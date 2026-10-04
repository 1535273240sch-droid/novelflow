import { create } from 'zustand'
import type { Workflow, WorkflowRun } from '../../shared/types'
import { useUiStore } from './ui'

interface WorkflowState {
  workflows: Workflow[]
  runs: WorkflowRun[]
  run: WorkflowRun | null
  loading: boolean
  load: () => Promise<void>
  save: (workflow: Workflow) => Promise<Workflow>
  remove: (id: string) => Promise<void>
  createFromTemplate: (templateId: string) => Promise<Workflow>
  start: (workflowId: string, chapterNo?: number) => Promise<WorkflowRun>
  resume: (id: string) => Promise<WorkflowRun>
  confirm: (id: string, nodeId: string, editedOutput?: string) => Promise<WorkflowRun>
  retry: (id: string, nodeId: string) => Promise<WorkflowRun>
  abort: (id: string) => Promise<WorkflowRun>
  clearRun: () => void
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  runs: [],
  run: null,
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const [workflows, runs] = await Promise.all([
        window.novelflow.workflow.list(),
        window.novelflow.runs.list()
      ])
      set({ workflows, runs })
    } finally {
      set({ loading: false })
    }
  },

  save: async (workflow) => {
    const saved = await window.novelflow.workflow.save(workflow)
    await get().load()
    return saved
  },

  remove: async (id) => {
    await window.novelflow.workflow.remove(id)
    await get().load()
  },

  createFromTemplate: async (templateId) => {
    const w = await window.novelflow.workflow.createFromTemplate(templateId)
    await get().load()
    return w
  },

  start: async (workflowId, chapterNo) => {
    const run = await window.novelflow.runs.start(workflowId, chapterNo != null ? { chapterNo } : undefined)
    set({ run })
    await get().load()
    useUiStore.getState().showToast(`运行状态：${statusLabel(run.status)}`)
    return run
  },

  resume: async (id) => {
    const run = await window.novelflow.runs.resume(id)
    set({ run })
    await get().load()
    return run
  },

  confirm: async (id, nodeId, editedOutput) => {
    const run = await window.novelflow.runs.confirm(id, nodeId, editedOutput)
    set({ run })
    await get().load()
    return run
  },

  retry: async (id, nodeId) => {
    const run = await window.novelflow.runs.retry(id, nodeId)
    set({ run })
    await get().load()
    return run
  },

  abort: async (id) => {
    const run = await window.novelflow.runs.abort(id)
    set({ run })
    await get().load()
    return run
  },

  clearRun: () => set({ run: null })
}))

export function statusLabel(s: WorkflowRun['status']): string {
  return (
    {
      running: '运行中',
      paused: '已暂停（等待人工确认）',
      failed: '失败（可从此处重试）',
      completed: '已完成',
      aborted: '已中止'
    } as const
  )[s]
}
