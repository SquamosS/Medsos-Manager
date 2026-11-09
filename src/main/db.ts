import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let db: DatabaseSync | null = null

export function dataDir(): string {
  return app.getPath('userData')
}

export function thumbsDir(): string {
  const dir = join(dataDir(), 'thumbs')
  mkdirSync(dir, { recursive: true })
  return dir
}

const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    display_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'demo',
    status TEXT NOT NULL DEFAULT 'connected',
    created_at TEXT NOT NULL
  );

  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    duration_sec REAL,
    width INTEGER,
    height INTEGER,
    has_thumb INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    format TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    hashtags TEXT NOT NULL DEFAULT '[]',
    media_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    scheduled_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_posts_due ON posts(status, next_run_at);

  CREATE TABLE post_targets (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    hashtags TEXT NOT NULL DEFAULT '[]',
    customized INTEGER NOT NULL DEFAULT 0,
    options TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    remote_id TEXT,
    remote_url TEXT,
    error TEXT,
    published_at TEXT
  );
  CREATE INDEX idx_targets_post ON post_targets(post_id);

  CREATE TABLE metric_snapshots (
    target_id TEXT NOT NULL REFERENCES post_targets(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    saves INTEGER NOT NULL DEFAULT 0,
    watch_time_sec REAL,
    PRIMARY KEY (target_id, day)
  );

  CREATE TABLE account_metrics (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    followers INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, day)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2 — live accounts: remote channel id + encrypted credential store
  `
  ALTER TABLE accounts ADD COLUMN remote_id TEXT;

  CREATE TABLE secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]

export function openDb(): DatabaseSync {
  if (db) return db
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const conn = new DatabaseSync(join(dir, 'medsos.db'))
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

  const row = conn.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    conn.exec('BEGIN')
    try {
      conn.exec(MIGRATIONS[v])
      conn.exec(`PRAGMA user_version = ${v + 1}`)
      conn.exec('COMMIT')
    } catch (e) {
      conn.exec('ROLLBACK')
      throw e
    }
  }
  db = conn
  return conn
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database is not open')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

/** Runs fn inside a transaction; rolls back if it throws. */
export function tx<T>(fn: () => T): T {
  const conn = getDb()
  conn.exec('BEGIN')
  try {
    const result = fn()
    conn.exec('COMMIT')
    return result
  } catch (e) {
    conn.exec('ROLLBACK')
    throw e
  }
}

export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
