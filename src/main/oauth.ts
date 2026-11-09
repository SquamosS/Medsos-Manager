import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { BrowserWindow, shell } from 'electron'

/**
 * Generic OAuth 2.0 "installed app" flow (authorization code + PKCE over a loopback redirect).
 * Platform files only provide endpoints, scopes and credentials; nothing here is YouTube specific.
 */

export interface OAuthConfig {
  authUrl: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  scopes: string[]
  /** Extra query parameters for the consent URL (e.g. access_type=offline). */
  authParams?: Record<string, string>
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  /** Epoch ms. */
  expiresAt: number
}

/** The refresh token was rejected: the user must sign in again. */
export class AuthExpiredError extends Error {}

const LOGIN_TIMEOUT_MS = 5 * 60_000
let cancelCurrent: (() => void) | null = null

export function cancelOAuth(): void {
  cancelCurrent?.()
}

const b64url = (b: Buffer): string => b.toString('base64url')

const PAGE = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Medsos Manager</title>
<body style="font-family:Segoe UI,system-ui,sans-serif;background:#0e1016;color:#e8eaf0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center;max-width:420px;padding:24px"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#8d94a9;margin:0">${body}</p></div>`

function waitForCode(cfg: OAuthConfig, challenge: string, state: string): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let server: Server | null = null
    let timer: NodeJS.Timeout | null = null
    let done = false

    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      cancelCurrent = null
      server?.close()
      server?.closeAllConnections()
      fn()
    }

    cancelCurrent = () => finish(() => reject(new Error('Sign-in was cancelled.')))
    timer = setTimeout(() => finish(() => reject(new Error('Sign-in timed out. Please try again.'))), LOGIN_TIMEOUT_MS)

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const html = (status: number, title: string, body: string): void => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE(title, body))
      }
      if (error) {
        html(400, 'Sign-in failed', 'You can close this tab and go back to Medsos Manager.')
        finish(() => reject(new Error(error === 'access_denied' ? 'Access was denied in the browser.' : `Sign-in failed: ${error}`)))
      } else if (code && url.searchParams.get('state') === state) {
        html(200, 'Connected', 'You can close this tab and go back to Medsos Manager.')
        const redirectUri = `http://127.0.0.1:${(server?.address() as { port: number }).port}`
        finish(() => resolve({ code, redirectUri }))
      } else {
        html(400, 'Unexpected request', 'This link is not valid. Start the sign-in again from Medsos Manager.')
      }
    })

    server.on('error', (e) => finish(() => reject(e)))
    server.listen(0, '127.0.0.1', () => {
      const port = (server?.address() as { port: number }).port
      const redirectUri = `http://127.0.0.1:${port}`
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: cfg.scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...cfg.authParams
      })
      void shell.openExternal(`${cfg.authUrl}?${params}`).catch((e) => finish(() => reject(e)))
    })
  })
}

async function tokenRequest(cfg: OAuthConfig, body: Record<string, string>): Promise<OAuthTokens> {
  const form = new URLSearchParams({ client_id: cfg.clientId, ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}), ...body })
  let res: Response
  try {
    res = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
  } catch (e) {
    throw new Error(`Could not reach the sign-in server: ${e instanceof Error ? e.message : String(e)}`)
  }
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') throw new AuthExpiredError(json.error_description ?? 'The sign-in is no longer valid.')
    throw new Error(json.error_description ?? json.error ?? `Sign-in server answered ${res.status}`)
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000
  }
}

/** Opens the system browser, waits for the user to approve, and returns the tokens. */
export async function runOAuth(cfg: OAuthConfig): Promise<OAuthTokens> {
  cancelOAuth()
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  try {
    const { code, redirectUri } = await waitForCode(cfg, challenge, state)
    return await tokenRequest(cfg, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
  } finally {
    // Bring the app back to the front once the browser step is over, whatever the outcome.
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  }
}

export function refreshAccessToken(cfg: OAuthConfig, refreshToken: string): Promise<OAuthTokens> {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken })
}
