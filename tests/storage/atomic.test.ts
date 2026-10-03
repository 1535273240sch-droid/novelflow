import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import * as fsModule from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { atomicWriteFile, atomicWriteJson, readJson } from '../../src/main/services/storage/atomic'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nf-atomic-'))
}

describe('原子写文件', () => {
  it('写入新文件并能读回', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'a.txt')
    await atomicWriteFile(file, '你好，世界')
    expect(await fs.readFile(file, 'utf8')).toBe('你好，世界')
  })

  it('走「临时文件 + rename」路径，且不留 .tmp 残留', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'b.md')
    const renameSpy = vi.spyOn(fsModule.promises, 'rename')

    await atomicWriteFile(file, '内容')

    expect(renameSpy).toHaveBeenCalled()
    const [tmpArg, targetArg] = renameSpy.mock.calls[0]
    expect(path.basename(tmpArg as string)).toMatch(/\.tmp$/)
    expect(tmpArg).not.toBe(targetArg) // 临时文件与目标文件不同名
    expect(path.dirname(tmpArg as string)).toBe(path.dirname(targetArg as string)) // 同目录（同一文件系统才能原子 rename）

    const leftovers = (await fs.readdir(dir)).filter((n) => n.includes('.tmp'))
    expect(leftovers).toEqual([])
    renameSpy.mockRestore()
  })

  it('覆盖已有文件：内容完整替换（原子 rename 语义）', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'c.md')
    await atomicWriteFile(file, '旧内容'.repeat(100))
    await atomicWriteFile(file, '新内容')
    expect(await fs.readFile(file, 'utf8')).toBe('新内容')
  })

  it('并发写同一文件：最终内容必是其中一次写入的完整内容', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'd.md')
    const contents = Array.from({ length: 8 }, (_, i) => `内容-${i}-`.padEnd(200, 'x'))
    await Promise.all(contents.map((c) => atomicWriteFile(file, c)))
    const final = await fs.readFile(file, 'utf8')
    expect(contents).toContain(final) // 不是半截内容
    const leftovers = (await fs.readdir(dir)).filter((n) => n.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('子目录不存在时自动创建', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'deep', 'nested', 'e.md')
    await atomicWriteFile(file, 'ok')
    expect(await fs.readFile(file, 'utf8')).toBe('ok')
  })

  it('atomicWriteJson + readJson 往返', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'f.json')
    await atomicWriteJson(file, { version: 1, items: ['甲', '乙'] })
    const obj = await readJson<{ version: number; items: string[] } | null>(file, null)
    expect(obj).toEqual({ version: 1, items: ['甲', '乙'] })
  })

  it('readJson 文件不存在时返回 fallback', async () => {
    const dir = await tmpDir()
    const obj = await readJson<{ a: number }>(path.join(dir, 'missing.json'), { a: 42 })
    expect(obj).toEqual({ a: 42 })
  })
})
