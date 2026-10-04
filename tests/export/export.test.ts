import { describe, expect, it } from 'vitest'
import {
  DOCX_LICENSE,
  exportFileName,
  renderDocxExport,
  renderTextExport
} from '../../src/main/services/export/export'

const chapters = [
  { name: '第001章', content: '# 第001章\n\n**张三**走进义庄。' },
  { name: '第002章', content: '# 第002章\n\n李四登场。' }
]

describe('导出文本（验收要点 1）', () => {
  it('txt：章节名 + 去标记正文', () => {
    const out = renderTextExport('测试小说', chapters, 'txt')
    expect(out).toContain('测试小说')
    expect(out).toContain('第001章')
    expect(out).toContain('张三走进义庄。')
    expect(out).not.toContain('**')
    expect(out).not.toContain('#')
  })

  it('md：保留标题层级', () => {
    const out = renderTextExport('测试小说', chapters, 'md')
    expect(out).toContain('# 测试小说')
    expect(out).toContain('## 第001章')
    expect(out).toContain('**张三**走进义庄。')
  })

  it('单章导出只有一章内容', () => {
    const out = renderTextExport('第001章', [chapters[0]], 'txt')
    expect(out).toContain('第001章')
    expect(out).not.toContain('李四登场')
  })
})

describe('导出 docx', () => {
  it('产出合法 zip 容器（PK 头）且非空', async () => {
    const buf = await renderDocxExport('测试小说', chapters)
    expect(buf.length).toBeGreaterThan(1000)
    // docx 是 zip：以 PK\x03\x04 开头
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('docx 依赖与其 License 已注明', () => {
    expect(DOCX_LICENSE).toContain('MIT')
  })
})

describe('导出文件名', () => {
  it('过滤非法字符并带正确扩展名', () => {
    expect(exportFileName('我的/小说:第一部', 'txt')).toBe('我的-小说-第一部.txt')
    expect(exportFileName('   ', 'docx')).toBe('novelflow-export.docx')
  })
})
