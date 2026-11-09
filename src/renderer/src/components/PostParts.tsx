import { Copy, ExternalLink, Pencil, Play, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Account, Media, Post } from '@shared/types'
import { FORMAT_LABELS } from '@shared/types'
import { buildCaption } from '@shared/validation'
import { call, useAccounts, useMedia } from '@/lib/api'
import { fmtWhen } from '@/lib/format'
import { usePlatformCtx } from '@/lib/platforms'
import { attempt, useApp } from '@/lib/store'
import { PlatformIcon } from './PlatformIcon'
import { Button, MediaThumb, Modal, StatusBadge } from './ui'

export function useMediaMap(): Map<string, Media> {
  const { data } = useMedia()
  return useMemo(() => new Map((data ?? []).map((m) => [m.id, m])), [data])
}

export function useAccountMap(): Map<string, Account> {
  const { data } = useAccounts()
  return useMemo(() => new Map((data ?? []).map((a) => [a.id, a])), [data])
}

export const postLabel = (p: Post): string => p.title || p.description.slice(0, 60) || 'Untitled post'

export function PlatformStack({ post, size = 20 }: { post: Post; size?: number }): React.JSX.Element {
  const platforms = [...new Set(post.targets.map((t) => t.platform))]
  if (platforms.length === 0) return <span className="text-xs text-muted">No accounts</span>
  return (
    <span className="flex -space-x-1.5">
      {platforms.map((p) => (
        <span key={p} className="rounded-md ring-2 ring-panel">
          <PlatformIcon id={p} size={size} />
        </span>
      ))}
    </span>
  )
}

export type PostAction = 'edit' | 'duplicate' | 'publishNow' | 'retry' | 'unschedule' | 'delete'

interface ConfirmState {
  title: string
  body: string
  label: string
  danger?: boolean
  onConfirm: () => void
}

/** Shared post actions (with confirmation for the risky ones). Render `node` once in the page. */
export function usePostActions(): { run: (action: PostAction, post: Post) => void; node: ReactNode } {
  const go = useApp((s) => s.go)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const run = (action: PostAction, post: Post): void => {
    switch (action) {
      case 'edit':
        go({ page: 'compose', postId: post.id })
        break
      case 'duplicate':
        void attempt(async () => {
          const copy = await call('posts:duplicate', post.id)
          go({ page: 'compose', postId: copy.id })
        }, 'Copied as a new draft')
        break
      case 'unschedule':
        void attempt(() => call('posts:unschedule', post.id), 'Moved back to drafts')
        break
      case 'retry':
        void attempt(() => call('posts:retry', post.id), 'Retrying…')
        break
      case 'publishNow':
        setConfirm({
          title: 'Publish now?',
          body: `"${postLabel(post)}" will be posted immediately to ${post.targets.length} account(s).`,
          label: 'Publish now',
          onConfirm: () => void attempt(() => call('posts:publishNow', post.id), 'Publishing…')
        })
        break
      case 'delete':
        setConfirm({
          title: 'Delete this post?',
          body: 'This removes it from Medsos Manager. Anything already published stays live on the platforms.',
          label: 'Delete',
          danger: true,
          onConfirm: () => void attempt(() => call('posts:delete', post.id), 'Post deleted')
        })
        break
    }
  }

  const node = (
    <Modal
      open={confirm !== null}
      onClose={() => setConfirm(null)}
      title={confirm?.title ?? ''}
      width={440}
      footer={
        <>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            variant={confirm?.danger ? 'danger' : 'primary'}
            onClick={() => {
              confirm?.onConfirm()
              setConfirm(null)
            }}
          >
            {confirm?.label}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{confirm?.body}</p>
    </Modal>
  )
  return { run, node }
}

/** Which actions make sense for a post in its current state. */
export function availableActions(post: Post): PostAction[] {
  switch (post.status) {
    case 'draft':
      return ['edit', 'publishNow', 'duplicate', 'delete']
    case 'scheduled':
      return ['edit', 'publishNow', 'unschedule', 'duplicate', 'delete']
    case 'publishing':
      return []
    case 'published':
      return ['duplicate', 'delete']
    case 'partial':
      return ['retry', 'duplicate', 'delete']
    case 'failed':
      return ['edit', 'retry', 'duplicate', 'delete']
    case 'missed':
      return ['edit', 'publishNow', 'unschedule', 'duplicate', 'delete']
  }
}

const ACTION_META: Record<PostAction, { label: string; icon: ReactNode; variant?: 'primary' | 'danger' | 'secondary' }> = {
  edit: { label: 'Edit', icon: <Pencil size={14} /> },
  duplicate: { label: 'Duplicate', icon: <Copy size={14} /> },
  publishNow: { label: 'Publish now', icon: <Play size={14} />, variant: 'primary' },
  retry: { label: 'Retry failed', icon: <RotateCcw size={14} />, variant: 'primary' },
  unschedule: { label: 'Unschedule', icon: <Undo2 size={14} /> },
  delete: { label: 'Delete', icon: <Trash2 size={14} />, variant: 'danger' }
}

export function PostActionButtons({ post, run, exclude = [] }: { post: Post; run: (a: PostAction, p: Post) => void; exclude?: PostAction[] }): React.JSX.Element {
  return (
    <>
      {availableActions(post)
        .filter((a) => !exclude.includes(a))
        .map((a) => (
          <Button key={a} size="sm" variant={ACTION_META[a].variant ?? 'secondary'} icon={ACTION_META[a].icon} onClick={() => run(a, post)}>
            {ACTION_META[a].label}
          </Button>
        ))}
    </>
  )
}

/** A compact row for lists: thumbnail, title, platforms, time, status. */
export function PostRow({ post, onOpen, trailing }: { post: Post; onOpen: (p: Post) => void; trailing?: ReactNode }): React.JSX.Element {
  const mediaMap = useMediaMap()
  const first = mediaMap.get(post.mediaIds[0])
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(post)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(post)}
      className="no-drag flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-panel2"
    >
      <MediaThumb media={first} className="h-11 w-11 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{postLabel(post)}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span>{fmtWhen(post.scheduledAt)}</span>
          <span>·</span>
          <span>{FORMAT_LABELS[post.format]}</span>
        </div>
      </div>
      <PlatformStack post={post} />
      <StatusBadge status={post.status} />
      {trailing}
    </div>
  )
}

/** Full detail of a post, with per-account results and the actions that apply. */
export function PostDetailModal({ post, onClose, run }: { post: Post | null; onClose: () => void; run: (a: PostAction, p: Post) => void }): React.JSX.Element {
  const mediaMap = useMediaMap()
  const accounts = useAccountMap()
  const { name } = usePlatformCtx()
  const act = (a: PostAction, p: Post): void => {
    if (a !== 'delete' && a !== 'publishNow') onClose()
    run(a, p)
  }
  return (
    <Modal
      open={post !== null}
      onClose={onClose}
      title={post ? postLabel(post) : ''}
      width={640}
      footer={post ? <PostActionButtons post={post} run={act} /> : undefined}
    >
      {post && (
        <div className="space-y-5">
          <div className="flex gap-4">
            <div className="flex gap-1.5">
              {post.mediaIds.slice(0, 3).map((id) => (
                <MediaThumb key={id} media={mediaMap.get(id)} className="h-24 w-16 rounded-lg" />
              ))}
              {post.mediaIds.length === 0 && <MediaThumb media={undefined} className="h-24 w-16 rounded-lg" />}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={post.status} />
                <span className="text-xs text-muted">{FORMAT_LABELS[post.format]}</span>
                <span className="text-xs text-muted">· {fmtWhen(post.scheduledAt)}</span>
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted">{buildCaption(post.description, post.hashtags) || 'No description'}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Accounts</h3>
            <div className="divide-y divide-line rounded-lg border border-line">
              {post.targets.length === 0 && <div className="p-3 text-sm text-muted">No accounts selected.</div>}
              {post.targets.map((t) => {
                const account = accounts.get(t.accountId)
                return (
                  <div key={t.id} className="flex items-start gap-3 p-3">
                    <PlatformIcon id={t.platform} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {account?.displayName ?? 'Removed account'}
                        <span className="text-xs font-normal text-muted">{name(t.platform)}</span>
                      </div>
                      {t.error && <p className="mt-1 text-xs text-bad">{t.error}</p>}
                      {t.status === 'failed' && !t.error && <p className="mt-1 text-xs text-bad">Failed.</p>}
                      {t.publishedAt && <p className="mt-1 text-xs text-muted">Published {fmtWhen(t.publishedAt)}</p>}
                    </div>
                    <StatusBadge status={t.status} />
                    {t.remoteUrl && (
                      <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => void attempt(() => call('app:openExternal', t.remoteUrl as string))}>
                        Open
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

