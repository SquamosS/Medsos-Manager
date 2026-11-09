import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { buildCaption } from '@shared/validation'
import type { Account, Media } from '@shared/types'
import { notify } from '../events'
import { AuthExpiredError, refreshAccessToken, runOAuth } from '../oauth'
import type { OAuthConfig } from '../oauth'
import { accountTokensKey, appCredentialsKey, getSecret, setSecret } from '../secrets'
import { setAccountStatus } from '../store/accounts'
import { PermanentPublishError } from './types'
import type { AppCredentials, PlatformDriver, PlatformProvider } from './types'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/youtube/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3/videos'
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']
/** Must be a multiple of 256 KiB for resumable uploads. */
const CHUNK = 8 * 1024 * 1024

interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

const oauthConfig = (c: AppCredentials): OAuthConfig => ({
  authUrl: AUTH_URL,
  tokenUrl: TOKEN_URL,
  clientId: c.clientId,
  clientSecret: c.clientSecret,
  scopes: SCOPES,
  // offline + consent so Google always returns a refresh token.
  authParams: { access_type: 'offline', prompt: 'consent' }
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Turns a Google API error response into an Error; permanent for anything retrying will not fix. */
async function apiError(res: Response, what: string): Promise<Error> {
  let reason = ''
  let message = `${res.status} ${res.statusText}`
  try {
    const j = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } }
    reason = j.error?.errors?.[0]?.reason ?? ''
    if (j.error?.message) message = j.error.message
  } catch {
    /* keep the status line */
  }
  const text = `${what}: ${message}`
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return new PermanentPublishError(`${what}: the daily YouTube API quota is used up. It resets at midnight Pacific time; use Retry then.`)
  }
  if (reason === 'uploadLimitExceeded') {
    return new PermanentPublishError(`${what}: this channel reached its daily upload limit.`)
  }
  if (res.status === 401) return new PermanentPublishError(`${what}: Google rejected the sign-in. Reconnect the account.`)
  if (res.status === 429 || res.status >= 500) return new Error(text)
  return new PermanentPublishError(text)
}

async function accessTokenFor(account: Account): Promise<string> {
  const tokens = getSecret<StoredTokens>(accountTokensKey(account.id))
  const creds = getSecret<AppCredentials>(appCredentialsKey('youtube'))
  const needReauth = (msg: string): never => {
    setAccountStatus(account.id, 'needs_reauth')
    notify('accounts')
    throw new PermanentPublishError(msg)
  }
  if (!tokens || !creds) return needReauth('YouTube credentials are missing. Open Accounts and reconnect YouTube.')
  if (tokens.accessToken && tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken
  try {
    const fresh = await refreshAccessToken(oauthConfig(creds), tokens.refreshToken)
    setSecret(accountTokensKey(account.id), { ...tokens, accessToken: fresh.accessToken, expiresAt: fresh.expiresAt })
    return fresh.accessToken
  } catch (e) {
    if (e instanceof AuthExpiredError) {
      return needReauth('The Google sign-in expired. Open Accounts and reconnect YouTube.')
    }
    throw e
  }
}

async function getJson<T>(account: Account, url: string, what: string): Promise<T> {
  const token = await accessTokenFor(account)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw await apiError(res, what)
  return (await res.json()) as T
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo' }

/** Resumable upload in chunks; resolves with the created video resource. */
async function uploadVideo(token: string, file: Media, metadata: unknown): Promise<{ id: string }> {
  const { size } = await stat(file.path)
  if (size === 0) throw new PermanentPublishError('The video file is empty.')
  const init = await fetch(`${UPLOAD_API}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': MIME[extname(file.path).toLowerCase()] ?? 'video/*'
    },
    body: JSON.stringify(metadata)
  })
  if (!init.ok) throw await apiError(init, 'YouTube upload')
  const session = init.headers.get('location')
  if (!session) throw new Error('YouTube did not return an upload address.')

  const handle = await open(file.path, 'r')
  try {
    let offset = 0
    let failures = 0
    for (;;) {
      const len = Math.min(CHUNK, size - offset)
      const buf = Buffer.alloc(len)
      await handle.read(buf, 0, len, offset)
      let res: Response
      try {
        res = await fetch(session, {
          method: 'PUT',
          redirect: 'manual',
          headers: { 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` },
          body: buf
        })
      } catch (e) {
        if (++failures > 4) throw new Error(`Upload interrupted: ${e instanceof Error ? e.message : String(e)}`)
        await sleep(2000 * failures)
        continue
      }
      if (res.status === 308) {
        // "Resume incomplete": the Range header says how much Google has stored so far.
        const range = res.headers.get('range')
        offset = range ? Number(range.split('-')[1]) + 1 : offset + len
        failures = 0
        continue
      }
      if (res.ok) return (await res.json()) as { id: string }
      if (res.status >= 500 && ++failures <= 4) {
        await sleep(2000 * failures)
        continue
      }
      throw await apiError(res, 'YouTube upload')
    }
  } finally {
    await handle.close()
  }
}

const clean = (s: string): string => s.replace(/</g, '‹').replace(/>/g, '›')

const driver: PlatformDriver = {
  async publish({ account, post, target, media }) {
    const video = media.find((m) => m.kind === 'video')
    if (!video) throw new PermanentPublishError('YouTube needs a video file.')
    const title = clean(target.title.trim() || post.title.trim()).slice(0, 100)
    if (!title) throw new PermanentPublishError('A title is required for YouTube.')

    let description = buildCaption(target.description, target.hashtags)
    if (post.format === 'short_video' && !/#shorts\b/i.test(description)) description = `${description}\n\n#Shorts`.trim()
    // YouTube limits total tag length; keep well under it.
    const tags: string[] = []
    let tagChars = 0
    for (const t of target.hashtags) {
      if (tagChars + t.length > 450) break
      tags.push(t)
      tagChars += t.length + 1
    }

    const privacy = typeof target.options.privacy === 'string' ? target.options.privacy : 'public'
    const metadata = {
      snippet: { title, description: clean(description).slice(0, 5000), tags, categoryId: '22' },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: target.options.madeForKids === true }
    }
    const token = await accessTokenFor(account)
    const created = await uploadVideo(token, video, metadata)
    const url = post.format === 'short_video' ? `https://www.youtube.com/shorts/${created.id}` : `https://www.youtube.com/watch?v=${created.id}`
    return { remoteId: created.id, remoteUrl: url }
  },

  async fetchPostMetrics({ account, target }) {
    if (!target.remoteId) throw new Error('This post has no YouTube video id.')
    const j = await getJson<{ items?: { statistics?: Record<string, string> }[] }>(
      account,
      `${API}/videos?part=statistics&id=${encodeURIComponent(target.remoteId)}`,
      'YouTube statistics'
    )
    const s = j.items?.[0]?.statistics
    if (!s) throw new Error('The video was not found on YouTube (deleted or private).')
    return {
      views: Number(s.viewCount ?? 0),
      likes: Number(s.likeCount ?? 0),
      comments: Number(s.commentCount ?? 0),
      shares: 0, // the public Data API does not expose shares
      saves: 0,
      watchTimeSec: null
    }
  },

  async fetchAccountMetrics({ account }) {
    const j = await getJson<{ items?: { statistics?: Record<string, string> }[] }>(account, `${API}/channels?part=statistics&mine=true`, 'YouTube channel')
    return { followers: Number(j.items?.[0]?.statistics?.subscriberCount ?? 0) }
  }
}

export const youtube: PlatformProvider = {
  createLiveDriver: () => driver,

  async connect(creds) {
    const tokens = await runOAuth(oauthConfig(creds))
    if (!tokens.refreshToken) {
      throw new Error('Google did not return a long-lived sign-in. Remove "Medsos Manager" at myaccount.google.com/permissions, then try again.')
    }
    const res = await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })
    if (!res.ok) throw await apiError(res, 'Reading your channel')
    const j = (await res.json()) as { items?: { id: string; snippet: { title: string; customUrl?: string } }[] }
    const ch = j.items?.[0]
    if (!ch) throw new Error('This Google account has no YouTube channel yet. Create one at youtube.com, then connect again.')
    return {
      remoteId: ch.id,
      displayName: ch.snippet.title,
      handle: ch.snippet.customUrl ?? ch.snippet.title,
      tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt }
    }
  },

  info: {
    id: 'youtube',
    name: 'YouTube',
    color: '#ff2d2d',
    liveAvailable: false,
    capabilities: {
      formats: {
        short_video: { maxDurationSec: 180, note: 'Shorts: vertical or square, up to 3 minutes.' },
        long_video: { note: 'Standard uploads. Unverified channels are limited to 15 minutes.' }
      },
      titleMax: 100,
      titleRequired: true,
      descriptionMax: 5000,
      maxHashtags: 15,
      supportsThumbnail: true,
      options: [
        {
          key: 'privacy',
          label: 'Visibility',
          type: 'select',
          default: 'public',
          choices: [
            { value: 'public', label: 'Public' },
            { value: 'unlisted', label: 'Unlisted' },
            { value: 'private', label: 'Private' }
          ]
        },
        {
          key: 'madeForKids',
          label: 'Made for kids',
          type: 'toggle',
          default: false,
          help: 'YouTube requires this declaration for every upload.'
        }
      ]
    },
    setupGuide: {
      title: 'Connect YouTube',
      steps: [
        'Open the Google Cloud Console and create a new project (any name).',
        'In "APIs & Services → Library", enable "YouTube Data API v3".',
        'Under "OAuth consent screen" (called "Google Auth Platform" in newer consoles), choose External and fill in the app name and your email.',
        'Add your own Google account as a Test user. Then click "Publish app" so the status is "In production": while it stays in "Testing", Google signs you out of the app every 7 days. An unverified app is fine for your own account; you only click through a warning once.',
        'Under "Credentials", create an OAuth client ID of type "Desktop app".',
        'Copy the Client ID and Client Secret, press Connect here, and paste them in. They are stored encrypted on this PC.'
      ],
      links: [
        { label: 'Google Cloud Console', url: 'https://console.cloud.google.com/' },
        { label: 'YouTube Data API overview', url: 'https://developers.google.com/youtube/v3/getting-started' }
      ],
      caveat:
        "Two limits to know. New API projects that have not passed Google's audit can have uploaded videos locked to private (apply for the audit once everything works). The default quota is 10,000 units a day and one upload costs 1,600, so roughly 6 uploads per day."
    }
  }
}
