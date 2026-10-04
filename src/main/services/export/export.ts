import { toPlainText } from './copy-format'
import type { ExportFormat } from '../../../shared/types'

/**
 * 导出（M5 验收要点 1）：单章 / 整卷 / 全书 → .txt / .md / .docx。
 *
 * docx 依赖 `docx`（MIT License，纯 JS，无原生模块；已在 README 依赖表注明）。
 * 本模块的文本渲染为纯函数，便于单测；文件写入由 IPC 层负责。
 */

export type { ExportFormat }

export interface ExportChapter {
  name: string
  content: string
}

export const DOCX_LICENSE = 'docx (MIT License) — https://github.com/dolanmiu/docx'

/** 渲染 txt / md 文本。 */
export function renderTextExport(title: string, chapters: ExportChapter[], format: 'txt' | 'md'): string {
  const parts: string[] = []
  if (format === 'md') {
    parts.push(`# ${title}`)
    for (const ch of chapters) {
      parts.push(`\n## ${ch.name}\n`)
      parts.push(ch.content.trim())
    }
  } else {
    parts.push(title)
    for (const ch of chapters) {
      parts.push(`\n${ch.name}\n`)
      parts.push(toPlainText(ch.content).trim())
    }
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** 渲染 docx（返回二进制 Buffer）。 */
export async function renderDocxExport(title: string, chapters: ExportChapter[]): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel } = await import('docx')
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE })
  ]
  for (const ch of chapters) {
    children.push(new Paragraph({ text: ch.name, heading: HeadingLevel.HEADING_1 }))
    for (const line of ch.content.split(/\r?\n/)) {
      children.push(new Paragraph({ text: line }))
    }
  }
  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}

export function exportFileName(title: string, format: ExportFormat): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'novelflow-export'
  return `${safe}.${format}`
}
