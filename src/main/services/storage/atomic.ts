import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'

/**
 * 原子写文件：先写同目录临时文件（.*.tmp），再 rename 覆盖目标。
 * 任何时刻目标文件要么是旧内容、要么是完整新内容，不会出现半截文件。
 * Windows 上 rename 可能因文件被占用（杀毒/索引服务）抛 EPERM/EBUSY，做有限重试。
 */
export async function atomicWriteFile(filePath: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(tmpPath, data, typeof data === 'string' ? 'utf8' : undefined)
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(tmpPath, filePath)
        return
      } catch (e) {
        lastError = e
        const code = (e as NodeJS.ErrnoException)?.code
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
          continue
        }
        throw e
      }
    }
    throw lastError
  } finally {
    // 若重命名最终失败，清理临时文件；成功时文件已不存在，force 防止报错。
    await fs.rm(tmpPath, { force: true }).catch(() => undefined)
  }
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, JSON.stringify(value, null, 2) + '\n')
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
