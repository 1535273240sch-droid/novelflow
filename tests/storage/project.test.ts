import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  ProjectStore,
  ProjectError,
  createProject,
  openProject,
  safeJoin
} from '../../src/main/services/storage/project'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nf-project-'))
}

const exists = async (p: string) => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

describe('项目存储：3.1 目录结构', () => {
  it('新建项目生成与说明书 3.1 完全一致的目录与文件', async () => {
    const base = await tmpDir()
    const root = path.join(base, '测试小说')
    const info = await createProject(root, { name: '测试小说', genre: '玄幻', targetWords: 2_000_000 })

    expect(info.name).toBe('测试小说')
    expect(info.dirPath).toBe(path.resolve(root))

    // novel.json
    expect(await exists(path.join(root, 'novel.json'))).toBe(true)
    const meta = JSON.parse(await fs.readFile(path.join(root, 'novel.json'), 'utf8'))
    expect(meta.name).toBe('测试小说')
    expect(meta.genre).toBe('玄幻')
    expect(meta.targetWords).toBe(2_000_000)

    // bible/
    for (const f of ['00-概述.md', '01-世界观.md', '03-主线与卷纲.md', '04-文风规范.md', '05-时间线.md']) {
      expect(await exists(path.join(root, 'bible', f)), `bible/${f}`).toBe(true)
    }
    const charDir = await fs.stat(path.join(root, 'bible', '02-人物'))
    expect(charDir.isDirectory()).toBe(true)

    // outline/ chapters/ runs/ .history/
    for (const d of ['outline', 'chapters', 'runs', '.history']) {
      const st = await fs.stat(path.join(root, d))
      expect(st.isDirectory(), d).toBe(true)
    }

    // state/ 三文件
    for (const f of ['characters.json', 'foreshadowing.json', 'events.json']) {
      const p = path.join(root, 'state', f)
      expect(await exists(p), `state/${f}`).toBe(true)
      const json = JSON.parse(await fs.readFile(p, 'utf8'))
      expect(json.version).toBe(1)
    }
  })

  it('重复创建（已含 novel.json）被拒绝', async () => {
    const base = await tmpDir()
    const root = path.join(base, 'proj')
    await createProject(root)
    await expect(createProject(root)).rejects.toThrow()
  })

  it('openProject 校验 novel.json；非项目目录报错', async () => {
    const base = await tmpDir()
    const root = path.join(base, 'proj')
    await createProject(root, { name: '甲' })
    const info = await openProject(root)
    expect(info.name).toBe('甲')

    await expect(openProject(base)).rejects.toThrow(/不是 NovelFlow 项目/)
  })
})

describe('项目存储：路径守卫与按章加载', () => {
  it('readRel/writeRel 拒绝逃出项目根目录', async () => {
    const base = await tmpDir()
    const root = path.join(base, 'proj')
    await createProject(root)
    const store = new ProjectStore(root)

    await expect(store.readRel('../outside.md')).rejects.toThrow(ProjectError)
    await expect(store.writeRel('../evil.md', 'x')).rejects.toThrow(ProjectError)
    await expect(store.readRel('a/../../evil.md')).rejects.toThrow(ProjectError)
  })

  it('写读往返 + 原子写（无 .tmp 残留）', async () => {
    const base = await tmpDir()
    const root = path.join(base, 'proj')
    await createProject(root)
    const store = new ProjectStore(root)

    await store.writeRel('chapters/第001章.md', '第一章内容'.repeat(500))
    expect(await store.readRel('chapters/第001章.md')).toBe('第一章内容'.repeat(500))
    const leftovers = (await fs.readdir(path.join(root, 'chapters'))).filter((n) => n.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('按章新建：第001章 → 第002章，三位编号；outline 独立编号', async () => {
    const base = await tmpDir()
    const root = path.join(base, 'proj')
    await createProject(root)
    const store = new ProjectStore(root)

    expect(await store.nextChapterNumber('chapters')).toBe(1)
    const rel1 = await store.createChapter('chapters')
    expect(rel1).toBe('chapters/第001章.md')
    const rel2 = await store.createChapter('chapters')
    expect(rel2).toBe('chapters/第002章.md')
    expect(await store.nextChapterNumber('outline')).toBe(1) // outline 不受 chapters 影响
    const relO = await store.createChapter('outline')
    expect(relO).toBe('outline/第001章.md')
  })

  it('listDir 列出文件并按名称排序（中文）', async () => {
    const base = await tmpDir()
    const root = path.join(base, 'proj')
    await createProject(root)
    const store = new ProjectStore(root)
    await store.writeRel('chapters/第002章.md', '乙')
    await store.writeRel('chapters/第001章.md', '甲')
    const entries = await store.listDir('chapters')
    expect(entries.map((e) => e.name)).toEqual(['第001章.md', '第002章.md'])
  })
})

describe('safeJoin', () => {
  it('正常相对路径解析到项目内；绝对路径与越界路径拒绝', () => {
    const root = path.resolve(os.tmpdir(), 'nf-root')
    expect(safeJoin(root, 'chapters/第001章.md')).toBe(path.join(root, 'chapters', '第001章.md'))
    expect(() => safeJoin(root, '../x')).toThrow(ProjectError)
    expect(() => safeJoin(root, 'C:\\other\\x.md')).toThrow(ProjectError)
  })
})
