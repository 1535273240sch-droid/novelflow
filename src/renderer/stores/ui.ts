import { create } from 'zustand'

export interface ToastItem {
  id: number
  text: string
}

interface UiState {
  toasts: ToastItem[]
  showToast: (text: string) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  showToast: (text) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, text }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 2600)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
