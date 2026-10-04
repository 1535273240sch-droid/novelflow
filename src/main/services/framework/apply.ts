import * as path from 'node:path'
import { atomicWriteFile } from '../storage/atomic'

/**
 * 故事框架落库（验收要点 1）：把「生成故事框架」Skill 的分节 Markdown 拆分为
 * bible/ 下的六个文件，人物一节按角色拆成 `bible/02-人物/<角色>.md`。
 *
 * 解析只依赖 `## ` 二级标题（Skill 被要求严格使用固定标题），标题缺失的段落会被忽略，
 * 不会覆盖已有文件——避免模型漏节时把既有设定清空。
 */

export interface ParsedFramework {
  overview: string
  worldview: string
  characters: Array<{ name: string; body: string }>
  mainline: string
  style: string
  timeline: string
  /** 未识别的二级标题（用于如实提示） */
  unknownSections: string[]
}

const OVERVIEW_KEYS = ['一句话梗概', '题材', '主题', '基调', '目标读者']

/** 拆 `## 标题` 分节。 */
function splitSections(md: string): Array<{ title: string; body: string }> {
  const lines = md.replace(/^\uFEFF/, '').split(/\r?\n/)
  const out: Array<{ title: string; body: string }> = []
  let current: { title: string; body: string[] } | null = null
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      if (current) out.push({ title: current.title, body: current.body.join('\n').trim() })
      current = { title: m[1].trim(), body: [] }
      continue
    }
    if (current) current.body.push(line)
  }
  if (current) out.push({ title: current.title, body: current.body.join('\n').trim() })
  return out
}

function cleanInline(s: string): string {
  return s
    .replace(/^#+\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/^\*\*(.+?)\*\*$/, '$1')
    .replace(/[:：]\s*$/, '')
    .trim()
}

/** 从「主要人物」一节拆出每个角色。优先 `### 姓名`，其次空行分段取首行姓名。 */
export function parseCharacters(section: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = []
  const subHeadings = section
    .split(/\r?\n/)
    .filter((l) => /^###\s+/.test(l))
  if (subHeadings.length > 0) {
    const parts = section.split(/\r?\n(?=###\s+)/)
    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const name = cleanInline(trimmed.split(/\r?\n/)[0])
      if (name) out.push({ name, body: trimmed.replace(/^###\s+/, '# ').trim() })
    }
    return out
  }
  // 空行分段：`姓名：身份...` 或 `姓名 / 身份 / ...`
  for (const para of section.split(/\n\s*\n/)) {
    const trimmed = para.trim()
    if (!trimmed) continue
    const firstLine = trimmed.split(/\r?\n/)[0]
    const m = /^([^：:/／]{1,12})\s*[:：/／]/.exec(cleanInline(firstLine))
    const name = (m ? m[1] : cleanInline(firstLine)).trim()
    if (name && name.length <= 12) out.push({ name, body: trimmed })
  }
  return out
}

export function parseFramework(md: string): ParsedFramework {
  const sections = splitSections(md)
  const overviewParts: string[] = []
  const result: ParsedFramework = {
    overview: '',
    worldview: '',
    characters: [],
    mainline: '',
    style: '',
    timeline: '',
    unknownSections: []
  }
  for (const s of sections) {
    if (OVERVIEW_KEYS.includes(s.title)) {
      overviewParts.push(`## ${s.title}\n${s.body}`)
    } else if (s.title === '世界观') {
      result.worldview = s.body
    } else if (s.title === '主要人物') {
      result.characters = parseCharacters(s.body)
    } else if (s.title === '主线与卷纲') {
      result.mainline = s.body
    } else if (s.title === '文风规范') {
      result.style = s.body
    } else if (s.title === '时间线') {
      result.timeline = s.body
    } else {
      result.unknownSections.push(s.title)
    }
  }
  result.overview = overviewParts.join('\n\n')
  return result
}

export function characterFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '')
  return `${safe || '未命名角色'}.md`
}

/** 把解析结果写入 bible/，返回写入的相对路径列表。未解析出的段不写入。 */
export async function applyFramework(root: string, fw: ParsedFramework): Promise<string[]> {
  const written: string[] = []
  const write = async (rel: string, content: string): Promise<void> => {
    await atomicWriteFile(path.join(root, rel), content.replace(/\s+$/, '') + '\n')
    written.push(rel)
  }
  if (fw.overview.trim()) await write('bible/00-概述.md', `# 概述\n\n${fw.overview.trim()}`)
  if (fw.worldview.trim()) await write('bible/01-世界观.md', `# 世界观\n\n${fw.worldview.trim()}`)
  const seen = new Set<string>()
  for (const c of fw.characters) {
    const file = characterFileName(c.name)
    if (seen.has(file)) continue
    seen.add(file)
    await write(`bible/02-人物/${file}`, c.body.trim())
  }
  if (fw.mainline.trim()) await write('bible/03-主线与卷纲.md', `# 主线与卷纲\n\n${fw.mainline.trim()}`)
  if (fw.style.trim()) await write('bible/04-文风规范.md', `# 文风规范\n\n${fw.style.trim()}`)
  if (fw.timeline.trim()) await write('bible/05-时间线.md', `# 时间线\n\n${fw.timeline.trim()}`)
  return written
}
