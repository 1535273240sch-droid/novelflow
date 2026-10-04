/**
 * Skill 变量替换：识别并替换 `{{变量}}` 占位符。
 *
 * 支持两类（对应验收要点 2）：
 * - 顶层变量：`{{chapter_text}}`、`{{selection}}`、`{{chapter_no}}` …；
 * - 项目文件：`{{bible.文风规范}}`，其中 `bible.X` 由主进程读取项目 `bible/` 下的文件注入，
 *   同时接受带序号/扩展名的键（`04-文风规范`、`04-文风规范.md`）。
 *
 * 缺变量在严格模式下**明确报错**，不做静默留空。
 */

export class MissingVariableError extends Error {
  constructor(public readonly missing: string[]) {
    super(`缺少 Skill 变量：${missing.join('、')}`)
    this.name = 'MissingVariableError'
  }
}

export type VarContext = Record<string, unknown>

const VAR_RE = /\{\{\s*([A-Za-z0-9_.\u4e00-\u9fa5-]+)\s*\}\}/g

/** 提取正文中出现的变量名（去重、保持出现顺序）。 */
export function extractVars(body: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of body.matchAll(VAR_RE)) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

function toText(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v, null, 2)
}

/**
 * 解析单个变量名。
 * - `bible.X` 在 ctx.bible 内按 X 精确匹配；找不到时退化为「去序号/去扩展名」模糊匹配。
 */
export function resolveVar(name: string, ctx: VarContext): string | undefined {
  if (name.includes('.')) {
    const [head, ...rest] = name.split('.')
    const path = rest.join('.')
    const container = ctx[head]
    if (container && typeof container === 'object') {
      const map = container as Record<string, unknown>
      if (path in map) return toText(map[path])
      const norm = (s: string): string => s.replace(/^\d+[-_]/, '').replace(/\.md$/i, '')
      const target = norm(path)
      for (const [k, v] of Object.entries(map)) {
        if (norm(k) === target) return toText(v)
      }
    }
    return undefined
  }
  return toText(ctx[name])
}

export interface SubstituteOptions {
  /** 严格模式（默认 true）：缺变量抛出 MissingVariableError */
  strict?: boolean
}

export interface SubstituteResult {
  text: string
  missing: string[]
}

/** 替换全部 `{{变量}}`；严格模式下遇到缺失变量直接抛错。 */
export function substitute(body: string, ctx: VarContext, opts: SubstituteOptions = {}): SubstituteResult {
  const strict = opts.strict ?? true
  const missing: string[] = []
  const text = body.replace(VAR_RE, (whole, name: string) => {
    const v = resolveVar(name, ctx)
    if (v === undefined) {
      missing.push(name)
      return whole
    }
    return v
  })
  if (strict && missing.length > 0) {
    throw new MissingVariableError(Array.from(new Set(missing)))
  }
  return { text, missing }
}

/** 仅返回未解析成功的变量名（用于界面预检）。 */
export function findMissing(body: string, ctx: VarContext): string[] {
  const missing: string[] = []
  for (const name of extractVars(body)) {
    if (resolveVar(name, ctx) === undefined) missing.push(name)
  }
  return missing
}
