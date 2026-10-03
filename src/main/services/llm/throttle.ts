/**
 * 流式刷新节流器：渲染进程每 50–100ms 收到一次全量快照（默认 80ms），
 * 避免每个 token 都触发一次 IPC 与 React 重渲染。
 * 采用「立即首帧 + 尾随帧」策略：停止推送后 flush 保证最终内容不丢。
 */
export class ThrottledEmitter<T> {
  private lastEmitAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingValue: T | null = null
  private hasPending = false

  constructor(
    private readonly intervalMs: number,
    private readonly emit: (value: T) => void
  ) {}

  push(value: T): void {
    this.pendingValue = value
    this.hasPending = true
    const now = Date.now()
    const elapsed = now - this.lastEmitAt
    if (this.timer === null && elapsed >= this.intervalMs) {
      this.lastEmitAt = now
      this.hasPending = false
      this.emit(value)
      return
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.fire()
      }, Math.max(this.intervalMs - elapsed, 0))
    }
  }

  /** 立即发出最后积压的值（若有） */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.fire()
  }

  private fire(): void {
    if (!this.hasPending) return
    this.hasPending = false
    this.lastEmitAt = Date.now()
    this.emit(this.pendingValue as T)
  }
}
