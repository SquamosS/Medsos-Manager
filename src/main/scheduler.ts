import { Notification } from 'electron'
import { notify } from './events'
import { driverFor } from './platforms/registry'
import { PermanentPublishError } from './platforms/types'
import { getAccount } from './store/accounts'
import { getMediaByIds } from './store/media'
import {
  MAX_ATTEMPTS,
  duePostIds,
  getPost,
  markTargetFailed,
  markTargetPublished,
  markTargetPublishing,
  recoverInterrupted,
  setPostStatus
} from './store/posts'
import { getAppSettings } from './store/settings'
import { errorMessage, nowIso } from './util'
import { syncAnalytics } from './analytics'

const TICK_MS = 15_000
const ANALYTICS_SYNC_MS = 6 * 60 * 60 * 1000
/** Wait before retry n (1-based), in minutes. */
const BACKOFF_MINUTES = [1, 5, 15]

let busy = false
let timer: NodeJS.Timeout | null = null
let syncTimer: NodeJS.Timeout | null = null

export function startScheduler(): void {
  const interrupted = recoverInterrupted()
  if (interrupted > 0) notify('posts')
  void tick()
  timer = setInterval(() => void tick(), TICK_MS)
  void syncAnalytics().then(() => notify('analytics'))
  syncTimer = setInterval(() => void syncAnalytics().then(() => notify('analytics')), ANALYTICS_SYNC_MS)
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  if (syncTimer) clearInterval(syncTimer)
}

/** Run a scheduler pass right now (after "Publish now", retry, etc.). */
export function kickScheduler(): void {
  void tick()
}

async function tick(): Promise<void> {
  if (busy) return
  busy = true
  try {
    const now = Date.now()
    const missedMs = getAppSettings().missedAfterMinutes * 60_000
    for (const id of duePostIds(new Date(now).toISOString())) {
      const post = getPost(id)
      if (!post || post.status !== 'scheduled') continue
      if (now - Date.parse(post.scheduledAt ?? nowIso()) > missedMs && !post.targets.some((t) => t.attempts > 0)) {
        // The app was closed (or the PC asleep) for too long. Don't surprise the user with a late post.
        setPostStatus(id, 'missed', null)
        notify('posts')
        toast('Missed scheduled post', `"${label(post.title, post.description)}" was not published because the app was not running.`)
        continue
      }
      await publishPost(id)
    }
  } catch (e) {
    console.error('[scheduler] tick failed:', e)
  } finally {
    busy = false
  }
}

const label = (title: string, description: string): string => (title || description || 'Untitled post').slice(0, 60)

async function publishPost(postId: string): Promise<void> {
  const post = getPost(postId)
  if (!post) return
  setPostStatus(postId, 'publishing')
  notify('posts')

  const media = getMediaByIds(post.mediaIds)
  for (const target of post.targets) {
    if (target.status === 'published') continue
    if (target.status === 'failed' && target.attempts >= MAX_ATTEMPTS) continue

    markTargetPublishing(target.id)
    notify('posts')
    try {
      const account = getAccount(target.accountId)
      if (!account) throw new PermanentPublishError('The account was removed.')
      if (media.some((m) => m.missing)) throw new PermanentPublishError('A media file is missing from disk.')
      const result = await driverFor(account).publish({ account, post, target, media })
      markTargetPublished(target.id, result.remoteId, result.remoteUrl)
    } catch (e) {
      markTargetFailed(target.id, errorMessage(e), e instanceof PermanentPublishError)
    }
    notify('posts')
  }

  const after = getPost(postId)
  if (!after) return
  const targets = after.targets
  const published = targets.filter((t) => t.status === 'published').length
  const retryable = targets.filter((t) => t.status === 'failed' && t.attempts < MAX_ATTEMPTS)

  if (published === targets.length) {
    setPostStatus(postId, 'published')
    toast('Post published', `"${label(after.title, after.description)}" is live on ${targets.length} account(s).`)
    void syncAnalytics().then(() => notify('analytics'))
  } else if (retryable.length > 0) {
    const attempt = Math.min(...retryable.map((t) => t.attempts))
    const waitMin = BACKOFF_MINUTES[Math.min(attempt, BACKOFF_MINUTES.length) - 1]
    setPostStatus(postId, 'scheduled', new Date(Date.now() + waitMin * 60_000).toISOString())
  } else {
    setPostStatus(postId, published > 0 ? 'partial' : 'failed')
    toast('Publishing failed', `"${label(after.title, after.description)}" could not be published. Open the app for details.`)
  }
  notify('posts', 'analytics')
}

function toast(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}
