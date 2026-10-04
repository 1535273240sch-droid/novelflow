import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createProject } from '../../src/main/services/storage/project'
import { applyStateWriteback } from '../../src/main/services/state/writeback'
import { buildChapterContext } from '../../src/main/services/context/builder'
import { SkillRegistry } from '../../src/main/services/skills/registry'
import { SkillRunner, type ChatInvoker } from '../../src/main/services/skills/runner'
import type { PresetCreds } from '../../src/main/services/llm/adapters'

const BUILTIN_DIR = path.resolve(process.cwd(), 'skills')

const PRESET: PresetCreds = {
  protocol: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:8801/v1',
  apiKey: 'sk-test',
  model: 'mock-model',
  temperature: 0.7,
  maxOutputTokens: 4096
}

async function project(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-flow-'))
  const root = path.join(base, 'proj')
  await createProject(root, { name: '流程测试', genre: '悬疑', targetWords: 500000 })
  await fs.writeFile(path.join(root, 'bible', '04-文风规范.md'), '第三人称，短句。', 'utf8')
  await fs.writeFile(path.join(root, 'bible', '01-世界观.md'), '亡者遗言可闻。', 'utf8')
  await fs.writeFile(path.join(root, 'bible', '02-人物', '张三.md'), '# 张三\n身份：仵作', 'utf8')
  await fs.writeFile(path.join(root, 'chapters', '第001章.md'), '第一章正文：张三在雨夜接到一具无名尸，故事由此开始。', 'utf8')
  await fs.writeFile(path.join(root, 'outline', '第002章.md'), '出场人物：张三\n本章目标：追查线索\n', 'utf8')
  return root
}

describe('状态传递：写完第 1 章回写后，第 2 章上下文包含状态与伏笔（验收要点 6）', () => {
  it('回写后第 2 章上下文出现人物最新状态与未回收伏笔', async () => {
    const root = await project()

    const before = await buildChapterContext(root, 2)
    expect(before.text).not.toContain('左臂缠着绷带')

    await applyStateWriteback(
      root,
      {
        characters: [{ name: '张三', status: '左臂缠着绷带', location: '义庄' }],
        foreshadowingPlanted: [{ text: '来历不明的铜钥匙' }]
      },
      1
    )

    const after = await buildChapterContext(root, 2)
    expect(after.text).toContain('左臂缠着绷带')
    expect(after.text).toContain('来历不明的铜钥匙')
  })

  it('伏笔回收后不再出现在下一章上下文的未回收清单里', async () => {
    const root = await project()
    await applyStateWriteback(root, { foreshadowingPlanted: [{ text: '来历不明的铜钥匙' }] }, 1)
    expect((await buildChapterContext(root, 2)).text).toContain('来历不明的铜钥匙')

    await applyStateWriteback(root, { foreshadowingResolved: [{ text: '来历不明的铜钥匙' }] }, 2)
    await fs.writeFile(path.join(root, 'outline', '第003章.md'), '出场人物：张三\n', 'utf8')
    const ch3 = await buildChapterContext(root, 3)
    expect(ch3.text).not.toContain('来历不明的铜钥匙')
  })
})

describe('「查看本次实际发送的上下文」与实际发送一致（验收要点 8）', () => {
  it('preview 与实际发送使用同一组装结果', async () => {
    const root = await project()
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-flow-skills-'))
    const reg = new SkillRegistry(BUILTIN_DIR, path.join(base, 'skills'))
    await reg.list()
    const runner = new SkillRunner(reg, root)

    const params = { skillId: 'write-chapter', target: 'chapter' as const, text: '', chapterNo: 2 }
    const preview = await runner.prepare(params)
    const built = await buildChapterContext(root, 2)

    // 预览的提示词包含构建出的本章计划与文风规范
    expect(preview.messages[0].content).toContain('追查线索')
    expect(preview.messages[0].content).toContain('第三人称，短句。')

    // 实际发送给模型的正是同一条消息
    let sent = ''
    const invoker: ChatInvoker = async ({ messages }) => {
      sent = messages[0].content
      return { text: '正文…' }
    }
    await runner.run(params, PRESET, invoker)
    expect(sent).toBe(preview.messages[0].content)
    expect(sent).not.toContain('{{')

    // preview 元数据与实际裁剪结果一致
    expect(preview.context?.droppedKeys).toEqual(built.droppedKeys)
    expect(preview.context?.totalTokens).toBe(built.totalTokens)
  })
})
