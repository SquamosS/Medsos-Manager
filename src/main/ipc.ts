import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import type { IpcChannel, IpcContract } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { getSummary, syncAnalytics } from './analytics'
import { dataDir } from './db'
import { notify } from './events'
import { cancelOAuth } from './oauth'
import { getPlatform, getProvider, listPlatforms } from './platforms/registry'
import type { AppCredentials } from './platforms/types'
import { clearSampleData, loadSampleData } from './sample'
import { kickScheduler } from './scheduler'
import { appCredentialsKey, getSecret, setSecret } from './secrets'
import { addDemoAccount, listAccounts, removeAccount, upsertLiveAccount } from './store/accounts'
import { importMedia, listMedia, removeMedia, setMediaMeta } from './store/media'
import {
  deletePost,
  duplicatePost,
  getPost,
  listPosts,
  queueNow,
  queueRetry,
  reschedulePost,
  savePost,
  unschedulePost
} from './store/posts'
import { getAppSettings, patchAppSettings } from './store/settings'

type Handler<C extends IpcChannel> = (...args: IpcContract[C]['args']) => IpcContract[C]['ret'] | Promise<IpcContract[C]['ret']>

function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as IpcContract[C]['args']))
    } catch (e) {
      // Surface a clean message to the renderer instead of Electron's "Error invoking remote method".
      throw new Error(e instanceof Error ? e.message : String(e))
    }
  })
}

const MEDIA_FILTERS = {
  video: [{ name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  image: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  any: [
    { name: 'Videos and images', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'jpg', 'jpeg', 'png', 'webp', 'gif'] }
  ]
}

export function registerIpc(onSettingsChanged: (s: AppSettings, prev: AppSettings) => void): void {
  handle('app:info', () => ({ version: app.getVersion(), dataDir: dataDir(), platform: process.platform }))
  handle('app:openExternal', async (url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened.')
    await shell.openExternal(url)
  })
  handle('platforms:list', () => listPlatforms())

  handle('accounts:list', () => listAccounts())
  handle('accounts:addDemo', (platform, name) => {
    const account = addDemoAccount(platform, name)
    // Give the new account a first analytics datapoint right away.
    void syncAnalytics().then(() => notify('analytics'))
    notify('accounts')
    return account
  })
  handle('accounts:remove', (id) => {
    removeAccount(id)
    notify('accounts', 'posts', 'analytics')
  })

  handle('credentials:status', (platform) => {
    const creds = getSecret<AppCredentials>(appCredentialsKey(platform))
    return { configured: creds !== null, clientId: creds?.clientId ?? null }
  })
  handle('credentials:save', (platform, clientId, clientSecret) => {
    getPlatform(platform)
    const id = clientId.trim()
    const secret = clientSecret.trim()
    if (!id || !secret) throw new Error('Both the Client ID and the Client Secret are required.')
    setSecret(appCredentialsKey(platform), { clientId: id, clientSecret: secret })
  })
  handle('accounts:connect', async (platform) => {
    const provider = getProvider(platform)
    if (!provider.connect) throw new Error(`${provider.info.name} sign-in is not available yet.`)
    const creds = getSecret<AppCredentials>(appCredentialsKey(platform))
    if (!creds) throw new Error('Save your developer credentials first.')
    const connection = await provider.connect(creds)
    const account = upsertLiveAccount(platform, connection)
    notify('accounts')
    void syncAnalytics().then(() => notify('analytics'))
    return account
  })
  handle('accounts:cancelConnect', () => cancelOAuth())

  handle('media:pick', async (kinds) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const opts = { title: 'Import media', properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[], filters: MEDIA_FILTERS[kinds] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths
  })
  handle('media:import', (paths) => {
    const media = importMedia(paths)
    notify('media')
    return media
  })
  handle('media:setMeta', (id, meta) => {
    const media = setMediaMeta(id, meta)
    notify('media')
    return media
  })
  handle('media:list', () => listMedia())
  handle('media:remove', (id) => {
    removeMedia(id)
    notify('media')
  })

  handle('posts:list', () => listPosts())
  handle('posts:get', (id) => getPost(id))
  handle('posts:save', (input) => {
    const post = savePost(input)
    notify('posts', 'media')
    if (input.intent === 'now') kickScheduler()
    return post
  })
  handle('posts:delete', (id) => {
    deletePost(id)
    notify('posts', 'media', 'analytics')
  })
  handle('posts:reschedule', (id, at) => {
    const post = reschedulePost(id, at)
    notify('posts')
    return post
  })
  handle('posts:unschedule', (id) => {
    const post = unschedulePost(id)
    notify('posts')
    return post
  })
  handle('posts:publishNow', (id) => {
    queueNow(id)
    notify('posts')
    kickScheduler()
  })
  handle('posts:retry', (id) => {
    queueRetry(id)
    notify('posts')
    kickScheduler()
  })
  handle('posts:duplicate', (id) => {
    const post = duplicatePost(id)
    notify('posts')
    return post
  })

  handle('analytics:summary', (q) => getSummary(q))
  handle('analytics:sync', async () => {
    const res = await syncAnalytics()
    notify('analytics')
    return res
  })

  handle('settings:get', () => getAppSettings())
  handle('settings:set', (patch) => {
    const prev = getAppSettings()
    const next = patchAppSettings(patch)
    onSettingsChanged(next, prev)
    notify('settings')
    return next
  })

  handle('sample:load', () => {
    loadSampleData()
    notify('accounts', 'posts', 'analytics')
  })
  handle('sample:clear', () => {
    clearSampleData()
    notify('accounts', 'posts', 'analytics')
  })
}
