import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { BUILTIN_TEMPLATES, findTemplate, resolveChapterPlaceholder } from '../../src/main/services/workflow/templates'
import { WorkflowRegistry, newNode } from '../../src/main/services/workflow/registry'

describe('三个内置模板（验收要点 4）', () => {
  it('恰好三个模板，且节点四要素齐备', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(3)
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.builtin).toBe(true)
      expect(t.nodes.length).toBeGreaterThanOrEqual(2)
      for (const n of t.nodes) {
        expect(n.input.source).toMatch(/^(previous|file|manual)$/)
        expect(n.sink.kind).toMatch(/^(next|file|display)$/)
        expect(typeof n.name).toBe('string')
      }
    }
  })

  it('写一章模板恰好 7 个节点，顺序为：读计划→写作→一致性→错别字→润色→去AI味→状态回写', () => {
    const t = findTemplate('template-write-chapter')!
    expect(t.nodes.map((n) => n.skillId)).toEqual([
      '', // 读取章节计划（无 Skill 的输入绑定节点）
      'write-chapter',
      'consistency-check',
      'proofread',
      'polish',
      'deai',
      'state-writeback'
    ])
    expect(t.nodes[0].input).toEqual({ source: 'file', relPath: 'outline/{chapter}' })
    expect(t.nodes[1].sink).toEqual({ kind: 'file', relPath: 'chapters/{chapter}' })
  })

  it('开新书：框架 → 规划', () => {
    const t = findTemplate('template-new-book')!
    expect(t.nodes.map((n) => n.skillId)).toEqual(['generate-story-framework', 'plan-chapter'])
  })

  it('精修：错别字 → 润色 → 去AI味', () => {
    const t = findTemplate('template-polish')!
    expect(t.nodes.map((n) => n.skillId)).toEqual(['proofread', 'polish', 'deai'])
  })

  it('章号占位符替换', () => {
    expect(resolveChapterPlaceholder('chapters/{chapter}', 7)).toBe('chapters/第007章.md')
    expect(resolveChapterPlaceholder('outline/{chapter}', undefined)).toBe('outline/第???章.md')
    expect(resolveChapterPlaceholder('no-placeholder.md', 1)).toBe('no-placeholder.md')
  })
})

describe('工作流库', () => {
  async function reg(): Promise<WorkflowRegistry> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-wf-'))
    return new WorkflowRegistry(dir)
  }

  it('list 含 3 个内置模板 + 用户自建', async () => {
    const r = await reg()
    expect(await r.list()).toHaveLength(3)
    await r.save({
      id: 'my-flow',
      name: '我的流程',
      nodes: [newNode(0, 'polish')],
      builtin: false,
      createdAt: '',
      updatedAt: ''
    })
    expect((await r.list()).map((w) => w.id)).toContain('my-flow')
  })

  it('模板可复制为可编辑副本', async () => {
    const r = await reg()
    const copy = await r.createFromTemplate('template-write-chapter')
    expect(copy.builtin).toBe(false)
    expect(copy.name).toContain('副本')
    expect(copy.nodes).toHaveLength(7)
    expect(await r.get(copy.id)).not.toBeNull()
  })

  it('内置模板不可覆盖或删除', async () => {
    const r = await reg()
    const tpl = (await r.templates())[0]
    await expect(r.save(tpl)).rejects.toThrow(/内置模板/)
    await expect(r.remove(tpl.id)).rejects.toThrow(/内置模板/)
  })

  it('空节点或重名 id 被拒绝', async () => {
    const r = await reg()
    await expect(
      r.save({ id: 'e1', name: '空', nodes: [], builtin: false, createdAt: '', updatedAt: '' })
    ).rejects.toThrow(/至少/)
    const dup = [
      { ...newNode(0, 'polish'), id: 'dup' },
      { ...newNode(1, 'deai'), id: 'dup' }
    ]
    await expect(
      r.save({ id: 'e2', name: '重复', nodes: dup, builtin: false, createdAt: '', updatedAt: '' })
    ).rejects.toThrow(/重复/)
  })
})
