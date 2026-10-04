import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createProject } from '../../src/main/services/storage/project'
import { ChapterGateError, checkSkillRequires, requireChapterPlan } from '../../src/main/services/context/gates'
import { SkillRegistry } from '../../src/main/services/skills/registry'
import { SkillRunner } from '../../src/main/services/skills/runner'

const BUILTIN_DIR = path.resolve(process.cwd(), 'skills')

async function project(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-gate-'))
  const root = path.join(base, 'proj')
  await createProject(root, { name: '门禁测试', targetWords: 100000 })
  return root
}

describe('写正文门禁（验收要点 3）', () => {
  it('没有章节计划时拒绝，并给出可执行引导', async () => {
    const root = await project()
    await expect(requireChapterPlan(root, 1)).rejects.toBeInstanceOf(ChapterGateError)
    try {
      await requireChapterPlan(root, 1)
    } catch (e) {
      const err = e as ChapterGateError
      expect(err.code).toBe('NO_PLAN')
      expect(err.guidance).toContain('章节规划')
      expect(err.guidance).toContain('outline/第001章.md')
    }
  })

  it('计划存在但为空 → 仍然拒绝（空文件不算计划）', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, 'outline', '第001章.md'), '   \n', 'utf8')
    await expect(requireChapterPlan(root, 1)).rejects.toBeInstanceOf(ChapterGateError)
  })

  it('有计划时放行并返回内容', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, 'outline', '第001章.md'), '出场人物：张三\n', 'utf8')
    expect(await requireChapterPlan(root, 1)).toContain('张三')
  })

  it('checkSkillRequires：chapter_plan 需要章号', async () => {
    const root = await project()
    await expect(checkSkillRequires(root, undefined, ['chapter_plan'])).rejects.toThrow(/章号/)
  })
})

describe('门禁与运行路径一致（界面与单测共用同一实现）', () => {
  it('write-chapter 在无计划时被 SkillRunner 拒绝', async () => {
    const root = await project()
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-gate-skills-'))
    const reg = new SkillRegistry(BUILTIN_DIR, path.join(base, 'skills'))
    await reg.list()
    const runner = new SkillRunner(reg, root)
    await expect(
      runner.prepare({ skillId: 'write-chapter', target: 'chapter', text: 'x', chapterNo: 1 })
    ).rejects.toBeInstanceOf(ChapterGateError)
  })

  it('补齐计划后同一调用放行（其余变量由 Context Builder 注入）', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, 'outline', '第001章.md'), '出场人物：张三\n本章目标：开场\n', 'utf8')
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-gate-skills-'))
    const reg = new SkillRegistry(BUILTIN_DIR, path.join(base, 'skills'))
    await reg.list()
    const runner = new SkillRunner(reg, root)
    const prep = await runner.prepare({ skillId: 'write-chapter', target: 'chapter', text: '', chapterNo: 1 })
    expect(prep.messages[0].content).toContain('开场')
    expect(prep.messages[0].content).not.toContain('{{')
  })
})
