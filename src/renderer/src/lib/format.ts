import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday } from 'date-fns'
import type { PostStatus, TargetStatus } from '@shared/types'

export const fmtNumber = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('en-US')

export const fmtPercent = (x: number): string => `${(x * 100).toFixed(1)}%`

export function fmtDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** "Today, 18:30", "Tomorrow, 09:00" or "12 Nov, 18:30". */
export function fmtWhen(iso: string | null): string {
  if (!iso) return 'No date'
  const d = new Date(iso)
  const time = format(d, 'HH:mm')
  if (isToday(d)) return `Today, ${time}`
  if (isTomorrow(d)) return `Tomorrow, ${time}`
  if (isYesterday(d)) return `Yesterday, ${time}`
  return `${format(d, d.getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yyyy')}, ${time}`
}

export const fmtRelative = (iso: string): string => formatDistanceToNowStrict(new Date(iso), { addSuffix: true })

/** Value for <input type="datetime-local"> in the user's timezone. */
export const toLocalInput = (iso: string | null): string => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '')
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null)

export const STATUS_LABEL: Record<PostStatus | TargetStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  publishing: 'Publishing…',
  published: 'Published',
  partial: 'Partly published',
  failed: 'Failed',
  missed: 'Missed',
  pending: 'Pending'
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
