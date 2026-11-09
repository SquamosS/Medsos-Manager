/// <reference types="vite/client" />
import type { MedsosApi } from '@shared/ipc'

declare global {
  interface Window {
    api: MedsosApi
  }
}
