import { describe, expect, it } from 'vitest'
import { formatForCopy, toPlainText } from '../../src/main/services/export/copy-format'

describe('纯文本：去 Markdown 标记（验收要点 2）', () => {
  it('去标题、列表、强调、链接标记', () => {
    const md = '# 标题\n\n**粗体**与*斜体*，[链接](http://a)与`代码`。\n\n- 列表项\n> 引用'
    const plain = toPlainText(md)
    expect(plain).not.toContain('#')
    expect(plain).not.toContain('**')
    expect(plain).not.toContain('](')
    expect(plain).toContain('粗体与斜体，链接与代码。')
    expect(plain).toContain('列表项')
    expect(plain).toContain('引用')
  })
})

describe('网文格式：段首空两格 + 段间空行（可配置）', () => {
  const text = '# 第一章\n\n第一段内容。\n\n第二段内容。'

  it('默认：段首两格、段间空行', () => {
    const out = formatForCopy(text, 'web')
    expect(out).toBe('　　第一章\n\n　　第一段内容。\n\n　　第二段内容。')
  })

  it('关闭段首缩进', () => {
    const out = formatForCopy(text, 'web', { indent: false })
    expect(out.startsWith('第一章')).toBe(true)
    expect(out).not.toContain('　　第一段')
  })

  it('关闭段间空行', () => {
    const out = formatForCopy(text, 'web', { blankLine: false })
    expect(out.split('\n').filter((l) => l.trim() === '')).toHaveLength(0)
    expect(out).toContain('　　第一段内容。\n　　第二段内容。')
  })
})

describe('Markdown 原样、plain 与 web 是纯文本', () => {
  it('markdown 返回原文', () => {
    const md = '# A\n\n**B**'
    expect(formatForCopy(md, 'markdown')).toBe(md)
  })
  it('plain 不去除段落，只去标记', () => {
    expect(formatForCopy('## 标题\n\n正文', 'plain')).toBe('标题\n\n正文')
  })
})
