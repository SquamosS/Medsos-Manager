import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Account, ContentFormat, Media, Post, PostInput, PostTargetInput } from '@shared/types'
import { parseHashtags, suggestFormat, validateForPlatform, validateMediaForFormat } from '@shared/validation'
import { getSummary, syncAnalytics } from '../analytics'
import { notify } from '../events'
import { getPlatform, listPlatforms } from '../platforms/registry'
import { kickScheduler } from '../scheduler'
import { getAccount, listAccounts } from '../store/accounts'
import { getMediaByIds, importMedia, listMedia } from '../store/media'
import {
  deletePost,
  duplicatePost,
  getPost,
  listPosts,
  queueNow,
  queueRetry,
  reschedulePost,
  savePost,
  unschedulePost
} from '../store/posts'
import { getAppSettings } from '../store/settings'

const FORMATS = ['short_video', 'long_video', 'image', 'carousel'] as const
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

/** "2026-11-12 19:00" in the user's own time zone, so an assistant can talk about times naturally. */
const local = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone, hour12: false }).slice(0, 16) : null

const text = (data: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
})

function def<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: S,
  hints: ToolAnnotations,
  fn: (args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>
): void {
  server.registerTool(name, { description, inputSchema: shape, annotations: hints }, (async (args: z.infer<z.ZodObject<S>>) => {
    try {
      return text(await fn(args))
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] }
    }
  }) as never)
}

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const DESTROY: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
const PUBLISH: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true }

// ---- helpers ---------------------------------------------------------------------------------

const PUBLISH_BLOCKED =
  'Publishing to real (live) accounts is turned off for assistants. Ask the user to review the draft in the app and press Schedule/Publish, or to switch on "Allow the assistant to schedule and publish" in Settings → AI assistant.'

function liveAccountNames(accountIds: string[]): string[] {
  return accountIds
    .map((id) => getAccount(id))
    .filter((a): a is Account => a !== null && a.mode === 'live')
    .map((a) => `${a.displayName} (${a.platform})`)
}

/** Throws when the post would go to a real account and the user has not allowed assistants to do that. */
function assertMayPublish(post: Post): void {
  if (getAppSettings().mcpAllowPublish) return
  const live = liveAccountNames(post.targets.map((t) => t.accountId))
  if (live.length > 0) throw new Error(`${PUBLISH_BLOCKED} (Live accounts on this post: ${live.join(', ')}.)`)
}

function requirePost(id: string): Post {
  const post = getPost(id)
  if (!post) throw new Error(`No post with id ${id}.`)
  return post
}

function toIso(value: string, what: string): string {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new Error(`${what} must be an ISO 8601 date-time such as 2026-11-12T19:00:00+07:00.`)
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
    throw new Error(`${what} needs a UTC offset (for example +07:00 or Z) so the time is unambiguous.`)
  }
  return new Date(ms).toISOString()
}

const hasMeta = (m: Media): boolean => m.hasThumb || m.width !== null

/**
 * Newly imported files get their duration/size/thumbnail from the app window (it uses the browser's
 * decoders). Give it a moment so validation sees real numbers.
 */
async function waitForMetadata(ids: string[], timeoutMs: number): Promise<Media[]> {
  const deadline = Date.now() + timeoutMs
  let media = getMediaByIds(ids)
  while (media.some((m) => !m.missing && !hasMeta(m)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400))
    media = getMediaByIds(ids)
  }
  return media
}

const mediaView = (m: Media): Record<string, unknown> => ({
  id: m.id,
  kind: m.kind,
  filename: m.filename,
  path: m.path,
  durationSec: m.durationSec === null ? null : Math.round(m.durationSec * 10) / 10,
  width: m.width,
  height: m.height,
  orientation: m.width && m.height ? (m.height > m.width ? 'vertical' : m.height < m.width ? 'horizontal' : 'square') : null,
  sizeMB: Math.round((m.sizeBytes / 1_048_576) * 10) / 10,
  usedInPosts: m.usedCount,
  missing: m.missing,
  metadataReady: hasMeta(m)
})

function postView(p: Post, accounts: Map<string, Account>, full: boolean): Record<string, unknown> {
  return {
    id: p.id,
    status: p.status,
    format: p.format,
    title: p.title,
    ...(full ? { description: p.description, hashtags: p.hashtags } : {}),
    scheduledAt: p.scheduledAt,
    scheduledLocal: local(p.scheduledAt),
    mediaIds: p.mediaIds,
    targets: p.targets.map((t) => ({
      accountId: t.accountId,
      account: accounts.get(t.accountId)?.displayName ?? '(removed account)',
      platform: t.platform,
      mode: accounts.get(t.accountId)?.mode ?? null,
      status: t.status,
      attempts: t.attempts,
      url: t.remoteUrl,
      error: t.error,
      ...(full ? { title: t.title, description: t.description, hashtags: t.hashtags, options: t.options } : {})
    }))
  }
}

const accountMap = (): Map<string, Account> => new Map(listAccounts().map((a) => [a.id, a]))

interface Problem {
  accountId: string
  account: string
  platform: string
  errors: string[]
  warnings: string[]
}

function checkDraft(
  format: ContentFormat,
  media: Media[],
  targets: { accountId: string; title: string; description: string; hashtags: string[] }[]
): { ok: boolean; mediaProblems: string[]; accounts: Problem[] } {
  const mediaProblems = validateMediaForFormat(format, media).filter((i) => i.severity === 'error').map((i) => i.message)
  const accounts: Problem[] = targets.map((t) => {
    const account = getAccount(t.accountId)
    if (!account) {
      return { accountId: t.accountId, account: '(unknown)', platform: '?', errors: ['This account does not exist.'], warnings: [] }
    }
    const issues = validateForPlatform(getPlatform(account.platform), format, media, t)
    return {
      accountId: account.id,
      account: account.displayName,
      platform: account.platform,
      errors: issues.filter((i) => i.severity === 'error').map((i) => i.message),
      warnings: issues.filter((i) => i.severity === 'warning').map((i) => i.message)
    }
  })
  return { ok: mediaProblems.length === 0 && accounts.every((a) => a.errors.length === 0), mediaProblems, accounts }
}

// ---- schemas ---------------------------------------------------------------------------------

const hashtagsField = z
  .array(z.string())
  .optional()
  .describe('Hashtags, with or without "#". Example: ["travel", "tips"]')

const targetField = z.object({
  accountId: z.string().describe('Account id from list_accounts'),
  title: z.string().optional().describe('Only to override the shared title for this account'),
  description: z.string().optional().describe('Only to override the shared description for this account'),
  hashtags: hashtagsField,
  options: z
    .record(z.string(), z.union([z.string(), z.boolean()]))
    .optional()
    .describe('Platform options from list_platforms, e.g. {"privacy":"private"} for YouTube')
})

const postBody = {
  title: z.string().describe('Shared title (YouTube needs one; Instagram/TikTok ignore it)'),
  description: z.string().default('').describe('Shared caption/description, without hashtags'),
  hashtags: hashtagsField,
  mediaIds: z.array(z.string()).min(1).describe('Media ids from list_media / import_media, in order'),
  format: z.enum(FORMATS).optional().describe('Defaults to a guess from the media (vertical video ≤3 min = short_video)'),
  targets: z.array(targetField).min(1).describe('Accounts to post to')
}

function resolveTargets(
  a: { title: string; description: string; hashtags?: string[]; targets: z.infer<typeof targetField>[] }
): PostTargetInput[] {
  return a.targets.map((t) => {
    const account = getAccount(t.accountId)
    if (!account) throw new Error(`Unknown account id ${t.accountId}. Use list_accounts.`)
    const defaults = Object.fromEntries(getPlatform(account.platform).capabilities.options.map((o) => [o.key, o.default]))
    const customized = t.title !== undefined || t.description !== undefined || t.hashtags !== undefined
    return {
      accountId: account.id,
      title: t.title,
      description: t.description,
      hashtags: t.hashtags ? parseHashtags(t.hashtags.join(' ')) : undefined,
      customized,
      options: { ...defaults, ...(t.options ?? {}) }
    }
  })
}

// ---- tools -----------------------------------------------------------------------------------

export function buildTools(server: McpServer): void {
  def(server, 'get_overview', 'Start here. Current time/time zone, connected accounts, post counts, what is scheduled next, and whether you may publish to live accounts.', {}, READ, () => {
    const accounts = listAccounts()
    const posts = listPosts()
    const byStatus: Record<string, number> = {}
    for (const p of posts) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1
    const map = new Map(accounts.map((a) => [a.id, a]))
    const upcoming = posts
      .filter((p) => p.status === 'scheduled')
      .sort((x, y) => (x.scheduledAt ?? '').localeCompare(y.scheduledAt ?? ''))
      .slice(0, 5)
      .map((p) => postView(p, map, false))
    const needsAttention = posts.filter((p) => ['failed', 'missed', 'partial'].includes(p.status)).map((p) => postView(p, map, false))
    return {
      now: { iso: new Date().toISOString(), local: local(new Date().toISOString()), timeZone },
      appVersion: process.env['npm_package_version'] ?? undefined,
      assistantMayPublishToLiveAccounts: getAppSettings().mcpAllowPublish,
      accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, name: a.displayName, handle: a.handle, mode: a.mode, status: a.status })),
      mediaCount: listMedia().length,
      postsByStatus: byStatus,
      nextScheduled: upcoming,
      needsAttention
    }
  })

  def(server, 'list_platforms', 'What each platform accepts: formats, duration/size limits, title/caption limits and the extra options you can set per account.', {}, READ, () =>
    listPlatforms().map((p) => ({
      id: p.id,
      name: p.name,
      liveAvailable: p.liveAvailable,
      formats: p.capabilities.formats,
      titleMax: p.capabilities.titleMax ?? null,
      titleRequired: p.capabilities.titleRequired ?? false,
      descriptionMax: p.capabilities.descriptionMax,
      maxHashtags: p.capabilities.maxHashtags ?? null,
      options: p.capabilities.options
    }))
  )

  def(server, 'list_accounts', 'Connected accounts. "live" accounts are real; "demo" accounts are simulated.', {}, READ, () =>
    listAccounts().map((a) => ({ id: a.id, platform: a.platform, name: a.displayName, handle: a.handle, mode: a.mode, status: a.status }))
  )

  def(server, 'list_media', 'Files in the media library, with duration, resolution and orientation.', {}, READ, () => listMedia().map(mediaView))

  def(
    server,
    'import_media',
    'Add video/image files from this PC to the media library. Paths must be absolute (e.g. C:\\Videos\\clip.mp4). Files are referenced in place, not copied. Returns media ids to use in save_post.',
    { paths: z.array(z.string()).min(1).max(50).describe('Absolute file paths') },
    WRITE,
    async ({ paths }) => {
      const problems: string[] = []
      const valid: string[] = []
      for (const p of paths) {
        if (!isAbsolute(p)) problems.push(`${p}: path must be absolute.`)
        else if (!existsSync(p) || !statSync(p).isFile()) problems.push(`${p}: file not found.`)
        else valid.push(p)
      }
      const imported = valid.length ? importMedia(valid) : []
      if (imported.length < valid.length) problems.push('Some files were skipped because their type is not supported (use mp4, mov, m4v, webm, mkv, avi, jpg, png, webp, gif).')
      if (imported.length) notify('media')
      const ready = await waitForMetadata(imported.map((m) => m.id), 25_000)
      const slow = ready.filter((m) => !hasMeta(m))
      return {
        media: ready.map(mediaView),
        problems,
        ...(slow.length
          ? { note: 'Some files have no duration/resolution yet (the app window reads them). Call list_media again in a few seconds; if they stay empty the format may be unreadable.' }
          : {})
      }
    }
  )

  def(
    server,
    'list_posts',
    'Posts with status and per-account results. Filter by status; newest first.',
    {
      status: z.enum(['draft', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'missed']).optional(),
      limit: z.number().int().min(1).max(100).default(30)
    },
    READ,
    ({ status, limit }) => {
      const map = accountMap()
      return listPosts()
        .filter((p) => !status || p.status === status)
        .slice(0, limit)
        .map((p) => postView(p, map, false))
    }
  )

  def(server, 'get_post', 'One post with full text, hashtags and options per account.', { id: z.string() }, READ, ({ id }) =>
    postView(requirePost(id), accountMap(), true)
  )

  def(
    server,
    'check_post',
    'Dry-run: validates a post against each platform’s rules (title/caption length, duration, format) without saving anything. Run it before save_post.',
    postBody,
    READ,
    async (a) => {
      const media = await waitForMetadata(a.mediaIds, 8_000)
      if (media.length !== a.mediaIds.length) throw new Error('Some media ids do not exist. Use list_media.')
      const format = a.format ?? suggestFormat(media)
      if (!format) throw new Error('Could not determine the format; pass "format".')
      const targets = resolveTargets(a)
      const tags = parseHashtags((a.hashtags ?? []).join(' '))
      const result = checkDraft(
        format,
        media,
        targets.map((t) => ({
          accountId: t.accountId,
          title: t.customized ? (t.title ?? a.title) : a.title,
          description: t.customized ? (t.description ?? a.description) : a.description,
          hashtags: t.customized ? (t.hashtags ?? tags) : tags
        }))
      )
      return { format, ...result }
    }
  )

  def(
    server,
    'save_post',
    'Create a post, or edit one by passing its id (only draft/scheduled/failed/missed posts are editable). intent: "draft" saves only; "scheduled" queues it at scheduledAt; "now" publishes immediately. For live accounts the post is saved as a draft unless the user allowed assistants to publish — the result says so.',
    {
      id: z.string().optional().describe('Existing post id to edit'),
      ...postBody,
      intent: z.enum(['draft', 'scheduled', 'now']).default('draft'),
      scheduledAt: z.string().optional().describe('ISO 8601 with UTC offset, e.g. 2026-11-12T19:00:00+07:00. Required for "scheduled".')
    },
    PUBLISH,
    async (a) => {
      const media = await waitForMetadata(a.mediaIds, 8_000)
      if (media.length !== a.mediaIds.length) throw new Error('Some media ids do not exist. Use list_media.')
      const format = a.format ?? suggestFormat(media)
      if (!format) throw new Error('Could not determine the format; pass "format".')
      const targets = resolveTargets(a)

      let intent = a.intent
      let note: string | undefined
      const live = liveAccountNames(targets.map((t) => t.accountId))
      if (intent !== 'draft' && live.length > 0 && !getAppSettings().mcpAllowPublish) {
        intent = 'draft'
        note = `Saved as a DRAFT, not ${a.intent === 'now' ? 'published' : 'scheduled'}, because it targets live account(s) (${live.join(', ')}) and assistants are not allowed to publish to those. ${a.scheduledAt ? `The requested time (${a.scheduledAt}) is stored on the draft. ` : ''}Tell the user to open it in the app (Calendar/Library → the post) and press Schedule, or enable "Allow the assistant to schedule and publish" in Settings → AI assistant.`
      }
      const input: PostInput = {
        id: a.id,
        format,
        title: a.title,
        description: a.description,
        hashtags: parseHashtags((a.hashtags ?? []).join(' ')),
        mediaIds: a.mediaIds,
        scheduledAt: a.scheduledAt ? toIso(a.scheduledAt, 'scheduledAt') : null,
        intent,
        targets
      }
      const post = savePost(input)
      notify('posts', 'media')
      if (intent === 'now') kickScheduler()
      return { ...postView(post, accountMap(), true), ...(note ? { note } : {}) }
    }
  )

  def(
    server,
    'reschedule_post',
    'Move a draft/scheduled/missed post to a new time and queue it.',
    { id: z.string(), scheduledAt: z.string().describe('ISO 8601 with UTC offset') },
    PUBLISH,
    ({ id, scheduledAt }) => {
      assertMayPublish(requirePost(id))
      const post = reschedulePost(id, toIso(scheduledAt, 'scheduledAt'))
      notify('posts')
      return postView(post, accountMap(), false)
    }
  )

  def(server, 'unschedule_post', 'Take a scheduled post out of the queue and turn it back into a draft.', { id: z.string() }, WRITE, ({ id }) => {
    const post = unschedulePost(id)
    notify('posts')
    return postView(post, accountMap(), false)
  })

  def(
    server,
    'publish_post_now',
    'Publish a draft/scheduled/missed post immediately. It runs in the background: poll get_post for the result.',
    { id: z.string() },
    PUBLISH,
    ({ id }) => {
      assertMayPublish(requirePost(id))
      queueNow(id)
      notify('posts')
      kickScheduler()
      return { queued: true, hint: 'Poll get_post until status is published, failed or partial.' }
    }
  )

  def(
    server,
    'retry_post',
    'Retry the failed accounts of a failed/partial/missed post. Check the platform first if it failed mid-upload, to avoid a duplicate.',
    { id: z.string() },
    PUBLISH,
    ({ id }) => {
      assertMayPublish(requirePost(id))
      queueRetry(id)
      notify('posts')
      kickScheduler()
      return { queued: true }
    }
  )

  def(server, 'duplicate_post', 'Copy a post into a new draft.', { id: z.string() }, WRITE, ({ id }) => {
    const post = duplicatePost(id)
    notify('posts')
    return postView(post, accountMap(), false)
  })

  def(
    server,
    'delete_post',
    'Delete a post from the app. This does not remove anything already published on a platform.',
    { id: z.string() },
    DESTROY,
    ({ id }) => {
      deletePost(id)
      notify('posts', 'media', 'analytics')
      return { deleted: true }
    }
  )

  def(
    server,
    'get_analytics',
    'Performance summary: totals, per-platform stats, top posts and suggested posting times. Call sync_analytics first for fresh numbers.',
    {
      days: z.number().int().min(1).max(365).default(28),
      platform: z.string().optional().describe('Platform id to filter by, e.g. "youtube"')
    },
    READ,
    ({ days, platform }) => {
      const s = getSummary({ days, platform: platform ?? null })
      return {
        days: s.days,
        totals: s.totals,
        platforms: s.platforms,
        topPosts: s.topPosts,
        bestPostingTimes: s.bestTimes.suggestions.map((x) => ({
          weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][x.weekday],
          hour: x.hour,
          score: x.score
        })),
        bestTimesSampleSize: s.bestTimes.sampleSize,
        includesDemoData: s.hasDemoData,
        lastSyncAt: s.lastSyncAt
      }
    }
  )

  def(server, 'sync_analytics', 'Fetch the latest numbers from the connected platforms now.', {}, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async () => {
    const res = await syncAnalytics()
    notify('analytics')
    return res
  })
}
