import type { CopyFormat } from '../../../shared/types'

/**
 * 复制格式（M5 验收要点 2）：纯文本 / Markdown / 网文格式。
 * 网文格式：段首空两格（可用全角空格）、段间空行——两者均可配置。
 */

export type { CopyFormat }

export interface CopyFormatOptions {
  /** 网文格式：段首空两格（默认 true） */
  indent?: boolean
  /** 网文格式：段间空行（默认 true） */
  blankLine?: boolean
}

/** 去掉 Markdown 标记，得到纯文本。 */
export function toPlainText(md: string): string {
  return md
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, '') // 标题
        .replace(/^\s{0,3}>\s?/, '') // 引用
        .replace(/^\s{0,3}[-*+]\s+/, '') // 无序列表
        .replace(/^\s{0,3}\d+\.\s+/, '') // 有序列表
        .replace(/```+/g, '') // 代码围栏
        .replace(/\*\*(.+?)\*\*/g, '$1') // 粗体
        .replace(/__(.+?)__/g, '$1')
        .replace(/\*(.+?)\*/g, '$1') // 斜体
        .replace(/_(.+?)_/g, '$1')
        .replace(/`(.+?)`/g, '$1') // 行内代码
        .replace(/!\[(.*?)\]\(.*?\)/g, '$1') // 图片
        .replace(/\[(.+?)\]\(.*?\)/g, '$1') // 链接
    )
    .join('\n')
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function toWebFormat(text: string, opts: CopyFormatOptions): string {
  const indent = opts.indent ?? true
  const blankLine = opts.blankLine ?? true
  const paras = paragraphs(toPlainText(text))
  const body = paras.map((p) => (indent ? `　　${p.replace(/^[　\s]+/, '')}` : p))
  return body.join(blankLine ? '\n\n' : '\n')
}

export function formatForCopy(text: string, format: CopyFormat, opts: CopyFormatOptions = {}): string {
  if (format === 'markdown') return text
  if (format === 'plain') return toPlainText(text)
  return toWebFormat(text, opts)
}
