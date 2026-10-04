import { create } from 'zustand'
import type { FileEntry, LlmEvent, ProjectInfo } from '../../shared/types'
import { useUiStore } from './ui'

interface ProjectState {
  project: ProjectInfo | null
  bible: FileEntry[]
  outline: FileEntry[]
  chapters: FileEntry[]
  /** 当前打开文件的相对路径（如 chapters/第001章.md） */
  currentPath: string | null
  currentTitle: string
  content: string
  dirty: boolean
  saving: boolean
  lastSavedAt: string | null
  /** 编辑器当前选中的文本（Skill「对选中文本运行」用） */
  selection: string
  /** 选区在文档中的起止下标（用于精确替换） */
  selectionFrom: number
  selectionTo: number
  /** 流式生成状态 */
  streamCallId: string | null
  streamStatus: 'idle' | 'streaming'
  /** 流式开始时的内容基准长度（流式输出追加在基准之后） */
  streamBase: string

  init: () => Promise<void>
  initEvents: () => void
  createDialog: () => Promise<void>
  openDialog: () => Promise<void>
  refresh: () => Promise<void>
  openFile: (relPath: string) => Promise<void>
  newChapter: (kind: 'chapters' | 'outline') => Promise<void>
  setContent: (text: string) => void
  setSelection: (text: string, from: number, to: number) => void
  saveNow: () => Promise<boolean>
  /** 用整段新内容替换当前文件（先快照到 .history/），用于应用 Skill 改写 */
  applyContent: (text: string) => Promise<void>
  /** 记录流式调用的 callId（早于 callId 到达的事件会被缓冲，在这里回放） */
  startStream: (callId: string) => void
  appendStream: (full: string) => void
  endStream: () => void
}

// 事件缓冲：llm:chat 的 invoke 返回 callId 之前，主进程可能已发出事件（全量快照语义，回放无损）
const pendingEvents: LlmEvent[] = []
let eventsInitialized = false

export const useProjectStore = create<ProjectState>((set, get) => {
  const handleEvent = (ev: LlmEvent): void => {
    const st = get()
    if (st.streamCallId !== ev.callId) return
    if (ev.type === 'delta') {
      st.appendStream(ev.full)
    } else if (ev.type === 'done') {
      st.endStream()
    } else {
      st.endStream()
      useUiStore.getState().showToast(
        ev.cancelled ? '生成已取消' : `生成失败：${ev.error ?? '未知错误'}`
      )
    }
  }

  return {
    project: null,
    bible: [],
    outline: [],
    chapters: [],
    currentPath: null,
    currentTitle: '',
    content: '',
    dirty: false,
    saving: false,
    lastSavedAt: null,
    selection: '',
    selectionFrom: 0,
    selectionTo: 0,
    streamCallId: null,
    streamStatus: 'idle',
    streamBase: '',

    init: async () => {
      const project = await window.novelflow.project.getCurrent()
      set({ project })
      if (project) await get().refresh()
    },

    initEvents: () => {
      if (eventsInitialized) return
      eventsInitialized = true
      window.novelflow.llm.onEvent((ev) => {
        const st = get()
        if (!st.streamCallId || st.streamCallId !== ev.callId) {
          pendingEvents.push(ev)
          if (pendingEvents.length > 100) pendingEvents.shift()
          return
        }
        handleEvent(ev)
      })
    },

    createDialog: async () => {
      const project = await window.novelflow.project.createDialog()
      if (!project) return
      set({ project, currentPath: null, currentTitle: '', content: '', dirty: false })
      await get().refresh()
      useUiStore.getState().showToast(`已创建项目「${project.name}」`)
    },

    openDialog: async () => {
      const project = await window.novelflow.project.openDialog()
      if (!project) return
      set({ project, currentPath: null, currentTitle: '', content: '', dirty: false })
      await get().refresh()
      useUiStore.getState().showToast(`已打开项目「${project.name}」`)
    },

    refresh: async () => {
      const api = window.novelflow
      const [bible, outline, chapters] = await Promise.all([
        api.files.list('bible'),
        api.files.list('outline'),
        api.files.list('chapters')
      ])
      set({ bible, outline, chapters })
    },

    openFile: async (relPath) => {
      const st = get()
      if (st.currentPath === relPath) return
      if (st.dirty) await st.saveNow()
      const content = await window.novelflow.files.read(relPath)
      set({
        currentPath: relPath,
        currentTitle: relPath.split('/').pop() ?? relPath,
        content,
        dirty: false
      })
    },

    newChapter: async (kind) => {
      const rel = await window.novelflow.files.createChapter(kind)
      await get().refresh()
      await get().openFile(rel)
      useUiStore.getState().showToast(`已新建：${rel}`)
    },

    setContent: (text) =>
      set((s) => (s.content === text ? s : { content: text, dirty: true })),

    setSelection: (text, from, to) =>
      set((s) =>
        s.selection === text && s.selectionFrom === from && s.selectionTo === to
          ? s
          : { selection: text, selectionFrom: from, selectionTo: to }
      ),

    applyContent: async (text) => {
      const st = get()
      if (!st.currentPath) return
      await window.novelflow.files.writeWithSnapshot(st.currentPath, text)
      set({ content: text, dirty: false, lastSavedAt: new Date().toLocaleTimeString('zh-CN') })
    },

    saveNow: async () => {
      const st = get()
      if (!st.currentPath || !st.dirty || st.saving) return false
      set({ saving: true })
      try {
        await window.novelflow.files.write(st.currentPath, st.content)
        set({ dirty: false, lastSavedAt: new Date().toLocaleTimeString('zh-CN') })
        return true
      } finally {
        set({ saving: false })
      }
    },

    startStream: (callId) => {
      set({ streamCallId: callId, streamStatus: 'streaming', streamBase: get().content })
      const buffered = pendingEvents.filter((e) => e.callId === callId)
      pendingEvents.length = 0
      for (const ev of buffered) handleEvent(ev)
    },

    appendStream: (full) => {
      set((s) => ({ content: s.streamBase + full, dirty: true }))
    },

    endStream: () => {
      set({ streamCallId: null, streamStatus: 'idle' })
    }
  }
})
