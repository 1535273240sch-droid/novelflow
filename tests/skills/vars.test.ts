import { describe, expect, it } from 'vitest'
import {
  extractVars,
  findMissing,
  MissingVariableError,
  resolveVar,
  substitute
} from '../../src/main/services/skills/vars'

describe('变量提取', () => {
  it('去重且保持出现顺序，支持点号与中文', () => {
    const body = '{{chapter_text}} 与 {{bible.文风规范}}，再次 {{chapter_text}}'
    expect(extractVars(body)).toEqual(['chapter_text', 'bible.文风规范'])
  })

  it('容忍花括号内空格', () => {
    expect(extractVars('{{  selection  }}')).toEqual(['selection'])
  })
})

describe('变量替换（验收要点 2）', () => {
  it('替换 {{chapter_text}}', () => {
    const r = substitute('正文：{{chapter_text}}', { chapter_text: '第一章内容' })
    expect(r.text).toBe('正文：第一章内容')
    expect(r.missing).toEqual([])
  })

  it('替换 {{bible.文风规范}}（精确键与带序号/扩展名的模糊键都可命中）', () => {
    const ctx = { bible: { '文风规范': '人称：第三人称', '04-文风规范.md': '旧键' } }
    expect(substitute('风：{{bible.文风规范}}', ctx).text).toBe('风：人称：第三人称')

    const ctx2 = { bible: { '04-文风规范.md': '人称：第一人称' } }
    expect(substitute('风：{{bible.文风规范}}', ctx2).text).toBe('风：人称：第一人称')

    const ctx3 = { bible: { '04-文风规范': '无扩展名' } }
    expect(substitute('风：{{bible.文风规范}}', ctx3).text).toBe('风：无扩展名')
  })

  it('数字变量转字符串', () => {
    expect(substitute('第{{chapter_no}}章', { chapter_no: 7 }).text).toBe('第7章')
  })

  it('缺失变量在严格模式下抛错并点名（不是静默留空）', () => {
    try {
      substitute('{{chapter_text}} + {{unknown_var}}', { chapter_text: 'x' })
      throw new Error('应当抛错')
    } catch (e) {
      expect(e).toBeInstanceOf(MissingVariableError)
      expect((e as MissingVariableError).missing).toEqual(['unknown_var'])
      expect((e as Error).message).toContain('unknown_var')
    }
  })

  it('非严格模式返回 missing，占位符原样保留', () => {
    const r = substitute('{{a}}/{{b}}', { a: 'A' }, { strict: false })
    expect(r.text).toBe('A/{{b}}')
    expect(r.missing).toEqual(['b'])
  })

  it('findMissing 只报未解析成功的变量', () => {
    const body = '{{chapter_text}}{{bible.文风规范}}{{missing}}'
    expect(findMissing(body, { chapter_text: 'x', bible: { 文风规范: 'y' } })).toEqual(['missing'])
  })
})

describe('resolveVar 边界', () => {
  it('bible 容器缺失时返回 undefined', () => {
    expect(resolveVar('bible.文风规范', {})).toBeUndefined()
  })
  it('对象值序列化为 JSON', () => {
    expect(resolveVar('state', { state: { a: 1 } })).toBe('{\n  "a": 1\n}')
  })
})
