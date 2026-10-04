import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { openSqlite, type SqliteDb } from './sqlite'
import type { Workflow, WorkflowNodeState, WorkflowRun, WorkflowRunStatus } from '../../../shared/types'

/**
 * 运行记录持久化（M4 验收要点 6）：SQLite `runs` + `run_nodes` 两张表。
 * 库文件放在项目 `runs/runs.db`，因此「上次未完成的运行」是**项目维度**的。
 * 本模块不 import electron，便于单测直接运行。
 */

interface RunRow {
  id: string
  workflow_id: string
  workflow_name: string
  chapter_no: number | null
  status: string
  payload: string
  created_at: string
  updated_at: string
}

interface NodeRow {
  node_id: string
  name: string
  skill_id: string
  seq: number
  status: string
  output: string | null
  raw: string | null
  kind: string | null
  writes_to: string | null
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export interface RunStoreOptions {
  now?: () => Date
  newId?: () => string
}

export class RunStore {
  private db: SqliteDb

  constructor(
    dbFile: string,
    private readonly opts: RunStoreOptions = {}
  ) {
    this.db = openSqlite(dbFile)
    this.migrate()
  }

  private now(): string {
    return (this.opts.now?.() ?? new Date()).toISOString()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        chapter_no INTEGER,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_nodes (
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        name TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        status TEXT NOT NULL,
        output TEXT,
        raw TEXT,
        kind TEXT,
        writes_to TEXT,
        error TEXT,
        started_at TEXT,
        finished_at TEXT,
        PRIMARY KEY (run_id, node_id)
      );
    `)
  }

  createRun(workflow: Workflow, opts: { chapterNo?: number; presetId?: string } = {}): WorkflowRun {
    const id = this.opts.newId?.() ?? randomUUID()
    const iso = this.now()
    const nodes: WorkflowNodeState[] = workflow.nodes.map((n) => ({
      nodeId: n.id,
      name: n.name,
      skillId: n.skillId,
      status: 'pending'
    }))
    const run: WorkflowRun = {
      id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      ...(opts.chapterNo != null ? { chapterNo: opts.chapterNo } : {}),
      status: 'running',
      nodes,
      createdAt: iso,
      updatedAt: iso
    }
    this.db
      .prepare(
        `INSERT INTO runs (id, workflow_id, workflow_name, chapter_no, status, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.workflowId,
        run.workflowName,
        run.chapterNo ?? null,
        run.status,
        JSON.stringify({ presetId: opts.presetId ?? null }),
        iso,
        iso
      )
    this.writeNodes(run)
    return run
  }

  private writeNodes(run: WorkflowRun): void {
    const stmt = this.db.prepare(
      `INSERT INTO run_nodes (run_id, node_id, name, skill_id, seq, status, output, raw, kind, writes_to, error, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, node_id) DO UPDATE SET
         status=excluded.status, output=excluded.output, raw=excluded.raw,
         kind=excluded.kind, writes_to=excluded.writes_to,
         error=excluded.error, started_at=excluded.started_at, finished_at=excluded.finished_at`
    )
    run.nodes.forEach((n, i) => {
      stmt.run(
        run.id,
        n.nodeId,
        n.name,
        n.skillId,
        i,
        n.status,
        n.output ?? null,
        n.raw ?? null,
        n.kind ?? null,
        n.writesTo ?? null,
        n.error ?? null,
        n.startedAt ?? null,
        n.finishedAt ?? null
      )
    })
  }

  /** 保存运行状态（覆盖 run 行与全部节点行）。 */
  saveRun(run: WorkflowRun): WorkflowRun {
    run.updatedAt = this.now()
    this.db
      .prepare(`UPDATE runs SET status=?, updated_at=?, chapter_no=? WHERE id=?`)
      .run(run.status, run.updatedAt, run.chapterNo ?? null, run.id)
    this.writeNodes(run)
    return run
  }

  getRun(id: string): WorkflowRun | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined
    if (!row) return null
    const nodeRows = this.db
      .prepare(`SELECT * FROM run_nodes WHERE run_id = ? ORDER BY seq ASC`)
      .all(id) as NodeRow[]
    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      ...(row.chapter_no != null ? { chapterNo: row.chapter_no } : {}),
      status: row.status as WorkflowRunStatus,
      nodes: nodeRows.map((n) => ({
        nodeId: n.node_id,
        name: n.name,
        skillId: n.skill_id,
        status: n.status as WorkflowNodeState['status'],
        ...(n.output != null ? { output: n.output } : {}),
        ...(n.raw != null ? { raw: n.raw } : {}),
        ...(n.kind != null ? { kind: n.kind as WorkflowNodeState['kind'] } : {}),
        ...(n.writes_to != null ? { writesTo: n.writes_to as WorkflowNodeState['writesTo'] } : {}),
        ...(n.error != null ? { error: n.error } : {}),
        ...(n.started_at != null ? { startedAt: n.started_at } : {}),
        ...(n.finished_at != null ? { finishedAt: n.finished_at } : {})
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /** 该运行保存的 presetId（start 时记录，resume 时复用）。 */
  getRunOptions(id: string): { presetId?: string } {
    const row = this.db.prepare(`SELECT payload FROM runs WHERE id = ?`).get(id) as
      | { payload: string }
      | undefined
    if (!row) return {}
    try {
      const p = JSON.parse(row.payload) as { presetId?: string | null }
      return p.presetId ? { presetId: p.presetId } : {}
    } catch {
      return {}
    }
  }

  listRuns(limit = 50): WorkflowRun[] {
    const rows = this.db
      .prepare(`SELECT id FROM runs ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as Array<{ id: string }>
    return rows.map((r) => this.getRun(r.id)).filter((r): r is WorkflowRun => r !== null)
  }

  /** 最近一次未完成的运行（running / paused / failed）。 */
  unfinished(): WorkflowRun | null {
    const row = this.db
      .prepare(
        `SELECT id FROM runs WHERE status IN ('running','paused','failed') ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as { id: string } | undefined
    return row ? this.getRun(row.id) : null
  }

  close(): void {
    this.db.close()
  }
}

/** 项目内运行库路径（确保 runs/ 目录存在）。 */
export async function runStoreFor(projectRoot: string): Promise<RunStore> {
  const dir = path.join(projectRoot, 'runs')
  await fs.mkdir(dir, { recursive: true })
  return new RunStore(path.join(dir, 'runs.db'))
}
