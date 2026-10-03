import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { atomicWriteFile, atomicWriteJson, readJson } from './atomic'
import { BIBLE_FILES, novelJson, STATE_TEMPLATES, type NovelMeta } from './templates'
import type { FileEntry, ProjectInfo } from '../../../shared/types'

/**
 * 项目 = 一个本地文件夹（说明书 3.1）：
 * novel.json + bible/(00-概述 01-世界观 02-人物/ 03-主线与卷纲 04-文风规范 05-时间线)
 * + outline/ + chapters/ + state/(characters foreshadowing events) + runs/ + .history/
 */

export const PROJECT_DIRS = [
  'bible/02-人物',
  'outline',
  'chapters',
  'state',
  'runs',
  '.history'
] as const

export const STATE_FILES = ['characters.json', 'foreshadowing.json', 'events.json'] as const

export class ProjectError extends Error {}

function baseName(dirPath: string): string {
  const b = path.basename(dirPath.trim())
  return b || '未命名小说'
}

/** 新建项目目录结构。目录中已存在 novel.json 时拒绝（避免覆盖既有项目）。 */
export async function createProject(
  dirPath: string,
  meta: { name?: string; genre?: string; targetWords?: number } = {}
): Promise<ProjectInfo> {
  const root = path.resolve(dirPath)
  const marker = path.join(root, 'novel.json')
  if (await exists(marker)) {
    throw new ProjectError('目标文件夹已包含 novel.json，不能重复创建项目')
  }
  for (const d of PROJECT_DIRS) {
    await fs.mkdir(path.join(root, d), { recursive: true })
  }
  const info = novelJson(meta.name?.trim() || baseName(root), meta.genre ?? '', meta.targetWords ?? 1_000_000)
  await atomicWriteJson(marker, info)
  for (const f of BIBLE_FILES) {
    const p = path.join(root, 'bible', f.name)
    if (!(await exists(p))) await atomicWriteFile(p, f.content)
  }
  for (const [name, value] of Object.entries(STATE_TEMPLATES)) {
    const p = path.join(root, 'state', name)
    if (!(await exists(p))) await atomicWriteJson(p, value)
  }
  return {
    dirPath: root,
    name: info.name,
    genre: info.genre,
    targetWords: info.targetWords,
    createdAt: info.createdAt
  }
}

/** 打开已有项目：校验 novel.json 存在且可解析。 */
export async function openProject(dirPath: string): Promise<ProjectInfo> {
  const root = path.resolve(dirPath)
  const marker = path.join(root, 'novel.json')
  if (!(await exists(marker))) {
    throw new ProjectError('所选文件夹不是 NovelFlow 项目（缺少 novel.json）')
  }
  const meta = await readJson<NovelMeta | null>(marker, null)
  if (!meta || typeof meta.name !== 'string') {
    throw new ProjectError('novel.json 内容无效')
  }
  return {
    dirPath: root,
    name: meta.name,
    genre: meta.genre ?? '',
    targetWords: meta.targetWords ?? 0,
    createdAt: meta.createdAt ?? ''
  }
}

export async function updateProjectMeta(root: string, patch: Partial<NovelMeta>): Promise<NovelMeta> {
  const marker = path.join(root, 'novel.json')
  const meta = await readJson<NovelMeta | null>(marker, null)
  if (!meta) throw new ProjectError('novel.json 缺失或无效')
  const next: NovelMeta = { ...meta, ...patch, updatedAt: new Date().toISOString() }
  await atomicWriteJson(marker, next)
  return next
}

/** 项目内相对路径守卫：禁止逃出项目根目录。 */
export function safeJoin(root: string, relPath: string): string {
  const rootResolved = path.resolve(root)
  const full = path.resolve(rootResolved, relPath)
  const rel = path.relative(rootResolved, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ProjectError(`非法路径：${relPath}`)
  }
  return full
}

export class ProjectStore {
  constructor(public readonly root: string) {}

  async listDir(relDir: string): Promise<FileEntry[]> {
    const dir = safeJoin(this.root, relDir)
    if (!(await exists(dir))) return []
    const names = await fs.readdir(dir)
    const entries: FileEntry[] = []
    for (const name of names) {
      if (name.startsWith('.')) continue
      const full = path.join(dir, name)
      const st = await fs.stat(full)
      entries.push({
        name,
        path: path.relative(this.root, full).split(path.sep).join('/'),
        type: st.isDirectory() ? 'dir' : 'file'
      })
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : a.type === 'dir' ? -1 : 1))
    return entries
  }

  async readRel(relPath: string): Promise<string> {
    const full = safeJoin(this.root, relPath)
    return fs.readFile(full, 'utf8')
  }

  /** 原子写入项目内相对路径文件（临时文件 + 重命名）。 */
  async writeRel(relPath: string, content: string): Promise<void> {
    const full = safeJoin(this.root, relPath)
    await atomicWriteFile(full, content)
  }

  /** 第NNN章.md 文件名（三位数字，与说明书示例一致）。 */
  chapterFileName(n: number): string {
    return `第${String(n).padStart(3, '0')}章.md`
  }

  /** 在 chapters/ 或 outline/ 下确定下一个章号并新建文件，返回相对路径。 */
  async createChapter(kind: 'chapters' | 'outline', titleSuffix = ''): Promise<string> {
    const n = await this.nextChapterNumber(kind)
    const name = this.chapterFileName(n)
    const rel = `${kind}/${name}`
    await this.writeRel(rel, titleSuffix ? `# ${name.replace(/\.md$/, '')} ${titleSuffix}\n\n` : '')
    return rel
  }

  async nextChapterNumber(kind: 'chapters' | 'outline'): Promise<number> {
    const entries = await this.listDir(kind)
    let max = 0
    for (const e of entries) {
      const m = e.name.match(/^第(\d+)章\.md$/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return max + 1
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
