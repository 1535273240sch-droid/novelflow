import { promises as fs } from 'node:fs'
import * as path from 'node:path'

/**
 * Context Builder（说明书 3.5，六条优先级）。
 *
 * 优先级（数字越小越不可裁剪）：
 *   1 文风规范 + 世界观要点
 *   2 本章计划
 *   3 出场人物档案（按本章计划按需加载）
 *   4 当前状态（人物最新状态 + 未回收伏笔）
 *   5 前情摘要（最近 N 章；更早章节一句话摘要）
 *   6 上一章结尾原文
 *
 * token 预算：超出时按 6 → 5 → 4 → 3 的顺序整段裁剪，**1–2 永不裁剪**。
 * 本模块只依赖 node:fs，便于单测直接运行。
 */

export type Priority = 1 | 2 | 3 | 4 | 5 | 6

export interface ContextSection {
  priority: Priority
  key: string
  title: string
  content: string
  tokens: number
  /** 因预算被裁掉 */
  dropped: boolean
}

export interface BuiltContext {
  sections: ContextSection[]
  /** 按优先级顺序拼接的正文（已裁掉的段不包含） */
  text: string
  totalTokens: number
  budget: number
  overBudget: boolean
  /** 被裁掉的段 key，按裁剪顺序 */
  droppedKeys: string[]
}

export interface BuildOptions {
  /** token 预算；默认 6000 */
  budget?: number
  /** 「最近 N 章」中的 N，默认 3 */
  recentChapters?: number
  /** 上一章结尾保留字数，默认 800 */
  tailChars?: number
}

export const DEFAULT_BUDGET = 6000

/**
 * token 估算（启发式）：中英混排按约 1.5 字符 / token。
 * 只用于预算裁剪的相对比较，不追求与具体 tokenizer 一致。
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

async function readOrUndefined(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return undefined
  }
}

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

export function chapterRel(kind: 'chapters' | 'outline', n: number): string {
  return `${kind}/第${String(n).padStart(3, '0')}章.md`
}

/** 从章节计划里解析「出场人物」列表。 */
export function parseAppearingCharacters(plan: string): string[] {
  const line = plan
    .split(/\r?\n/)
    .find((l) => /出场人物\s*[：:]/.test(l))
  if (!line) return []
  const raw = line.replace(/^.*?出场人物\s*[：:]\s*/, '')
  return raw
    .split(/[、，,;；/\s]+/)
    .map((s) => s.replace(/^[-*\d.、\s]+/, '').trim())
    .filter((s) => s.length > 0 && s.length <= 12)
}

/** 取文本的一句话摘要（跳过 Markdown 标题，取首个正文句）。 */
export function oneLineSummary(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^#+\s/.test(l))
    .map((l) => l.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  const m = /^(.{1,60}?[。！？!?])/.exec(line)
  return m ? m[1] : line.slice(0, 60)
}

/** 未回收伏笔（foreshadowing.json）。 */
export function openForeshadowing(state: {
  items?: Array<{ text?: string; status?: string }>
}): string[] {
  return (state.items ?? [])
    .filter((it) => it.status !== 'resolved' && it.status !== '已回收' && (it.text ?? '').trim())
    .map((it) => (it.text ?? '').trim())
}

/** 人物最新状态（characters.json）。 */
export function characterStatusLines(state: {
  characters?: Array<{ name?: string; status?: string; location?: string }>
}): string[] {
  return (state.characters ?? [])
    .filter((c) => (c.name ?? '').trim())
    .map((c) => {
      const parts = [c.status, c.location].filter((x) => (x ?? '').trim())
      return `- ${c.name}${parts.length ? `：${parts.join('；')}` : ''}`
    })
}

export async function buildChapterContext(
  root: string,
  chapterNo: number,
  opts: BuildOptions = {}
): Promise<BuiltContext> {
  const budget = opts.budget ?? DEFAULT_BUDGET
  const recentChapters = opts.recentChapters ?? 3
  const tailChars = opts.tailChars ?? 800

  const style = (await readOrUndefined(path.join(root, 'bible', '04-文风规范.md'))) ?? ''
  const worldview = (await readOrUndefined(path.join(root, 'bible', '01-世界观.md'))) ?? ''
  const plan = (await readOrUndefined(path.join(root, chapterRel('outline', chapterNo)))) ?? ''

  const profileFiles = await readMdDir(path.join(root, 'bible', '02-人物'))
  const appearing = chapterNo > 0 ? parseAppearingCharacters(plan) : []
  const profiles = appearing
    .map((name) => {
      const hit = profileFiles.find((f) => f.name.replace(/\.md$/, '') === name)
      return hit ? hit.content : ''
    })
    .filter((x) => x.trim())

  const charactersJson = await readOrUndefined(path.join(root, 'state', 'characters.json'))
  const foreshadowingJson = await readOrUndefined(path.join(root, 'state', 'foreshadowing.json'))
  const stateParts: string[] = []
  if (charactersJson) {
    try {
      const j = JSON.parse(charactersJson) as { characters?: Array<{ name?: string; status?: string; location?: string }> }
      const lines = characterStatusLines(j)
      if (lines.length) stateParts.push(`【人物最新状态】\n${lines.join('\n')}`)
    } catch {
      /* 忽略损坏状态 */
    }
  }
  if (foreshadowingJson) {
    try {
      const j = JSON.parse(foreshadowingJson) as { items?: Array<{ text?: string; status?: string }> }
      const lines = openForeshadowing(j)
      if (lines.length) stateParts.push(`【未回收伏笔】\n${lines.map((t) => `- ${t}`).join('\n')}`)
    } catch {
      /* 忽略 */
    }
  }

  // 前情：更早章节一句话摘要 + 最近 N 章原文
  const chapterFiles: Array<{ n: number; content: string }> = []
  const chaptersDir = path.join(root, 'chapters')
  let names: string[] = []
  try {
    names = await fs.readdir(chaptersDir)
  } catch {
    names = []
  }
  for (const name of names) {
    const m = /^第(\d+)章\.md$/.exec(name)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (n >= chapterNo) continue
    const content = await fs.readFile(path.join(chaptersDir, name), 'utf8').catch(() => '')
    chapterFiles.push({ n, content })
  }
  chapterFiles.sort((a, b) => a.n - b.n)
  const recapParts: string[] = []
  for (const cf of chapterFiles) {
    if (cf.n > chapterFiles.length - recentChapters && cf.n >= chapterNo - recentChapters) {
      recapParts.push(`【第${cf.n}章】\n${cf.content}`)
    } else {
      recapParts.push(`- 第${cf.n}章：${oneLineSummary(cf.content)}`)
    }
  }
  const recap = recapParts.join('\n')

  const prevRaw =
    chapterNo > 1
      ? ((await readOrUndefined(path.join(root, chapterRel('chapters', chapterNo - 1)))) ?? '')
      : ''
  const prevTail = prevRaw.trim() ? prevRaw.trim().slice(-tailChars) : ''

  const specs: Array<{ priority: Priority; key: string; title: string; content: string }> = [
    {
      priority: 1,
      key: 'style_worldview',
      title: '文风规范与世界观要点',
      content: [style, worldview].filter((x) => x.trim()).join('\n\n')
    },
    { priority: 2, key: 'chapter_plan', title: '本章计划', content: plan.trim() },
    { priority: 3, key: 'character_profiles', title: '出场人物档案', content: profiles.join('\n\n') },
    { priority: 4, key: 'current_state', title: '当前状态', content: stateParts.join('\n\n') },
    { priority: 5, key: 'recap', title: '前情摘要', content: recap.trim() },
    { priority: 6, key: 'previous_tail', title: '上一章结尾', content: prevTail }
  ]

  const sections: ContextSection[] = specs.map((s) => ({
    priority: s.priority,
    key: s.key,
    title: s.title,
    content: s.content,
    tokens: estimateTokens(s.content),
    dropped: false
  }))

  const total = (): number => sections.reduce((sum, s) => (s.dropped ? sum : sum + s.tokens), 0)
  const droppedKeys: string[] = []
  // 按 6 → 5 → 4 → 3 顺序裁剪；1–2 永不动
  for (const p of [6, 5, 4, 3] as const) {
    if (total() <= budget) break
    for (const s of sections) {
      if (s.priority === p && !s.dropped && s.content.trim()) {
        s.dropped = true
        droppedKeys.push(s.key)
        break
      }
    }
  }

  const kept = sections.filter((s) => !s.dropped && s.content.trim())
  const text = kept.map((s) => `## ${s.title}\n${s.content}`).join('\n\n')
  return {
    sections,
    text,
    totalTokens: total(),
    budget,
    overBudget: total() > budget,
    droppedKeys
  }
}
