import { create } from 'zustand'
import type { AppConfig, AppSettings, PresetInput, PresetView, RoleMapping } from '../../shared/types'

interface SettingsState {
  settings: AppSettings | null
  loaded: boolean
  load: () => Promise<void>
  savePreset: (input: PresetInput) => Promise<PresetView>
  deletePreset: (id: string) => Promise<void>
  setRoles: (roles: RoleMapping) => Promise<void>
  setAppConfig: (patch: Partial<AppConfig>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loaded: false,
  load: async () => {
    const settings = await window.novelflow.settings.get()
    set({ settings, loaded: true })
  },
  savePreset: async (input) => {
    const view = await window.novelflow.settings.savePreset(input)
    await get().load()
    return view
  },
  deletePreset: async (id) => {
    await window.novelflow.settings.deletePreset(id)
    await get().load()
  },
  setRoles: async (roles) => {
    await window.novelflow.settings.setRoles(roles)
    await get().load()
  },
  setAppConfig: async (patch) => {
    await window.novelflow.settings.setAppConfig(patch)
    await get().load()
  }
}))
