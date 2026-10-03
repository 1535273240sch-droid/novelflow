/**
 * 并发信号量：限制同时进行的 LLM 请求（默认 2，可配置）。
 * 等待队列中的 acquire 可被 AbortSignal 取消。
 */
export class Semaphore {
  private running = 0
  private queue: Array<{ resolve: () => void; reject: (e: unknown) => void; cleanup: () => void }> = []

  constructor(private _limit: number) {
    if (_limit < 1 || !Number.isFinite(_limit)) this._limit = 1
  }

  get limit(): number {
    return this._limit
  }

  set limit(v: number) {
    if (v < 1 || !Number.isFinite(v)) v = 1
    this._limit = v
    // 提升上限时让等待者立即进入
    while (this.running < this._limit && this.queue.length > 0) {
      const next = this.queue.shift()!
      this.running++
      next.resolve()
    }
  }

  get active(): number {
    return this.running
  }

  get pending(): number {
    return this.queue.length
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.running < this._limit) {
      this.running++
      return () => this.release()
    }
    return new Promise<() => void>((resolve, reject) => {
      // 排队的条目被唤醒时由 release()/set limit() 负责计数，这里不再自增
      const entry: (typeof this.queue)[number] = {
        resolve: () => {
          entry.cleanup()
          resolve(() => this.release())
        },
        reject: (e: unknown) => {
          entry.cleanup()
          reject(e)
        },
        cleanup: () => {
          const i = this.queue.indexOf(entry)
          if (i >= 0) this.queue.splice(i, 1)
          signal?.removeEventListener('abort', onAbort)
        }
      }
      const onAbort = () => entry.reject(signal?.reason ?? new Error('aborted'))
      this.queue.push(entry)
      if (signal) {
        if (signal.aborted) {
          entry.reject(signal.reason ?? new Error('aborted'))
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }
    })
  }

  private release(): void {
    this.running--
    if (this.running < 0) this.running = 0
    while (this.queue.length > 0 && this.running < this._limit) {
      const next = this.queue.shift()!
      this.running++
      next.resolve()
    }
  }
}
