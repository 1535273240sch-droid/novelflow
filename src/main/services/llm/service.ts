import { randomUUID } from 'node:crypto'
import { Semaphore } from './concurrency'
import { ThrottledEmitter } from './throttle'
import { defaultSleep, type SleepFn } from './sleep'
import { CancelledError, describeError, HttpError, isRetryableStatus, TimeoutError } from './errors'
import { complete, streamChat, type ChatMessage, type LlmResult, type PresetCreds } from './adapters'
import type { TestConnectionResult } from '../../../shared/types'

export interface LlmServiceConfig {
  /** 同时进行的 LLM 请求上限，默认 2，可配置 */
  concurrencyLimit: number
  /** 流式输出刷新节流（毫秒），默认 80（约 50–100ms） */
  throttleMs: number
  /** 连接超时（毫秒） */
  connectTimeoutMs: number
  /** 流式空闲超时（毫秒） */
  idleTimeoutMs: number
  /** 429/5xx/超时 的指数退避重试上限（次数，不含首次请求） */
  maxRetries: number
  /** 退避基数（毫秒）：1000, 2000, 4000… */
  baseDelayMs: number
  /** 退避上限（毫秒） */
  maxDelayMs: number
}

export const DEFAULT_LLM_SERVICE_CONFIG: LlmServiceConfig = {
  concurrencyLimit: 2,
  throttleMs: 80,
  connectTimeoutMs: 30_000,
  idleTimeoutMs: 60_000,
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000
}

export interface ChatRequest {
  preset: PresetCreds
  messages: ChatMessage[]
  /** 节流后的全量文本回调 */
  onDelta?: (full: string) => void
  signal?: AbortSignal
  /** 覆盖连接超时（单测用小值） */
  timeoutMs?: number
  /** 覆盖流式空闲超时 */
  idleTimeoutMs?: number
  /** 覆盖重试次数 */
  maxRetries?: number
  /** 覆盖节流间隔 */
  throttleMs?: number
}

export interface ChatHandlers {
  onDelta?: (callId: string, full: string) => void
  onDone?: (callId: string, text: string) => void
  onError?: (callId: string, error: string, partialText: string, cancelled: boolean) => void
}

export interface ChatTicket {
  callId: string
  done: Promise<{ text: string; cancelled: boolean; error?: string }>
}

/**
 * 主进程 LLM 调用层（渲染进程不执行任何 LLM 请求）。
 * 组合能力：并发限制（默认 2，可配置）→ 指数退避重试（429/5xx/超时，最多 3 次，
 * 仅在未收到任何内容时重试，避免重复拼接）→ 流式节流 → 可取消。
 */
export class LlmService {
  private config: LlmServiceConfig
  private sema: Semaphore
  private calls = new Map<string, AbortController>()
  private deps: { fetchImpl?: typeof fetch; sleep?: SleepFn }

  constructor(config: Partial<LlmServiceConfig> = {}, deps: { fetchImpl?: typeof fetch; sleep?: SleepFn } = {}) {
    this.config = { ...DEFAULT_LLM_SERVICE_CONFIG, ...config }
    this.deps = deps
    this.sema = new Semaphore(this.config.concurrencyLimit)
  }

  getConfig(): Readonly<LlmServiceConfig> {
    return this.config
  }

  updateConfig(partial: Partial<LlmServiceConfig>): void {
    this.config = { ...this.config, ...partial }
    this.sema.limit = this.config.concurrencyLimit
  }

  /** 直接调用（等待完整结果）。 */
  async chat(req: ChatRequest): Promise<LlmResult> {
    const release = await this.sema.acquire(req.signal)
    try {
      return await this.executeWithRetry(req)
    } finally {
      release()
    }
  }

  /**
   * 发起可取消的调用并登记 callId（IPC 用）。
   * 永不 reject：错误经 onError 回调并在 done 中返回。
   */
  startChat(req: Omit<ChatRequest, 'signal'>, handlers: ChatHandlers = {}): ChatTicket {
    const callId = randomUUID()
    const ctrl = new AbortController()
    this.calls.set(callId, ctrl)
    let partial = ''
    const onDelta = (full: string) => {
      partial = full
      handlers.onDelta?.(callId, full)
    }
    const done = this.chat({ ...req, onDelta, signal: ctrl.signal })
      .then((r) => {
        handlers.onDone?.(callId, r.text)
        return { text: r.text, cancelled: false as const }
      })
      .catch((e: unknown) => {
        const cancelled = e instanceof CancelledError || ctrl.signal.aborted
        const msg = describeError(e)
        handlers.onError?.(callId, msg, partial, cancelled)
        return { text: partial, cancelled, error: msg }
      })
      .finally(() => {
        this.calls.delete(callId)
      })
    return { callId, done }
  }

  /** 取消进行中的调用；callId 不存在时返回 false。 */
  cancel(callId: string): boolean {
    const ctrl = this.calls.get(callId)
    if (!ctrl) return false
    ctrl.abort(new CancelledError('已取消'))
    return true
  }

  /** 测试连接：发一个极短请求，返回成功/失败原因（单次尝试，不重试）。 */
  async testConnection(creds: PresetCreds): Promise<TestConnectionResult> {
    const startedAt = Date.now()
    try {
      await complete(creds, [{ role: 'user', content: 'ping' }], {
        connectTimeoutMs: 20_000,
        fetchImpl: this.deps.fetchImpl
      })
      return { ok: true, latencyMs: Date.now() - startedAt, model: creds.model }
    } catch (e) {
      return { ok: false, error: describeError(e) }
    }
  }

  private async executeWithRetry(req: ChatRequest): Promise<LlmResult> {
    const maxRetries = req.maxRetries ?? this.config.maxRetries
    const throttleMs = req.throttleMs ?? this.config.throttleMs
    const sleep: SleepFn = this.deps.sleep ?? defaultSleep
    let attempt = 0
    let receivedAny = false
    let lastFull = ''
    for (;;) {
      try {
        const throttled = new ThrottledEmitter<string>(throttleMs, (full) => {
          lastFull = full
          req.onDelta?.(full)
        })
        const result = await streamChat(
          req.preset,
          req.messages,
          (_delta, full) => {
            receivedAny = true
            throttled.push(full)
          },
          {
            signal: req.signal,
            connectTimeoutMs: req.timeoutMs ?? this.config.connectTimeoutMs,
            idleTimeoutMs: req.idleTimeoutMs ?? this.config.idleTimeoutMs,
            fetchImpl: this.deps.fetchImpl
          }
        )
        throttled.push(result.text)
        throttled.flush()
        return result
      } catch (e) {
        if (req.signal?.aborted) throw new CancelledError('已取消')
        // 重试条件：尚未收到任何内容，且错误为超时或 429/5xx。
        // 已收到部分内容时不再重试（避免重复拼接），错误连同已收文本一起上抛。
        const retryable =
          !receivedAny &&
          (e instanceof TimeoutError || (e instanceof HttpError && isRetryableStatus(e.status)))
        if (!retryable || attempt >= maxRetries) {
          if (lastFull) req.onDelta?.(lastFull)
          throw e
        }
        await sleep(Math.min(this.config.baseDelayMs * 2 ** attempt, this.config.maxDelayMs), req.signal)
        attempt++
      }
    }
  }
}
