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

/** Developer credentials the user creates once per platform (e.g. a Google OAuth client). */
export interface AppCredentials {
  clientId: string
  clientSecret: string
}

/** What a successful sign-in returns. Tokens are stored encrypted, keyed by the new account id. */
export interface LiveConnection {
  /** Stable id on the platform (e.g. YouTube channel id), used to recognise a reconnect. */
  remoteId: string
  displayName: string
  handle: string
  tokens: { accessToken: string; refreshToken: string; expiresAt: number }
}

/**
 * A platform plugin: static description (shown in the UI and used for validation) plus an optional
 * live driver and sign-in flow. Without them, only demo accounts can be added for the platform.
 */
export interface PlatformProvider {
  info: PlatformInfo
  createLiveDriver?: () => PlatformDriver
  /** Runs the sign-in flow (usually in the browser) and resolves with the connected account's identity. */
  connect?: (creds: AppCredentials) => Promise<LiveConnection>
}
