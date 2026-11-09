import { AlertTriangle, CalendarClock, CheckCircle2, FileText, Link2, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Post } from '@shared/types'
import { PlatformIcon } from '@/components/PlatformIcon'
import { PostDetailModal, PostRow, usePostActions } from '@/components/PostParts'
import { Button, Card, EmptyState, PageHeader, Spinner, cx } from '@/components/ui'
import { call, useAccounts, usePosts } from '@/lib/api'
import { fmtRelative } from '@/lib/format'
import { attempt, useApp } from '@/lib/store'

function Stat({ icon, label, value, tone, onClick }: { icon: ReactNode; label: string; value: number; tone?: 'bad'; onClick?: () => void }): React.JSX.Element {
  return (
    <Card className={cx('flex items-center gap-4 p-4', onClick && 'cursor-pointer transition hover:border-muted/60')} onClick={onClick}>
      <div className={cx('flex h-10 w-10 items-center justify-center rounded-lg', tone === 'bad' && value > 0 ? 'bg-bad/15 text-bad' : 'bg-accent-soft text-accent')}>{icon}</div>
      <div>
        <div className="text-2xl font-semibold tabular-nums leading-none">{value}</div>
        <div className="mt-1 text-xs text-muted">{label}</div>
      </div>
    </Card>
  )
}

export function Dashboard(): React.JSX.Element {
  const go = useApp((s) => s.go)
  const { data: posts, loading } = usePosts()
  const { data: accounts } = useAccounts()
  const [open, setOpen] = useState<Post | null>(null)
  const { run, node } = usePostActions()

  if (loading || !posts || !accounts) return <Spinner />

  const now = Date.now()
  const weekAgo = now - 7 * 86_400_000
  const upcoming = posts
    .filter((p) => p.status === 'scheduled' || p.status === 'publishing')
    .sort((a, b) => Date.parse(a.scheduledAt ?? '') - Date.parse(b.scheduledAt ?? ''))
  const attention = posts.filter((p) => ['failed', 'missed', 'partial'].includes(p.status))
  const drafts = posts.filter((p) => p.status === 'draft')
  const recent = posts
    .filter((p) => p.status === 'published')
    .sort((a, b) => Date.parse(b.scheduledAt ?? '') - Date.parse(a.scheduledAt ?? ''))
  const publishedWeek = recent.filter((p) => Date.parse(p.scheduledAt ?? '') >= weekAgo).length
  const hour = new Date().getHours()
  const greeting = hour < 11 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title={greeting} subtitle="Let's get your first account connected." />
        <Card>
          <EmptyState
            icon={<Link2 size={22} />}
            title="No accounts yet"
            body="Add a demo account to try the whole workflow right now, or follow the setup guides to prepare real YouTube, Instagram and TikTok connections."
            action={
              <div className="flex gap-2">
                <Button variant="primary" icon={<Link2 size={16} />} onClick={() => go({ page: 'accounts' })}>
                  Add accounts
                </Button>
                <Button icon={<Sparkles size={16} />} onClick={() => void attempt(() => call('sample:load'), 'Sample data loaded')}>
                  Load sample data
                </Button>
              </div>
            }
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={`${upcoming.length} post${upcoming.length === 1 ? '' : 's'} in the queue`}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => go({ page: 'compose' })}>
            New post
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <Stat icon={<CalendarClock size={20} />} label="Scheduled" value={upcoming.length} onClick={() => go({ page: 'calendar' })} />
        <Stat icon={<CheckCircle2 size={20} />} label="Published in last 7 days" value={publishedWeek} />
        <Stat icon={<FileText size={20} />} label="Drafts" value={drafts.length} onClick={() => go({ page: 'calendar' })} />
        <Stat icon={<AlertTriangle size={20} />} label="Need attention" value={attention.length} tone="bad" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <Card className="p-4">
            <h2 className="mb-2 px-2 text-sm font-semibold">Up next</h2>
            {upcoming.length === 0 ? (
              <EmptyState icon={<CalendarClock size={20} />} title="Nothing scheduled" body="Create a post and pick a time. It will go out automatically while the app is running." action={<Button variant="primary" onClick={() => go({ page: 'compose' })}>Create a post</Button>} />
            ) : (
              <div className="space-y-0.5">{upcoming.slice(0, 6).map((p) => <PostRow key={p.id} post={p} onOpen={setOpen} />)}</div>
            )}
          </Card>

          {attention.length > 0 && (
            <Card className="border-bad/40 p-4">
              <h2 className="mb-2 flex items-center gap-2 px-2 text-sm font-semibold text-bad">
                <AlertTriangle size={16} /> Needs attention
              </h2>
              <div className="space-y-0.5">{attention.map((p) => <PostRow key={p.id} post={p} onOpen={setOpen} />)}</div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="mb-2 px-2 text-sm font-semibold">Recently published</h2>
            {recent.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted">Published posts will show up here.</p>
            ) : (
              <div className="space-y-0.5">
                {recent.slice(0, 5).map((p) => (
                  <button key={p.id} onClick={() => setOpen(p)} className="no-drag flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-panel2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{p.title || p.description || 'Untitled'}</div>
                      <div className="text-xs text-muted">{p.scheduledAt ? fmtRelative(p.scheduledAt) : ''}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 px-2 text-sm font-semibold">Accounts</h2>
            <div className="space-y-1">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                  <PlatformIcon id={a.platform} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{a.displayName}</div>
                    <div className="truncate text-xs text-muted">{a.handle}</div>
                  </div>
                  {a.mode === 'demo' && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warn">Demo</span>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <PostDetailModal post={open ? (posts.find((p) => p.id === open.id) ?? null) : null} onClose={() => setOpen(null)} run={run} />
      {node}
    </>
  )
}
