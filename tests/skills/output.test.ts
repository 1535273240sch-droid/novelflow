import { describe, expect, it } from 'vitest'
import { applyIssues, parseIssues } from '../../src/main/services/skills/output'

const TARGET = '他说的对，既使这样也没关系。\n天空很篮。'

describe('结构化问题清单解析（验收要点 4）', () => {
  it('严格 JSON 数组', () => {
    const raw = '[{"original":"既使","suggestion":"即使","reason":"错别字"},{"original":"很篮","suggestion":"很蓝","reason":"错别字"}]'
    const r = parseIssues(raw, TARGET)
    expect(r.degraded).toBe(false)
    expect(r.issues).toHaveLength(2)
    expect(r.issues[0]).toMatchObject({ original: '既使', suggestion: '即使', reason: '错别字' })
  })

  it('Markdown 代码块包裹', () => {
    const raw = '```json\n[{"original":"既使","suggestion":"即使"}]\n```'
    expect(parseIssues(raw).issues).toHaveLength(1)
  })

  it('前后夹杂解释文字也能抠出数组', () => {
    const raw = '好的，以下是检查结果：\n[{"original":"很篮","suggestion":"很蓝"}]\n希望有帮助。'
    const r = parseIssues(raw)
    expect(r.issues.map((i) => i.original)).toEqual(['很篮'])
  })

  it('{issues:[...]} 包装形式', () => {
    const raw = '{"issues":[{"original":"既使","suggestion":"即使"}]}'
    expect(parseIssues(raw).issues).toHaveLength(1)
  })

  it('中文键名 原文/建议 兼容', () => {
    const raw = '[{"原文":"既使","建议":"即使","类型":"错别字"}]'
    const r = parseIssues(raw)
    expect(r.issues[0]).toMatchObject({ original: '既使', suggestion: '即使', reason: '错别字' })
  })

  it('无问题输出 [] → 空清单且非降级', () => {
    const r = parseIssues('[]')
    expect(r.issues).toEqual([])
    expect(r.degraded).toBe(false)
  })

  it('畸形输出优雅降级为纯文本，不抛异常（验收要点 4）', () => {
    const raw = '这是一段模型自由发挥的分析，没有任何结构化清单。'
    const r = parseIssues(raw)
    expect(r.degraded).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.degradedReason).toBeTruthy()
  })

  it('半截 JSON 不崩溃', () => {
    const r = parseIssues('[{"original":"既使","suggestion"')
    expect(r.degraded).toBe(true)
  })

  it('数组中出现缺字段的畸形项 → 降级而非产出半个清单', () => {
    const r = parseIssues('[{"original":"既使"}]')
    // 单元素缺 suggestion：无箭头行兜底 → 降级
    expect(r.degraded).toBe(true)
    expect(r.issues).toEqual([])
  })

  it('非 JSON 的行式箭头输出可兜底解析', () => {
    const raw = '1. 既使 → 即使\n2. 很篮 → 很蓝'
    const r = parseIssues(raw)
    expect(r.degraded).toBe(false)
    expect(r.issues.map((i) => [i.original, i.suggestion])).toEqual([
      ['既使', '即使'],
      ['很篮', '很蓝']
    ])
  })

  it('定位：给出 index 与 1 起行号', () => {
    const r = parseIssues('[{"original":"很篮","suggestion":"很蓝"}]', TARGET)
    expect(r.issues[0].index).toBe(TARGET.indexOf('很篮'))
    expect(r.issues[0].line).toBe(2)
  })

  it('原文不在目标文本中时不报错，只是没有 index', () => {
    const r = parseIssues('[{"original":"不存在的片段","suggestion":"x"}]', TARGET)
    expect(r.issues[0].index).toBeUndefined()
  })
})

describe('逐条应用', () => {
  it('只应用被接受的条目', () => {
    const issues = [
      { original: '既使', suggestion: '即使' },
      { original: '很篮', suggestion: '很蓝' }
    ]
    expect(applyIssues(TARGET, issues, new Set([0]))).toBe('他说的对，即使这样也没关系。\n天空很篮。')
    expect(applyIssues(TARGET, issues, new Set([1]))).toBe('他说的对，既使这样也没关系。\n天空很蓝。')
    expect(applyIssues(TARGET, issues, new Set([0, 1]))).toBe('他说的对，即使这样也没关系。\n天空很蓝。')
    expect(applyIssues(TARGET, issues, new Set())).toBe(TARGET)
  })

  it('只替换命中的第一条（避免重复片段被连环替换）', () => {
    const text = '的的的'
    const out = applyIssues(text, [{ original: '的', suggestion: '得' }], new Set([0]))
    expect(out).toBe('得的的')
  })
})
