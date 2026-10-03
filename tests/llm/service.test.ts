import { describe, expect, it, vi } from 'vitest'
import { LlmService } from '../../src/main/services/llm/service'
import { CancelledError, describeError, HttpError, TimeoutError } from '../../src/main/services/llm/errors'
import type { PresetCreds } from '../../src/main/services/llm/adapters'

const creds: PresetCreds = {
  protocol: 'openai-compatible',
  baseUrl: 'http://mock.local/v1',
  apiKey: 'sk-test-abcdefg',
  model: 'mock-model',
  temperature: 0.7,
  maxOutputTokens: 64
}

const messages = [{ role: 'user' as const, content: 'hi' }]

function jsonResponse(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function statusResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: `mock ${status}` } }), { status })
}

function recordingSleep() {
  const delays: number[] = []
  const fn = vi.fn(async (ms: number) => {
    delays.push(ms)
  })
  return { fn, delays }
}

describe('模型调用层：指数退避重试（全 mock 网络）', () => {
  it('持续 429：最多重试 3 次（共 4 次请求），退避间隔 1000/2000/4000', async () => {
    const fetchMock = vi.fn(async () => statusResponse(429))
    const { fn: sleep, delays } = recordingSleep()
    const svc = new LlmService({}, { fetchImpl: fetchMock as unknown as typeof fetch, sleep })

    await expect(svc.chat({ preset: creds, messages })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(4) // 1 次首发 + 最多 3 次重试
    expect(delays).toEqual([1000, 2000, 4000]) // 指数退避
  })

  it('持续 500：同样最多 3 次重试', async () => {
    const fetchMock = vi.fn(async () => statusResponse(500))
    const { fn: sleep } = recordingSleep()
    const svc = new LlmService({}, { fetchImpl: fetchMock as unknown as typeof fetch, sleep })

    await expect(svc.chat({ preset: creds, messages })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('429 两次后成功：重试后返回结果', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(429))
      .mockResolvedValueOnce(statusResponse(503))
      .mockResolvedValueOnce(jsonResponse('重试成功'))
    const { fn: sleep, delays } = recordingSleep()
    const svc = new LlmService({}, { fetchImpl: fetchMock as unknown as typeof fetch, sleep })

    const res = await svc.chat({ preset: creds, messages })
    expect(res.text).toBe('重试成功')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(delays).toEqual([1000, 2000])
  })

  it('400（不可重试错误）：不重试，直接失败', async () => {
    const fetchMock = vi.fn(async () => statusResponse(400))
    const { fn: sleep } = recordingSleep()
    const svc = new LlmService({}, { fetchImpl: fetchMock as unknown as typeof fetch, sleep })

    await expect(svc.chat({ preset: creds, messages })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('已收到流式内容后出错：不再重试（避免重复拼接）', async () => {
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'))
        setTimeout(() => controller.error(new Error('stream broken')), 10)
      }
    })
    const fetchMock = vi.fn(async () => new Response(stream, { status: 200 }))
    const { fn: sleep } = recordingSleep()
    const svc = new LlmService({}, { fetchImpl: fetchMock as unknown as typeof fetch, sleep })

    const received: string[] = []
    await expect(
      svc.chat({ preset: creds, messages, onDelta: (full) => received.push(full) })
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1) // 只尝试一次
    expect(received[received.length - 1]).toBe('第一段') // 已收内容仍上抛
  })
})

describe('模型调用层：超时', () => {
  function hangingFetch(): typeof fetch {
    return vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('aborted'))
          return
        }
        signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
          once: true
        })
      })
    ) as unknown as typeof fetch
  }

  it('连接超时：中止请求并抛 TimeoutError（不重试时单次尝试）', async () => {
    const fetchMock = hangingFetch()
    const svc = new LlmService({ connectTimeoutMs: 40 }, { fetchImpl: fetchMock })

    await expect(
      svc.chat({ preset: creds, messages, maxRetries: 0 })
    ).rejects.toBeInstanceOf(TimeoutError)
  })

  it('超时也参与指数退避重试（默认最多 3 次）', async () => {
    const fetchMock = hangingFetch()
    const { fn: sleep, delays } = recordingSleep()
    const svc = new LlmService({ connectTimeoutMs: 30 }, { fetchImpl: fetchMock, sleep })

    await expect(svc.chat({ preset: creds, messages })).rejects.toBeInstanceOf(TimeoutError)
    expect(delays).toEqual([1000, 2000, 4000])
  })
})

describe('模型调用层：取消', () => {
  it('cancel(callId) 中止进行中的请求，结果标记 cancelled', async () => {
    const fetchMock = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('aborted'))
          return
        }
        signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
          once: true
        })
      })
    ) as unknown as typeof fetch

    const svc = new LlmService({}, { fetchImpl: fetchMock })
    const ticket = svc.startChat({ preset: creds, messages })
    const cancelled = svc.cancel(ticket.callId)
    expect(cancelled).toBe(true)

    const outcome = await ticket.done
    expect(outcome.cancelled).toBe(true)
    expect(outcome.error).toContain('取消')
  })

  it('取消不存在的 callId 返回 false；等待队列中的请求也可取消', async () => {
    const svc = new LlmService({ concurrencyLimit: 1 }, {
      fetchImpl: async () => jsonResponse('ok')
    })
    expect(svc.cancel('no-such-id')).toBe(false)

    // 占满并发额度后，排队的第二个请求可被取消
    let releaseFirst: () => void = () => undefined
    const gate = new Promise<void>((r) => (releaseFirst = r))
    const blockingFetch = vi.fn(async () => {
      await gate
      return jsonResponse('ok')
    })
    const svc2 = new LlmService({ concurrencyLimit: 1 }, {
      fetchImpl: blockingFetch as unknown as typeof fetch
    })
    const t1 = svc2.startChat({ preset: creds, messages })
    const t2 = svc2.startChat({ preset: creds, messages })
    expect(svc2.cancel(t2.callId)).toBe(true)
    releaseFirst()
    const r1 = await t1.done
    const r2 = await t2.done
    expect(r1.cancelled).toBe(false)
    expect(r2.cancelled).toBe(true)
    expect(r2.error).toContain('取消')
  })
})

describe('模型调用层：并发限制（默认 2，可配置）', () => {
  it('默认并发上限为 2', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 30))
      inFlight--
      return jsonResponse('ok')
    })
    const svc = new LlmService({}, { fetchImpl: fetchMock as unknown as typeof fetch })

    expect(svc.getConfig().concurrencyLimit).toBe(2)
    await Promise.all(Array.from({ length: 6 }, () => svc.chat({ preset: creds, messages })))
    expect(maxInFlight).toBe(2)
  })

  it('可配置为 3', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 30))
      inFlight--
      return jsonResponse('ok')
    })
    const svc = new LlmService({ concurrencyLimit: 3 }, { fetchImpl: fetchMock as unknown as typeof fetch })

    await Promise.all(Array.from({ length: 6 }, () => svc.chat({ preset: creds, messages })))
    expect(maxInFlight).toBe(3)
  })
})

describe('模型调用层：SSE 流式解析', () => {
  it('跨 chunk 拆分的 SSE 帧能正确解析，[DONE] 结束', async () => {
    const enc = new TextEncoder()
    const raw1 = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"del'
    const raw2 = 'ta":{"content":"世界"}}]}\n\ndata: [DONE]\n\n'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(raw1))
        controller.enqueue(enc.encode(raw2))
        controller.close()
      }
    })
    const fetchMock = vi.fn(async () => new Response(stream, { status: 200 }))
    const svc = new LlmService({}, { fetchImpl: fetchMock as unknown as typeof fetch })

    const res = await svc.chat({ preset: creds, messages })
    expect(res.text).toBe('你好世界')
  })

  it('节流：密集 delta 合并刷新，最终 flush 不丢内容', async () => {
    const enc = new TextEncoder()
    // 服务器快速推 10 个分片
    const events = Array.from({ length: 10 }, (_, i) => `data: ${JSON.stringify({ choices: [{ delta: { content: `片${i}` } }] })}\n\n`).join('')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(events))
        controller.close()
      }
    })
    const fetchMock = vi.fn(async () => new Response(stream, { status: 200 }))

    const emissions: string[] = []
    const svc = new LlmService({ throttleMs: 80 }, { fetchImpl: fetchMock as unknown as typeof fetch })
    await svc.chat({ preset: creds, messages, onDelta: (full) => emissions.push(full) })

    // 10 个分片在 80ms 内到达，最多应只发出极少次（首帧 + 定时器帧），而不是 10 次
    expect(emissions.length).toBeLessThanOrEqual(3)
    expect(emissions[emissions.length - 1]).toBe(Array.from({ length: 10 }, (_, i) => `片${i}`).join(''))
  })
})

describe('错误信息可读化（脱敏前的文案规则）', () => {
  it('401/403 → 认证失败；429 → 限流；5xx → 服务端错误', () => {
    expect(describeError(new HttpError(401, 'unauthorized'))).toContain('认证失败')
    expect(describeError(new HttpError(429, 'rate limited'))).toContain('限流')
    expect(describeError(new HttpError(503, 'unavailable'))).toContain('服务端错误')
  })

  it('连接拒绝 → 无法连接提示', () => {
    const e = new Error('fetch failed')
    expect(describeError(e)).toContain('无法连接')
  })

  it('取消 → 已取消', () => {
    expect(describeError(new CancelledError('已取消'))).toBe('已取消')
  })
})
