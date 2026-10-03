import type { Protocol } from '../../../shared/types'
import { CancelledError, HttpError, LlmError, TimeoutError } from './errors'
import { extractAnthropicDelta, extractOpenAiDelta, SseParser } from './sse'

/** 发起调用所需的凭据（明文 key 只存在于主进程内存） */
export interface PresetCreds {
  protocol: Protocol
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxOutputTokens: number
  contextLength?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmResult {
  text: string
}

export interface StreamOptions {
  signal?: AbortSignal
  /** 连接超时：该时间内未收到响应头则中止（毫秒） */
  connectTimeoutMs?: number
  /** 流式空闲超时：该时间内未收到新数据则中止（毫秒） */
  idleTimeoutMs?: number
  fetchImpl?: typeof fetch
}

type FetchLike = typeof fetch

/**
 * base_url 规范化：
 * - 无协议前缀时默认补 http://
 * - 已以 /chat/completions 或 /messages 结尾则原样使用
 * - 以 /v1、/v2 等 /vN 结尾则追加动作路径
 * - 其余情况补 /v1 + 动作路径
 * OpenAI 兼容服务（含 Ollama/LM Studio）通常 base_url 以 /v1 结尾。
 */
export function resolveEndpoint(baseUrl: string, action: 'chat/completions' | 'messages'): string {
  let u = baseUrl.trim()
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  u = u.replace(/\/+$/, '')
  const suffix = `/${action}`
  if (u.endsWith(suffix)) return u
  if (/\/v\d+$/i.test(u)) return u + suffix
  return `/v1${suffix}`.length > 0 ? `${u}/v1/${action}` : u
}

function truncate(text: string, max = 300): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function buildRequest(
  creds: PresetCreds,
  messages: ChatMessage[],
  stream: boolean
): { url: string; headers: Record<string, string>; body: string } {
  if (creds.protocol === 'anthropic') {
    const url = resolveEndpoint(creds.baseUrl || 'https://api.anthropic.com', 'messages')
    const body: Record<string, unknown> = {
      model: creds.model,
      max_tokens: Math.max(1, Math.floor(creds.maxOutputTokens || 1024)),
      temperature: creds.temperature,
      messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
      stream
    }
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    if (system) body.system = system
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': creds.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    }
  }
  const url = resolveEndpoint(creds.baseUrl, 'chat/completions')
  const body = {
    model: creds.model,
    messages,
    temperature: creds.temperature,
    max_tokens: Math.max(1, Math.floor(creds.maxOutputTokens || 1024)),
    stream
  }
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.apiKey}`
    },
    body: JSON.stringify(body)
  }
}

function normalizeError(e: unknown, ext?: AbortSignal): Error {
  if (e instanceof LlmError) return e
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      if (ext?.aborted) return new CancelledError('已取消')
      return new TimeoutError('请求超时')
    }
    return new LlmError(e.message || '请求失败')
  }
  return new LlmError(String(e))
}

/**
 * 流式对话。内部维护一个组合 AbortController：
 * 外部取消信号、连接超时、流式空闲超时三者都会中止请求。
 */
export async function streamChat(
  creds: PresetCreds,
  messages: ChatMessage[],
  onDelta: (delta: string, full: string) => void,
  opts: StreamOptions = {}
): Promise<LlmResult> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? fetch
  const ctrl = new AbortController()
  const ext = opts.signal
  const onExtAbort = () => ctrl.abort(ext?.reason ?? new CancelledError('已取消'))
  if (ext) {
    if (ext.aborted) onExtAbort()
    else ext.addEventListener('abort', onExtAbort, { once: true })
  }
  const connectTimer = opts.connectTimeoutMs
    ? setTimeout(
        () => ctrl.abort(new TimeoutError(`连接超时：${opts.connectTimeoutMs}ms 内未收到服务器响应`)),
        opts.connectTimeoutMs
      )
    : null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdle = () => {
    if (!opts.idleTimeoutMs) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(
      () => ctrl.abort(new TimeoutError(`流式空闲超时：${opts.idleTimeoutMs}ms 内未收到新数据`)),
      opts.idleTimeoutMs
    )
  }
  const { url, headers, body } = buildRequest(creds, messages, true)
  let full = ''
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: ctrl.signal })
    if (connectTimer) clearTimeout(connectTimer)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new HttpError(res.status, truncate(errText) || `HTTP ${res.status}`)
    }
    if (!res.body) throw new LlmError('服务器未返回内容流')
    const contentType = res.headers.get('content-type') ?? ''

    // 防御：部分网关/本地服务对 stream:true 仍返回一次性 JSON，做兼容解析
    if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
      const text = await res.text()
      let content = ''
      try {
        const json = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: string } }>
          content?: Array<{ type?: string; text?: string }>
        }
        if (creds.protocol === 'anthropic') {
          content = (json.content ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('')
        } else {
          content = json.choices?.[0]?.message?.content ?? ''
        }
      } catch {
        throw new LlmError('响应不是合法的 JSON 或 SSE 流')
      }
      if (content) {
        full += content
        onDelta(content, full)
      }
      return { text: full }
    }

    armIdle()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseParser((data) => {
      const delta = creds.protocol === 'anthropic' ? extractAnthropicDelta(data) : extractOpenAiDelta(data)
      if (delta) {
        full += delta
        onDelta(delta, full)
      }
    })
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      armIdle()
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.flush()
    return { text: full }
  } catch (e) {
    throw normalizeError(e, ext)
  } finally {
    if (connectTimer) clearTimeout(connectTimer)
    if (idleTimer) clearTimeout(idleTimer)
    ext?.removeEventListener('abort', onExtAbort)
  }
}

/** 非流式对话（测试连接用，一次尝试、不重试；connectTimeoutMs 作为整体截止时间）。 */
export async function complete(
  creds: PresetCreds,
  messages: ChatMessage[],
  opts: StreamOptions = {}
): Promise<LlmResult> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? fetch
  const ctrl = new AbortController()
  const ext = opts.signal
  const onExtAbort = () => ctrl.abort(ext?.reason ?? new CancelledError('已取消'))
  if (ext) {
    if (ext.aborted) onExtAbort()
    else ext.addEventListener('abort', onExtAbort, { once: true })
  }
  const totalTimer = opts.connectTimeoutMs
    ? setTimeout(
        () => ctrl.abort(new TimeoutError(`连接超时：${opts.connectTimeoutMs}ms 内未完成请求`)),
        opts.connectTimeoutMs
      )
    : null
  const { url, headers, body } = buildRequest(creds, messages, false)
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: ctrl.signal })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new HttpError(res.status, truncate(errText) || `HTTP ${res.status}`)
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      content?: Array<{ type?: string; text?: string }>
    }
    let text = ''
    if (creds.protocol === 'anthropic') {
      text = (json.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
    } else {
      text = json.choices?.[0]?.message?.content ?? ''
    }
    return { text }
  } catch (e) {
    throw normalizeError(e, ext)
  } finally {
    if (totalTimer) clearTimeout(totalTimer)
    ext?.removeEventListener('abort', onExtAbort)
  }
}
