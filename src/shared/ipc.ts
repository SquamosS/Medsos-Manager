import type {
  Account,
  AnalyticsQuery,
  AnalyticsSummary,
  AppInfo,
  AppSettings,
  Media,
  MediaMetaInput,
  PlatformId,
  PlatformInfo,
  Post,
  PostInput
} from './types'

/** Request/response channels: `invoke(channel, ...args)` resolves with the return type. */
export interface IpcContract {
  'app:info': { args: []; ret: AppInfo }
  'app:openExternal': { args: [url: string]; ret: void }
  'platforms:list': { args: []; ret: PlatformInfo[] }

  'accounts:list': { args: []; ret: Account[] }
  'accounts:addDemo': { args: [platform: PlatformId, displayName: string]; ret: Account }
  'accounts:remove': { args: [id: string]; ret: void }

  'media:pick': { args: [kinds: 'video' | 'image' | 'any']; ret: string[] }
  'media:import': { args: [paths: string[]]; ret: Media[] }
  'media:setMeta': { args: [id: string, meta: MediaMetaInput]; ret: Media | null }
  'media:list': { args: []; ret: Media[] }
  'media:remove': { args: [id: string]; ret: void }

  'posts:list': { args: []; ret: Post[] }
  'posts:get': { args: [id: string]; ret: Post | null }
  'posts:save': { args: [input: PostInput]; ret: Post }
  'posts:delete': { args: [id: string]; ret: void }
  'posts:reschedule': { args: [id: string, scheduledAt: string]; ret: Post }
  'posts:unschedule': { args: [id: string]; ret: Post }
  'posts:publishNow': { args: [id: string]; ret: void }
  'posts:retry': { args: [id: string]; ret: void }
  'posts:duplicate': { args: [id: string]; ret: Post }

  'analytics:summary': { args: [query: AnalyticsQuery]; ret: AnalyticsSummary }
  'analytics:sync': { args: []; ret: { updated: number } }

  'settings:get': { args: []; ret: AppSettings }
  'settings:set': { args: [patch: Partial<AppSettings>]; ret: AppSettings }

  'sample:load': { args: []; ret: void }
  'sample:clear': { args: []; ret: void }
}

export type IpcChannel = keyof IpcContract

/** Push events from the main process. The payload names what changed. */
export type DataTopic = 'posts' | 'media' | 'accounts' | 'analytics' | 'settings'
export const DATA_CHANGED_EVENT = 'data:changed'

export interface MedsosApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcContract[C]['args']): Promise<IpcContract[C]['ret']>
  onDataChanged(cb: (topic: DataTopic) => void): () => void
  /** Resolves a dropped File to its absolute path (File.path was removed from Electron). */
  pathForFile(file: File): string
}
