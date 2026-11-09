import type { ReactNode } from 'react'
import type { AppSettings } from '@shared/types'
import { Button, Card, PageHeader, Segmented, Toggle } from '@/components/ui'
import { call, useQuery, useSettings } from '@/lib/api'
import { attempt } from '@/lib/store'

function Row({ title, body, children }: { title: string; body: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 max-w-xl text-xs text-muted">{body}</div>
      </div>
      {children}
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { data: s } = useSettings()
  const { data: info } = useQuery('app:info', [], [])
  if (!s) return <></>
  const set = (patch: Partial<AppSettings>): void => void attempt(() => call('settings:set', patch))

  return (
    <>
      <PageHeader title="Settings" />
      <Card className="divide-y divide-line px-5">
        <Row title="Theme" body="Dark is easier on the eyes for long editing sessions.">
          <Segmented
            value={s.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' }
            ]}
          />
        </Row>
        <Row title="Keep running in the background" body="Closing the window hides the app in the system tray so scheduled posts still go out. Use the tray icon to quit completely. Your PC must be on and awake at posting time.">
          <Toggle checked={s.runInBackground} onChange={(runInBackground) => set({ runInBackground })} label="Keep running in the background" />
        </Row>
        <Row title="Start with Windows" body="Launch hidden in the tray when you sign in. Only available in the installed app, not in development mode.">
          <Toggle checked={s.launchAtLogin} onChange={(launchAtLogin) => set({ launchAtLogin })} label="Start with Windows" />
        </Row>
        <Row title="Missed post cutoff" body="If the app was closed when a post was due, it is still published when you come back within this window. After that it is marked as missed so nothing posts at a surprising time.">
          <Segmented
            value={String(s.missedAfterMinutes)}
            onChange={(v) => set({ missedAfterMinutes: Number(v) })}
            options={[
              { value: '15', label: '15 min' },
              { value: '60', label: '1 hour' },
              { value: '240', label: '4 hours' }
            ]}
          />
        </Row>
      </Card>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Sample data</h2>
      <Card className="flex items-center justify-between gap-6 p-5">
        <p className="max-w-xl text-sm text-muted">
          Sample data creates demo accounts with a history of simulated posts and statistics so you can explore the calendar and analytics. Removing it deletes all demo accounts and their posts.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => void attempt(() => call('sample:load'), 'Sample data loaded')}>Load</Button>
          <Button variant="danger" onClick={() => void attempt(() => call('sample:clear'), 'Demo accounts and their posts removed')}>
            Remove demo data
          </Button>
        </div>
      </Card>

      <h2 className="mb-2 mt-8 text-sm font-semibold">About</h2>
      <Card className="space-y-1 p-5 text-sm text-muted">
        <div>Version {info?.version}</div>
        <div>
          Times are shown in your computer's timezone. Data is stored in <span className="select-text text-fg">{info?.dataDir}</span>
        </div>
      </Card>
    </>
  )
}
