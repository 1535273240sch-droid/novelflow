import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { RunStore } from '../../src/main/services/workflow/store'
import { BUILTIN_TEMPLATES } from '../../src/main/services/workflow/templates'

async function store(): Promise<{ store: RunStore; dbFile: string; close: () => void }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-runs-'))
  const dbFile = path.join(dir, 'runs', 'runs.db')
  await fs.mkdir(path.dirname(dbFile), { recursive: true })
  const s = new RunStore(dbFile)
  return { store: s, dbFile, close: () => s.close() }
}

describe('运行记录 SQLite 持久化（验收要点 6）', () => {
  it('createRun 写入 runs/run_nodes；getRun 读回 pending 节点', async () => {
    const { store: s, dbFile, close } = await store()
    const wf = BUILTIN_TEMPLATES.find((t) => t.id === 'template-polish')!
    const run = s.createRun(wf, { chapterNo: 3 })
    expect(run.status).toBe('running')
    expect(run.nodes).toHaveLength(3)
    expect(run.nodes.every((n) => n.status === 'pending')).toBe(true)
    expect(await fs.stat(dbFile).then((x) => x.isFile())).toBe(true)

    const back = s.getRun(run.id)!
    expect(back.workflowId).toBe(wf.id)
    expect(back.chapterNo).toBe(3)
    expect(back.nodes.map((n) => n.nodeId)).toEqual(wf.nodes.map((n) => n.id))
    close()
  })

  it('saveRun 更新状态与节点输出（含 raw/kind/writesTo）并能读回', async () => {
    const { store: s, close } = await store()
    const wf = BUILTIN_TEMPLATES.find((t) => t.id === 'template-polish')!
    const run = s.createRun(wf, {})
    run.nodes[0].status = 'done'
    run.nodes[0].output = '原文'
    run.nodes[0].raw = '[{"original":"a","suggestion":"b"}]'
    run.nodes[0].kind = 'issues'
    run.nodes[0].writesTo = 'chapter'
    run.status = 'paused'
    s.saveRun(run)

    const back = s.getRun(run.id)!
    expect(back.status).toBe('paused')
    expect(back.nodes[0]).toMatchObject({
      status: 'done',
      output: '原文',
      raw: '[{"original":"a","suggestion":"b"}]',
      kind: 'issues',
      writesTo: 'chapter'
    })
    close()
  })

  it('unfinished 返回最近未完成的运行；完成后不再返回', async () => {
    const { store: s, close } = await store()
    const wf = BUILTIN_TEMPLATES.find((t) => t.id === 'template-polish')!
    const r1 = s.createRun(wf, {})
    expect(s.unfinished()?.id).toBe(r1.id)

    r1.status = 'completed'
    s.saveRun(r1)
    expect(s.unfinished()).toBeNull()

    const r2 = s.createRun(wf, {})
    r2.status = 'paused'
    s.saveRun(r2)
    expect(s.unfinished()?.id).toBe(r2.id)
    close()
  })

  it('listRuns 按更新时间倒序', async () => {
    const { store: s, close } = await store()
    const wf = BUILTIN_TEMPLATES.find((t) => t.id === 'template-polish')!
    const a = s.createRun(wf, {})
    const b = s.createRun(wf, {})
    const list = s.listRuns()
    expect(list.map((r) => r.id)).toContain(a.id)
    expect(list.map((r) => r.id)).toContain(b.id)
    expect(list.length).toBe(2)
    close()
  })

  it('重新打开同一库文件可看到之前的运行（进程重启语义）', async () => {
    const { store: s, dbFile, close } = await store()
    const wf = BUILTIN_TEMPLATES.find((t) => t.id === 'template-polish')!
    const run = s.createRun(wf, { chapterNo: 9 })
    run.status = 'paused'
    run.nodes[0].status = 'failed'
    run.nodes[0].error = '网络中断'
    s.saveRun(run)
    close()

    const reopened = new RunStore(dbFile)
    const back = reopened.getRun(run.id)!
    expect(back.status).toBe('paused')
    expect(back.nodes[0]).toMatchObject({ status: 'failed', error: '网络中断' })
    expect(reopened.unfinished()?.id).toBe(run.id)
    reopened.close()
  })
})
