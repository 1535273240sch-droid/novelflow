import { resolveChapterPlaceholder } from './templates'
import type { RunStore } from './store'
import type {
  SkillOutputKind,
  SkillWritesTo,
  Workflow,
  WorkflowNode,
  WorkflowRun,
  WorkflowNodeState
} from '../../../shared/types'

/**
 * 工作流引擎（M4）：
 * - 顺序执行节点；节点四要素（Skill / 模型 / 输入绑定 / 输出去向）由节点定义驱动；
 * - 检查类（issues）节点的输出**不污染文本流**，下一步仍拿到原文；
 * - 人工确认点：执行到该节点后暂停，界面可查看/修改中间结果再继续；
 * - 失败语义：停在该节点，已完成结果保留，可从此处重试；
 * - 状态每步落库（RunStore/SQLite），因此进程被杀后重新 new 一个引擎 resume 即可续跑。
 *
 * 引擎不 import electron；模型调用经注入的 NodeExecutor，单测可完全 mock。
 */

export interface NodeExecutionRequest {
  node: WorkflowNode
  inputText: string
  chapterNo?: number
  presetId?: string
}

export interface NodeExecutionResult {
  /** 流向下一节点的文本 */
  output: string
  /** 模型原始输出 */
  raw: string
  kind: SkillOutputKind
  writesTo: SkillWritesTo
}

export interface NodeExecutor {
  (req: NodeExecutionRequest): Promise<NodeExecutionResult>
}

export interface EngineDeps {
  readFile(rel: string): Promise<string>
  writeFile(rel: string, content: string): Promise<void>
  applyFramework(text: string): Promise<unknown>
  applyState(raw: string, chapterNo?: number): Promise<unknown>
  now?: () => Date
}

export interface StartOptions {
  chapterNo?: number
  presetId?: string
}

export function chapterFileName(chapterNo?: number): string {
  return `第${String(chapterNo ?? 0).padStart(3, '0')}章.md`
}

export class WorkflowEngine {
  constructor(
    private readonly store: RunStore,
    private readonly workflows: { get(id: string): Promise<Workflow | null> },
    private readonly executor: NodeExecutor,
    private readonly deps: EngineDeps
  ) {}

  private iso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  async start(workflow: Workflow, opts: StartOptions = {}): Promise<WorkflowRun> {
    const run = this.store.createRun(workflow, opts)
    return this.advance(run.id, workflow)
  }

  async resume(runId: string): Promise<WorkflowRun> {
    return this.advance(runId)
  }

  /** 从当前位置继续执行，直到完成、暂停（人工确认）或失败。 */
  async advance(runId: string, wf?: Workflow): Promise<WorkflowRun> {
    const run = this.store.getRun(runId)
    if (!run) throw new Error(`运行不存在：${runId}`)
    if (run.status === 'completed' || run.status === 'aborted') return run
    const workflow = wf ?? (await this.workflows.get(run.workflowId))
    if (!workflow) throw new Error('工作流定义不存在，无法继续')
    const presetId = this.store.getRunOptions(runId).presetId
    run.status = 'running'

    for (let i = 0; i < run.nodes.length; i++) {
      const st = run.nodes[i]
      const node = workflow.nodes[i]
      if (!node) {
        st.status = 'failed'
        st.error = '工作流定义与运行记录不一致（节点数不同）'
        run.status = 'failed'
        return this.store.saveRun(run)
      }
      if (st.status === 'done') continue
      if (st.status === 'awaiting_confirm' || st.status === 'failed') {
        run.status = st.status === 'failed' ? 'failed' : 'paused'
        return this.store.saveRun(run)
      }

      // pending（或崩溃时残留的 running）→ 执行
      try {
        const inputText = await this.resolveInput(node, i, run)
        st.status = 'running'
        st.startedAt = this.iso()
        this.store.saveRun(run)

        const result = node.skillId
          ? await this.executor({ node, inputText, chapterNo: run.chapterNo, presetId })
          : { output: inputText, raw: inputText, kind: 'text' as const, writesTo: 'chapter' as const }

        st.kind = result.kind
        st.writesTo = result.writesTo
        st.raw = result.raw
        // 检查类节点：文本流原样传递
        st.output = result.kind === 'issues' ? inputText : result.output

        if (node.confirm) {
          // 人工确认点：先不落盘，等确认（可带修改）后再写
          st.status = 'awaiting_confirm'
          run.status = 'paused'
          return this.store.saveRun(run)
        }
        await this.applyWrites(node, st, run)
        st.status = 'done'
        st.finishedAt = this.iso()
        this.store.saveRun(run)
      } catch (e) {
        st.status = 'failed'
        st.error = e instanceof Error ? e.message : String(e)
        st.finishedAt = this.iso()
        run.status = 'failed'
        return this.store.saveRun(run)
      }
    }

    run.status = 'completed'
    return this.store.saveRun(run)
  }

  /** 人工确认：可带修改后的中间结果；随后继续执行。 */
  async confirm(runId: string, nodeId: string, editedOutput?: string): Promise<WorkflowRun> {
    const run = this.store.getRun(runId)
    if (!run) throw new Error(`运行不存在：${runId}`)
    const st = run.nodes.find((n) => n.nodeId === nodeId)
    if (!st) throw new Error(`节点不存在：${nodeId}`)
    if (st.status !== 'awaiting_confirm') throw new Error('该节点不在待确认状态')
    const workflow = await this.workflows.get(run.workflowId)
    if (!workflow) throw new Error('工作流定义不存在')
    const node = workflow.nodes[run.nodes.indexOf(st)]
    if (editedOutput != null) {
      st.output = editedOutput
      st.raw = editedOutput
    }
    try {
      await this.applyWrites(node, st, run)
      st.status = 'done'
      st.finishedAt = this.iso()
      this.store.saveRun(run)
    } catch (e) {
      st.status = 'failed'
      st.error = e instanceof Error ? e.message : String(e)
      run.status = 'failed'
      return this.store.saveRun(run)
    }
    return this.advance(runId, workflow)
  }

  /** 从指定节点重试（该节点需为 failed；后续节点保持 pending）。 */
  async retry(runId: string, nodeId: string): Promise<WorkflowRun> {
    const run = this.store.getRun(runId)
    if (!run) throw new Error(`运行不存在：${runId}`)
    const st = run.nodes.find((n) => n.nodeId === nodeId)
    if (!st) throw new Error(`节点不存在：${nodeId}`)
    st.status = 'pending'
    delete st.error
    delete st.startedAt
    delete st.finishedAt
    run.status = 'running'
    this.store.saveRun(run)
    return this.advance(runId)
  }

  async abort(runId: string): Promise<WorkflowRun> {
    const run = this.store.getRun(runId)
    if (!run) throw new Error(`运行不存在：${runId}`)
    run.status = 'aborted'
    return this.store.saveRun(run)
  }

  private async resolveInput(node: WorkflowNode, index: number, run: WorkflowRun): Promise<string> {
    const src = node.input.source
    if (src === 'manual') return node.input.text ?? ''
    if (src === 'file') {
      const rel = resolveChapterPlaceholder(node.input.relPath ?? '', run.chapterNo)
      return this.deps.readFile(rel)
    }
    // previous
    if (index === 0) throw new Error('首个节点不能绑定「上节点输出」，请改用项目文件或手填')
    return run.nodes[index - 1].output ?? ''
  }

  private async applyWrites(node: WorkflowNode, st: WorkflowNodeState, run: WorkflowRun): Promise<void> {
    const out = st.output ?? ''
    const raw = st.raw ?? out
    switch (st.writesTo ?? 'chapter') {
      case 'outline':
        await this.deps.writeFile(`outline/${chapterFileName(run.chapterNo)}`, out)
        return
      case 'bible':
        await this.deps.applyFramework(raw)
        return
      case 'state':
        await this.deps.applyState(raw, run.chapterNo)
        return
      default:
        if (node.sink.kind === 'file' && node.sink.relPath) {
          await this.deps.writeFile(resolveChapterPlaceholder(node.sink.relPath, run.chapterNo), out)
        }
        return
    }
  }
}
