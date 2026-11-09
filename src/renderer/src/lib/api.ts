import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataTopic, IpcChannel, IpcContract } from '@shared/ipc'

/** Typed wrapper over window.api.invoke that strips Electron's error prefix. */
export async function call<C extends IpcChannel>(
  channel: C,
  ...args: IpcContract[C]['args']
): Promise<IpcContract[C]['ret']> {
  try {
    return await window.api.invoke(channel, ...args)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  }
}

export interface Query<T> {
  data: T | undefined
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Loads data over IPC and reloads it whenever the main process reports a change to one of `topics`.
 * Pass `args` as a stable array literal; it is compared by value.
 */
export function useQuery<C extends IpcChannel>(
  channel: C,
  args: IpcContract[C]['args'],
  topics: DataTopic[]
): Query<IpcContract[C]['ret']> {
  const [data, setData] = useState<IpcContract[C]['ret']>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const argsKey = JSON.stringify(args)
  const topicsKey = topics.join(',')
  const seq = useRef(0)

  const load = useCallback(() => {
    const mine = ++seq.current
    call(channel, ...(JSON.parse(argsKey) as IpcContract[C]['args']))
      .then((res) => {
        if (mine !== seq.current) return
        setData(res)
        setError(null)
      })
      .catch((e: Error) => mine === seq.current && setError(e.message))
      .finally(() => mine === seq.current && setLoading(false))
  }, [channel, argsKey])

  useEffect(() => {
    load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.api.onDataChanged((topic) => {
      if (!topicsKey.split(',').includes(topic)) return
      clearTimeout(timer) // coalesce bursts of events
      timer = setTimeout(load, 60)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [load, topicsKey])

  return { data, loading, error, reload: load }
}

export const usePlatforms = () => useQuery('platforms:list', [], [])
export const useAccounts = () => useQuery('accounts:list', [], ['accounts'])
export const useMedia = () => useQuery('media:list', [], ['media'])
export const usePosts = () => useQuery('posts:list', [], ['posts'])
export const useSettings = () => useQuery('settings:get', [], ['settings'])
