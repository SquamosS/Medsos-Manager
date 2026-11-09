import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight, FileText, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import type { Post } from '@shared/types'
import { PostDetailModal, postLabel, usePostActions } from '@/components/PostParts'
import { Button, Card, IconButton, Segmented, Spinner, cx } from '@/components/ui'
import { call, usePosts } from '@/lib/api'
import { usePlatformCtx } from '@/lib/platforms'
import { attempt, useApp } from '@/lib/store'

const DRAG_TYPE = 'application/x-medsos-post'
const dayKey = (d: Date): string => format(d, 'yyyy-MM-dd')
const canMove = (p: Post): boolean => ['draft', 'scheduled', 'missed'].includes(p.status)

function Chip({ post, onOpen }: { post: Post; onOpen: (p: Post) => void }): React.JSX.Element {
  const { color } = usePlatformCtx()
  const platforms = [...new Set(post.targets.map((t) => t.platform))]
  const tone =
    post.status === 'failed' || post.status === 'missed'
      ? 'border-bad/60 bg-bad/10'
      : post.status === 'published'
        ? 'border-transparent bg-good/10'
        : post.status === 'draft'
          ? 'border-dashed border-muted/50 bg-transparent'
          : 'border-transparent bg-accent-soft'
  return (
    <div
      draggable={canMove(post)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, post.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(post)
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(post)}
      title={`${postLabel(post)} — ${post.status}`}
      className={cx('no-drag flex cursor-pointer items-center gap-1.5 truncate rounded-md border px-1.5 py-1 text-xs transition hover:brightness-125', tone, canMove(post) && 'active:cursor-grabbing')}
    >
      <span className="flex shrink-0 -space-x-0.5">
        {platforms.map((p) => (
          <span key={p} className="h-2 w-2 rounded-full ring-1 ring-panel" style={{ background: p === 'tiktok' ? '#25f4ee' : color(p) }} />
        ))}
      </span>
      {post.scheduledAt && <span className="shrink-0 tabular-nums text-muted">{format(new Date(post.scheduledAt), 'HH:mm')}</span>}
      <span className="truncate">{postLabel(post)}</span>
    </div>
  )
}

function DayCell({
  day,
  posts,
  inMonth,
  tall,
  onOpen,
  onDropPost,
  onAdd,
  onMore
}: {
  day: Date
  posts: Post[]
  inMonth: boolean
  tall: boolean
  onOpen: (p: Post) => void
  onDropPost: (postId: string, day: Date) => void
  onAdd: (day: Date) => void
  onMore: (day: Date) => void
}): React.JSX.Element {
  const [over, setOver] = useState(false)
  const today = isSameDay(day, new Date())
  const isPast = day < new Date(new Date().setHours(0, 0, 0, 0))
  const limit = tall ? 99 : 3
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const id = e.dataTransfer.getData(DRAG_TYPE)
    if (id) onDropPost(id, day)
  }
  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cx('group flex flex-col gap-1 border-b border-r border-line p-1.5 transition', tall ? 'min-h-[420px]' : 'min-h-[118px]', !inMonth && 'bg-panel2/40', over && 'bg-accent-soft')}
    >
      <div className="flex items-center justify-between px-0.5">
        <span className={cx('flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums', today ? 'bg-accent font-semibold text-white' : inMonth ? 'text-fg' : 'text-muted/60')}>{format(day, tall ? 'EEE d' : 'd')}</span>
        {!isPast && (
          <button aria-label={`New post on ${format(day, 'd MMMM')}`} onClick={() => onAdd(day)} className="no-drag flex h-5 w-5 items-center justify-center rounded text-muted opacity-0 transition hover:bg-panel2 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100">
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {posts.slice(0, limit).map((p) => (
          <Chip key={p.id} post={p} onOpen={onOpen} />
        ))}
        {posts.length > limit && (
          <button onClick={() => onMore(day)} className="no-drag px-1 text-left text-xs text-muted hover:text-fg">
            +{posts.length - limit} more
          </button>
        )}
      </div>
    </div>
  )
}

export function Calendar(): React.JSX.Element {
  const go = useApp((s) => s.go)
  const { data: posts, loading } = usePosts()
  const [view, setView] = useState<'month' | 'week'>('month')
  const [cursor, setCursor] = useState(new Date())
  const [open, setOpen] = useState<Post | null>(null)
  const { run, node } = usePostActions()

  const { byDay, undated } = useMemo(() => {
    const map = new Map<string, Post[]>()
    const none: Post[] = []
    for (const p of posts ?? []) {
      if (!p.scheduledAt) {
        if (p.status === 'draft') none.push(p)
        continue
      }
      const key = dayKey(new Date(p.scheduledAt))
      map.set(key, [...(map.get(key) ?? []), p])
    }
    for (const list of map.values()) list.sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))
    return { byDay: map, undated: none }
  }, [posts])

  const days =
    view === 'month'
      ? eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) })
      : eachDayOfInterval({ start: startOfWeek(cursor, { weekStartsOn: 1 }), end: endOfWeek(cursor, { weekStartsOn: 1 }) })

  const step = (dir: 1 | -1): void => setCursor((c) => (view === 'month' ? addMonths(c, dir) : addWeeks(c, dir)))
  const title = view === 'month' ? format(cursor, 'MMMM yyyy') : `${format(days[0], 'd MMM')} – ${format(days[6], 'd MMM yyyy')}`

  const dropPost = (postId: string, day: Date): void => {
    const post = posts?.find((p) => p.id === postId)
    if (!post) return
    if (!canMove(post)) return void useApp.getState().toast(`A ${post.status} post can't be moved.`, 'error')
    const base = post.scheduledAt ? new Date(post.scheduledAt) : null
    const target = new Date(day)
    target.setHours(base ? base.getHours() : 18, base ? base.getMinutes() : 0, 0, 0)
    const now = new Date()
    if (target < now) {
      if (!isSameDay(day, now)) return void useApp.getState().toast("That day is in the past.", 'error')
      target.setTime(now.getTime() + 10 * 60_000) // dropped on today after the usual time: post shortly
      target.setSeconds(0, 0)
    }
    void attempt(() => call('posts:reschedule', postId, target.toISOString()), `Scheduled for ${format(target, "d MMM, HH:mm")}`)
  }

  const addOn = (day: Date): void => {
    const at = new Date(day)
    at.setHours(18, 0, 0, 0)
    if (at < new Date()) at.setTime(Date.now() + 30 * 60_000)
    go({ page: 'compose', prefillDate: at.toISOString() })
  }

  if (loading || !posts) return <Spinner />

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="min-w-[200px] text-xl font-semibold tracking-tight">{title}</h1>
          <div className="flex items-center">
            <IconButton label="Previous" onClick={() => step(-1)}>
              <ChevronLeft size={18} />
            </IconButton>
            <IconButton label="Next" onClick={() => step(1)}>
              <ChevronRight size={18} />
            </IconButton>
          </div>
          <Button size="sm" onClick={() => setCursor(new Date())}>
            Today
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' }
            ]}
          />
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => go({ page: 'compose' })}>
            New post
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-5">
        <Card className="min-w-0 flex-1 overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line bg-panel2/50 text-center text-xs font-medium text-muted">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="border-r border-line py-2 last:border-r-0">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 [&>div:nth-child(7n)]:border-r-0">
            {days.map((day) => (
              <DayCell
                key={day.toISOString()}
                day={day}
                posts={byDay.get(dayKey(day)) ?? []}
                inMonth={view === 'week' || isSameMonth(day, cursor)}
                tall={view === 'week'}
                onOpen={setOpen}
                onDropPost={dropPost}
                onAdd={addOn}
                onMore={(d) => {
                  setCursor(d)
                  setView('week')
                }}
              />
            ))}
          </div>
        </Card>

        <div className="w-60 shrink-0">
          <Card className="p-3">
            <h2 className="mb-1 flex items-center gap-2 px-1 text-sm font-semibold">
              <FileText size={15} className="text-muted" /> Unscheduled drafts
            </h2>
            <p className="mb-2 px-1 text-xs text-muted">Drag a draft onto a day to schedule it.</p>
            <div className="flex flex-col gap-1">
              {undated.length === 0 && <p className="px-1 py-3 text-xs text-muted">No unscheduled drafts.</p>}
              {undated.map((p) => (
                <Chip key={p.id} post={p} onOpen={setOpen} />
              ))}
            </div>
          </Card>
          <div className="mt-4 space-y-1.5 px-1 text-xs text-muted">
            <div className="flex items-center gap-2"><span className="h-3 w-5 rounded border border-transparent bg-accent-soft" /> Scheduled</div>
            <div className="flex items-center gap-2"><span className="h-3 w-5 rounded border border-dashed border-muted/50" /> Draft</div>
            <div className="flex items-center gap-2"><span className="h-3 w-5 rounded bg-good/10" /> Published</div>
            <div className="flex items-center gap-2"><span className="h-3 w-5 rounded border border-bad/60 bg-bad/10" /> Failed / missed</div>
          </div>
        </div>
      </div>

      <PostDetailModal post={open ? (posts.find((p) => p.id === open.id) ?? null) : null} onClose={() => setOpen(null)} run={run} />
      {node}
    </>
  )
}
