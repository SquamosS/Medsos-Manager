import { BarChart3, CalendarDays, Images, LayoutDashboard, Link2, Plus, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePosts } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { Route } from '@/lib/store'
import { Button, cx } from './ui'

const NAV: { page: Route['page']; label: string; icon: ReactNode }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { page: 'calendar', label: 'Calendar', icon: <CalendarDays size={18} /> },
  { page: 'library', label: 'Library', icon: <Images size={18} /> },
  { page: 'analytics', label: 'Analytics', icon: <BarChart3 size={18} /> },
  { page: 'accounts', label: 'Accounts', icon: <Link2 size={18} /> }
]

export function Sidebar(): React.JSX.Element {
  const route = useApp((s) => s.route)
  const go = useApp((s) => s.go)
  const { data: posts } = usePosts()
  const queued = posts?.filter((p) => p.status === 'scheduled').length ?? 0
  const needsAttention = posts?.filter((p) => p.status === 'failed' || p.status === 'missed' || p.status === 'partial').length ?? 0

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="drag flex h-10 items-center gap-2 px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-white">M</div>
        <span className="text-sm font-semibold tracking-tight">Medsos Manager</span>
      </div>

      <div className="px-3 pb-2 pt-3">
        <Button variant="primary" className="w-full" icon={<Plus size={16} />} onClick={() => go({ page: 'compose' })}>
          New post
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2" aria-label="Main">
        {NAV.map((item) => {
          const active = route.page === item.page || (item.page === 'calendar' && route.page === 'compose')
          return (
            <button
              key={item.page}
              onClick={() => go({ page: item.page } as Route)}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'no-drag flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition',
                active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel2 hover:text-fg'
              )}
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {item.page === 'calendar' && queued > 0 && <span className="rounded-full bg-panel2 px-1.5 text-[11px] text-muted">{queued}</span>}
              {item.page === 'dashboard' && needsAttention > 0 && (
                <span title="Posts needing attention" className="rounded-full bg-bad/20 px-1.5 text-[11px] font-semibold text-bad">
                  {needsAttention}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <button
          onClick={() => go({ page: 'settings' })}
          className={cx(
            'no-drag flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition',
            route.page === 'settings' ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel2 hover:text-fg'
          )}
        >
          <Settings size={18} /> Settings
        </button>
      </div>
    </aside>
  )
}

