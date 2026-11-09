// Types shared by the main process, preload and renderer.

/** Platform ids are plain strings so new platforms can be added without touching shared code. */
export type PlatformId = string

/** What kind of content a post is. Platforms declare which formats they accept. */
export type ContentFormat = 'short_video' | 'long_video' | 'image' | 'carousel'

export const FORMAT_LABELS: Record<ContentFormat, string> = {
  short_video: 'Short video',
  long_video: 'Long video',
  image: 'Image',
  carousel: 'Carousel'
}

export interface FormatRules {
  minDurationSec?: number
  maxDurationSec?: number
  maxFileMB?: number
  /** Number of media items allowed (carousel). Defaults to 1. */
  maxItems?: number
  minItems?: number
  note?: string
}

export interface OptionField {
  key: string
  label: string
  type: 'select' | 'toggle'
  choices?: { value: string; label: string }[]
  default: string | boolean
  help?: string
}

export interface PlatformCapabilities {
  formats: Partial<Record<ContentFormat, FormatRules>>
  /** Max title length. Undefined means the platform has no title field. */
  titleMax?: number
  titleRequired?: boolean
  /** Max description / caption length (hashtags included). */
  descriptionMax: number
  maxHashtags?: number
  supportsThumbnail: boolean
  /** Extra platform-specific settings shown in the composer. */
  options: OptionField[]
}

export interface PlatformInfo {
  id: PlatformId
  name: string
  /** Brand-ish colour used for badges and chart series. */
  color: string
  capabilities: PlatformCapabilities
  /** Step-by-step instructions for creating developer credentials. */
  setupGuide: { title: string; steps: string[]; links: { label: string; url: string }[]; caveat?: string }
  /** True once a real (non-demo) integration exists for this platform. */
  liveAvailable: boolean
}

export type AccountMode = 'demo' | 'live'
export type AccountStatus = 'connected' | 'needs_reauth' | 'error'

export interface Account {
  id: string
  platform: PlatformId
  displayName: string
  handle: string
  mode: AccountMode
  status: AccountStatus
  createdAt: string
}

export type MediaKind = 'video' | 'image'

export interface Media {
  id: string
  kind: MediaKind
  path: string
  filename: string
  sizeBytes: number
  durationSec: number | null
  width: number | null
  height: number | null
  hasThumb: boolean
  /** True when the original file no longer exists on disk. */
  missing: boolean
  usedCount: number
  createdAt: string
}

/** Metadata read in the renderer after import (the renderer never touches arbitrary files itself). */
export interface MediaMetaInput {
  durationSec: number | null
  width: number | null
  height: number | null
  /** JPEG data URL captured from the first frame. */
  thumbDataUrl: string | null
}

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed' | 'missed'
export type TargetStatus = 'pending' | 'publishing' | 'published' | 'failed'

export interface PostTarget {
  id: string
  postId: string
  accountId: string
  platform: PlatformId
  title: string
  description: string
  hashtags: string[]
  /** True when the user edited this platform's text away from the shared text. */
  customized: boolean
  options: Record<string, string | boolean>
  status: TargetStatus
  attempts: number
  remoteId: string | null
  remoteUrl: string | null
  error: string | null
  publishedAt: string | null
}

export interface Post {
  id: string
  format: ContentFormat
  title: string
  description: string
  hashtags: string[]
  mediaIds: string[]
  status: PostStatus
  /** ISO timestamp (UTC). Null for drafts without a date. */
  scheduledAt: string | null
  createdAt: string
  updatedAt: string
  targets: PostTarget[]
}

export interface PostTargetInput {
  accountId: string
  title?: string
  description?: string
  hashtags?: string[]
  customized: boolean
  options: Record<string, string | boolean>
}

export interface PostInput {
  id?: string
  format: ContentFormat
  title: string
  description: string
  hashtags: string[]
  mediaIds: string[]
  scheduledAt: string | null
  /** 'draft' keeps the post unscheduled; 'scheduled' queues it; 'now' publishes immediately. */
  intent: 'draft' | 'scheduled' | 'now'
  targets: PostTargetInput[]
}

export interface MetricsSnapshot {
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  /** Total watch time in seconds, when the platform reports it. */
  watchTimeSec: number | null
}

export interface AnalyticsQuery {
  days: number
  platform: PlatformId | null
}

export interface PlatformStat {
  platform: PlatformId
  views: number
  likes: number
  comments: number
  shares: number
  followers: number
  posts: number
  engagementRate: number
}

export interface TopPost {
  targetId: string
  postId: string
  title: string
  platform: PlatformId
  publishedAt: string
  views: number
  likes: number
  comments: number
  shares: number
  engagementRate: number
}

export interface AnalyticsSummary {
  days: number
  totals: {
    views: number
    likes: number
    comments: number
    shares: number
    followers: number
    followersDelta: number
    posts: number
    engagementRate: number
  }
  daily: { date: string; byPlatform: Record<PlatformId, number> }[]
  followersDaily: { date: string; byPlatform: Record<PlatformId, number> }[]
  platforms: PlatformStat[]
  topPosts: TopPost[]
  bestTimes: {
    /** grid[weekday 0=Mon..6=Sun][bucket 0..7] where bucket = 3-hour block. Null = no data. */
    grid: (number | null)[][]
    suggestions: { weekday: number; hour: number; score: number }[]
    sampleSize: number
  }
  hasDemoData: boolean
  lastSyncAt: string | null
}

export interface AppSettings {
  runInBackground: boolean
  launchAtLogin: boolean
  theme: 'dark' | 'light'
  /** Posts overdue by more than this many minutes when the app wakes are marked "missed". */
  missedAfterMinutes: number
  /** Local MCP server so an AI assistant (e.g. Claude Code) can operate the app. Off by default. */
  mcpEnabled: boolean
  /**
   * When false (default) the assistant can only save drafts for live accounts; a person has to
   * schedule or publish them in the app. When true it may schedule and publish on its own.
   */
  mcpAllowPublish: boolean
  mcpPort: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  runInBackground: true,
  launchAtLogin: false,
  theme: 'dark',
  missedAfterMinutes: 60,
  mcpEnabled: false,
  mcpAllowPublish: false,
  mcpPort: 38517
}

export interface McpInfo {
  enabled: boolean
  running: boolean
  /** Endpoint the assistant connects to. */
  url: string
  token: string
  error: string | null
}

export interface AppInfo {
  version: string
  dataDir: string
  platform: string
}
