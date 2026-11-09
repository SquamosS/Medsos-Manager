import { BookOpen, ExternalLink, LogIn, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PlatformInfo } from '@shared/types'
import { PlatformIcon } from '@/components/PlatformIcon'
import { Badge, Button, Card, Field, IconButton, Modal, PageHeader, Spinner, inputClass } from '@/components/ui'
import { call, useAccounts } from '@/lib/api'
import { usePlatformCtx } from '@/lib/platforms'
import { attempt, useApp } from '@/lib/store'

/** Sign-in dialog: asks for developer credentials once, then hands over to the browser. */
function ConnectModal({ platform, onClose, onOpenGuide }: { platform: PlatformInfo | null; onClose: () => void; onOpenGuide: (p: PlatformInfo) => void }): React.JSX.Element {
  const [status, setStatus] = useState<{ configured: boolean; clientId: string | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useApp((s) => s.toast)

  useEffect(() => {
    if (!platform) return
    setStatus(null)
    setEditing(false)
    setClientId('')
    setClientSecret('')
    setError(null)
    setWaiting(false)
    call('credentials:status', platform.id).then(setStatus, (e: Error) => setError(e.message))
  }, [platform])

  const close = (): void => {
    if (waiting) void call('accounts:cancelConnect')
    onClose()
  }

  const signIn = async (): Promise<void> => {
    if (!platform) return
    setError(null)
    setWaiting(true)
    try {
      if (!status?.configured || editing) {
        await call('credentials:save', platform.id, clientId, clientSecret)
      }
      const account = await call('accounts:connect', platform.id)
      toast(`${account.displayName} connected`, 'success')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWaiting(false)
    }
  }

  const needsCredentials = status !== null && (!status.configured || editing)

  return (
    <Modal
      open={platform !== null}
      onClose={close}
      title={`Connect ${platform?.name ?? ''}`}
      width={520}
      footer={
        <>
          <Button onClick={close}>{waiting ? 'Cancel sign-in' : 'Close'}</Button>
          <Button
            variant="primary"
            icon={<LogIn size={15} />}
            loading={waiting}
            disabled={status === null || (needsCredentials && (!clientId.trim() || !clientSecret.trim()))}
            onClick={() => void signIn()}
          >
            {needsCredentials ? 'Save and sign in' : 'Sign in'}
          </Button>
        </>
      }
    >
      {status === null ? (
        <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          {waiting ? (
            <p className="rounded-lg bg-accent-soft px-3 py-2.5 text-accent">Finish signing in in your browser. This window updates by itself when you are done.</p>
          ) : needsCredentials ? (
            <>
              <p className="text-muted">
                Paste the developer credentials you created for {platform?.name}. They are stored encrypted on this PC and never shown again.{' '}
                {platform && (
                  <button className="text-accent underline" onClick={() => onOpenGuide(platform)}>
                    Show the setup guide
                  </button>
                )}
              </p>
              <Field label="Client ID">
                <input autoFocus className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" spellCheck={false} />
              </Field>
              <Field label="Client Secret">
                <input className={inputClass} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-…" spellCheck={false} autoComplete="off" />
              </Field>
            </>
          ) : (
            <>
              <p className="text-muted">
                Your browser opens so you can choose the {platform?.name} account and approve access. Medsos Manager never sees your password.
              </p>
              <p className="text-xs text-muted">
                Using credentials for <span className="text-fg">{status.clientId}</span>.{' '}
                <button className="text-accent underline" onClick={() => setEditing(true)}>
                  Change
                </button>
              </p>
            </>
          )}
          {error && <p className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-bad">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

export function Accounts(): React.JSX.Element {
  const { list: platforms } = usePlatformCtx()
  const { data: accounts } = useAccounts()
  const [guide, setGuide] = useState<PlatformInfo | null>(null)
  const [adding, setAdding] = useState<PlatformInfo | null>(null)
  const [connecting, setConnecting] = useState<PlatformInfo | null>(null)
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const livePlatforms = platforms.filter((p) => p.liveAvailable)
  const pendingPlatforms = platforms.filter((p) => !p.liveAvailable)

  const addDemo = async (): Promise<void> => {
    if (!adding) return
    await attempt(() => call('accounts:addDemo', adding.id, name), 'Demo account added')
    setAdding(null)
    setName('')
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Connect the channels you publish to."
        actions={
          <Button icon={<Sparkles size={16} />} onClick={() => void attempt(() => call('sample:load'), 'Sample data loaded')}>
            Load sample data
          </Button>
        }
      />

      <Card className="mb-6 border-warn/40 bg-warn/5 p-4 text-sm">
        <strong className="text-warn">
          {livePlatforms.length > 0 ? `${livePlatforms.map((p) => p.name).join(', ')} can be connected for real.` : 'Live connections are not enabled yet.'}
        </strong>{' '}
        <span className="text-muted">
          {pendingPlatforms.length > 0 && <>{pendingPlatforms.map((p) => p.name).join(' and ')} {pendingPlatforms.length > 1 ? 'are' : 'is'} added in the next phases. </>}
          <b className="text-fg">Demo accounts</b> let you try the full workflow without posting anywhere: nothing is sent to a real platform and their numbers are simulated.
        </span>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        {platforms.map((p) => {
          const mine = (accounts ?? []).filter((a) => a.platform === p.id)
          return (
            <Card key={p.id} className="flex flex-col p-5">
              <div className="mb-4 flex items-center gap-3">
                <PlatformIcon id={p.id} size={40} />
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-muted">{Object.keys(p.capabilities.formats).length} content formats</div>
                </div>
              </div>

              <div className="mb-4 min-h-[56px] space-y-1.5">
                {mine.length === 0 && <p className="text-sm text-muted">No account connected.</p>}
                {mine.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.displayName}</div>
                      <div className="truncate text-xs text-muted">{a.handle}</div>
                    </div>
                    {a.mode === 'demo' && <Badge tone="warn">Demo</Badge>}
                    {a.mode === 'live' && a.status === 'connected' && <Badge tone="accent">Live</Badge>}
                    {a.mode === 'live' && a.status !== 'connected' && (
                      <Button size="sm" variant="primary" onClick={() => setConnecting(p)} title="The sign-in expired. Sign in again to keep posting.">
                        Reconnect
                      </Button>
                    )}
                    <IconButton label={`Remove ${a.displayName}`} onClick={() => setRemoving(a.id)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                ))}
              </div>

              <div className="mt-auto flex flex-wrap gap-2">
                <Button size="sm" disabled={!p.liveAvailable} title={p.liveAvailable ? undefined : 'Coming in a later phase'} icon={<ExternalLink size={14} />} onClick={() => setConnecting(p)}>
                  Connect
                </Button>
                <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding(p)}>
                  Demo account
                </Button>
                <Button size="sm" variant="ghost" icon={<BookOpen size={14} />} onClick={() => setGuide(p)}>
                  Setup guide
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      <ConnectModal
        platform={connecting}
        onClose={() => setConnecting(null)}
        onOpenGuide={(p) => {
          setConnecting(null)
          setGuide(p)
        }}
      />

      <Modal
        open={adding !== null}
        onClose={() => setAdding(null)}
        title={`Add demo ${adding?.name ?? ''} account`}
        width={440}
        footer={
          <>
            <Button onClick={() => setAdding(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void addDemo()}>
              Add account
            </Button>
          </>
        }
      >
        <Field label="Account name" hint="Only used inside this app.">
          <input autoFocus className={inputClass} value={name} placeholder={`My ${adding?.name ?? ''} channel`} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addDemo()} />
        </Field>
      </Modal>

      <Modal
        open={guide !== null}
        onClose={() => setGuide(null)}
        title={guide?.setupGuide.title ?? ''}
        width={600}
        footer={<Button onClick={() => setGuide(null)}>Close</Button>}
      >
        {guide && (
          <div className="space-y-4 text-sm">
            <p className="text-muted">Everything below is free. These steps create the developer credentials the app will need for a real connection.</p>
            <ol className="space-y-3">
              {guide.setupGuide.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
            {guide.setupGuide.caveat && <div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-warn">{guide.setupGuide.caveat}</div>}
            <div className="flex flex-wrap gap-2">
              {guide.setupGuide.links.map((l) => (
                <Button key={l.url} size="sm" icon={<ExternalLink size={13} />} onClick={() => void attempt(() => call('app:openExternal', l.url))}>
                  {l.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove account?"
        width={440}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const id = removing as string
                setRemoving(null)
                void attempt(() => call('accounts:remove', id), 'Account removed')
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Posts and analytics for this account are deleted from Medsos Manager. Anything already published stays on the platform.
        </p>
      </Modal>
    </>
  )
}
