import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DATA_CHANGED_EVENT } from '@shared/ipc'
import type { DataTopic, MedsosApi } from '@shared/ipc'

const api: MedsosApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onDataChanged: (cb) => {
    const listener = (_e: unknown, topic: DataTopic): void => cb(topic)
    ipcRenderer.on(DATA_CHANGED_EVENT, listener)
    return () => ipcRenderer.removeListener(DATA_CHANGED_EVENT, listener)
  },
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('api', api)
