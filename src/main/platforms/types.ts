import type { Account, MetricsSnapshot, Media, PlatformInfo, Post, PostTarget } from '@shared/types'

export interface PublishRequest {
  account: Account
  post: Post
  target: PostTarget
  /** Media in the order chosen by the user, with absolute file paths. */
  media: Media[]
}

export interface PublishResult {
  remoteId: string
  remoteUrl: string | null
}

/** Thrown by drivers when a failure should not be retried automatically (bad credentials, rejected content...). */
export class PermanentPublishError extends Error {}

/**
 * Everything the app needs from a social network. A platform integration implements this once;
 * the scheduler, composer and analytics never talk to a network directly.
 */
export interface PlatformDriver {
  publish(req: PublishRequest): Promise<PublishResult>
  fetchPostMetrics(req: { account: Account; target: PostTarget; asOf: Date }): Promise<MetricsSnapshot>
  fetchAccountMetrics(req: { account: Account; asOf: Date }): Promise<{ followers: number }>
}

/**
 * A platform plugin: static description (shown in the UI and used for validation) plus an optional
 * live driver. Until a live driver exists, only demo accounts can be added for the platform.
 */
export interface PlatformProvider {
  info: PlatformInfo
  createLiveDriver?: () => PlatformDriver
}
