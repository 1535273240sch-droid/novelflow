import { create } from 'zustand'
import type { Skill, SkillEvent, SkillMeta, SkillRunParams, SkillRunResult } from '../../shared/types'
import { useUiStore } from './ui'

interface SkillState {
  skills: SkillMeta[]
  loading: boolean
  running: boolean
  callId: string | null
  /** 流式过程中的全量文本快照 */
  streamText: string
  result: SkillRunResult | null
  /** 最近一次运行参数（应用改写时用以确定目标文本） */
  lastParams: SkillRunParams | null
  error: string | null

  load: () => Promise<void>
  get: (id: string) => Promise<Skill | null>
  save: (skill: Skill) => Promise<Skill>
  remove: (id: string) => Promise<void>
  duplicate: (id: string) => Promise<Skill>
  importDialog: () => Promise<Skill | null>
  exportDialog: (id: string) => Promise<string | null>
  run: (params: SkillRunParams) => Promise<void>
  cancel: () => Promise<void>
  clear: () => void
}

const pending: SkillEvent[] = []
let initialized = false

export const useSkillStore = create<SkillState>((set, getState) => {
  const handle = (ev: SkillEvent): void => {
    const st = getState()
    if (st.callId !== ev.callId) return
    if (ev.type === 'delta') {
      set({ streamText: ev.full })
    } else if (ev.type === 'done') {
      set({ running: false, callId: null, streamText: ev.result?.raw ?? ev.full, result: ev.result ?? null })
    } else {
      set({
        running: false,
        callId: null,
        error: ev.cancelled ? '已取消' : (ev.error ?? '运行失败')
      })
      useUiStore.getState().showToast(ev.cancelled ? 'Skill 运行已取消' : `Skill 运行失败：${ev.error ?? ''}`)
    }
  }

  const initEvents = (): void => {
    if (initialized) return
    initialized = true
    window.novelflow.skills.onEvent((ev) => {
      const st = getState()
      if (!st.callId || st.callId !== ev.callId) {
        pending.push(ev)
        if (pending.length > 200) pending.shift()
        return
      }
      handle(ev)
    })
  }

  return {
    skills: [],
    loading: false,
    running: false,
    callId: null,
    streamText: '',
    result: null,
    lastParams: null,
    error: null,

    load: async () => {
      initEvents()
      set({ loading: true })
      try {
        const skills = await window.novelflow.skills.list()
        set({ skills })
      } finally {
        set({ loading: false })
      }
    },

    get: (id) => window.novelflow.skills.get(id),

    save: async (skill) => {
      const saved = await window.novelflow.skills.save(skill)
      await getState().load()
      return saved
    },

    remove: async (id) => {
      await window.novelflow.skills.remove(id)
      await getState().load()
    },

    duplicate: async (id) => {
      const copy = await window.novelflow.skills.duplicate(id)
      await getState().load()
      return copy
    },

    importDialog: async () => {
      const skill = await window.novelflow.skills.importDialog()
      await getState().load()
      return skill
    },

    exportDialog: (id) => window.novelflow.skills.exportDialog(id),

    run: async (params) => {
      initEvents()
      set({ running: true, result: null, error: null, streamText: '', lastParams: params })
      try {
        const callId = await window.novelflow.skills.run(params)
        set({ callId })
        const buffered = pending.filter((e) => e.callId === callId)
        pending.length = 0
        for (const ev of buffered) handle(ev)
      } catch (e) {
        set({ running: false, callId: null, error: e instanceof Error ? e.message : String(e) })
        useUiStore.getState().showToast(`发起失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },

    cancel: async () => {
      const { callId } = getState()
      if (callId) await window.novelflow.skills.cancel(callId)
    },

    clear: () => set({ result: null, streamText: '', error: null, lastParams: null })
  }
})
