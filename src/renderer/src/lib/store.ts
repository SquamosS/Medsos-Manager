import { create } from 'zustand'

export type Route =
  | { page: 'dashboard' }
  | { page: 'calendar' }
  | { page: 'compose'; postId?: string; prefillDate?: string; prefillMedia?: string[] }
  | { page: 'library' }
  | { page: 'analytics' }
  | { page: 'accounts' }
  | { page: 'settings' }

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

interface AppState {
  route: Route
  go: (route: Route) => void
  toasts: Toast[]
  toast: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
}

let nextToastId = 1

export const useApp = create<AppState>((set, get) => ({
  route: { page: 'dashboard' },
  go: (route) => set({ route }),
  toasts: [],
  toast: (message, kind = 'info') => {
    const id = nextToastId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Runs an async action and reports failures as an error toast. */
export async function attempt<T>(fn: () => Promise<T>, successMessage?: string): Promise<T | undefined> {
  try {
    const res = await fn()
    if (successMessage) useApp.getState().toast(successMessage, 'success')
    return res
  } catch (e) {
    useApp.getState().toast(e instanceof Error ? e.message : String(e), 'error')
    return undefined
  }
}
