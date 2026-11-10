import { readFile, stat } from 'node:fs/promises'
import { buildCaption } from '@shared/validation'
import type { Account } from '@shared/types'
import { notify } from '../events'
import { authorizeInBrowser } from '../oauth'
import { accountTokensKey, getSecret } from '../secrets'
import { setAccountStatus } from '../store/accounts'
import { PermanentPublishError } from './types'
import type { AppCredentials, PlatformDriver, PlatformProvider } from './types'

/**
 * Instagram through "Instagram API with Facebook Login". This is the only route that can upload a
 * video straight from a file on this PC (resumable upload to rupload.facebook.com); the simpler
 * "Instagram Login" route only accepts videos that are already on a public web server.
 *
 * Sign-in gives a user token, which is swapped for a long-lived one and then for the linked
 * Facebook Page's token. A Page token obtained from a long-lived user token does not expire, so no
 * refresh logic is needed; if it is ever revoked the account is flagged for reconnecting.
 */

const VERSION = 'v27.0'
const GRAPH = `https://graph.facebook.com/${VERSION}`
const RUPLOAD = `https://rupload.facebook.com/ig-api-upload/${VERSION}`
const AUTH_URL = `https://www.facebook.com/${VERSION}/dialog/oauth`
/** Facebook only accepts registered redirects; http://localhost is allowed for apps in development mode. */
export const INSTAGRAM_REDIRECT_PORT = 38518
const SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'business_management'
]
/** Reels processing usually takes under a minute; give large files plenty of room. */
const PROCESS_TIMEOUT_MS = 15 * 60_000
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024

interface StoredTokens {
  /** Page access token. */
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string; is_transient?: boolean }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function flagReauth(account: Account | null, message: string): never {
  if (account) {
    setAccountStatus(account.id, 'needs_reauth')
    notify('accounts')
  }
  throw new PermanentPublishError(message)
}

/** Converts a Graph API error into an Error; permanent unless retrying could help. */
async function graphError(res: Response, what: string, account: Account | null): Promise<Error> {
  let body: GraphErrorBody = {}
  try {
    body = (await res.json()) as GraphErrorBody
  } catch {
    /* not JSON */
  }
  const e = body.error ?? {}
  const message = e.error_user_msg || e.message || `${res.status} ${res.statusText}`
  if (e.code === 190) flagReauth(account, `${what}: the Instagram sign-in is no longer valid. Open Accounts and reconnect Instagram.`)
  // 4/17/32/613: rate limits; 9004/2207xxx are content problems that retrying will not fix.
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return new Error(`${what}: Instagram rate limit reached. ${message}`)
  if (e.is_transient || res.status >= 500) return new Error(`${what}: ${message}`)
  return new PermanentPublishError(`${what}: ${message}`)
}

async function graph<T>(
  account: Account | null,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>,
  what: string
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token })
  let res: Response
  try {
    res =
      method === 'GET'
        ? await fetch(`${GRAPH}${path}?${qs}`)
        : await fetch(`${GRAPH}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs })
  } catch (e) {
    throw new Error(`${what}: could not reach Instagram (${e instanceof Error ? e.message : String(e)})`)
  }
  if (!res.ok) throw await graphError(res, what, account)
  return (await res.json()) as T
}

function tokenFor(account: Account): string {
  const t = getSecret<StoredTokens>(accountTokensKey(account.id))
  if (!t?.accessToken) flagReauth(account, 'Instagram sign-in is missing. Open Accounts and reconnect Instagram.')
  return t.accessToken
}

function igId(account: Account): string {
  if (!account.remoteId) flagReauth(account, 'The Instagram account id is missing. Open Accounts and reconnect Instagram.')
  return account.remoteId
}

async function uploadReel(account: Account, token: string, path: string, params: Record<string, string>): Promise<string> {
  const { size } = await stat(path)
  if (size === 0) throw new PermanentPublishError('The video file is empty.')
  if (size > MAX_UPLOAD_BYTES) throw new PermanentPublishError('Instagram accepts Reels up to 1 GB through the API. Export a smaller file.')

  const container = await graph<{ id: string; uri?: string }>(
    account,
    token,
    'POST',
    `/${igId(account)}/media`,
    { media_type: 'REELS', upload_type: 'resumable', ...params },
    'Instagram upload'
  )
  const data = await readFile(path)
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(container.uri ?? `${RUPLOAD}/${container.id}`, {
        method: 'POST',
        headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(size) },
        body: data
      })
      if (res.ok) {
        lastError = null
        break
      }
      const err = await graphError(res, 'Instagram upload', account)
      if (err instanceof PermanentPublishError) throw err
      lastError = err
    } catch (e) {
      if (e instanceof PermanentPublishError) throw e
      lastError = e
    }
    await sleep(3000 * attempt)
  }
  if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError))
  return container.id
}

async function waitUntilProcessed(account: Account, token: string, containerId: string): Promise<void> {
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  let delay = 5000
  while (Date.now() < deadline) {
    const s = await graph<{ status_code?: string; status?: string }>(
      account,
      token,
      'GET',
      `/${containerId}`,
      { fields: 'status_code,status' },
      'Instagram processing'
    )
    if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new PermanentPublishError(`Instagram could not process the video${s.status ? `: ${s.status}` : ''}. Check that it is a standard MP4 (H.264/AAC) between 3 s and 15 min.`)
    }
    await sleep(delay)
    delay = Math.min(delay + 5000, 30_000)
  }
  throw new PermanentPublishError('Instagram took too long to process the video. Check the app on your phone before retrying, to avoid a duplicate.')
}

const driver: PlatformDriver = {
  async publish({ account, post, target, media }) {
    if (post.format !== 'short_video' && post.format !== 'long_video') {
      throw new PermanentPublishError(
        'Live Instagram posting supports Reels (video) only for now: Instagram requires photos and carousels to be on a public web address first.'
      )
    }
    const video = media.find((m) => m.kind === 'video')
    if (!video) throw new PermanentPublishError('A Reel needs a video file.')
    const token = tokenFor(account)
    const caption = buildCaption(target.description, target.hashtags).slice(0, 2200)
    const containerId = await uploadReel(account, token, video.path, {
      caption,
      share_to_feed: target.options.shareToFeed === false ? 'false' : 'true'
    })
    await waitUntilProcessed(account, token, containerId)
    const published = await graph<{ id: string }>(account, token, 'POST', `/${igId(account)}/media_publish`, { creation_id: containerId }, 'Instagram publish')
    let url: string | null = null
    try {
      url = (await graph<{ permalink?: string }>(account, token, 'GET', `/${published.id}`, { fields: 'permalink' }, 'Instagram link')).permalink ?? null
    } catch {
      /* the post is live; the link is only a convenience */
    }
    return { remoteId: published.id, remoteUrl: url }
  },

  async fetchPostMetrics({ account, target }) {
    if (!target.remoteId) throw new Error('This post has no Instagram media id.')
    const token = tokenFor(account)
    const basic = await graph<{ like_count?: number; comments_count?: number }>(
      account,
      token,
      'GET',
      `/${target.remoteId}`,
      { fields: 'like_count,comments_count' },
      'Instagram statistics'
    )
    const out = { views: 0, likes: basic.like_count ?? 0, comments: basic.comments_count ?? 0, shares: 0, saves: 0, watchTimeSec: null as number | null }
    try {
      const ins = await graph<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
        account,
        token,
        'GET',
        `/${target.remoteId}/insights`,
        { metric: 'views,shares,saved,ig_reels_avg_watch_time' },
        'Instagram insights'
      )
      for (const m of ins.data ?? []) {
        const v = m.values?.[0]?.value ?? m.total_value?.value ?? 0
        if (m.name === 'views') out.views = v
        if (m.name === 'shares') out.shares = v
        if (m.name === 'saved') out.saves = v
        // average watch time is in ms; total = average × views
        if (m.name === 'ig_reels_avg_watch_time') out.watchTimeSec = Math.round((v / 1000) * Math.max(out.views, 0)) || null
      }
    } catch (e) {
      if (e instanceof PermanentPublishError && /reconnect/i.test(e.message)) throw e
      /* insights can lag right after publishing; likes/comments are still useful */
    }
    return out
  },

  async fetchAccountMetrics({ account }) {
    const token = tokenFor(account)
    const j = await graph<{ followers_count?: number }>(account, token, 'GET', `/${igId(account)}`, { fields: 'followers_count' }, 'Instagram account')
    return { followers: j.followers_count ?? 0 }
  }
}

interface PageRow {
  id: string
  name: string
  access_token?: string
  instagram_business_account?: { id: string; username?: string; name?: string }
}

async function connect(creds: AppCredentials): Promise<{ remoteId: string; displayName: string; handle: string; tokens: StoredTokens }> {
  const { code, redirectUri } = await authorizeInBrowser({
    authUrl: AUTH_URL,
    tokenUrl: `${GRAPH}/oauth/access_token`,
    clientId: creds.clientId,
    scopes: SCOPES,
    scopeSeparator: ',',
    pkce: false,
    redirect: { host: 'localhost', port: INSTAGRAM_REDIRECT_PORT },
    authParams: { auth_type: 'rerequest' }
  })
  const short = await graph<{ access_token: string }>(
    null,
    '',
    'GET',
    '/oauth/access_token',
    { client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, code },
    'Signing in'
  )
  const long = await graph<{ access_token: string }>(
    null,
    '',
    'GET',
    '/oauth/access_token',
    { grant_type: 'fb_exchange_token', client_id: creds.clientId, client_secret: creds.clientSecret, fb_exchange_token: short.access_token },
    'Signing in'
  )
  const pages = await graph<{ data?: PageRow[] }>(
    null,
    long.access_token,
    'GET',
    '/me/accounts',
    { fields: 'id,name,access_token,instagram_business_account{id,username,name}', limit: '100' },
    'Reading your Facebook Pages'
  )
  const linked = (pages.data ?? []).filter((p) => p.instagram_business_account && p.access_token)
  if (linked.length === 0) {
    throw new Error(
      (pages.data ?? []).length === 0
        ? 'No Facebook Page was shared with the app. Sign in again and, when Facebook asks, select your Page and your Instagram account.'
        : 'None of your Facebook Pages has an Instagram professional account linked. Link it in the Instagram app (Settings → Account type and tools / Accounts Center), then connect again.'
    )
  }
  const page = linked[0]
  const ig = page.instagram_business_account!
  return {
    remoteId: ig.id,
    displayName: ig.name || ig.username || page.name,
    handle: ig.username ? `@${ig.username}` : page.name,
    tokens: { accessToken: page.access_token!, refreshToken: '', expiresAt: Number.MAX_SAFE_INTEGER }
  }
}

export const instagram: PlatformProvider = {
  createLiveDriver: () => driver,
  connect,
  info: {
    id: 'instagram',
    name: 'Instagram',
    color: '#e1306c',
    liveAvailable: false,
    credentialLabels: { id: 'App ID', secret: 'App Secret', idPlaceholder: '1234567890123456', secretPlaceholder: '32-character app secret' },
    capabilities: {
      formats: {
        short_video: { minDurationSec: 3, maxDurationSec: 900, maxFileMB: 1024, note: 'Published as a Reel.' },
        image: { note: 'Demo accounts only for now. Live accounts support Reels.' },
        carousel: { minItems: 2, maxItems: 10, note: 'Demo accounts only for now. Live accounts support Reels.' }
      },
      descriptionMax: 2200,
      maxHashtags: 30,
      supportsThumbnail: false,
      liveFormats: ['short_video'],
      options: [
        {
          key: 'shareToFeed',
          label: 'Also show Reel in the main feed',
          type: 'toggle',
          default: true
        }
      ]
    },
    setupGuide: {
      title: 'Connect Instagram',
      steps: [
        'In the Instagram app: Settings → Account type and tools → Switch to professional account (Creator or Business).',
        'Link it to a Facebook Page: in Instagram open Accounts Center and add your Facebook account, then on Facebook create a Page (any name) and in the Page settings choose Linked accounts → Instagram → Connect.',
        'Use button 1 below: create an app at Meta for Developers. Pick the use case "Manage everything on your Page" / "Other", app type "Business", and finish the wizard.',
        'In the app dashboard add the products "Facebook Login for Business" and "Instagram" (Instagram API with Facebook Login). Leave the app in Development mode: as its admin you can use it with your own accounts without App Review.',
        `In Facebook Login → Settings, make sure "http://localhost:${INSTAGRAM_REDIRECT_PORT}/" is accepted as a Valid OAuth Redirect URI (add it if the page asks for one).`,
        'Open App settings → Basic, copy the App ID and App Secret, press Connect here and paste them in. In the Facebook window, select your Page and your Instagram account when asked.'
      ],
      links: [
        { label: '1 · Create Meta app', url: 'https://developers.facebook.com/apps/creation/' },
        { label: 'Instagram publishing docs', url: 'https://developers.facebook.com/docs/instagram-platform/content-publishing' }
      ],
      caveat:
        'Only Creator and Business accounts linked to a Facebook Page can be published to through the API. Live posting supports Reels; photos and carousels stay demo-only for now. Instagram allows up to 100 API posts per 24 hours.'
    }
  }
}
