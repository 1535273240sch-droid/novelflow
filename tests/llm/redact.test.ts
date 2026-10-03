import { describe, expect, it } from 'vitest'
import { Redactor, maskKey } from '../../src/main/services/llm/redact'
import { SseParser } from '../../src/main/services/llm/sse'

describe('日志脱敏', () => {
  it('注册的密钥在日志文本中被替换为 ***', () => {
    const r = new Redactor()
    r.add('sk-secret-1234567890')
    const log = `请求失败：POST http://x/v1/chat/completions Authorization: Bearer sk-secret-1234567890`
    expect(r.redact(log)).not.toContain('sk-secret-1234567890')
    expect(r.redact(log)).toContain('Bearer ***')
  })

  it('多个密钥都被替换；未注册内容不受影响', () => {
    const r = new Redactor()
    r.add('key-aaaa')
    r.add('key-bbbb')
    const out = r.redact('a=key-aaaa b=key-bbbb c=normal')
    expect(out).toBe('a=*** b=*** c=normal')
  })

  it('过短的串不注册（避免误伤）', () => {
    const r = new Redactor()
    r.add('abc')
    expect(r.redact('abc')).toBe('abc')
  })

  it('maskKey 只暴露首尾少量字符', () => {
    expect(maskKey('sk-abcdefghijklmnop')).toBe('sk-***mnop')
    expect(maskKey('short')).toBe('***')
    expect(maskKey('')).toBe('')
    expect(maskKey(null)).toBe('')
  })
})

describe('SseParser 单元', () => {
  it('按空行切帧并拼接 data 行', () => {
    const got: string[] = []
    const p = new SseParser((d) => got.push(d))
    p.push('data: A\n\ndata: B\n')
    p.push('\ndata: C\n\n')
    expect(got).toEqual(['A', 'B', 'C'])
  })

  it('CRLF 与无结束帧 flush', () => {
    const got: string[] = []
    const p = new SseParser((d) => got.push(d))
    p.push('data: X\r\n\r\ndata: Y')
    p.flush()
    expect(got).toEqual(['X', 'Y'])
  })
})
