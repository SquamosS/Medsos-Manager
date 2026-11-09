import type { Account, MetricsSnapshot, PlatformInfo } from '@shared/types'
import type { PlatformDriver } from './types'

/** Small deterministic PRNG so demo numbers stay stable between syncs. */
function fnv(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PLATFORM_REACH: Record<string, number> = { tiktok: 3, instagram: 1.4, youtube: 1 }

/**
 * Synthetic metrics. Posts published in the evening and on weekends get a boost so the
 * "best time to post" view has something to show. Never used for live accounts.
 */
export function demoPostMetrics(
  targetId: string,
  platform: string,
  publishedAt: Date,
  asOf: Date
): MetricsSnapshot {
  const rand = mulberry32(fnv(targetId))
  const hour = publishedAt.getHours()
  const hourBoost = hour >= 18 && hour <= 21 ? 1.6 : hour >= 11 && hour <= 13 ? 1.2 : hour < 6 ? 0.55 : 1
  const weekend = [0, 6].includes(publishedAt.getDay()) ? 1.25 : 1
  const base = (800 + rand() * 18000) * (PLATFORM_REACH[platform] ?? 1) * hourBoost * weekend
  const ageDays = Math.max(0, (asOf.getTime() - publishedAt.getTime()) / 86_400_000)
  const views = Math.floor(base * (1 - Math.exp(-ageDays / 4)))
  return {
    views,
    likes: Math.floor(views * (0.04 + rand() * 0.05)),
    comments: Math.floor(views * (0.002 + rand() * 0.004)),
    shares: Math.floor(views * (0.003 + rand() * 0.01)),
    saves: Math.floor(views * (0.005 + rand() * 0.01)),
    watchTimeSec: platform === 'youtube' ? Math.floor(views * (20 + rand() * 100)) : null
  }
}

export function demoFollowers(accountId: string, createdAt: Date, asOf: Date): number {
  const rand = mulberry32(fnv(accountId))
  const start = 900 + Math.floor(rand() * 9000)
  const perDay = 4 + rand() * 30
  const days = Math.max(0, (asOf.getTime() - createdAt.getTime()) / 86_400_000)
  const wobble = Math.sin(days * 1.7 + start) * perDay * 2
  return Math.max(0, Math.floor(start + perDay * days + wobble))
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Driver for demo accounts: pretends to publish and generates synthetic analytics. */
export function createDemoDriver(info: PlatformInfo): PlatformDriver {
  return {
    async publish({ target }) {
      await sleep(1200)
      const remoteId = `demo_${info.id}_${target.id.slice(0, 8)}`
      return { remoteId, remoteUrl: null }
    },
    async fetchPostMetrics({ target, asOf }) {
      const published = target.publishedAt ? new Date(target.publishedAt) : asOf
      return demoPostMetrics(target.id, info.id, published, asOf)
    },
    async fetchAccountMetrics({ account, asOf }: { account: Account; asOf: Date }) {
      return { followers: demoFollowers(account.id, new Date(account.createdAt), asOf) }
    }
  }
}
