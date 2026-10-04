import type { ModelRole } from '../../../shared/types'
import type { Skill, SkillOutputKind } from '../../../shared/types'

/**
 * SKILL.md 解析与序列化（YAML 头 + 正文）。
 *
 * 只实现本仓库所需的最小 YAML 子集：`key: value`、`key: [a, b]`、以及
 * `key:` 后跟缩进 `- item` 的块状列表。这是刻意为之：不引入第三方 YAML 依赖
 * （见 README「无闭源依赖」），代价是不支持锚点、多行折叠等进阶语法，已在此声明。
 */

export class SkillParseError extends Error {}

export interface ParsedFrontmatter {
  meta: Record<string, unknown>
  body: string
}

const DELIM = /^---\s*$/

function coerce(scalar: string): unknown {
  const v = scalar.trim()
  if (v === '') return ''
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1).replace(/''/g, "'")
  }
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null' || v === '~') return null
  if (/^-?\d+$/.test(v)) return parseInt(v, 10)
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v)
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((x) => coerce(x))
  }
  return v
}

/** 解析 YAML 子集（仅顶层键；支持块状列表）。 */
export function parseYamlSubset(source: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const lines = source.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.replace(/\t/g, '  ')
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }
    const m = /^([A-Za-z0-9_.\u4e00-\u9fa5-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) {
      throw new SkillParseError(`无法解析的头部行：${raw}`)
    }
    const key = m[1]
    const rest = m[2]
    if (rest !== '') {
      out[key] = coerce(rest)
      i++
      continue
    }
    // 块状列表
    const items: unknown[] = []
    let j = i + 1
    while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
      items.push(coerce(lines[j].replace(/^\s+-\s+/, '')))
      j++
    }
    if (items.length > 0) {
      out[key] = items
      i = j
    } else {
      out[key] = ''
      i++
    }
  }
  return out
}

/** 拆分 frontmatter 与正文；无 frontmatter 时 meta 为空、body 为全文。 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const normalized = text.replace(/^\uFEFF/, '')
  const lines = normalized.split(/\r?\n/)
  if (lines.length === 0 || !DELIM.test(lines[0])) {
    return { meta: {}, body: normalized }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (DELIM.test(lines[i])) {
      end = i
      break
    }
  }
  if (end === -1) {
    throw new SkillParseError('frontmatter 缺少结束的 --- 分隔线')
  }
  const meta = parseYamlSubset(lines.slice(1, end).join('\n'))
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '')
  return { meta, body }
}

const OUTPUT_KINDS: SkillOutputKind[] = ['text', 'rewrite', 'issues']
const ROLES: ModelRole[] = ['planner', 'writer', 'checker', 'polisher']

export interface SkillFileParseResult {
  skill: Omit<Skill, 'builtin' | 'createdAt' | 'updatedAt'>
}

/**
 * 把 SKILL.md 文本解析为 Skill 主体（不含库元数据 builtin/createdAt/updatedAt）。
 * @param opts.fallbackId 头部缺 id 时使用（导入时由文件名派生）
 */
export function parseSkillFile(text: string, opts: { fallbackId?: string } = {}): SkillFileParseResult {
  const { meta, body } = parseFrontmatter(text)
  const id = typeof meta.id === 'string' && meta.id.trim() ? meta.id.trim() : (opts.fallbackId ?? '')
  if (!id) throw new SkillParseError('SKILL.md 缺少 id 字段')
  if (!isValidSkillId(id)) throw new SkillParseError(`非法 Skill id：${id}`)
  const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : id
  const output = OUTPUT_KINDS.includes(meta.output as SkillOutputKind)
    ? (meta.output as SkillOutputKind)
    : 'text'
  const recommendedModel =
    typeof meta.recommended_model === 'string' && ROLES.includes(meta.recommended_model as ModelRole)
      ? (meta.recommended_model as ModelRole)
      : null
  const inputs = Array.isArray(meta.inputs)
    ? meta.inputs.map((x) => String(x)).filter((x) => x.length > 0)
    : []
  const version = typeof meta.version === 'number' && meta.version > 0 ? Math.floor(meta.version) : 1
  const description = typeof meta.description === 'string' ? meta.description : ''
  if (!body.trim()) throw new SkillParseError('SKILL.md 正文为空')
  return { skill: { id, name, description, output, recommendedModel, inputs, version, body } }
}

function quoteIfNeeded(v: string): string {
  if (v === '') return '""'
  if (/^[\w\u4e00-\u9fa5.\-]+$/.test(v)) return v
  return `"${v.replace(/"/g, '\\"')}"`
}

/** 序列化为标准 SKILL.md（字段顺序固定，便于人工阅读与 diff）。 */
export function serializeSkill(skill: Skill): string {
  const lines: string[] = ['---']
  lines.push(`id: ${quoteIfNeeded(skill.id)}`)
  lines.push(`name: ${quoteIfNeeded(skill.name)}`)
  if (skill.description) lines.push(`description: ${quoteIfNeeded(skill.description)}`)
  lines.push(`version: ${skill.version}`)
  if (skill.recommendedModel) lines.push(`recommended_model: ${skill.recommendedModel}`)
  lines.push(`output: ${skill.output}`)
  if (skill.inputs.length > 0) {
    lines.push('inputs:')
    for (const v of skill.inputs) lines.push(`  - ${quoteIfNeeded(v)}`)
  } else {
    lines.push('inputs: []')
  }
  lines.push('---', '', skill.body.replace(/\s+$/, ''), '')
  return lines.join('\n')
}

/** Skill id 同时是文件名：禁止路径分隔符与纯点号，允许中文等 Unicode 字母数字。 */
export function isValidSkillId(id: string): boolean {
  if (!id || id === '.' || id === '..') return false
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id)
}
