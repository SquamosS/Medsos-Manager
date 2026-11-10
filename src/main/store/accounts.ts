import type { Account, AccountMode, AccountStatus } from '@shared/types'
import { getDb, tx } from '../db'
import { getPlatform } from '../platforms/registry'
import type { LiveConnection } from '../platforms/types'
import { accountTokensKey, deleteSecret, setSecret } from '../secrets'
import { newId, nowIso } from '../util'

interface AccountRow {
  id: string
  platform: string
  display_name: string
  handle: string
  mode: string
  status: string
  created_at: string
  remote_id: string | null
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  remoteId: r.remote_id ?? null,
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

export function setAccountStatus(id: string, status: AccountStatus): void {
  getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, id)
}

/**
 * Adds a signed-in account, or refreshes it when the same remote account (e.g. the same YouTube
 * channel) is connected again. Tokens are stored encrypted, never in the accounts table.
 */
export function upsertLiveAccount(platform: string, conn: LiveConnection): Account {
  getPlatform(platform)
  const db = getDb()
  const existing = db.prepare("SELECT id FROM accounts WHERE platform = ? AND mode = 'live' AND remote_id = ?").get(platform, conn.remoteId) as unknown as
    | { id: string }
    | undefined
  const id = existing?.id ?? newId()
  tx(() => {
    if (existing) {
      db.prepare("UPDATE accounts SET display_name = ?, handle = ?, status = 'connected' WHERE id = ?").run(conn.displayName, conn.handle, id)
    } else {
      db.prepare(
        `INSERT INTO accounts (id, platform, display_name, handle, mode, status, created_at, remote_id)
         VALUES (?, ?, ?, ?, 'live', 'connected', ?, ?)`
      ).run(id, platform, conn.displayName, conn.handle, nowIso(), conn.remoteId)
    }
    setSecret(accountTokensKey(id), conn.tokens)
  })
  return getAccount(id) as Account
}

/** Removes an account and its post targets. Posts left with no targets are deleted too. */
export function removeAccount(id: string): void {
  const db = getDb()
  tx(() => {
    deleteSecret(accountTokensKey(id))
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
