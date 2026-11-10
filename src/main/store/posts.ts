import { FORMAT_LABELS } from '@shared/types'
import type {
  ContentFormat,
  Post,
  PostInput,
  PostStatus,
  PostTarget,
  TargetStatus
} from '@shared/types'
import { validateForPlatform, validateMediaForFormat } from '@shared/validation'
import { getDb, parseJson, tx } from '../db'
import { getPlatform } from '../platforms/registry'
import { newId, nowIso } from '../util'
import { getAccount } from './accounts'
import { getMediaByIds } from './media'

interface PostRow {
  id: string
  format: string
  title: string
  description: string
  hashtags: string
  media_ids: string
  status: string
  scheduled_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

interface TargetRow {
  id: string
  post_id: string
  account_id: string
  platform: string
  title: string
  description: string
  hashtags: string
  customized: number
  options: string
  status: string
  attempts: number
  remote_id: string | null
  remote_url: string | null
  error: string | null
  published_at: string | null
}

export const MAX_ATTEMPTS = 3

const toTarget = (r: TargetRow): PostTarget => ({
  id: r.id,
  postId: r.post_id,
  accountId: r.account_id,
  platform: r.platform,
  title: r.title,
  description: r.description,
  hashtags: parseJson<string[]>(r.hashtags, []),
  customized: r.customized === 1,
  options: parseJson<Record<string, string | boolean>>(r.options, {}),
  status: r.status as TargetStatus,
  attempts: r.attempts,
  remoteId: r.remote_id,
  remoteUrl: r.remote_url,
  error: r.error,
  publishedAt: r.published_at
})

const toPost = (r: PostRow, targets: PostTarget[]): Post => ({
  id: r.id,
  format: r.format as ContentFormat,
  title: r.title,
  description: r.description,
  hashtags: parseJson<string[]>(r.hashtags, []),
  mediaIds: parseJson<string[]>(r.media_ids, []),
  status: r.status as PostStatus,
  scheduledAt: r.scheduled_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  targets
})

function targetsByPost(postIds?: string[]): Map<string, PostTarget[]> {
  const db = getDb()
  const rows = (
    postIds
      ? (db
          .prepare(`SELECT * FROM post_targets WHERE post_id IN (${postIds.map(() => '?').join(',')}) ORDER BY rowid`)
          .all(...postIds) as unknown as TargetRow[])
      : (db.prepare('SELECT * FROM post_targets ORDER BY rowid').all() as unknown as TargetRow[])
  ) as TargetRow[]
  const map = new Map<string, PostTarget[]>()
  for (const r of rows) {
    const list = map.get(r.post_id) ?? []
    list.push(toTarget(r))
    map.set(r.post_id, list)
  }
  return map
}

export function listPosts(): Post[] {
  const rows = getDb()
    .prepare('SELECT * FROM posts ORDER BY COALESCE(scheduled_at, created_at) DESC')
    .all() as unknown as PostRow[]
  const targets = targetsByPost()
  return rows.map((r) => toPost(r, targets.get(r.id) ?? []))
}

export function getPost(id: string): Post | null {
  const row = getDb().prepare('SELECT * FROM posts WHERE id = ?').get(id) as unknown as PostRow | undefined
  if (!row) return null
  return toPost(row, targetsByPost([id]).get(id) ?? [])
}

function requirePost(id: string): Post {
  const post = getPost(id)
  if (!post) throw new Error('Post not found.')
  return post
}

/** Throws a readable error when the post cannot be published as configured. */
export function assertPublishable(post: Post): void {
  if (post.targets.length === 0) throw new Error('Choose at least one account to post to.')
  const media = getMediaByIds(post.mediaIds)
  if (media.length !== post.mediaIds.length) throw new Error('A selected media file was removed from the library.')
  const problems = validateMediaForFormat(post.format, media).filter((i) => i.severity === 'error')
  for (const target of post.targets) {
    const account = getAccount(target.accountId)
    if (!account) throw new Error('One of the selected accounts no longer exists.')
    const platform = getPlatform(target.platform)
    const live = platform.capabilities.liveFormats
    if (account.mode === 'live' && live && !live.includes(post.format)) {
      problems.push({
        severity: 'error',
        message: `${platform.name}: ${account.displayName} is a real account, which can only publish ${live.map((f) => FORMAT_LABELS[f].toLowerCase()).join(', ')} posts for now.`
      })
    }
    for (const issue of validateForPlatform(platform, post.format, media, target)) {
      if (issue.severity === 'error') problems.push({ ...issue, message: `${platform.name}: ${issue.message}` })
    }
  }
  if (problems.length > 0) throw new Error(problems[0].message)
}

const EDITABLE: PostStatus[] = ['draft', 'scheduled', 'missed', 'failed']

export function savePost(input: PostInput): Post {
  const db = getDb()
  const now = nowIso()
  const existing = input.id ? requirePost(input.id) : null
  if (existing && !EDITABLE.includes(existing.status)) {
    throw new Error(`A ${existing.status} post can no longer be edited. Duplicate it instead.`)
  }

  let scheduledAt = input.scheduledAt
  if (input.intent === 'now') scheduledAt = now
  if (input.intent === 'scheduled') {
    if (!scheduledAt) throw new Error('Pick a date and time to schedule this post.')
    if (Date.parse(scheduledAt) < Date.now() - 60_000) throw new Error('The scheduled time is in the past.')
  }
  const queued = input.intent !== 'draft'
  const id = existing?.id ?? newId()

  tx(() => {
    if (existing) {
      db.prepare(
        `UPDATE posts SET format=?, title=?, description=?, hashtags=?, media_ids=?, status=?, scheduled_at=?, next_run_at=?, updated_at=? WHERE id=?`
      ).run(
        input.format,
        input.title,
        input.description,
        JSON.stringify(input.hashtags),
        JSON.stringify(input.mediaIds),
        'draft',
        scheduledAt,
        null,
        now,
        id
      )
      db.prepare('DELETE FROM post_targets WHERE post_id = ?').run(id)
    } else {
      db.prepare(
        `INSERT INTO posts (id, format, title, description, hashtags, media_ids, status, scheduled_at, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NULL, ?, ?)`
      ).run(
        id,
        input.format,
        input.title,
        input.description,
        JSON.stringify(input.hashtags),
        JSON.stringify(input.mediaIds),
        scheduledAt,
        now,
        now
      )
    }
    const insert = db.prepare(
      `INSERT INTO post_targets (id, post_id, account_id, platform, title, description, hashtags, customized, options)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const t of input.targets) {
      const account = getAccount(t.accountId)
      if (!account) throw new Error('One of the selected accounts no longer exists.')
      insert.run(
        newId(),
        id,
        account.id,
        account.platform,
        t.customized ? (t.title ?? input.title) : input.title,
        t.customized ? (t.description ?? input.description) : input.description,
        JSON.stringify(t.customized ? (t.hashtags ?? input.hashtags) : input.hashtags),
        t.customized ? 1 : 0,
        JSON.stringify(t.options)
      )
    }
    if (queued) {
      // Validate with the real stored data so scheduling can never accept something unpublishable.
      assertPublishable(requirePost(id))
      db.prepare(`UPDATE posts SET status='scheduled', next_run_at=? WHERE id=?`).run(scheduledAt, id)
    }
  })
  return requirePost(id)
}

export function deletePost(id: string): void {
  const post = requirePost(id)
  if (post.status === 'publishing') throw new Error('This post is being published right now.')
  getDb().prepare('DELETE FROM posts WHERE id = ?').run(id)
}

export function reschedulePost(id: string, scheduledAt: string): Post {
  const post = requirePost(id)
  if (!['draft', 'scheduled', 'missed'].includes(post.status)) {
    throw new Error(`A ${post.status} post cannot be rescheduled.`)
  }
  if (Date.parse(scheduledAt) < Date.now() - 60_000) throw new Error('The new time is in the past.')
  tx(() => {
    getDb()
      .prepare(`UPDATE posts SET scheduled_at=?, next_run_at=?, status='scheduled', updated_at=? WHERE id=?`)
      .run(scheduledAt, scheduledAt, nowIso(), id)
    resetUnpublishedTargets(id)
    assertPublishable(requirePost(id))
  })
  return requirePost(id)
}

export function unschedulePost(id: string): Post {
  const post = requirePost(id)
  if (!['scheduled', 'missed'].includes(post.status)) throw new Error('Only scheduled posts can be unscheduled.')
  getDb().prepare(`UPDATE posts SET status='draft', next_run_at=NULL, updated_at=? WHERE id=?`).run(nowIso(), id)
  return requirePost(id)
}

/** Queues the post to publish immediately. The scheduler is kicked by the caller. */
export function queueNow(id: string): void {
  const post = requirePost(id)
  if (!['draft', 'scheduled', 'missed'].includes(post.status)) {
    throw new Error(`A ${post.status} post cannot be published now.`)
  }
  const now = nowIso()
  tx(() => {
    getDb()
      .prepare(`UPDATE posts SET scheduled_at=?, next_run_at=?, status='scheduled', updated_at=? WHERE id=?`)
      .run(now, now, now, id)
    resetUnpublishedTargets(id)
    assertPublishable(requirePost(id))
  })
}

/** Retries failed targets of a failed/partial/missed post. Already published targets are left alone. */
export function queueRetry(id: string): void {
  const post = requirePost(id)
  if (!['failed', 'partial', 'missed'].includes(post.status)) throw new Error('Nothing to retry for this post.')
  const now = nowIso()
  tx(() => {
    resetUnpublishedTargets(id)
    getDb().prepare(`UPDATE posts SET status='scheduled', next_run_at=?, updated_at=? WHERE id=?`).run(now, now, id)
  })
}

function resetUnpublishedTargets(postId: string): void {
  getDb()
    .prepare(
      `UPDATE post_targets SET status='pending', attempts=0, error=NULL WHERE post_id=? AND status IN ('failed','pending')`
    )
    .run(postId)
}

export function duplicatePost(id: string): Post {
  const src = requirePost(id)
  return savePost({
    format: src.format,
    title: src.title ? `${src.title} (copy)` : '',
    description: src.description,
    hashtags: src.hashtags,
    mediaIds: src.mediaIds,
    scheduledAt: null,
    intent: 'draft',
    targets: src.targets.map((t) => ({
      accountId: t.accountId,
      title: t.title,
      description: t.description,
      hashtags: t.hashtags,
      customized: t.customized,
      options: t.options
    }))
  })
}

// ---- helpers used by the scheduler -------------------------------------------------------

export function duePostIds(nowIsoStr: string): string[] {
  const rows = getDb()
    .prepare(`SELECT id FROM posts WHERE status='scheduled' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at`)
    .all(nowIsoStr) as unknown as { id: string }[]
  return rows.map((r) => r.id)
}

export function setPostStatus(id: string, status: PostStatus, nextRunAt?: string | null): void {
  if (nextRunAt === undefined) {
    getDb().prepare('UPDATE posts SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), id)
  } else {
    getDb().prepare('UPDATE posts SET status=?, next_run_at=?, updated_at=? WHERE id=?').run(status, nextRunAt, nowIso(), id)
  }
}

export function markTargetPublishing(id: string): void {
  getDb().prepare(`UPDATE post_targets SET status='publishing', error=NULL WHERE id=?`).run(id)
}

export function markTargetPublished(id: string, remoteId: string, remoteUrl: string | null): void {
  getDb()
    .prepare(`UPDATE post_targets SET status='published', remote_id=?, remote_url=?, error=NULL, published_at=? WHERE id=?`)
    .run(remoteId, remoteUrl, nowIso(), id)
}

export function markTargetFailed(id: string, error: string, permanent: boolean): void {
  const db = getDb()
  db.prepare(`UPDATE post_targets SET status='failed', error=?, attempts=? WHERE id=?`).run(
    error,
    permanent
      ? MAX_ATTEMPTS
      : ((db.prepare('SELECT attempts FROM post_targets WHERE id=?').get(id) as unknown as { attempts: number }).attempts + 1),
    id
  )
}

/** Targets stuck in "publishing" mean the app died mid-upload. Fail them without auto-retry to avoid duplicates. */
export function recoverInterrupted(): number {
  const db = getDb()
  const res = db
    .prepare(
      `UPDATE post_targets SET status='failed', attempts=?, error='Interrupted while publishing (the app was closed). Check the platform before retrying to avoid a duplicate post.' WHERE status='publishing'`
    )
    .run(MAX_ATTEMPTS)
  db.prepare(
    `UPDATE posts SET status = CASE
        WHEN EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = posts.id AND t.status='published') THEN 'partial'
        ELSE 'failed' END
     WHERE status='publishing'`
  ).run()
  return Number(res.changes)
}
