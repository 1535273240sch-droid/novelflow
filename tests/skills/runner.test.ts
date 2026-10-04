import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SkillRegistry } from '../../src/main/services/skills/registry'
import { SkillRunner, type ChatInvoker } from '../../src/main/services/skills/runner'
import { MissingVariableError } from '../../src/main/services/skills/vars'
import { createProject } from '../../src/main/services/storage/project'
import { listSnapshots, readSnapshot, snapshotFile } from '../../src/main/services/storage/snapshot'
import type { PresetCreds } from '../../src/main/services/llm/adapters'
import type { Skill } from '../../src/shared/types'

const BUILTIN_DIR = path.resolve(process.cwd(), 'skills')

const PRESET: PresetCreds = {
  protocol: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:8801/v1',
  apiKey: 'sk-test',
  model: 'mock-model',
  temperature: 0.7,
  maxOutputTokens: 4096
}

async function setup(): Promise<{ reg: SkillRegistry; root: string; runner: SkillRunner }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-runner-'))
  const root = path.join(base, 'proj')
  await createProject(root, { name: '测试小说', genre: '玄幻', targetWords: 1000000 })
  // 写入可辨别的设定，供变量替换断言
  await fs.writeFile(path.join(root, 'bible', '01-世界观.md'), '世界观：大陆名「东洲」', 'utf8')
  await fs.writeFile(path.join(root, 'bible', '04-文风规范.md'), '文风：第三人称、短句', 'utf8')
  const reg = new SkillRegistry(BUILTIN_DIR, path.join(base, 'skills'))
  const runner = new SkillRunner(reg, root)
  await reg.list() // seed
  return { reg, root, runner }
}

describe('SkillRunner：上下文组装与变量替换', () => {
  it('prepare 把目标文本与 bible 变量替换进消息，且不残留占位符', async () => {
    const { runner } = await setup()
    const prep = await runner.prepare({
      skillId: 'polish',
      target: 'chapter',
      text: '原始正文内容。'
    })
    const content = prep.messages[0].content
    expect(content).toContain('原始正文内容。')
    expect(content).toContain('文风：第三人称、短句')
    expect(content).not.toContain('{{')
    expect(prep.kind).toBe('rewrite')
  })

  it('选中目标同时注入 selection 与 chapter_text', async () => {
    const { reg, runner } = await setup()
    await reg.save({
      id: 'sel-test',
      name: 'selection',
      description: '',
      version: 1,
      recommendedModel: null,
      output: 'rewrite',
      inputs: ['selection'],
      body: '片段：{{selection}}',
      requires: [],
      builtin: false,
      createdAt: '',
      updatedAt: ''
    } as Skill)
    const prep = await runner.prepare({
      skillId: 'sel-test',
      target: 'selection',
      text: '只选中这一句。'
    })
    expect(prep.messages[0].content).toContain('片段：只选中这一句。')
  })

  it('缺变量时明确报错并点名（验收要点 2）', async () => {
    const { reg, runner } = await setup()
    await reg.save({
      id: 'needs-missing',
      name: '缺变量',
      description: '',
      version: 1,
      recommendedModel: null,
      output: 'text',
      inputs: ['this_var_does_not_exist'],
      body: '使用 {{this_var_does_not_exist}}',
      requires: [],
      builtin: false,
      createdAt: '',
      updatedAt: ''
    } as Skill)
    await expect(
      runner.prepare({ skillId: 'needs-missing', target: 'chapter', text: 'x' })
    ).rejects.toBeInstanceOf(MissingVariableError)
  })

  it('extraVars 可补足变量', async () => {
    const { reg, runner } = await setup()
    await reg.save({
      id: 'with-extra',
      name: '额外变量',
      description: '',
      version: 1,
      recommendedModel: null,
      output: 'text',
      inputs: ['custom_thing'],
      body: '自定义：{{custom_thing}}',
      requires: [],
      builtin: false,
      createdAt: '',
      updatedAt: ''
    } as Skill)
    const prep = await runner.prepare({
      skillId: 'with-extra',
      target: 'chapter',
      text: 'x',
      vars: { custom_thing: '补上了' }
    })
    expect(prep.messages[0].content).toContain('自定义：补上了')
  })

  it('Skill 不存在时报错', async () => {
    const { runner } = await setup()
    await expect(runner.prepare({ skillId: 'no-such', target: 'chapter', text: 'x' })).rejects.toThrow(/不存在/)
  })
})

describe('SkillRunner：输出解析', () => {
  it('issues 类技能把 JSON 解析为清单', async () => {
    const { runner } = await setup()
    const prep = await runner.prepare({ skillId: 'proofread', target: 'chapter', text: '既使这样。' })
    const result = runner.finalize(prep, '[{"original":"既使","suggestion":"即使","reason":"错别字"}]')
    expect(result.kind).toBe('issues')
    expect(result.issues?.[0]).toMatchObject({ original: '既使', suggestion: '即使' })
    expect(result.degraded).toBe(false)
  })

  it('issues 类技能遇到畸形输出 → 优雅降级', async () => {
    const { runner } = await setup()
    const prep = await runner.prepare({ skillId: 'proofread', target: 'chapter', text: 'x' })
    const result = runner.finalize(prep, '我觉得写得还行，没什么问题。')
    expect(result.degraded).toBe(true)
    expect(result.raw).toContain('还行')
  })

  it('rewrite 类技能返回完整文本', async () => {
    const { runner } = await setup()
    const prep = await runner.prepare({ skillId: 'polish', target: 'chapter', text: '旧文' })
    const result = runner.finalize(prep, '润色后的新文')
    expect(result.kind).toBe('rewrite')
    expect(result.text).toBe('润色后的新文')
  })
})

describe('SkillRunner：端到端（mock LLM）', () => {
  it('run 经注入的 invoker 调用，返回解析结果', async () => {
    const { runner } = await setup()
    let seenPrompt = ''
    const invoker: ChatInvoker = async ({ messages }) => {
      seenPrompt = messages[0].content
      return { text: '处理结果' }
    }
    const result = await runner.run({ skillId: 'deai', target: 'chapter', text: '机器味的文本' }, PRESET, invoker)
    expect(result.text).toBe('处理结果')
    expect(seenPrompt).toContain('机器味的文本')
  })
})

describe('改写前快照（验收要点 7）', () => {
  it('snapshotFile 落盘到 .history，可列举与读取', async () => {
    const { root } = await setup()
    const rel = 'chapters/第001章.md'
    await fs.writeFile(path.join(root, rel), '第一版内容', 'utf8')

    const entry = await snapshotFile(root, rel, '第一版内容')
    expect(entry.relPath).toBe(rel)
    expect(entry.size).toBeGreaterThan(0)

    const dirs = await fs.readdir(path.join(root, '.history'))
    expect(dirs.length).toBeGreaterThan(0)

    const list = await listSnapshots(root, rel)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(entry.id)
    expect(await readSnapshot(root, entry.id)).toBe('第一版内容')
  })

  it('先快照再覆盖：历史里保存的是旧内容，符合「改写前自动快照」语义', async () => {
    const { root } = await setup()
    const rel = 'chapters/第002章.md'
    const before = '被 AI 改写之前的原文'
    const after = 'AI 改写之后的结果'
    await fs.writeFile(path.join(root, rel), before, 'utf8')

    // 模拟应用改写：先快照当前内容，再原子覆盖
    const entry = await snapshotFile(root, rel, before)
    await fs.writeFile(path.join(root, rel), after, 'utf8')

    expect(await fs.readFile(path.join(root, rel), 'utf8')).toBe(after)
    expect(await readSnapshot(root, entry.id)).toBe(before)
  })

  it('按文件筛选：不同文件的快照互不串台', async () => {
    const { root } = await setup()
    await snapshotFile(root, 'chapters/第001章.md', 'A')
    await snapshotFile(root, 'chapters/第002章.md', 'B')
    const only1 = await listSnapshots(root, 'chapters/第001章.md')
    expect(only1).toHaveLength(1)
    expect(await readSnapshot(root, only1[0].id)).toBe('A')
    expect(await listSnapshots(root)).toHaveLength(2)
  })

  it('同一毫秒重复快照不覆盖（自动加序号）', async () => {
    const { root } = await setup()
    const date = new Date('2026-01-02T03:04:05.678Z')
    const a = await snapshotFile(root, 'chapters/第003章.md', 'old', date)
    const b = await snapshotFile(root, 'chapters/第003章.md', 'old', date)
    expect(a.id).not.toBe(b.id)
    expect(await listSnapshots(root, 'chapters/第003章.md')).toHaveLength(2)
  })
})
