/**
 * 纯函数文本差异（逐行 LCS），供主进程与渲染进程共用，也便于单元测试直接运行。
 * 不依赖任何 Node/浏览器 API。
 */

export type DiffOp = 'equal' | 'insert' | 'delete'

export interface DiffLine {
  op: DiffOp
  text: string
  /** 原文行号（1 起，insert 为 null） */
  aLine: number | null
  /** 新文行号（1 起，delete 为 null） */
  bLine: number | null
}

export interface DiffHunk {
  id: string
  /** equal 段用于折叠展示；change 段可逐处接受/拒绝 */
  kind: 'equal' | 'change'
  lines: DiffLine[]
}

function splitLines(text: string): string[] {
  // 保留末尾空行的语义：'a\n' -> ['a', '']，join('\n') 可无损还原
  return text.split('\n')
}

/**
 * 行级差异。超过阈值时退化为「整块替换」，避免 O(n·m) 在超长文本上卡死。
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const MAX = 4000
  if (a.length > MAX || b.length > MAX) {
    return coarseDiff(a, b)
  }
  const lcs = lcsTable(a, b)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'equal', text: a[i], aLine: i + 1, bLine: j + 1 })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: 'delete', text: a[i], aLine: i + 1, bLine: null })
      i++
    } else {
      out.push({ op: 'insert', text: b[j], aLine: null, bLine: j + 1 })
      j++
    }
  }
  while (i < a.length) {
    out.push({ op: 'delete', text: a[i], aLine: i + 1, bLine: null })
    i++
  }
  while (j < b.length) {
    out.push({ op: 'insert', text: b[j], aLine: null, bLine: j + 1 })
    j++
  }
  return out
}

function coarseDiff(a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = []
  const n = Math.min(a.length, b.length)
  let common = 0
  // 只保留首尾公共行，其余整块替换
  while (common < n && a[common] === b[common]) common++
  let tail = 0
  while (tail < n - common && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  for (let k = 0; k < common; k++) out.push({ op: 'equal', text: a[k], aLine: k + 1, bLine: k + 1 })
  for (let k = common; k < a.length - tail; k++) {
    out.push({ op: 'delete', text: a[k], aLine: k + 1, bLine: null })
  }
  for (let k = common; k < b.length - tail; k++) {
    out.push({ op: 'insert', text: b[k], aLine: null, bLine: k + 1 })
  }
  for (let k = 0; k < tail; k++) {
    const ai = a.length - tail + k
    out.push({ op: 'equal', text: a[ai], aLine: ai + 1, bLine: b.length - tail + k + 1 })
  }
  return out
}

function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

/** 把差异行按「连续非 equal」聚合为块；每块有稳定 id，便于接受/拒绝。 */
export function groupHunks(lines: DiffLine[], idPrefix = 'h'): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let idx = 0
  let cur: DiffLine[] = []
  let curKind: 'equal' | 'change' = 'equal'
  const flush = (): void => {
    if (cur.length === 0) return
    hunks.push({ id: `${idPrefix}${idx++}`, kind: curKind, lines: cur })
    cur = []
  }
  for (const ln of lines) {
    const kind = ln.op === 'equal' ? 'equal' : 'change'
    if (kind !== curKind) {
      flush()
      curKind = kind
    }
    cur.push(ln)
  }
  flush()
  return hunks
}

/** 便捷：文本差异 + 分块，一次完成。 */
export function diffHunks(before: string, after: string, idPrefix = 'h'): DiffHunk[] {
  return groupHunks(diffLines(before, after), idPrefix)
}

/**
 * 依据「接受/拒绝」的选择重建结果文本。
 * - equal 块恒取原文；
 * - change 块若被接受，取新文（insert 行）；若被拒绝，取原文（delete 行）。
 * @param accepted 被接受的 change 块 id 集合
 */
export function applyHunks(before: string, after: string, accepted: ReadonlySet<string>, idPrefix = 'h'): string {
  const hunks = diffHunks(before, after, idPrefix)
  const out: string[] = []
  for (const h of hunks) {
    if (h.kind === 'equal') {
      for (const ln of h.lines) out.push(ln.text)
    } else if (accepted.has(h.id)) {
      for (const ln of h.lines) if (ln.op !== 'delete') out.push(ln.text)
    } else {
      for (const ln of h.lines) if (ln.op !== 'insert') out.push(ln.text)
    }
  }
  return out.join('\n')
}

/** change 块的数量（用于界面提示「共 N 处」）。 */
export function countChanges(hunks: DiffHunk[]): number {
  return hunks.filter((h) => h.kind === 'change').length
}
