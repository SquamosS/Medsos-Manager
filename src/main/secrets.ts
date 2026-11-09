import { safeStorage } from 'electron'
import { getDb } from './db'

/**
 * Encrypted key/value store for API credentials and OAuth tokens.
 * Values are encrypted with the OS keystore (Windows DPAPI), so the database file alone is not enough
 * to use them: they only decrypt for the same Windows user on the same machine.
 */

function assertAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system, so credentials cannot be saved safely.')
  }
}

export function setSecret(key: string, value: unknown): void {
  assertAvailable()
  const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64')
  getDb()
    .prepare('INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, encrypted)
}

export function getSecret<T>(key: string): T | null {
  const row = getDb().prepare('SELECT value FROM secrets WHERE key = ?').get(key) as unknown as { value: string } | undefined
  if (!row) return null
  try {
    assertAvailable()
    return JSON.parse(safeStorage.decryptString(Buffer.from(row.value, 'base64'))) as T
  } catch {
    return null
  }
}

export function hasSecret(key: string): boolean {
  return getDb().prepare('SELECT 1 AS x FROM secrets WHERE key = ?').get(key) !== undefined
}

export function deleteSecret(key: string): void {
  getDb().prepare('DELETE FROM secrets WHERE key = ?').run(key)
}

/** Keys, so the layout stays in one place. */
export const appCredentialsKey = (platform: string): string => `app:${platform}`
export const accountTokensKey = (accountId: string): string => `account:${accountId}`
