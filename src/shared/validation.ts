import { FORMAT_LABELS } from './types'
import type { ContentFormat, Media, PlatformInfo } from './types'

export interface Issue {
  severity: 'error' | 'warning'
  message: string
}

/** Normalises user input like "#Travel, #food  vlog" into ["Travel", "food", "vlog"]. */
export function parseHashtags(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.split(/[\s,]+/)) {
    const tag = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      out.push(tag)
    }
  }
  return out
}

export function hashtagLine(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(' ')
}

/** The caption/description body actually sent to a platform (text + hashtags). */
export function buildCaption(description: string, hashtags: string[]): string {
  const tags = hashtagLine(hashtags)
  if (!tags) return description.trim()
  return description.trim() ? `${description.trim()}\n\n${tags}` : tags
}

/** Suggests a format for the chosen media: vertical clips up to 3 min are treated as shorts. */
export function suggestFormat(media: Media[]): ContentFormat | null {
  if (media.length === 0) return null
  if (media.length > 1) return 'carousel'
  const m = media[0]
  if (m.kind === 'image') return 'image'
  const vertical = (m.height ?? 0) >= (m.width ?? 0)
  if (vertical && (m.durationSec ?? 0) <= 180) return 'short_video'
  return 'long_video'
}

/** Checks the media selection against a format, independent of any platform. */
export function validateMediaForFormat(format: ContentFormat, media: Media[]): Issue[] {
  const issues: Issue[] = []
  const err = (message: string): void => void issues.push({ severity: 'error', message })
  if (media.length === 0) {
    err('Choose at least one media file.')
    return issues
  }
  if (media.some((m) => m.missing)) err('A selected file no longer exists on disk. Re-import it or pick another.')
  if (format === 'short_video' || format === 'long_video') {
    if (media.length !== 1 || media[0].kind !== 'video') err(`${FORMAT_LABELS[format]} needs exactly one video.`)
  } else if (format === 'image') {
    if (media.length !== 1 || media[0].kind !== 'image') err('An image post needs exactly one image.')
  } else if (format === 'carousel') {
    if (media.length < 2) err('A carousel needs at least two items.')
  }
  return issues
}

export interface TargetDraft {
  title: string
  description: string
  hashtags: string[]
}

/** Checks one platform's text and media against that platform's declared capabilities. */
export function validateForPlatform(
  platform: PlatformInfo,
  format: ContentFormat,
  media: Media[],
  draft: TargetDraft
): Issue[] {
  const issues: Issue[] = []
  const cap = platform.capabilities
  const rules = cap.formats[format]
  const err = (message: string): void => void issues.push({ severity: 'error', message })
  const warn = (message: string): void => void issues.push({ severity: 'warning', message })

  if (!rules) {
    err(`${platform.name} does not support ${FORMAT_LABELS[format].toLowerCase()} posts.`)
    return issues
  }

  if (cap.titleMax !== undefined) {
    if (cap.titleRequired && !draft.title.trim()) err('A title is required.')
    if (draft.title.length > cap.titleMax) err(`Title is ${draft.title.length}/${cap.titleMax} characters.`)
  }

  const caption = buildCaption(draft.description, draft.hashtags)
  if (caption.length > cap.descriptionMax) {
    err(`Caption is ${caption.length}/${cap.descriptionMax} characters.`)
  }
  if (cap.maxHashtags !== undefined && draft.hashtags.length > cap.maxHashtags) {
    err(`${draft.hashtags.length} hashtags, but ${platform.name} allows ${cap.maxHashtags}.`)
  }

  const items = media.length
  if (rules.maxItems !== undefined && items > rules.maxItems) err(`Up to ${rules.maxItems} items are allowed.`)
  if (rules.minItems !== undefined && items < rules.minItems) err(`At least ${rules.minItems} items are required.`)

  // Duration and size limits are treated as warnings: platforms change them often and they can
  // differ per account, so we flag them without blocking.
  for (const m of media) {
    if (m.kind !== 'video') continue
    if (rules.maxDurationSec && m.durationSec && m.durationSec > rules.maxDurationSec) {
      warn(`Video is ${Math.round(m.durationSec)}s; ${platform.name} limit is about ${rules.maxDurationSec}s.`)
    }
    if (rules.minDurationSec && m.durationSec && m.durationSec < rules.minDurationSec) {
      warn(`Video is shorter than ${rules.minDurationSec}s.`)
    }
    if (rules.maxFileMB && m.sizeBytes > rules.maxFileMB * 1024 * 1024) {
      warn(`File is larger than ${rules.maxFileMB} MB.`)
    }
  }
  return issues
}
