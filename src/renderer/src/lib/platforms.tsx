import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PlatformInfo } from '@shared/types'
import { usePlatforms } from './api'

interface PlatformCtx {
  list: PlatformInfo[]
  get: (id: string) => PlatformInfo | undefined
  color: (id: string) => string
  name: (id: string) => string
}

const Ctx = createContext<PlatformCtx>({ list: [], get: () => undefined, color: () => '#888', name: (id) => id })

export function PlatformsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { data } = usePlatforms()
  const value = useMemo<PlatformCtx>(() => {
    const list = data ?? []
    const map = new Map(list.map((p) => [p.id, p]))
    return {
      list,
      get: (id) => map.get(id),
      color: (id) => map.get(id)?.color ?? '#888888',
      name: (id) => map.get(id)?.name ?? id
    }
  }, [data])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePlatformCtx = (): PlatformCtx => useContext(Ctx)
