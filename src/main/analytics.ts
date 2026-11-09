import type { AnalyticsQuery, AnalyticsSummary, PlatformStat, TopPost } from '@shared/types'
import { getDb } from './db'
import { driverFor, listPlatforms } from './platforms/registry'
import { getAccount, listAccounts } from './store/accounts'
import { listPosts } from './store/posts'
import { getSetting, setSetting } from './store/settings'
import { addDays, errorMessage, localDay, nowIso } from './util'

/** Pulls fresh numbers from every connected account and stores today's snapshot. */
export async function syncAnalytics(): Promise<{ updated: number }> {
  const db = getDb()
  const today = localDay(new Date())
  const asOf = new Date()
  let updated = 0

  const upsertSnap = db.prepare(
    `INSERT INTO metric_snapshots (target_id, day, views, likes, comments, shares, saves, watch_time_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(target_id, day) DO UPDATE SET views=excluded.views, likes=excluded.likes, comments=excluded.comments,
       shares=excluded.shares, saves=excluded.saves, watch_time_sec=excluded.watch_time_sec`
  )
  const upsertFollowers = db.prepare(
    `INSERT INTO account_metrics (account_id, day, followers) VALUES (?, ?, ?)
     ON CONFLICT(account_id, day) DO UPDATE SET followers=excluded.followers`
  )

  for (const post of listPosts()) {
    for (const target of post.targets) {
      if (target.status !== 'published') continue
      const account = getAccount(target.accountId)
      if (!account) continue
      try {
        const m = await driverFor(account).fetchPostMetrics({ account, target, asOf })
        upsertSnap.run(target.id, today, m.views, m.likes, m.comments, m.shares, m.saves, m.watchTimeSec)
        updated++
      } catch (e) {
        console.warn(`[analytics] post metrics failed for ${target.id}: ${errorMessage(e)}`)
      }
    }
  }
  for (const account of listAccounts()) {
    try {
      const { followers } = await driverFor(account).fetchAccountMetrics({ account, asOf })
      upsertFollowers.run(account.id, today, followers)
      updated++
    } catch (e) {
      console.warn(`[analytics] account metrics failed for ${account.id}: ${errorMessage(e)}`)
    }
  }
  setSetting('lastSyncAt', nowIso())
  return { updated }
}

interface DeltaRow {
  day: string
  platform: string
  views: number
  likes: number
  comments: number
  shares: number
}

interface LatestRow {
  target_id: string
  post_id: string
  platform: string
  title: string
  published_at: string
  views: number
  likes: number
  comments: number
  shares: number
}

const engagement = (likes: number, comments: number, shares: number, views: number): number =>
  views > 0 ? (likes + comments + shares) / views : 0

export function getSummary(q: AnalyticsQuery): AnalyticsSummary {
  const db = getDb()
  const days = Math.max(1, Math.min(365, Math.round(q.days)))
  const today = new Date()
  const dates: string[] = []
  for (let i = days - 1; i >= 0; i--) dates.push(localDay(addDays(today, -i)))
  const startDay = dates[0]
  const pf = q.platform ? 'AND t.platform = ?' : ''
  const pfArgs = q.platform ? [q.platform] : []

  // Daily growth per platform = difference between consecutive snapshots of each post.
  const deltas = db
    .prepare(
      `SELECT day, platform, SUM(MAX(dv,0)) AS views, SUM(MAX(dl,0)) AS likes, SUM(MAX(dc,0)) AS comments, SUM(MAX(ds,0)) AS shares
       FROM (
         SELECT s.day AS day, t.platform AS platform,
           s.views    - COALESCE(LAG(s.views)    OVER w, 0) AS dv,
           s.likes    - COALESCE(LAG(s.likes)    OVER w, 0) AS dl,
           s.comments - COALESCE(LAG(s.comments) OVER w, 0) AS dc,
           s.shares   - COALESCE(LAG(s.shares)   OVER w, 0) AS ds
         FROM metric_snapshots s JOIN post_targets t ON t.id = s.target_id
         WHERE 1=1 ${pf}
         WINDOW w AS (PARTITION BY s.target_id ORDER BY s.day)
       ) WHERE day >= ? GROUP BY day, platform`
    )
    .all(...pfArgs, startDay) as unknown as DeltaRow[]

  const platformIds = listPlatforms().map((p) => p.id).filter((id) => !q.platform || id === q.platform)
  const emptyByPlatform = (): Record<string, number> => Object.fromEntries(platformIds.map((id) => [id, 0]))

  const dailyMap = new Map<string, Record<string, number>>(dates.map((d) => [d, emptyByPlatform()]))
  const totalsByPlatform = new Map<string, { views: number; likes: number; comments: number; shares: number }>(
    platformIds.map((id) => [id, { views: 0, likes: 0, comments: 0, shares: 0 }])
  )
  for (const r of deltas) {
    const bucket = dailyMap.get(r.day)
    if (bucket) bucket[r.platform] = (bucket[r.platform] ?? 0) + r.views
    const t = totalsByPlatform.get(r.platform)
    if (t) {
      t.views += r.views
      t.likes += r.likes
      t.comments += r.comments
      t.shares += r.shares
    }
  }

  // Followers: carry the last known value forward for each account.
  const accounts = listAccounts().filter((a) => !q.platform || a.platform === q.platform)
  const followerRows = db
    .prepare('SELECT account_id, day, followers FROM account_metrics ORDER BY day')
    .all() as unknown as { account_id: string; day: string; followers: number }[]
  const byAccount = new Map<string, { day: string; followers: number }[]>()
  for (const r of followerRows) {
    const list = byAccount.get(r.account_id) ?? []
    list.push({ day: r.day, followers: r.followers })
    byAccount.set(r.account_id, list)
  }
  const valueOn = (accountId: string, day: string): number | null => {
    const list = byAccount.get(accountId) ?? []
    let v: number | null = null
    for (const p of list) {
      if (p.day <= day) v = p.followers
      else break
    }
    return v
  }
  const followersDaily = dates.map((date) => {
    const byPlatform = emptyByPlatform()
    for (const a of accounts) byPlatform[a.platform] = (byPlatform[a.platform] ?? 0) + (valueOn(a.id, date) ?? 0)
    return { date, byPlatform }
  })
  const followersByPlatform = new Map<string, number>()
  let followersNow = 0
  let followersStart = 0
  for (const a of accounts) {
    const list = byAccount.get(a.id) ?? []
    const latest = list.length ? list[list.length - 1].followers : 0
    followersNow += latest
    followersByPlatform.set(a.platform, (followersByPlatform.get(a.platform) ?? 0) + latest)
    followersStart += valueOn(a.id, startDay) ?? list.find((p) => p.day >= startDay)?.followers ?? latest
  }

  // Latest snapshot per published target, for the top-posts table and best-times grid.
  const latest = db
    .prepare(
      `SELECT t.id AS target_id, t.post_id, t.platform, COALESCE(NULLIF(t.title,''), NULLIF(p.title,''), substr(t.description,1,60), 'Untitled') AS title,
              t.published_at, s.views, s.likes, s.comments, s.shares
       FROM post_targets t
       JOIN posts p ON p.id = t.post_id
       JOIN metric_snapshots s ON s.target_id = t.id
        AND s.day = (SELECT MAX(day) FROM metric_snapshots WHERE target_id = t.id)
       WHERE t.status = 'published' AND t.published_at IS NOT NULL ${pf}`
    )
    .all(...pfArgs) as unknown as LatestRow[]

  const windowStart = new Date(`${startDay}T00:00:00`)
  const inWindow = latest.filter((r) => new Date(r.published_at) >= windowStart)
  const postsByPlatform = new Map<string, number>()
  for (const r of inWindow) postsByPlatform.set(r.platform, (postsByPlatform.get(r.platform) ?? 0) + 1)

  const topPosts: TopPost[] = [...inWindow]
    .sort((a, b) => b.views - a.views)
    .slice(0, 8)
    .map((r) => ({
      targetId: r.target_id,
      postId: r.post_id,
      title: r.title,
      platform: r.platform,
      publishedAt: r.published_at,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      engagementRate: engagement(r.likes, r.comments, r.shares, r.views)
    }))

  const platforms: PlatformStat[] = platformIds.map((id) => {
    const t = totalsByPlatform.get(id)!
    return {
      platform: id,
      ...t,
      followers: followersByPlatform.get(id) ?? 0,
      posts: postsByPlatform.get(id) ?? 0,
      engagementRate: engagement(t.likes, t.comments, t.shares, t.views)
    }
  })

  const sum = (f: (p: PlatformStat) => number): number => platforms.reduce((n, p) => n + f(p), 0)
  const totals = {
    views: sum((p) => p.views),
    likes: sum((p) => p.likes),
    comments: sum((p) => p.comments),
    shares: sum((p) => p.shares),
    followers: followersNow,
    followersDelta: followersNow - followersStart,
    posts: sum((p) => p.posts),
    engagementRate: 0
  }
  totals.engagementRate = engagement(totals.likes, totals.comments, totals.shares, totals.views)

  // Best time to post: average views per (weekday, 3-hour block), using posts old enough to have settled.
  const settledBefore = Date.now() - 3 * 86_400_000
  const settled = latest.filter((r) => Date.parse(r.published_at) <= settledBefore)
  const sums: number[][] = Array.from({ length: 7 }, () => new Array(8).fill(0))
  const counts: number[][] = Array.from({ length: 7 }, () => new Array(8).fill(0))
  for (const r of settled) {
    const d = new Date(r.published_at)
    const wd = (d.getDay() + 6) % 7
    const bucket = Math.floor(d.getHours() / 3)
    sums[wd][bucket] += r.views
    counts[wd][bucket] += 1
  }
  const grid = sums.map((row, wd) => row.map((v, b) => (counts[wd][b] ? Math.round(v / counts[wd][b]) : null)))
  const suggestions: { weekday: number; hour: number; score: number }[] = []
  if (settled.length >= 8) {
    for (let wd = 0; wd < 7; wd++) {
      for (let b = 0; b < 8; b++) {
        const score = grid[wd][b]
        if (score !== null) suggestions.push({ weekday: wd, hour: b * 3 + 1, score })
      }
    }
    suggestions.sort((a, b) => b.score - a.score)
    suggestions.length = Math.min(suggestions.length, 3)
  }

  return {
    days,
    totals,
    daily: dates.map((date) => ({ date, byPlatform: dailyMap.get(date)! })),
    followersDaily,
    platforms,
    topPosts,
    bestTimes: { grid, suggestions, sampleSize: settled.length },
    hasDemoData: listAccounts().some((a) => a.mode === 'demo'),
    lastSyncAt: getSetting<string | null>('lastSyncAt', null)
  }
}

