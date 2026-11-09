import { randomUUID } from 'node:crypto'

export const newId = (): string => randomUUID()
export const nowIso = (): string => new Date().toISOString()

/** Local calendar day as YYYY-MM-DD (the user's timezone, not UTC). */
export function localDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))
