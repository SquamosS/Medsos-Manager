import { BrowserWindow, Menu, Tray, app, nativeImage, net, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AppSettings } from '@shared/types'
import { closeDb, openDb } from './db'
import { registerIpc } from './ipc'
import { stopMcp, syncMcp } from './mcp'
import { startScheduler, stopScheduler } from './scheduler'
import { getMediaPath, thumbPath } from './store/media'
import { getAppSettings } from './store/settings'
import icon from '../../resources/icon.png?asset'

// Serves library media and thumbnails to the renderer (file:// is blocked from http://localhost in dev).
protocol.registerSchemesAsPrivileged([
  { scheme: 'medsos', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
])

const THEME = {
  dark: { bg: '#0e1016', fg: '#e8eaf0' },
  light: { bg: '#f5f6fa', fg: '#1b1e28' }
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function createWindow(showOnReady: boolean): void {
  const theme = THEME[getAppSettings().theme]
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: theme.bg,
    title: 'Medsos Manager',
    icon,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: theme.bg, symbolColor: theme.fg, height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    if (showOnReady) win.show()
  })
  win.on('close', (e) => {
    // Keep running in the tray so scheduled posts still go out when the window is closed.
    if (!quitting && getAppSettings().runInBackground) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) createWindow(true)
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  tray.setToolTip('Medsos Manager')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Medsos Manager', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit (stops scheduled posts)',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showWindow)
}

async function applySettings(next: AppSettings, prev: AppSettings): Promise<void> {
  if (next.theme !== prev.theme) {
    const t = THEME[next.theme]
    mainWindow?.setBackgroundColor(t.bg)
    if (process.platform === 'win32') mainWindow?.setTitleBarOverlay({ color: t.bg, symbolColor: t.fg, height: 40 })
  }
  if (next.launchAtLogin !== prev.launchAtLogin && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] })
  }
  if (next.mcpEnabled !== prev.mcpEnabled || next.mcpPort !== prev.mcpPort) await syncMcp(next, prev)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.medsos.manager')
    openDb()

    protocol.handle('medsos', async (request) => {
      const url = new URL(request.url)
      const id = decodeURIComponent(url.pathname.slice(1))
      if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Bad request', { status: 400 })
      const file = url.hostname === 'media' ? getMediaPath(id) : url.hostname === 'thumb' ? thumbPath(id) : null
      if (!file || !existsSync(file)) return new Response('Not found', { status: 404 })
      const res = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers })
      // Allow the renderer to read frames from videos/images (canvas needs CORS-clean media).
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    })

    if (app.isPackaged) Menu.setApplicationMenu(null)
    registerIpc(applySettings)
    void syncMcp(getAppSettings())
    createTray()
    createWindow(!process.argv.includes('--hidden'))
    startScheduler()

    app.on('activate', showWindow)
  })

  app.on('before-quit', () => {
    quitting = true
    stopScheduler()
    void stopMcp()
  })
  app.on('will-quit', () => closeDb())
  // With "run in background" the window hides instead of closing, so this only fires when that is off.
  app.on('window-all-closed', () => {
    if (quitting || !getAppSettings().runInBackground) app.quit()
  })
}
