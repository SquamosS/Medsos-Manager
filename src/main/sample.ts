import { getDb, tx } from './db'
import { demoFollowers, demoPostMetrics } from './platforms/demo'
import { listPlatforms } from './platforms/registry'
import { addDemoAccount, listAccounts, removeAccount } from './store/accounts'
import { addDays, localDay, newId, nowIso } from './util'

const TITLES = [
  '5 editing tricks that save hours',
  'Behind the scenes of my setup',
  'Day in my life as a creator',
  'Quick tip: better lighting on a budget',
  'How I plan a week of content',
  'Reacting to your comments',
  'Morning routine, no filters',
  'Gear I actually use every day',
  'Mistakes I made in my first year',
  'Q&A: your questions answered',
  'Simple storytelling formula',
  'Trying a viral trend (honest review)',
  'Studio tour 2026',
  'Three habits that grew my channel',
  'What I wish I knew sooner'
]
const TAGS = ['creator', 'tips', 'behindthescenes', 'howto', 'dayinthelife', 'contentcreation']

/** Deterministic-enough pseudo random in [0,1) for building sample data. */
const rnd = (): number => Math.random()
const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]

/**
 * Creates demo accounts (one per platform if missing) plus a believable history of published,
 * scheduled and draft posts. Everything hangs off demo accounts so it can be removed in one go.
 */
export function loadSampleData(): void {
  const db = getDb()
  const now = new Date()
  tx(() => {
    const accounts = listAccounts().filter((a) => a.mode === 'demo')
    for (const p of listPlatforms()) {
      if (!accounts.some((a) => a.platform === p.id)) {
        accounts.push(addDemoAccount(p.id, `Sample ${p.name}`, addDays(now, -60).toISOString()))
      }
    }

    const insertPost = db.prepare(
      `INSERT INTO posts (id, format, title, description, hashtags, media_ids, status, scheduled_at, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?)`
    )
    const insertTarget = db.prepare(
      `INSERT INTO post_targets (id, post_id, account_id, platform, title, description, hashtags, customized, options, status, attempts, remote_id, error, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, '{}', ?, ?, ?, ?, ?)`
    )
    const insertSnap = db.prepare(
      `INSERT OR REPLACE INTO metric_snapshots (target_id, day, views, likes, comments, shares, saves, watch_time_sec) VALUES (?,?,?,?,?,?,?,?)`
    )
    const insertFollowers = db.prepare(`INSERT OR REPLACE INTO account_metrics (account_id, day, followers) VALUES (?,?,?)`)

    const addPost = (opts: {
      when: Date
      status: 'published' | 'scheduled' | 'draft' | 'failed'
      accountsFor: typeof accounts
    }): void => {
      const title = pick(TITLES)
      const tags = JSON.stringify([pick(TAGS), pick(TAGS)])
      const postId = newId()
      const whenIso = opts.when.toISOString()
      const status = opts.status
      insertPost.run(
        postId,
        'short_video',
        title,
        'Sample post created by "Load sample data".',
        status,
        status === 'draft' ? null : whenIso,
        status === 'scheduled' ? whenIso : null,
        nowIso(),
        nowIso()
      )
      for (const account of opts.accountsFor) {
        const targetId = newId()
        const published = status === 'published'
        const failed = status === 'failed'
        insertTarget.run(
          targetId,
          postId,
          account.id,
          account.platform,
          title,
          'Sample post created by "Load sample data".',
          tags,
          published ? 'published' : failed ? 'failed' : 'pending',
          failed ? 3 : 0,
          published ? `demo_${targetId.slice(0, 8)}` : null,
          failed ? 'Sample failure: the platform rejected the upload.' : null,
          published ? whenIso : null
        )
        if (published) {
          for (let d = new Date(opts.when); d <= now; d = addDays(d, 1)) {
            const asOf = d > now ? now : d
            const m = demoPostMetrics(targetId, account.platform, opts.when, asOf)
            insertSnap.run(targetId, localDay(d), m.views, m.likes, m.comments, m.shares, m.saves, m.watchTimeSec)
          }
          const m = demoPostMetrics(targetId, account.platform, opts.when, now)
          insertSnap.run(targetId, localDay(now), m.views, m.likes, m.comments, m.shares, m.saves, m.watchTimeSec)
        }
      }
    }

    // ~34 published posts across the last 55 days, each on 1–3 platforms, at varied times.
    for (let i = 0; i < 34; i++) {
      const when = addDays(now, -(2 + Math.floor(rnd() * 53)))
      when.setHours(pick([7, 9, 12, 12, 15, 18, 19, 20, 20, 21, 22, 2]), pick([0, 15, 30, 45]), 0, 0)
      const count = 1 + Math.floor(rnd() * 3)
      addPost({ when, status: 'published', accountsFor: [...accounts].sort(() => rnd() - 0.5).slice(0, count) })
    }
    // A few upcoming scheduled posts and some drafts so the calendar is not empty.
    for (let i = 1; i <= 5; i++) {
      const when = addDays(now, i * 2)
      when.setHours(pick([12, 18, 20]), 0, 0, 0)
      addPost({ when, status: 'scheduled', accountsFor: [...accounts].sort(() => rnd() - 0.5).slice(0, 2) })
    }
    addPost({ when: addDays(now, 3), status: 'draft', accountsFor: accounts.slice(0, 1) })
    addPost({ when: addDays(now, 6), status: 'draft', accountsFor: accounts.slice(0, 2) })
    const failedWhen = addDays(now, -1)
    failedWhen.setHours(18, 0, 0, 0)
    addPost({ when: failedWhen, status: 'failed', accountsFor: accounts.slice(0, 1) })

    // Follower history for every demo account.
    for (const account of accounts) {
      for (let i = 55; i >= 0; i--) {
        const day = addDays(now, -i)
        insertFollowers.run(account.id, localDay(day), demoFollowers(account.id, new Date(account.createdAt), day))
      }
    }
  })
}

/** Deletes every demo account together with the posts and metrics that belong to them. */
export function clearSampleData(): void {
  for (const account of listAccounts()) {
    if (account.mode === 'demo') removeAccount(account.id)
  }
}
