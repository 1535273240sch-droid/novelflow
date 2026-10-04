import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { SnapshotEntry } from '../../../shared/types'

/**
 * 改写前快照（验收要点 7）：把文件当前内容落到项目 `.history/` 下，可列举、可读取、可还原。
 *
 * 命名：`.history/<时间戳>__<encodeURIComponent(相对路径)>.md`
 * 把来源路径编码进文件名，避免建多层目录，也让「按文件筛选」无需索引文件。
 */

const STAMP = (d: Date): string => {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
  )
}

const HISTORY_DIR = '.history'

function historyDir(root: string): string {
  return path.join(root, HISTORY_DIR)
}

function safeId(id: string): string {
  const base = path.basename(id)
  if (base !== id || !id.endsWith('.md')) throw new Error(`非法快照 id：${id}`)
  return base
}

/** 写入一条快照，返回条目。同一毫秒重复时自动加序号，保证不覆盖。 */
export async function snapshotFile(
  root: string,
  relPath: string,
  content: string,
  now: Date = new Date()
): Promise<SnapshotEntry> {
  const dir = historyDir(root)
  await fs.mkdir(dir, { recursive: true })
  const encoded = encodeURIComponent(relPath)
  let ts = STAMP(now)
  let file = `${ts}__${encoded}.md`
  let n = 1
  while (await existsFile(path.join(dir, file))) {
    file = `${ts}-${n++}__${encoded}.md`
  }
  await fs.writeFile(path.join(dir, file), content, 'utf8')
  return {
    id: file,
    relPath,
    name: path.basename(relPath),
    createdAt: now.toISOString(),
    size: Buffer.byteLength(content, 'utf8')
  }
}

interface ParsedName {
  relPath: string
  createdAt: string
}

function parseName(file: string): ParsedName | null {
  const m = /^(\d{8}-\d{6}-\d{3})(?:-\d+)?__(.+)\.md$/.exec(file)
  if (!m) return null
  const raw = m[1]
  let relPath: string
  try {
    relPath = decodeURIComponent(m[2])
  } catch {
    return null
  }
  const iso =
    `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T` +
    `${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}.${raw.slice(16, 19)}`
  return { relPath, createdAt: iso }
}

/** 列出快照；传入 relPath 时只列该文件的快照。按时间倒序。 */
export async function listSnapshots(root: string, relPath?: string): Promise<SnapshotEntry[]> {
  const dir = historyDir(root)
  let names: string[] = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: SnapshotEntry[] = []
  for (const file of names) {
    if (!file.endsWith('.md')) continue
    const parsed = parseName(file)
    if (!parsed) continue
    if (relPath && parsed.relPath !== relPath) continue
    const st = await fs.stat(path.join(dir, file)).catch(() => null)
    out.push({
      id: file,
      relPath: parsed.relPath,
      name: path.basename(parsed.relPath),
      createdAt: parsed.createdAt,
      size: st?.size ?? 0
    })
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return out
}

/** 读取某条快照内容。 */
export async function readSnapshot(root: string, id: string): Promise<string> {
  return fs.readFile(path.join(historyDir(root), safeId(id)), 'utf8')
}

/** 快照条目的来源相对路径（还原时用）。 */
export async function snapshotRelPath(root: string, id: string): Promise<string> {
  const parsed = parseName(safeId(id))
  if (!parsed) throw new Error(`无法识别快照：${id}`)
  return parsed.relPath
}

async function existsFile(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
