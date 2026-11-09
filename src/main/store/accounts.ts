import type { Account, AccountMode, AccountStatus } from '@shared/types'
import { getDb, tx } from '../db'
import { getPlatform } from '../platforms/registry'
import { newId, nowIso } from '../util'

interface AccountRow {
  id: string
  platform: string
  display_name: string
  handle: string
  mode: string
  status: string
  created_at: string
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  platform: r.platform,
  displayName: r.display_name,
  handle: r.handle,
  mode: r.mode as AccountMode,
  status: r.status as AccountStatus,
  createdAt: r.created_at
})

export function listAccounts(): Account[] {
  const rows = getDb().prepare('SELECT * FROM accounts ORDER BY created_at').all() as unknown as AccountRow[]
  return rows.map(toAccount)
}

export function getAccount(id: string): Account | null {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as AccountRow | undefined
  return row ? toAccount(row) : null
}

export function addDemoAccount(platform: string, displayName: string, createdAt = nowIso()): Account {
  getPlatform(platform) // throws on unknown platform
  const name = displayName.trim() || `Demo ${getPlatform(platform).name}`
  const handle = '@' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const id = newId()
  getDb()
    .prepare(
      `INSERT INTO accounts (id, platform, display_name, handle, mode, status, created_at)
       VALUES (?, ?, ?, ?, 'demo', 'connected', ?)`
    )
    .run(id, platform, name, handle, createdAt)
  return getAccount(id) as Account
}

/** Removes an account and its post targets. Posts left with no targets are deleted too. */
export function removeAccount(id: string): void {
  const db = getDb()
  tx(() => {
    const affected = db.prepare('SELECT DISTINCT post_id FROM post_targets WHERE account_id = ?').all(id) as unknown as {
      post_id: string
    }[]
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    const orphan = db.prepare('SELECT COUNT(*) AS n FROM post_targets WHERE post_id = ?')
    const del = db.prepare('DELETE FROM posts WHERE id = ?')
    for (const { post_id } of affected) {
      if ((orphan.get(post_id) as unknown as { n: number }).n === 0) del.run(post_id)
    }
  })
}
