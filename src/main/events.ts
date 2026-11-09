import { BrowserWindow } from 'electron'
import { DATA_CHANGED_EVENT } from '@shared/ipc'
import type { DataTopic } from '@shared/ipc'

/** Tells every open window that some data changed so it can refetch. */
export function notify(...topics: DataTopic[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    for (const topic of topics) win.webContents.send(DATA_CHANGED_EVENT, topic)
  }
}
