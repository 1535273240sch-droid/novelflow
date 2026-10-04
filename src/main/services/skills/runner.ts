import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { SkillRegistry } from './registry'
import { extractVars, findMissing, substitute, MissingVariableError } from './vars'
import { parseIssues } from './output'
import { buildChapterContext, openForeshadowing, DEFAULT_BUDGET } from '../context/builder'
import { checkSkillRequires } from '../context/gates'
import type { ChatMessage, PresetCreds } from '../llm/adapters'
import type { Skill, SkillOutputKind, SkillRunParams, SkillRunResult } from '../../../shared/types'

/**
 * Skill 运行器：把「选中的 Skill + 项目上下文 + 目标文本」组装为一次 LLM 调用，
 * 再把模型输出解析为可应用的形态（改写文本 / 结构化工单）。
 *
 * 上下文装配复用 M3 的 Context Builder（六条优先级 + token 裁剪），因此
 * 「查看本次实际发送的上下文」与实际发送内容必然一致。
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
  /** 本次使用的上下文预算与裁剪结果（供预览展示） */
  context?: { budget: number; totalTokens: number; droppedKeys: string[]; overBudget: boolean }
}

export class SkillRunError extends Error {}

function keyVariants(fileName: string): string[] {
  const noExt = fileName.replace(/\.md$/i, '')
  const noIndex = noExt.replace(/^\d+[-_]/, '')
  return Array.from(new Set([fileName, noExt, noIndex]))
}

/** 读取项目内某个相对目录下的 .md（只一层）。 */
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

/** bible 变量表（`{{bible.文风规范}}` 等）。 */
export async function loadBibleMap(root: string): Promise<Record<string, string>> {
  const bible: Record<string, string> = {}
  for (const f of await readMdDir(path.join(root, 'bible'))) {
    for (const k of keyVariants(f.name)) bible[k] = f.content
  }
  return bible
}

export class SkillRunner {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly projectRoot: string
  ) {}

  /**
   * 组装上下文与消息，但**不调用模型**。IPC 层据此发起流式调用，测试可直接注入 mock。
   * 缺变量在严格模式下抛 MissingVariableError（M2 验收要点 2）；缺前置依赖抛 ChapterGateError（M3 验收要点 3）。
   */
  async prepare(params: SkillRunParams): Promise<PreparedRun> {
    const skill = await this.registry.get(params.skillId)
    if (!skill) throw new SkillRunError(`Skill 不存在：${params.skillId}`)

    // 前置门禁：如 write-chapter 要求本章计划已存在
    await checkSkillRequires(this.projectRoot, params.chapterNo, skill.requires)

    const bible = await loadBibleMap(this.projectRoot)
    const ctx: Record<string, unknown> = { bible }

    // 目标文本：整章 / 选中文本。两种目标都注入 chapter_text；选中文本另注入 selection。
    ctx.chapter_text = params.text
    if (params.target === 'selection') ctx.selection = params.text

    const metaRaw = await fs.readFile(path.join(this.projectRoot, 'novel.json'), 'utf8').catch(() => '')
    if (metaRaw) {
      try {
        const meta = JSON.parse(metaRaw) as { name?: string; genre?: string; targetWords?: number }
        if (meta.genre) ctx.genre = meta.genre
        if (meta.targetWords) ctx.target_words = String(meta.targetWords)
        if (meta.name) ctx.novel_name = meta.name
      } catch {
        /* 忽略损坏的 novel.json */
      }
    }

    let context: PreparedRun['context']
    if (params.chapterNo != null) {
      ctx.chapter_no = String(params.chapterNo)
      const built = await buildChapterContext(this.projectRoot, params.chapterNo, {
        budget: params.budget ?? DEFAULT_BUDGET
      })
      const byKey = new Map(built.sections.map((s) => [s.key, s]))
      // 无论脚手架段是否被裁剪，都把「原文」变量注入为可用值（空则由 Skill 决定是否必需）
      ctx.chapter_plan = byKey.get('chapter_plan')?.content ?? ''
      ctx.character_profiles = byKey.get('character_profiles')?.content ?? ''
      ctx.current_state = byKey.get('current_state')?.content ?? ''
      ctx.previous_tail = byKey.get('previous_tail')?.content ?? ''
      ctx.recap = byKey.get('recap')?.content ?? ''
      ctx.style_worldview = byKey.get('style_worldview')?.content ?? ''
      // 完整组装文本（六条优先级 + 裁剪后的结果），供需要整体上下文的 Skill 使用
      ctx.context_text = built.text
      const fs2 = await fs.readFile(path.join(this.projectRoot, 'state', 'foreshadowing.json'), 'utf8').catch(() => '')
      if (fs2) {
        try {
          const open = openForeshadowing(JSON.parse(fs2) as { items?: Array<{ text?: string; status?: string }> })
          if (open.length) ctx.open_foreshadowing = open.map((t) => `- ${t}`).join('\n')
        } catch {
          /* 忽略 */
        }
      }
      context = {
        budget: built.budget,
        totalTokens: built.totalTokens,
        droppedKeys: built.droppedKeys,
        overBudget: built.overBudget
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

    return { skill, kind: skill.output, messages, targetText: params.text, variables, context }
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
    return { kind: prep.kind, raw, text: raw.trim() ? raw : '' }
  }

  /** 非流式便捷入口（测试直接注入 mock invoker 与预设凭据）。 */
  async run(params: SkillRunParams, preset: PresetCreds, invoker: ChatInvoker): Promise<SkillRunResult> {
    const prep = await this.prepare(params)
    const { text } = await invoker({ preset, messages: prep.messages })
    return this.finalize(prep, text)
  }
}
