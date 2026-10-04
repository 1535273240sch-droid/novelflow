import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { SkillRegistry } from './registry'
import { extractVars, findMissing, substitute, MissingVariableError } from './vars'
import { parseIssues } from './output'
import type { ChatMessage, PresetCreds } from '../llm/adapters'
import type { Skill, SkillOutputKind, SkillRunParams, SkillRunResult } from '../../../shared/types'

/**
 * Skill 运行器：把「选中的 Skill + 项目上下文 + 目标文本」组装为一次 LLM 调用，
 * 再把模型输出解析为可应用的形态（改写文本 / 结构化工单）。
 *
 * 本模块不 import electron；LLM 调用经注入的 ChatInvoker，单测可完全 mock。
 * 提示词一律来自 skill.body，本模块不含任何提示词文本（验收要点 8）。
 */

export interface ChatInvoker {
  (req: {
    preset: PresetCreds
    messages: ChatMessage[]
    onDelta?: (full: string) => void
    signal?: AbortSignal
  }): Promise<{ text: string }>
}

export interface PreparedRun {
  skill: Skill
  kind: SkillOutputKind
  messages: ChatMessage[]
  /** 目标文本（选中文本或整章），issues 定位用 */
  targetText: string
  /** 已解析出的变量快照，便于界面展示「本次实际发送的上下文」 */
  variables: Record<string, string>
}

export class SkillRunError extends Error {}

function keyVariants(fileName: string): string[] {
  const noExt = fileName.replace(/\.md$/i, '')
  const noIndex = noExt.replace(/^\d+[-_]/, '')
  return Array.from(new Set([fileName, noExt, noIndex]))
}

/** 读取项目内某个相对目录下的 .md（只一层，用于 bible/ 与 bible/02-人物/）。 */
async function readMdDir(dir: string): Promise<Array<{ name: string; content: string }>> {
  let names: string[] = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: Array<{ name: string; content: string }> = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const content = await fs.readFile(path.join(dir, name), 'utf8').catch(() => '')
    out.push({ name, content })
  }
  return out
}

/**
 * 从项目目录装载基础上下文（M2 版：bible + state + 人物）。
 * M3 的 Context Builder 会在此基础上加入 token 预算与优先级裁剪。
 */
export async function loadBaseContext(projectRoot: string): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {}
  const bible: Record<string, string> = {}
  for (const f of await readMdDir(path.join(projectRoot, 'bible'))) {
    for (const k of keyVariants(f.name)) bible[k] = f.content
  }
  ctx.bible = bible

  const profiles = await readMdDir(path.join(projectRoot, 'bible', '02-人物'))
  if (profiles.length > 0) {
    ctx.character_profiles = profiles.map((p) => p.content).join('\n\n')
  }

  const stateParts: string[] = []
  for (const name of ['characters.json', 'foreshadowing.json', 'events.json']) {
    const raw = await fs.readFile(path.join(projectRoot, 'state', name), 'utf8').catch(() => '')
    if (raw) stateParts.push(`【${name}】\n${raw}`)
  }
  if (stateParts.length > 0) ctx.current_state = stateParts.join('\n\n')

  // 未回收伏笔（供「章节规划」使用）
  const foreshadowingRaw = await fs
    .readFile(path.join(projectRoot, 'state', 'foreshadowing.json'), 'utf8')
    .catch(() => '')
  if (foreshadowingRaw) {
    try {
      const j = JSON.parse(foreshadowingRaw) as { items?: Array<{ text?: string; status?: string }> }
      const open = (j.items ?? [])
        .filter((it) => it.status !== 'resolved' && it.status !== '已回收')
        .map((it) => `- ${it.text ?? ''}`)
      if (open.length > 0) ctx.open_foreshadowing = open.join('\n')
    } catch {
      /* 状态文件损坏不影响运行 */
    }
  }

  const metaRaw = await fs.readFile(path.join(projectRoot, 'novel.json'), 'utf8').catch(() => '')
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw) as { name?: string; genre?: string; targetWords?: number }
      if (meta.genre) ctx.genre = meta.genre
      if (meta.targetWords) ctx.target_words = String(meta.targetWords)
      if (meta.name) ctx.novel_name = meta.name
    } catch {
      /* 忽略 */
    }
  }
  return ctx
}

/** 章号 → 相对路径（与 ProjectStore.chapterFileName 保持一致）。 */
function chapterRel(kind: 'chapters' | 'outline', n: number): string {
  return `${kind}/第${String(n).padStart(3, '0')}章.md`
}

export class SkillRunner {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly projectRoot: string
  ) {}

  /**
   * 组装上下文与消息，但**不调用模型**。IPC 层据此发起流式调用，测试可直接注入 mock。
   * 缺变量在严格模式下抛 MissingVariableError（验收要点 2）。
   */
  async prepare(params: SkillRunParams): Promise<PreparedRun> {
    const skill = await this.registry.get(params.skillId)
    if (!skill) throw new SkillRunError(`Skill 不存在：${params.skillId}`)

    const base = await loadBaseContext(this.projectRoot)
    const ctx: Record<string, unknown> = { ...base }

    // 目标文本：整章 / 选中文本。两种目标都注入 chapter_text，便于内置 Skill 通用；
    // 选中文本另外注入 selection，供只处理片段的 Skill 使用。
    ctx.chapter_text = params.text
    if (params.target === 'selection') ctx.selection = params.text

    if (params.chapterNo != null) {
      ctx.chapter_no = String(params.chapterNo)
      const plan = await fs
        .readFile(path.join(this.projectRoot, chapterRel('outline', params.chapterNo)), 'utf8')
        .catch(() => '')
      if (plan) ctx.chapter_plan = plan
      if (params.chapterNo > 1) {
        const prev = await fs
          .readFile(path.join(this.projectRoot, chapterRel('chapters', params.chapterNo - 1)), 'utf8')
          .catch(() => '')
        if (prev.trim()) ctx.previous_tail = prev.trim().slice(-800)
      }
    }

    if (params.vars) {
      for (const [k, v] of Object.entries(params.vars)) if (v != null) ctx[k] = v
    }

    const declared = extractVars(skill.body)
    const missing = findMissing(skill.body, ctx)
    if (missing.length > 0) {
      throw new MissingVariableError(missing)
    }
    const { text: prompt } = substitute(skill.body, ctx, { strict: true })
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }]

    const variables: Record<string, string> = {}
    for (const name of declared) {
      const v = name.includes('.')
        ? (ctx[name.split('.')[0]] as Record<string, string> | undefined)?.[name.split('.').slice(1).join('.')]
        : (ctx[name] as string | undefined)
      variables[name] = v ?? ''
    }

    return { skill, kind: skill.output, messages, targetText: params.text, variables }
  }

  /** 把模型原始输出解析为最终结果。 */
  finalize(prep: PreparedRun, raw: string): SkillRunResult {
    if (prep.kind === 'issues') {
      const parsed = parseIssues(raw, prep.targetText)
      return {
        kind: 'issues',
        raw,
        issues: parsed.issues,
        degraded: parsed.degraded,
        ...(parsed.degradedReason ? { degradedReason: parsed.degradedReason } : {})
      }
    }
    const text = raw.trim() ? raw : ''
    return { kind: prep.kind, raw, text }
  }

  /** 非流式便捷入口（测试直接注入 mock invoker 与预设凭据）。 */
  async run(params: SkillRunParams, preset: PresetCreds, invoker: ChatInvoker): Promise<SkillRunResult> {
    const prep = await this.prepare(params)
    const { text } = await invoker({ preset, messages: prep.messages })
    return this.finalize(prep, text)
  }
}
