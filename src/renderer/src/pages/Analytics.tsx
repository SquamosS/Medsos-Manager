import { format } from 'date-fns'
import { BarChart3, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnalyticsSummary, PlatformId } from '@shared/types'
import { PlatformIcon } from '@/components/PlatformIcon'
import { Badge, Button, Card, EmptyState, PageHeader, Segmented, Spinner, cx, inputClass } from '@/components/ui'
import { call, useQuery } from '@/lib/api'
import { WEEKDAYS, fmtNumber, fmtPercent, fmtRelative } from '@/lib/format'
import { usePlatformCtx } from '@/lib/platforms'
import { attempt } from '@/lib/store'

/** Each platform keeps one categorical slot for its whole life, so filters never repaint a series. */
function useSeriesColor(): (platform: PlatformId) => string {
  const { list } = usePlatformCtx()
  return (platform) => {
    const i = list.findIndex((p) => p.id === platform)
    return i >= 0 && i < 8 ? `var(--s${i + 1})` : 'var(--muted)'
  }
}

function Tile({ label, value, sub, subTone }: { label: string; value: string; sub?: string; subTone?: 'good' | 'bad' }): React.JSX.Element {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold leading-none">{value}</div>
      {sub && <div className={cx('mt-2 text-xs', subTone === 'good' ? 'text-good' : subTone === 'bad' ? 'text-bad' : 'text-muted')}>{sub}</div>}
    </Card>
  )
}

function Legend({ platforms }: { platforms: PlatformId[] }): React.JSX.Element | null {
  const { name } = usePlatformCtx()
  const colorOf = useSeriesColor()
  if (platforms.length < 2) return null
  return (
    <div className="flex items-center gap-4 text-xs text-muted">
      {platforms.map((p) => (
        <span key={p} className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full" style={{ background: colorOf(p) }} /> {name(p)}
        </span>
      ))}
    </div>
  )
}

interface TooltipPayload {
  dataKey: string
  value: number
}

function ChartTooltip({ active, payload, label, platforms, valueLabel }: { active?: boolean; payload?: TooltipPayload[]; label?: string; platforms: PlatformId[]; valueLabel: string }): React.JSX.Element | null {
  const { name } = usePlatformCtx()
  const colorOf = useSeriesColor()
  if (!active || !payload?.length || !label) return null
  const byKey = new Map(payload.map((p) => [p.dataKey, p.value]))
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 font-medium">{format(new Date(label + 'T00:00:00'), 'EEE, d MMM yyyy')}</div>
      {platforms.map((p) => (
        <div key={p} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-2 text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: colorOf(p) }} /> {name(p)}
          </span>
          <span className="tabular-nums">{fmtNumber(byKey.get(p) ?? 0)}</span>
        </div>
      ))}
      <div className="mt-1 text-[11px] text-muted">{valueLabel}</div>
    </div>
  )
}

function SeriesChart({ rows, platforms, valueLabel }: { rows: { date: string; byPlatform: Record<string, number> }[]; platforms: PlatformId[]; valueLabel: string }): React.JSX.Element {
  const colorOf = useSeriesColor()
  const data = rows.map((r) => ({ date: r.date, ...r.byPlatform }))
  return (
    <div style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => format(new Date(d + 'T00:00:00'), 'd MMM')} stroke="var(--grid)" tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} minTickGap={36} />
          <YAxis tickFormatter={fmtNumber} width={48} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
          <Tooltip content={<ChartTooltip platforms={platforms} valueLabel={valueLabel} />} cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} />
          {platforms.map((p) => (
            <Area key={p} type="monotone" dataKey={p} stroke={colorOf(p)} strokeWidth={2} fill={colorOf(p)} fillOpacity={0.1} activeDot={{ r: 4, stroke: 'var(--panel)', strokeWidth: 2 }} dot={false} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function DataTable({ rows, platforms }: { rows: { date: string; byPlatform: Record<string, number> }[]; platforms: PlatformId[] }): React.JSX.Element {
  const { name } = usePlatformCtx()
  return (
    <div className="max-h-[260px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-muted">
          <tr>
            <th className="py-1.5 font-medium">Date</th>
            {platforms.map((p) => (
              <th key={p} className="py-1.5 text-right font-medium">{name(p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.date} className="border-t border-line">
              <td className="py-1.5 text-muted">{format(new Date(r.date + 'T00:00:00'), 'd MMM yyyy')}</td>
              {platforms.map((p) => (
                <td key={p} className="py-1.5 text-right tabular-nums">{(r.byPlatform[p] ?? 0).toLocaleString('en-US')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartCard({ title, subtitle, children, table, platforms, rows }: { title: string; subtitle: string; children: ReactNode; table?: boolean; platforms: PlatformId[]; rows: AnalyticsSummary['daily'] }): React.JSX.Element {
  const [asTable, setAsTable] = useState(false)
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <Legend platforms={platforms} />
          {table !== false && (
            <Segmented
              value={asTable ? 'table' : 'chart'}
              onChange={(v) => setAsTable(v === 'table')}
              options={[
                { value: 'chart', label: 'Chart' },
                { value: 'table', label: 'Table' }
              ]}
            />
          )}
        </div>
      </div>
      {asTable ? <DataTable rows={rows} platforms={platforms} /> : children}
    </Card>
  )
}

/** Weekday × 3-hour grid. Colour is one blue hue fading into the surface: darker = more average views. */
function BestTimes({ data }: { data: AnalyticsSummary['bestTimes'] }): React.JSX.Element {
  const values = data.grid.flat().filter((v): v is number => v !== null)
  const max = Math.max(1, ...values)
  const labels = ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24']
  const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`
  return (
    <Card className="p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Best time to post</h2>
        <p className="text-xs text-muted">Average views by weekday and time of day, from {data.sampleSize} posts older than 3 days.</p>
      </div>
      {data.sampleSize < 8 ? (
        <p className="py-8 text-center text-sm text-muted">Not enough data yet. Publish at least 8 posts and check back after a few days.</p>
      ) : (
        <div className="flex gap-6">
          <div className="min-w-0 flex-1">
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: '36px repeat(8, 1fr)' }}>
              <div />
              {labels.map((l) => (
                <div key={l} className="pb-1 text-center text-[10px] text-muted">{l}</div>
              ))}
              {data.grid.map((row, wd) => (
                <div key={wd} className="contents">
                  <div className="flex items-center text-xs text-muted">{WEEKDAYS[wd]}</div>
                  {row.map((v, b) => (
                    <div
                      key={b}
                      title={v === null ? `${WEEKDAYS[wd]} ${labels[b]}: no posts` : `${WEEKDAYS[wd]} ${labels[b]}: ${v.toLocaleString('en-US')} avg views`}
                      className="h-7 rounded-[4px]"
                      style={{ background: v === null ? 'var(--panel2)' : `color-mix(in srgb, var(--s1) ${Math.round(14 + (v / max) * 86)}%, var(--panel))` }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
              Fewer views
              <span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--s1) 14%, var(--panel)), var(--s1))' }} />
              More views
            </div>
          </div>
          <div className="w-48 shrink-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Top slots</h3>
            <ol className="space-y-2 text-sm">
              {data.suggestions.map((s, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span>{WEEKDAYS[s.weekday]} · {hourLabel(Math.floor(s.hour / 3) * 3)}–{hourLabel(Math.floor(s.hour / 3) * 3 + 3)}</span>
                  <span className="text-xs tabular-nums text-muted">{fmtNumber(s.score)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Card>
  )
}

export function Analytics(): React.JSX.Element {
  const { list: platforms, name } = usePlatformCtx()
  const [days, setDays] = useState(30)
  const [platform, setPlatform] = useState<PlatformId | ''>('')
  const [syncing, setSyncing] = useState(false)
  const { data, loading, reload } = useQuery('analytics:summary', [{ days, platform: platform || null }], ['analytics', 'posts', 'accounts'])

  const sync = async (): Promise<void> => {
    setSyncing(true)
    await attempt(() => call('analytics:sync'), 'Analytics updated')
    setSyncing(false)
    reload()
  }

  if (loading || !data) return <Spinner />

  const visible = platforms.map((p) => p.id).filter((id) => !platform || id === platform)
  const hasData = data.totals.views > 0 || data.platforms.some((p) => p.posts > 0 || p.followers > 0)
  const delta = data.totals.followersDelta

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={data.lastSyncAt ? `Last updated ${fmtRelative(data.lastSyncAt)}` : 'Not synced yet'}
        actions={
          <>
            <select aria-label="Platform" className={cx(inputClass, 'w-40')} value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">All platforms</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Segmented
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: '90', label: '90 days' }
              ]}
            />
            <Button icon={<RefreshCw size={15} className={syncing ? 'spin' : ''} />} onClick={() => void sync()} disabled={syncing}>
              Sync
            </Button>
          </>
        }
      />

      {data.hasDemoData && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/5 px-4 py-2.5 text-sm text-warn">
          <Badge tone="warn">Demo</Badge> Numbers from demo accounts are simulated and do not come from a real platform.
        </div>
      )}

      {!hasData ? (
        <Card>
          <EmptyState
            icon={<BarChart3 size={22} />}
            title="No analytics yet"
            body="Statistics appear after your first published post. To explore the screen right now, load sample data."
            action={
              <Button icon={<Sparkles size={16} />} onClick={() => void attempt(() => call('sample:load'), 'Sample data loaded')}>
                Load sample data
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-5 gap-4">
            <Tile label={`Views · ${days} days`} value={fmtNumber(data.totals.views)} />
            <Tile label="Engagement rate" value={fmtPercent(data.totals.engagementRate)} sub="Likes, comments, shares ÷ views" />
            <Tile label="Interactions" value={fmtNumber(data.totals.likes + data.totals.comments + data.totals.shares)} sub={`${fmtNumber(data.totals.likes)} likes · ${fmtNumber(data.totals.comments)} comments`} />
            <Tile label="Followers" value={fmtNumber(data.totals.followers)} sub={`${delta >= 0 ? '+' : ''}${delta.toLocaleString('en-US')} in ${days} days`} subTone={delta > 0 ? 'good' : delta < 0 ? 'bad' : undefined} />
            <Tile label="Posts published" value={String(data.totals.posts)} />
          </div>

          <ChartCard title="Views per day" subtitle="Growth in views, by day the data was recorded" platforms={visible} rows={data.daily}>
            <SeriesChart rows={data.daily} platforms={visible} valueLabel="views" />
          </ChartCard>

          <div className="grid grid-cols-2 gap-5">
            <ChartCard title="Followers" subtitle="Total across connected accounts" platforms={visible} rows={data.followersDaily}>
              <SeriesChart rows={data.followersDaily} platforms={visible} valueLabel="followers" />
            </ChartCard>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">By platform</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="pb-2 font-medium">Platform</th>
                    <th className="pb-2 text-right font-medium">Views</th>
                    <th className="pb-2 text-right font-medium">Eng. rate</th>
                    <th className="pb-2 text-right font-medium">Followers</th>
                    <th className="pb-2 text-right font-medium">Posts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.platforms.map((p) => (
                    <tr key={p.platform} className="border-t border-line">
                      <td className="py-2.5">
                        <span className="flex items-center gap-2"><PlatformIcon id={p.platform} size={22} /> {name(p.platform)}</span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{fmtNumber(p.views)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtPercent(p.engagementRate)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtNumber(p.followers)}</td>
                      <td className="py-2.5 text-right tabular-nums">{p.posts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Top posts</h2>
            {data.topPosts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No posts were published in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="pb-2 font-medium">Post</th>
                    <th className="pb-2 font-medium">Published</th>
                    <th className="pb-2 text-right font-medium">Views</th>
                    <th className="pb-2 text-right font-medium">Likes</th>
                    <th className="pb-2 text-right font-medium">Comments</th>
                    <th className="pb-2 text-right font-medium">Shares</th>
                    <th className="pb-2 text-right font-medium">Eng. rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPosts.map((p) => (
                    <tr key={p.targetId} className="border-t border-line">
                      <td className="max-w-[320px] py-2.5">
                        <span className="flex items-center gap-2.5">
                          <PlatformIcon id={p.platform} size={22} />
                          <span className="truncate">{p.title}</span>
                        </span>
                      </td>
                      <td className="py-2.5 text-muted">{format(new Date(p.publishedAt), 'd MMM, HH:mm')}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtNumber(p.views)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtNumber(p.likes)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtNumber(p.comments)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtNumber(p.shares)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtPercent(p.engagementRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <BestTimes data={data.bestTimes} />
        </div>
      )}
    </>
  )
}
