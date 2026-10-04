import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { RunStore } from '../../src/main/services/workflow/store'
import { WorkflowEngine, type EngineDeps, type NodeExecutor } from '../../src/main/services/workflow/engine'
import { createProject, ProjectStore } from '../../src/main/services/storage/project'
import type { Workflow, WorkflowNode } from '../../src/shared/types'

/**
 * 崩溃恢复集成用例（验收要点 7）。
 * 「强杀」以「进程在节点执行中途消失」来模拟：节点状态被写成 running 后不再有任何收尾，
 * 新进程用同一个 SQLite 库 resume，应从中断处续跑，且文件不损坏。
 */

function wf(nodes: WorkflowNode[]): Workflow {
  return { id: 'wf-recover', name: '恢复流程', nodes, builtin: false, createdAt: '', updatedAt: '' }
}
function n(id: string, skillId: string, patch: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, name: id, skillId, input: { source: 'previous' }, sink: { kind: 'next' }, ...patch }
}

async function setup(): Promise<{ root: string; dbFile: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-recover-'))
  const root = path.join(base, 'proj')
  await createProject(root, { name: '恢复测试' })
  return { root, dbFile: path.join(root, 'runs', 'runs.db') }
}

function depsFor(root: string): EngineDeps {
  const store = new ProjectStore(root)
  return {
    readFile: (rel) => store.readRel(rel),
    writeFile: async (rel, content) => {
      // 与产品一致：先快照再原子写入
      const prev = await store.readRel(rel).catch(() => null)
      if (prev !== null) {
        const { snapshotFile } = await import('../../src/main/services/storage/snapshot')
        await snapshotFile(root, rel, prev)
      }
      await store.writeRel(rel, content)
    },
    applyFramework: async () => undefined,
    applyState: async () => undefined
  }
}

describe('崩溃恢复：强杀后重启断点续跑，文件不损坏', () => {
  it('running 状态的节点在重启后被重跑，其余已完成节点保留', async () => {
    const { root, dbFile } = await setup()
    const workflow = wf([
      n('a', 'polish', { input: { source: 'manual', text: '第一章初稿' }, sink: { kind: 'next' } }),
      n('b', 'deai', { sink: { kind: 'file', relPath: 'chapters/第001章.md' } }),
      n('c', 'polish', { sink: { kind: 'file', relPath: 'chapters/第001章.md' } })
    ])

    // ---- 进程 1：跑到节点 b 中途被强杀 ----
    const store1 = new RunStore(dbFile)
    const run = store1.createRun(workflow, { chapterNo: 1 })
    run.nodes[0].status = 'done'
    run.nodes[0].output = '第一章初稿'
    run.nodes[0].raw = '第一章初稿'
    run.nodes[0].kind = 'rewrite'
    run.nodes[0].writesTo = 'chapter'
    run.nodes[1].status = 'running'
    run.nodes[1].startedAt = new Date().toISOString()
    store1.saveRun(run)
    store1.close() // 进程消失，没有任何收尾

    // ---- 进程 2：重启 ----
    const store2 = new RunStore(dbFile)
    const unfinished = store2.unfinished()
    expect(unfinished).not.toBeNull()
    expect(unfinished!.id).toBe(run.id)
    expect(unfinished!.nodes[1].status).toBe('running')

    const executions: string[] = []
    const executor: NodeExecutor = async ({ node, inputText }) => {
      executions.push(node.id)
      return { output: `${node.name}(${inputText})`, raw: `${node.name}(${inputText})`, kind: 'rewrite', writesTo: 'chapter' }
    }
    const engine = new WorkflowEngine(store2, { get: async () => workflow }, executor, depsFor(root))
    const resumed = await engine.resume(run.id)

    expect(resumed.status).toBe('completed')
    // 已完成的节点 a 不再重跑；b、c 重跑
    expect(executions).toEqual(['b', 'c'])
    expect(resumed.nodes.map((s) => s.status)).toEqual(['done', 'done', 'done'])

    // 文件完整且内容正确
    const content = await fs.readFile(path.join(root, 'chapters', '第001章.md'), 'utf8')
    expect(content).toContain('c(')
    expect(content).toContain('第一章初稿')

    // 无 .tmp 残留（原子写未损坏）
    const chapterDir = await fs.readdir(path.join(root, 'chapters'))
    expect(chapterDir.filter((f) => f.includes('.tmp'))).toEqual([])
    store2.close()
  })

  it('崩溃前已写入的章节文件内容在重启后仍可读（不损坏）', async () => {
    const { root, dbFile } = await setup()
    const chapterRel = 'chapters/第005章.md'
    await fs.writeFile(path.join(root, chapterRel), '崩溃前已落盘的内容', 'utf8')

    const store1 = new RunStore(dbFile)
    store1.createRun(wf([n('a', 'polish', { input: { source: 'manual', text: 'x' } })]), {})
    store1.close()

    // 模拟重启后读取该文件
    const content = await fs.readFile(path.join(root, chapterRel), 'utf8')
    expect(content).toBe('崩溃前已落盘的内容')
  })
})
