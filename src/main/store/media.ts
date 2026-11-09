import { existsSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Media, MediaKind, MediaMetaInput } from '@shared/types'
import { getDb, thumbsDir } from '../db'
import { newId, nowIso } from '../util'

interface MediaRow {
  id: string
  kind: string
  path: string
  filename: string
  size_bytes: number
  duration_sec: number | null
  width: number | null
  height: number | null
  has_thumb: number
  created_at: string
  used_count?: number
}

const toMedia = (r: MediaRow): Media => ({
  id: r.id,
  kind: r.kind as MediaKind,
  path: r.path,
  filename: r.filename,
  sizeBytes: r.size_bytes,
  durationSec: r.duration_sec,
  width: r.width,
  height: r.height,
  hasThumb: r.has_thumb === 1,
  missing: !existsSync(r.path),
  usedCount: r.used_count ?? 0,
  createdAt: r.created_at
})

const SELECT_MEDIA = `
  SELECT m.*, (SELECT COUNT(*) FROM posts p WHERE p.media_ids LIKE '%"' || m.id || '"%') AS used_count
  FROM media m`

export function listMedia(): Media[] {
  const rows = getDb().prepare(`${SELECT_MEDIA} ORDER BY m.created_at DESC`).all() as unknown as MediaRow[]
  return rows.map(toMedia)
}

export function getMediaByIds(ids: string[]): Media[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = getDb()
    .prepare(`${SELECT_MEDIA} WHERE m.id IN (${placeholders})`)
    .all(...ids) as unknown as MediaRow[]
  const byId = new Map(rows.map((r) => [r.id, toMedia(r)]))
  // Preserve the order the user chose (matters for carousels).
  return ids.map((id) => byId.get(id)).filter((m): m is Media => Boolean(m))
}

export function getMediaPath(id: string): string | null {
  const row = getDb().prepare('SELECT path FROM media WHERE id = ?').get(id) as unknown as { path: string } | undefined
  return row?.path ?? null
}

export function thumbPath(id: string): string {
  return join(thumbsDir(), `${id}.jpg`)
}

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

/** Adds files to the library. Already-imported paths are returned as they are; unsupported files are skipped. */
export function importMedia(paths: string[]): Media[] {
  const db = getDb()
  const ids: string[] = []
  for (const path of paths) {
    const ext = extname(path).toLowerCase()
    const kind: MediaKind | null = VIDEO_EXT.has(ext) ? 'video' : IMAGE_EXT.has(ext) ? 'image' : null
    if (!kind) continue
    const existing = db.prepare('SELECT id FROM media WHERE path = ?').get(path) as unknown as { id: string } | undefined
    if (existing) {
      ids.push(existing.id)
      continue
    }
    const id = newId()
    db.prepare(
      `INSERT INTO media (id, kind, path, filename, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, kind, path, basename(path), statSync(path).size, nowIso())
    ids.push(id)
  }
  return getMediaByIds(ids)
}

export function setMediaMeta(id: string, meta: MediaMetaInput): Media | null {
  let hasThumb = 0
  const match = meta.thumbDataUrl ? /^data:image\/\w+;base64,(.+)$/.exec(meta.thumbDataUrl) : null
  if (match) {
    writeFileSync(thumbPath(id), Buffer.from(match[1], 'base64'))
    hasThumb = 1
  }
  getDb()
    .prepare('UPDATE media SET duration_sec=?, width=?, height=?, has_thumb=? WHERE id=?')
    .run(meta.durationSec, meta.width, meta.height, hasThumb, id)
  return getMediaByIds([id])[0] ?? null
}

/** Removes the library entry (never the original file). Refuses if a queued post still needs it. */
export function removeMedia(id: string): void {
  const db = getDb()
  const queued = db
    .prepare(
      `SELECT COUNT(*) AS n FROM posts WHERE status IN ('scheduled','publishing') AND media_ids LIKE '%"' || ? || '"%'`
    )
    .get(id) as unknown as { n: number }
  if (queued.n > 0) {
    throw new Error(`This file is used by ${queued.n} scheduled post(s). Unschedule them first.`)
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(id)
  try {
    unlinkSync(thumbPath(id))
  } catch {
    /* thumbnail may not exist */
  }
}
