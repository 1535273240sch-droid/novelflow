import type { SkillIssue } from '../../../shared/types'

/**
 * 结构化问题清单解析（验收要点 4）：
 * 「错别字与病句检查」「一致性检查」要求模型输出 JSON 数组，但真实模型经常
 * 加代码块、加解释、或输出半截 JSON。这里按「从严格到宽松」的阶梯解析，
 * 全部失败时**优雅降级**为纯文本（degraded=true），绝不抛异常。
 */

export interface ParseIssuesResult {
  issues: SkillIssue[]
  /** 是否为非结构化降级 */
  degraded: boolean
  degradedReason?: string
}

function stripFences(raw: string): string {
  const fence = /```[a-zA-Z]*\s*([\s\S]*?)```/.exec(raw)
  if (fence && fence[1].trim()) return fence[1].trim()
  return raw.trim()
}

/** 提取第一个平衡的 JSON 数组子串（字符串感知，避免把数组内 ] 提前截断）。 */
function firstBalancedArray(text: string): string | null {
  const start = text.indexOf('[')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function normalizeIssue(x: unknown): SkillIssue | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const original = typeof o.original === 'string' ? o.original : typeof o.原文 === 'string' ? (o.原文 as string) : ''
  const suggestion =
    typeof o.suggestion === 'string' ? o.suggestion : typeof o.建议 === 'string' ? (o.建议 as string) : ''
  if (!original.trim() || !suggestion.trim()) return null
  const reasonRaw = o.reason ?? o.类型 ?? o.type
  const issue: SkillIssue = {
    original,
    suggestion,
    ...(typeof reasonRaw === 'string' && reasonRaw.trim() ? { reason: reasonRaw } : {})
  }
  return issue
}

function fromArray(arr: unknown[]): SkillIssue[] | null {
  const out: SkillIssue[] = []
  for (const x of arr) {
    const issue = normalizeIssue(x)
    if (!issue) return null // 数组里出现畸形元素 → 交给下一级降级策略
    out.push(issue)
  }
  return out
}

/** 行式兜底：`原文 → 建议` / `原文 -> 建议` / `「原文」→「建议」`。 */
function parseArrowLines(raw: string): SkillIssue[] {
  const out: SkillIssue[] = []
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*[-*\d.、]*\s*[「“"]?(.+?)[」”"]?\s*(?:→|->|=>|⇒)\s*[「“"]?(.+?)[」”"]?\s*$/.exec(line)
    if (m && m[1].trim() && m[2].trim()) {
      out.push({ original: m[1].trim(), suggestion: m[2].trim(), reason: '（非结构化输出）' })
    }
  }
  return out
}

/**
 * 解析模型输出为问题清单。
 * @param raw 模型原始输出
 * @param targetText 可选：用于为每条 issue 计算 index/line，供界面定位
 */
export function parseIssues(raw: string, targetText = ''): ParseIssuesResult {
  const stripped = stripFences(raw)

  // 1) 直接 JSON（数组，或 {issues:[...]}）
  try {
    const parsed = JSON.parse(stripped) as unknown
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { issues?: unknown[] }).issues)
        ? ((parsed as { issues: unknown[] }).issues)
        : null
    if (arr) {
      const issues = fromArray(arr)
      if (issues) return { issues: locate(issues, targetText), degraded: false }
    }
  } catch {
    /* 继续下一级 */
  }

  // 2) 从混杂文本里抠出第一个平衡数组
  const balanced = firstBalancedArray(stripped)
  if (balanced) {
    try {
      const parsed = JSON.parse(balanced) as unknown
      if (Array.isArray(parsed)) {
        const issues = fromArray(parsed)
        if (issues) return { issues: locate(issues, targetText), degraded: false }
      }
    } catch {
      /* 继续下一级 */
    }
  }

  // 3) 行式箭头兜底
  const arrow = parseArrowLines(raw)
  if (arrow.length > 0) return { issues: locate(arrow, targetText), degraded: false }

  // 4) 优雅降级：保留原始文本
  return {
    issues: [],
    degraded: true,
    degradedReason: '模型输出不是可解析的结构化清单，已降级为纯文本，请人工查看'
  }
}

function locate(issues: SkillIssue[], targetText: string): SkillIssue[] {
  if (!targetText) return issues
  return issues.map((it) => {
    const index = targetText.indexOf(it.original)
    if (index < 0) return it
    const line = targetText.slice(0, index).split('\n').length
    return { ...it, index, line }
  })
}

/** 把问题清单按 `original` 逐条应用为目标文本（仅替换命中的第一条）。 */
export function applyIssues(targetText: string, issues: SkillIssue[], acceptedIndexes: ReadonlySet<number>): string {
  let out = targetText
  issues.forEach((it, i) => {
    if (!acceptedIndexes.has(i)) return
    const at = out.indexOf(it.original)
    if (at >= 0) out = out.slice(0, at) + it.suggestion + out.slice(at + it.original.length)
  })
  return out
}
