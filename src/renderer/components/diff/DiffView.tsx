import { useMemo } from 'react'
import { diffHunks, type DiffHunk } from '../../../shared/diff'

interface Props {
  before: string
  after: string
  accepted: ReadonlySet<string>
  onToggle: (id: string) => void
}

/** 折叠过长的 equal 段，只保留靠近变更的上下文行。 */
function visibleEqualLines(hunk: DiffHunk): { lines: DiffHunk['lines']; truncated: boolean } {
  const MAX = 6
  if (hunk.lines.length <= MAX) return { lines: hunk.lines, truncated: false }
  return { lines: hunk.lines.slice(0, MAX), truncated: true }
}

/**
 * 差异视图：equal 段折叠展示，change 段逐处「接受 / 拒绝」（验收要点 3、5）。
 */
export function DiffView({ before, after, accepted, onToggle }: Props) {
  const hunks = useMemo(() => diffHunks(before, after), [before, after])
  const changes = hunks.filter((h) => h.kind === 'change')

  if (changes.length === 0) {
    return <div className="nf-callout nf-callout-info text-sm">结果与原文一致，没有可应用的改动。</div>
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="text-xs text-slate-500">共 {changes.length} 处改动，逐处勾选后应用。</div>
      {hunks.map((h) => {
        if (h.kind === 'equal') {
          const { lines, truncated } = visibleEqualLines(h)
          return (
            <div key={h.id} className="nf-inset px-2 py-1">
              {lines.map((ln, i) => (
                <div key={i} className="truncate font-mono text-xs text-slate-400">
                  {ln.text || '\u00a0'}
                </div>
              ))}
              {truncated && <div className="font-mono text-xs text-slate-400">…（略）</div>}
            </div>
          )
        }
        const isAccepted = accepted.has(h.id)
        return (
          <div
            key={h.id}
            className={`overflow-hidden rounded-md border transition-colors ${
              isAccepted ? 'border-green-300' : 'border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between bg-slate-100 px-2 py-1">
              <span className={`text-xs ${isAccepted ? 'text-green-700' : 'text-slate-500'}`}>
                {isAccepted ? '✓ 已接受' : '未接受'}
              </span>
              <button
                onClick={() => onToggle(h.id)}
                className={`nf-btn nf-btn-sm ${isAccepted ? 'nf-btn-ghost' : 'nf-btn-primary'}`}
              >
                {isAccepted ? '改为拒绝' : '接受此处'}
              </button>
            </div>
            <div className="font-mono text-xs leading-relaxed">
              {h.lines.map((ln, i) => (
                <div
                  key={i}
                  className={
                    ln.op === 'delete'
                      ? 'bg-red-50 px-2 text-red-700 line-through'
                      : ln.op === 'insert'
                        ? 'bg-green-50 px-2 text-green-800'
                        : 'px-2 text-slate-500'
                  }
                >
                  {ln.op === 'delete' ? '- ' : ln.op === 'insert' ? '+ ' : '  '}
                  {ln.text || '\u00a0'}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
