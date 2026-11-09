import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { app } from 'electron'
import type { AppSettings, McpInfo } from '@shared/types'
import { getSecret, setSecret } from '../secrets'
import { buildTools } from './tools'

/**
 * Local MCP server. It lets an AI assistant such as Claude Code operate the app (schedule posts, read
 * analytics) while the app is running. Security model:
 *  - off unless the user switches it on in Settings;
 *  - bound to 127.0.0.1 only, so nothing outside this PC can reach it;
 *  - every request needs a secret bearer token, and requests carrying a browser Origin or an unexpected
 *    Host header are refused (blocks web pages and DNS-rebinding from talking to it);
 *  - the assistant cannot publish to real accounts unless the user explicitly allows it.
 */

const TOKEN_KEY = 'mcp:token'
const MAX_BODY = 2 * 1024 * 1024

interface State {
  server: Server | null
  port: number
  error: string | null
}
const state: State = { server: null, port: 0, error: null }

function getToken(): string {
  const existing = getSecret<string>(TOKEN_KEY)
  if (existing) return existing
  const token = randomBytes(32).toString('hex')
  setSecret(TOKEN_KEY, token)
  return token
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest()
const tokensMatch = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b))

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  // Rejected requests never read their body, so don't keep that connection alive for reuse.
  const close = status >= 400 ? { connection: 'close' } : {}
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...close, ...headers })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Request too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined)
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'medsos-manager', version: app.getVersion() },
    {
      instructions: [
        'Medsos Manager is a desktop app for scheduling and analysing short-video posts (YouTube, Instagram, TikTok).',
        'Start with get_overview, then list_accounts / list_media. To post: import_media (absolute file paths on this PC) → check_post → save_post.',
        'Times are ISO 8601 with a UTC offset, e.g. 2026-11-12T19:00:00+07:00. get_overview returns the user’s current local time and time zone.',
        'Accounts in "demo" mode are simulated and always safe. Accounts in "live" mode are real: by default you can only save drafts for them and the user schedules/publishes in the app. save_post tells you when that happened.',
        'Never publish to live accounts unless the user clearly asked for it in this conversation.'
      ].join('\n')
    }
  )
  buildTools(server)
  return server
}

async function handle(req: IncomingMessage, res: ServerResponse, port: number, token: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/mcp') return reply(res, 404, { error: 'Not found' })

  const host = (req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(res, 403, { error: 'Forbidden host' })
  if (req.headers.origin) return reply(res, 403, { error: 'Browser requests are not allowed' })

  const auth = req.headers.authorization ?? ''
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!given || !tokensMatch(given, token)) {
    return reply(res, 401, { error: 'Missing or wrong token' }, { 'www-authenticate': 'Bearer' })
  }
  // Stateless mode has no standalone event stream, so only POST is meaningful.
  if (req.method !== 'POST') return reply(res, 405, { error: 'Use POST' }, { allow: 'POST' })

  let body: unknown
  try {
    body = await readBody(req)
  } catch (e) {
    return reply(res, 400, { error: e instanceof Error ? e.message : 'Bad request' })
  }

  const server = buildServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

export async function stopMcp(): Promise<void> {
  const server = state.server
  state.server = null
  if (!server) return
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

export async function startMcp(port: number): Promise<void> {
  await stopMcp()
  state.error = null
  state.port = port
  const token = getToken()
  const server = createServer((req, res) => {
    handle(req, res, port, token).catch((e) => {
      reply(res, 500, { error: e instanceof Error ? e.message : 'Server error' })
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    state.server = server
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    state.error =
      code === 'EADDRINUSE'
        ? `Port ${port} is already used by another program. Pick a different port.`
        : `Could not start the assistant connection: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** Starts, stops or restarts the server so it matches the settings. */
export async function syncMcp(next: AppSettings, prev?: AppSettings): Promise<void> {
  const running = state.server !== null
  if (!next.mcpEnabled) {
    state.error = null
    if (running) await stopMcp()
    return
  }
  if (!running || !prev || prev.mcpEnabled !== next.mcpEnabled || prev.mcpPort !== next.mcpPort || state.port !== next.mcpPort) {
    await startMcp(next.mcpPort)
  }
}

export function mcpInfo(settings: AppSettings): McpInfo {
  return {
    enabled: settings.mcpEnabled,
    running: state.server !== null,
    url: `http://127.0.0.1:${settings.mcpPort}/mcp`,
    token: getToken(),
    error: state.error
  }
}

export async function regenerateMcpToken(settings: AppSettings): Promise<McpInfo> {
  setSecret(TOKEN_KEY, randomBytes(32).toString('hex'))
  // The running server captured the old token, so restart it.
  if (settings.mcpEnabled) await startMcp(settings.mcpPort)
  return mcpInfo(settings)
}
