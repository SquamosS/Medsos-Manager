import type { Account, PlatformInfo } from '@shared/types'
import { createDemoDriver } from './demo'
import { instagram } from './instagram'
import { tiktok } from './tiktok'
import type { PlatformDriver, PlatformProvider } from './types'
import { youtube } from './youtube'

/**
 * To add a platform: create a file exporting a PlatformProvider (see youtube.ts) and add it here.
 * The UI, validation, scheduler and analytics pick it up automatically.
 */
const PROVIDERS: PlatformProvider[] = [youtube, instagram, tiktok].map((p) => ({
  ...p,
  info: { ...p.info, liveAvailable: Boolean(p.createLiveDriver) }
}))

const byId = new Map(PROVIDERS.map((p) => [p.info.id, p]))

export function listPlatforms(): PlatformInfo[] {
  return PROVIDERS.map((p) => p.info)
}

export function getPlatform(id: string): PlatformInfo {
  const p = byId.get(id)
  if (!p) throw new Error(`Unknown platform: ${id}`)
  return p.info
}

export function getProvider(id: string): PlatformProvider {
  const p = byId.get(id)
  if (!p) throw new Error(`Unknown platform: ${id}`)
  return p
}

export function driverFor(account: Account): PlatformDriver {
  const provider = byId.get(account.platform)
  if (!provider) throw new Error(`Unknown platform: ${account.platform}`)
  if (account.mode === 'demo') return createDemoDriver(provider.info)
  if (!provider.createLiveDriver) {
    throw new Error(`Live ${provider.info.name} publishing is not available yet.`)
  }
  return provider.createLiveDriver()
}
