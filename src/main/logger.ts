import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { Redactor } from './services/llm/redact'

/**
 * 主进程日志：写入 userData/logs/main.log 并输出到控制台。
 * 所有输出先经 Redactor 脱敏（API Key 等敏感串替换为 ***）。
 */
export class Logger {
  private redactor = new Redactor()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath?: string) {}

  registerSecret(secret: string | null | undefined): void {
    this.redactor.add(secret)
  }

  redact(text: string): string {
    return this.redactor.redact(text)
  }

  info(msg: string): void {
    this.write('INFO', msg)
  }

  warn(msg: string): void {
    this.write('WARN', msg)
  }

  error(msg: string): void {
    this.write('ERROR', msg)
  }

  private write(level: string, msg: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${this.redact(msg)}`
    // eslint-disable-next-line no-console
    if (level === 'ERROR') console.error(line)
    else console.log(line)
    if (!this.filePath) return
    this.queue = this.queue
      .then(async () => {
        await fs.mkdir(path.dirname(this.filePath!), { recursive: true })
        await fs.appendFile(this.filePath!, line + '\n', 'utf8')
      })
      .catch(() => undefined)
  }
}
