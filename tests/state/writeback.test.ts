import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createProject } from '../../src/main/services/storage/project'
import {
  applyStateWriteback,
  parseWriteback,
  WritebackParseError
} from '../../src/main/services/state/writeback'

async function project(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-wb-'))
  const root = path.join(base, 'proj')
  await createProject(root, { name: '回写测试' })
  return root
}

const readJson = async (p: string): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, unknown>

describe('状态回写解析', () => {
  it('容忍代码块与前后解释', () => {
    const raw = '好的：\n```json\n{"characters":[{"name":"张三","status":"受伤"}]}\n```\n以上。'
    expect(parseWriteback(raw).characters?.[0]).toMatchObject({ name: '张三', status: '受伤' })
  })
  it('畸形输出抛 WritebackParseError', () => {
    expect(() => parseWriteback('完全不是 JSON')).toThrow(WritebackParseError)
  })
})

describe('状态回写合并（验收要点 7）', () => {
  it('新增与更新人物、登记/回收伏笔、追加事件', async () => {
    const root = await project()
    // 预置一个已存在人物与一条未回收伏笔
    await fs.writeFile(
      path.join(root, 'state', 'characters.json'),
      JSON.stringify({ version: 1, characters: [{ name: '张三', status: '健康' }] }),
      'utf8'
    )
    await fs.writeFile(
      path.join(root, 'state', 'foreshadowing.json'),
      JSON.stringify({ version: 1, items: [{ text: '青铜怀表', status: 'open' }] }),
      'utf8'
    )

    const payload = parseWriteback(
      JSON.stringify({
        characters: [
          { name: '张三', status: '左臂受伤', location: '义庄' },
          { name: '李四', status: '健康', location: '衙门' }
        ],
        foreshadowingPlanted: [{ text: '带血的玉佩' }],
        foreshadowingResolved: [{ text: '青铜怀表' }],
        events: [{ summary: '张三在义庄发现玉佩', characters: ['张三'] }]
      })
    )
    const r = await applyStateWriteback(root, payload, 3)
    expect(r).toEqual({ charactersUpdated: 1, charactersAdded: 1, planted: 1, resolved: 1, eventsAdded: 1 })

    const chars = (await readJson(path.join(root, 'state', 'characters.json'))).characters as Array<Record<string, string>>
    expect(chars.find((c) => c.name === '张三')?.status).toBe('左臂受伤')
    expect(chars.find((c) => c.name === '张三')?.location).toBe('义庄')
    expect(chars.find((c) => c.name === '李四')?.status).toBe('健康')

    const items = (await readJson(path.join(root, 'state', 'foreshadowing.json'))).items as Array<Record<string, string>>
    expect(items.find((i) => i.text === '青铜怀表')?.status).toBe('resolved')
    expect(items.find((i) => i.text === '带血的玉佩')?.status).toBe('open')

    const events = (await readJson(path.join(root, 'state', 'events.json'))).events as Array<Record<string, unknown>>
    expect(events).toHaveLength(1)
    expect(events[0].summary).toContain('玉佩')
    expect(events[0].chapter).toBe(3)
  })

  it('重复回写幂等：同文本伏笔与同摘要事件不重复登记', async () => {
    const root = await project()
    const payload = {
      foreshadowingPlanted: [{ text: '带血的玉佩' }],
      events: [{ summary: '张三在义庄发现玉佩' }]
    }
    const first = await applyStateWriteback(root, payload, 1)
    const second = await applyStateWriteback(root, payload, 1)
    expect(first.planted).toBe(1)
    expect(second.planted).toBe(0)
    expect(first.eventsAdded).toBe(1)
    expect(second.eventsAdded).toBe(0)
    const items = (await readJson(path.join(root, 'state', 'foreshadowing.json'))).items as unknown[]
    expect(items).toHaveLength(1)
  })

  it('回收一条未登记过的伏笔也会记为已回收（信息不丢失）', async () => {
    const root = await project()
    const r = await applyStateWriteback(root, { foreshadowingResolved: [{ text: '从未登记的线' }] }, 5)
    expect(r.resolved).toBe(1)
    const items = (await readJson(path.join(root, 'state', 'foreshadowing.json'))).items as Array<Record<string, string>>
    expect(items[0]).toMatchObject({ text: '从未登记的线', status: 'resolved', resolvedAt: '第5章' })
  })

  it('损坏的状态文件不致命，按空档重建', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, 'state', 'characters.json'), '{ 坏掉的 json', 'utf8')
    const r = await applyStateWriteback(root, { characters: [{ name: '新角色', status: '登场' }] }, 1)
    expect(r.charactersAdded).toBe(1)
    const chars = (await readJson(path.join(root, 'state', 'characters.json'))).characters as unknown[]
    expect(chars).toHaveLength(1)
  })
})
