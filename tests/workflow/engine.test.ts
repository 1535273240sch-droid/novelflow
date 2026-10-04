import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { RunStore } from '../../src/main/services/workflow/store'
import { WorkflowEngine, type EngineDeps, type NodeExecutor } from '../../src/main/services/workflow/engine'
import type { Workflow, WorkflowNode } from '../../src/shared/types'

function wf(nodes: WorkflowNode[]): Workflow {
  return { id: 'wf-test', name: '测试流程', nodes, builtin: false, createdAt: '', updatedAt: '' }
}

function n(id: string, skillId: string, patch: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, name: id, skillId, input: { source: 'previous' }, sink: { kind: 'next' }, ...patch }
}

interface Harness {
  engine: WorkflowEngine
  store: RunStore
  files: Map<string, string>
  written: string[]
  close: () => void
  setExecutor: (fn: NodeExecutor) => void
  setWorkflow: (w: Workflow) => void
}

async function harness(initialFiles: Record<string, string> = {}): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-engine-'))
  const dbFile = path.join(dir, 'runs', 'runs.db')
  await fs.mkdir(path.dirname(dbFile), { recursive: true })
  const store = new RunStore(dbFile)
  const files = new Map<string, string>(Object.entries(initialFiles))
  const written: string[] = []
  const deps: EngineDeps = {
    readFile: async (rel) => {
      if (!files.has(rel)) throw new Error(`文件不存在：${rel}`)
      return files.get(rel)!
    },
    writeFile: async (rel, content) => {
      files.set(rel, content)
      written.push(rel)
    },
    applyFramework: async () => undefined,
    applyState: async () => undefined
  }
  let current: Workflow | null = null
  let executor: NodeExecutor = async ({ node, inputText }) => ({
    output: `${node.name} → ${inputText}`,
    raw: `${node.name} → ${inputText}`,
    kind: 'rewrite',
    writesTo: 'chapter'
  })
  const workflows = { get: async (): Promise<Workflow | null> => current }
  const engine = new WorkflowEngine(store, workflows, (req) => executor(req), deps)
  return {
    engine,
    store,
    files,
    written,
    close: () => store.close(),
    setExecutor: (fn) => {
      executor = fn
    },
    setWorkflow: (w) => {
      current = w
    }
  }
}

describe('工作流引擎：顺序执行与产物写回（验收要点 1、2）', () => {
  it('按顺序执行，previous 传递文本，sink=file 写入指定路径', async () => {
    const h = await harness()
    const workflow = wf([
      n('a', 'polish', { input: { source: 'manual', text: '原始文本' } }),
      n('b', 'deai', { sink: { kind: 'file', relPath: 'chapters/第002章.md' } })
    ])
    h.setWorkflow(workflow)
    const run = await h.engine.start(workflow, { chapterNo: 2 })
    expect(run.status).toBe('completed')
    expect(run.nodes.map((s) => s.status)).toEqual(['done', 'done'])
    expect(run.nodes[1].output).toContain('原始文本')
    expect(h.files.get('chapters/第002章.md')).toContain('原始文本')
    h.close()
  })

  it('首个节点不能绑定上节点输出', async () => {
    const h = await harness()
    const workflow = wf([n('a', 'polish')])
    h.setWorkflow(workflow)
    const run = await h.engine.start(workflow, {})
    expect(run.status).toBe('failed')
    expect(run.nodes[0].error).toMatch(/首个节点/)
    h.close()
  })

  it('检查类（issues）节点不污染文本流：下一节点拿到的仍是原文', async () => {
    const h = await harness()
    const seen: string[] = []
    h.setExecutor(async ({ node, inputText }) => {
      seen.push(inputText)
      if (node.skillId === 'proofread') {
        const raw = '[{"original":"a","suggestion":"b"}]'
        return { output: raw, raw, kind: 'issues', writesTo: 'chapter' }
      }
      return { output: `润色(${inputText})`, raw: `润色(${inputText})`, kind: 'rewrite', writesTo: 'chapter' }
    })
    const workflow = wf([
      n('a', 'proofread', { input: { source: 'manual', text: '原始正文' } }),
      n('b', 'polish')
    ])
    h.setWorkflow(workflow)
    const run = await h.engine.start(workflow, {})
    expect(run.status).toBe('completed')
    expect(seen[1]).toBe('原始正文')
    expect(run.nodes[0].output).toBe('原始正文')
    expect(run.nodes[0].raw).toContain('original')
    h.close()
  })

  it('读取节点（无 Skill）按 input=file 读取项目文件', async () => {
    const h = await harness({ 'outline/第003章.md': '本章计划内容' })
    const workflow = wf([n('read', '', { input: { source: 'file', relPath: 'outline/{chapter}' } })])
    h.setWorkflow(workflow)
    const run = await h.engine.start(workflow, { chapterNo: 3 })
    expect(run.status).toBe('completed')
    expect(run.nodes[0].output).toBe('本章计划内容')
    h.close()
  })

  it('writes_to=outline 的 Skill 输出写入章节计划文件', async () => {
    const h = await harness()
    h.setExecutor(async ({ inputText }) => ({
      output: `计划：${inputText}`,
      raw: `计划：${inputText}`,
      kind: 'text',
      writesTo: 'outline'
    }))
    const workflow = wf([n('plan', 'plan-chapter', { input: { source: 'manual', text: '本章目标' } })])
    h.setWorkflow(workflow)
    const run = await h.engine.start(workflow, { chapterNo: 4 })
    expect(run.status).toBe('completed')
    expect(h.files.get('outline/第004章.md')).toContain('本章目标')
    h.close()
  })
})

describe('人工确认点（验收要点 3）', () => {
  it('确认节点执行后暂停且尚未落盘；确认（可改）后写入并继续', async () => {
    const h = await harness()
    const workflow = wf([
      n('a', 'write-chapter', {
        input: { source: 'manual', text: '计划' },
        sink: { kind: 'file', relPath: 'chapters/第001章.md' },
        confirm: true
      }),
      n('b', 'polish', { sink: { kind: 'file', relPath: 'chapters/第001章.md' } })
    ])
    h.setWorkflow(workflow)

    const paused = await h.engine.start(workflow, { chapterNo: 1 })
    expect(paused.status).toBe('paused')
    expect(paused.nodes[0].status).toBe('awaiting_confirm')
    expect(h.files.has('chapters/第001章.md')).toBe(false)

    const done = await h.engine.confirm(paused.id, 'a', '人工修改后的正文')
    expect(done.status).toBe('completed')
    expect(h.files.get('chapters/第001章.md')).toContain('人工修改后的正文')
    h.close()
  })

  it('对非待确认节点调用 confirm 会报错', async () => {
    const h = await harness()
    const workflow = wf([n('a', 'polish', { input: { source: 'manual', text: 'x' } })])
    h.setWorkflow(workflow)
    const run = await h.engine.start(workflow, {})
    await expect(h.engine.confirm(run.id, 'a')).rejects.toThrow(/待确认/)
    h.close()
  })
})

describe('失败语义与重试（验收要点 5）', () => {
  it('失败停在该节点，已完成结果保留；retry 后从该处续跑', async () => {
    const h = await harness()
    let failOnce = true
    h.setExecutor(async ({ node, inputText }) => {
      if (node.skillId === 'deai' && failOnce) {
        failOnce = false
        throw new Error('模型 500')
      }
      return { output: `${node.name}(${inputText})`, raw: `${node.name}(${inputText})`, kind: 'rewrite', writesTo: 'chapter' }
    })
    const workflow = wf([
      n('a', 'polish', { input: { source: 'manual', text: '原稿' } }),
      n('b', 'deai', { sink: { kind: 'file', relPath: 'chapters/第001章.md' } }),
      n('c', 'polish', { sink: { kind: 'file', relPath: 'chapters/第001章.md' } })
    ])
    h.setWorkflow(workflow)

    const failed = await h.engine.start(workflow, { chapterNo: 1 })
    expect(failed.status).toBe('failed')
    expect(failed.nodes[0].status).toBe('done')
    expect(failed.nodes[1].status).toBe('failed')
    expect(failed.nodes[1].error).toContain('500')
    expect(failed.nodes[2].status).toBe('pending')
    expect(h.files.has('chapters/第001章.md')).toBe(false)

    const resumed = await h.engine.retry(failed.id, 'b')
    expect(resumed.status).toBe('completed')
    expect(resumed.nodes.map((s) => s.status)).toEqual(['done', 'done', 'done'])
    expect(h.files.get('chapters/第001章.md')).toContain('c(')
    h.close()
  })

  it('abort 后不再继续', async () => {
    const h = await harness()
    const workflow = wf([n('a', 'polish', { input: { source: 'manual', text: 'x' } })])
    h.setWorkflow(workflow)
    const run = h.store.createRun(workflow, {})
    await h.engine.abort(run.id)
    const after = await h.engine.resume(run.id)
    expect(after.status).toBe('aborted')
    h.close()
  })
})
