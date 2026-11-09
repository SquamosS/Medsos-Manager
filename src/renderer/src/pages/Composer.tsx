import { addDays, format as formatDate } from 'date-fns'
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Film, ImagePlus, Lightbulb, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContentFormat, Media, OptionField, PlatformInfo, Post, PostInput } from '@shared/types'
import { FORMAT_LABELS } from '@shared/types'
import { buildCaption, parseHashtags, suggestFormat, validateForPlatform, validateMediaForFormat } from '@shared/validation'
import type { Issue } from '@shared/validation'
import { MediaPicker } from '@/components/MediaPicker'
import { PlatformIcon } from '@/components/PlatformIcon'
import { Button, Card, Counter, Field, MediaThumb, Segmented, Spinner, Toggle, cx, inputClass } from '@/components/ui'
import { call, useAccounts, useMedia, useQuery } from '@/lib/api'
import { fromLocalInput, toLocalInput } from '@/lib/format'
import { usePlatformCtx } from '@/lib/platforms'
import { attempt, useApp } from '@/lib/store'

interface TextDraft {
  title: string
  description: string
  hashtags: string
}
type OptionValues = Record<string, string | boolean>
type Mode = 'schedule' | 'now' | 'draft'

const FORMATS: ContentFormat[] = ['short_video', 'long_video', 'image', 'carousel']

function defaultsOf(info: PlatformInfo | undefined): OptionValues {
  return Object.fromEntries((info?.capabilities.options ?? []).map((o) => [o.key, o.default]))
}

function nextOccurrence(weekdayMon0: number, hour: number): Date {
  const now = Date.now() + 30 * 60_000
  for (let i = 0; i < 8; i++) {
    const d = addDays(new Date(), i)
    d.setHours(hour, 0, 0, 0)
    if ((d.getDay() + 6) % 7 === weekdayMon0 && d.getTime() > now) return d
  }
  return addDays(new Date(), 1)
}

function defaultSlots(): Date[] {
  const out: Date[] = []
  for (const dayOffset of [0, 1, 2]) {
    for (const hour of [12, 18, 20]) {
      const d = addDays(new Date(), dayOffset)
      d.setHours(hour, 0, 0, 0)
      if (d.getTime() > Date.now() + 30 * 60_000) out.push(d)
    }
  }
  return out.slice(0, 4)
}

function OptionControl({ field, value, onChange }: { field: OptionField; value: string | boolean; onChange: (v: string | boolean) => void }): React.JSX.Element {
  if (field.type === 'toggle') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg bg-panel2 px-3 py-2">
        <div>
          <div className="text-sm">{field.label}</div>
          {field.help && <div className="text-xs text-muted">{field.help}</div>}
        </div>
        <Toggle checked={value === true} onChange={onChange} label={field.label} />
      </div>
    )
  }
  return (
    <Field label={field.label} hint={field.help}>
      <select className={inputClass} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {field.choices?.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

function Preview({ info, handle, format, media, title, caption }: { info: PlatformInfo; handle: string; format: ContentFormat; media: Media | undefined; title: string; caption: string }): React.JSX.Element {
  const vertical = format === 'short_video'
  const wide = format === 'long_video'
  const showTitle = info.capabilities.titleMax !== undefined
  return (
    <div className="mx-auto" style={{ width: wide ? 300 : 210 }}>
      <div className={cx('relative overflow-hidden rounded-2xl border border-line bg-black', vertical ? 'aspect-[9/16]' : wide ? 'aspect-video' : 'aspect-[4/5]')}>
        {media?.hasThumb ? <img src={`medsos://thumb/${media.id}`} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><Film size={30} /></div>}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/30" />
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 text-[11px] font-medium text-white">
          <PlatformIcon id={info.id} size={18} />
          <span className="max-w-[120px] truncate">{handle}</span>
        </div>
        {vertical && (
          <div className="absolute bottom-16 right-2 flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-6 w-6 rounded-full bg-white/25" />
            ))}
          </div>
        )}
        {!wide && (
          <div className="absolute inset-x-0 bottom-0 p-3 text-white">
            {showTitle && title && <div className="mb-0.5 line-clamp-2 text-xs font-semibold">{title}</div>}
            <p className="line-clamp-3 whitespace-pre-line text-[11px] leading-snug opacity-90">{caption || 'Your caption appears here'}</p>
          </div>
        )}
      </div>
      {wide && (
        <div className="px-1 pt-2">
          <div className="line-clamp-2 text-xs font-semibold">{title || 'Video title'}</div>
          <p className="mt-1 line-clamp-2 whitespace-pre-line text-[11px] text-muted">{caption || 'Description'}</p>
        </div>
      )}
    </div>
  )
}

export function Composer({ postId, prefillDate, prefillMedia }: { postId?: string; prefillDate?: string; prefillMedia?: string[] }): React.JSX.Element {
  const go = useApp((s) => s.go)
  const { get: platformOf, name: platformName } = usePlatformCtx()
  const { data: accounts } = useAccounts()
  const { data: media } = useMedia()
  const { data: existing, loading: loadingPost } = useQuery('posts:get', [postId ?? ''], [])
  const { data: analytics } = useQuery('analytics:summary', [{ days: 90, platform: null }], ['analytics'])

  const [format, setFormat] = useState<ContentFormat>('short_video')
  const [formatTouched, setFormatTouched] = useState(false)
  const [mediaIds, setMediaIds] = useState<string[]>(prefillMedia ?? [])
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [shared, setShared] = useState<TextDraft>({ title: '', description: '', hashtags: '' })
  const [overrides, setOverrides] = useState<Record<string, TextDraft>>({})
  const [options, setOptions] = useState<Record<string, OptionValues>>({})
  const [tab, setTab] = useState<string>('shared')
  const [mode, setMode] = useState<Mode>('schedule')
  const [when, setWhen] = useState(toLocalInput(prefillDate ?? null))
  const [picker, setPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const hydrated = useRef(false)

  const mediaMap = useMemo(() => new Map((media ?? []).map((m) => [m.id, m])), [media])
  const selectedMedia = mediaIds.map((id) => mediaMap.get(id)).filter((m): m is Media => Boolean(m))
  const accountMap = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts])

  // Load an existing post into the form once.
  useEffect(() => {
    if (hydrated.current || !existing) return
    hydrated.current = true
    const p: Post = existing
    setFormat(p.format)
    setFormatTouched(true)
    setMediaIds(p.mediaIds)
    setAccountIds(p.targets.map((t) => t.accountId))
    setShared({ title: p.title, description: p.description, hashtags: p.hashtags.join(' ') })
    setOverrides(Object.fromEntries(p.targets.filter((t) => t.customized).map((t) => [t.accountId, { title: t.title, description: t.description, hashtags: t.hashtags.join(' ') }])))
    setOptions(Object.fromEntries(p.targets.map((t) => [t.accountId, t.options])))
    const future = p.scheduledAt && Date.parse(p.scheduledAt) > Date.now()
    setWhen(future ? toLocalInput(p.scheduledAt) : '')
    setMode(p.status === 'draft' ? 'draft' : 'schedule')
  }, [existing])

  // Suggest a format from the chosen media until the user picks one themselves.
  useEffect(() => {
    if (formatTouched) return
    const suggested = suggestFormat(selectedMedia)
    if (suggested) setFormat(suggested)
  }, [mediaIds, media, formatTouched]) // eslint-disable-line react-hooks/exhaustive-deps

  const effective = (accountId: string): TextDraft => overrides[accountId] ?? shared
  const optionsFor = (accountId: string): OptionValues => {
    const info = platformOf(accountMap.get(accountId)?.platform ?? '')
    return { ...defaultsOf(info), ...(options[accountId] ?? {}) }
  }

  const selectedAccounts = accountIds.map((id) => accountMap.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a))
  const activeAccount = tab !== 'shared' ? accountMap.get(tab) : undefined
  const previewAccount = activeAccount ?? selectedAccounts[0]

  // ---- Validation ---------------------------------------------------------------------------
  const mediaIssues: Issue[] = useMemo(() => validateMediaForFormat(format, selectedMedia), [format, selectedMedia])
  const accountIssues = useMemo(() => {
    const out = new Map<string, Issue[]>()
    for (const a of selectedAccounts) {
      const info = platformOf(a.platform)
      if (!info) continue
      const t = overrides[a.id] ?? shared
      out.set(a.id, validateForPlatform(info, format, selectedMedia, { title: t.title, description: t.description, hashtags: parseHashtags(t.hashtags) }))
    }
    return out
  }, [selectedAccounts, overrides, shared, format, selectedMedia, platformOf])

  const allIssues = [...mediaIssues, ...[...accountIssues.values()].flat()]
  const hasErrors = allIssues.some((i) => i.severity === 'error') || selectedAccounts.length === 0
  const whenIso = fromLocalInput(when)
  const whenInvalid = mode === 'schedule' && (!whenIso || Date.parse(whenIso) < Date.now() - 60_000)

  // Shared-tab limits come from the strictest selected platform.
  const sharedLimits = useMemo(() => {
    const infos = selectedAccounts.map((a) => platformOf(a.platform)).filter((p): p is PlatformInfo => Boolean(p))
    const titleInfos = infos.filter((i) => i.capabilities.titleMax !== undefined)
    return {
      titleMax: titleInfos.length ? Math.min(...titleInfos.map((i) => i.capabilities.titleMax as number)) : undefined,
      titleRequired: titleInfos.some((i) => i.capabilities.titleRequired),
      descriptionMax: infos.length ? Math.min(...infos.map((i) => i.capabilities.descriptionMax)) : 5000
    }
  }, [selectedAccounts, platformOf])

  const suggestions = useMemo(() => {
    const fromData = analytics?.bestTimes.suggestions.map((s) => nextOccurrence(s.weekday, s.hour)) ?? []
    return fromData.length > 0 ? { slots: fromData, learned: true } : { slots: defaultSlots(), learned: false }
  }, [analytics])

  // ---- Handlers -----------------------------------------------------------------------------
  const toggleAccount = (id: string): void => {
    setAccountIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
    if (tab === id) setTab('shared')
  }
  const editText = (field: keyof TextDraft, value: string): void => {
    if (activeAccount) setOverrides((o) => ({ ...o, [activeAccount.id]: { ...(o[activeAccount.id] ?? shared), [field]: value } }))
    else setShared((s) => ({ ...s, [field]: value }))
  }
  const moveMedia = (index: number, dir: -1 | 1): void =>
    setMediaIds((ids) => {
      const next = [...ids]
      const j = index + dir
      if (j < 0 || j >= next.length) return ids
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })

  const submit = async (): Promise<void> => {
    const intent = mode === 'schedule' ? 'scheduled' : mode
    const input: PostInput = {
      id: postId,
      format,
      title: shared.title.trim(),
      description: shared.description,
      hashtags: parseHashtags(shared.hashtags),
      mediaIds,
      scheduledAt: mode === 'now' ? null : whenIso,
      intent,
      targets: accountIds.map((id) => {
        const t = effective(id)
        return {
          accountId: id,
          customized: Boolean(overrides[id]),
          title: t.title.trim(),
          description: t.description,
          hashtags: parseHashtags(t.hashtags),
          options: optionsFor(id)
        }
      })
    }
    setSaving(true)
    const message = mode === 'schedule' ? 'Post scheduled' : mode === 'now' ? 'Publishing now…' : 'Draft saved'
    const saved = await attempt(() => call('posts:save', input), message)
    setSaving(false)
    if (saved) go({ page: 'calendar' })
  }

  if ((postId && loadingPost) || !accounts || !media) return <Spinner />
  if (postId && !existing) return <div className="p-10 text-center text-muted">This post no longer exists.</div>

  const textFor = activeAccount ? effective(activeAccount.id) : shared
  const activeInfo = activeAccount ? platformOf(activeAccount.platform) : undefined
  const showTitle = activeAccount ? activeInfo?.capabilities.titleMax !== undefined : sharedLimits.titleMax !== undefined || selectedAccounts.length === 0
  const titleMax = activeAccount ? activeInfo?.capabilities.titleMax : sharedLimits.titleMax
  const descMax = activeAccount ? (activeInfo?.capabilities.descriptionMax ?? 5000) : sharedLimits.descriptionMax
  const captionLength = buildCaption(textFor.description, parseHashtags(textFor.hashtags)).length
  const primaryLabel = mode === 'schedule' ? 'Schedule post' : mode === 'now' ? 'Publish now' : 'Save draft'
  const previewTarget = previewAccount ? effective(previewAccount.id) : shared
  const previewInfo = previewAccount ? platformOf(previewAccount.platform) : undefined

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => go({ page: 'calendar' })}>
          Back
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">{postId ? 'Edit post' : 'New post'}</h1>
      </div>

      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1 space-y-5">
          {/* 1. Media */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">1 · Media</h2>
              <Segmented
                value={format}
                onChange={(f) => {
                  setFormat(f)
                  setFormatTouched(true)
                }}
                options={FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] }))}
              />
            </div>
            <div className="flex flex-wrap items-start gap-3">
              {selectedMedia.map((m, i) => (
                <div key={m.id} className="group relative">
                  <MediaThumb media={m} className="h-36 w-28 rounded-lg" />
                  <button aria-label="Remove" onClick={() => setMediaIds((ids) => ids.filter((x) => x !== m.id))} className="no-drag absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100">
                    <X size={12} />
                  </button>
                  {selectedMedia.length > 1 && (
                    <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition group-hover:opacity-100">
                      <button aria-label="Move left" disabled={i === 0} onClick={() => moveMedia(i, -1)} className="no-drag rounded-full bg-black/70 p-1 text-white disabled:opacity-30"><ChevronLeft size={13} /></button>
                      <button aria-label="Move right" disabled={i === selectedMedia.length - 1} onClick={() => moveMedia(i, 1)} className="no-drag rounded-full bg-black/70 p-1 text-white disabled:opacity-30"><ChevronRight size={13} /></button>
                    </div>
                  )}
                </div>
              ))}
              <button onClick={() => setPicker(true)} className="no-drag flex h-36 w-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-xs text-muted transition hover:border-accent hover:text-accent">
                <ImagePlus size={22} />
                {selectedMedia.length ? 'Change' : 'Choose media'}
              </button>
            </div>
            {mediaIssues.map((i, k) => (
              <p key={k} className="mt-3 flex items-center gap-1.5 text-xs text-bad"><AlertCircle size={13} /> {i.message}</p>
            ))}
          </Card>

          {/* 2. Accounts */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">2 · Post to</h2>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted">
                No accounts yet.{' '}
                <button className="text-accent underline" onClick={() => go({ page: 'accounts' })}>Add an account</button> first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => {
                  const info = platformOf(a.platform)
                  const supported = Boolean(info?.capabilities.formats[format])
                  const on = accountIds.includes(a.id)
                  return (
                    <button
                      key={a.id}
                      disabled={!supported && !on}
                      onClick={() => toggleAccount(a.id)}
                      title={supported ? undefined : `${platformName(a.platform)} doesn't support ${FORMAT_LABELS[format].toLowerCase()} posts`}
                      className={cx('no-drag flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40', on ? 'border-accent bg-accent-soft' : 'border-line hover:border-muted/60')}
                    >
                      <PlatformIcon id={a.platform} size={26} />
                      <span>
                        <span className="block text-sm font-medium leading-tight">{a.displayName}</span>
                        <span className="block text-xs text-muted">{a.mode === 'demo' ? 'Demo' : a.handle}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>

          {/* 3. Content */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">3 · Content</h2>
            <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
              {[{ id: 'shared', label: 'All platforms' }, ...selectedAccounts.map((a) => ({ id: a.id, label: platformName(a.platform) }))].map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} className={cx('no-drag -mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition', tab === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}>
                  {t.id !== 'shared' && <PlatformIcon id={accountMap.get(t.id)?.platform ?? ''} size={16} />}
                  {t.label}
                  {overrides[t.id] && <span title="Customized" className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {activeAccount && (
                <div className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2 text-xs text-muted">
                  <span>{overrides[activeAccount.id] ? `Custom text for ${platformName(activeAccount.platform)}.` : `Uses the shared text. Edit any field to customize it for ${platformName(activeAccount.platform)}.`}</span>
                  {overrides[activeAccount.id] && (
                    <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setOverrides((o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== activeAccount.id)))}>
                      Reset to shared
                    </Button>
                  )}
                </div>
              )}

              {showTitle && (
                <Field label={`Title${sharedLimits.titleRequired || activeInfo?.capabilities.titleRequired ? ' *' : ''}`} right={titleMax ? <Counter value={textFor.title.length} max={titleMax} /> : undefined}>
                  <input className={inputClass} value={textFor.title} placeholder="A short, clear title" onChange={(e) => editText('title', e.target.value)} />
                </Field>
              )}
              <Field label="Description / caption" right={<Counter value={captionLength} max={descMax} />} hint={!activeAccount && selectedAccounts.length > 1 ? 'The limit shown is the strictest of the selected platforms.' : undefined}>
                <textarea className={cx(inputClass, 'min-h-[130px] resize-y leading-relaxed')} value={textFor.description} placeholder="Write something your audience will care about…" onChange={(e) => editText('description', e.target.value)} />
              </Field>
              <Field label="Hashtags" hint="Separate with spaces or commas. The # is added for you.">
                <input className={inputClass} value={textFor.hashtags} placeholder="travel, vlog, tips" onChange={(e) => editText('hashtags', e.target.value)} />
              </Field>

              {activeAccount && activeInfo && activeInfo.capabilities.options.length > 0 && (
                <div className="space-y-3 border-t border-line pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{platformName(activeAccount.platform)} settings</h3>
                  {activeInfo.capabilities.options.map((f) => (
                    <OptionControl key={f.key} field={f} value={optionsFor(activeAccount.id)[f.key]} onChange={(v) => setOptions((o) => ({ ...o, [activeAccount.id]: { ...optionsFor(activeAccount.id), [f.key]: v } }))} />
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 4. When */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">4 · When</h2>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'schedule', label: 'Schedule' },
                  { value: 'now', label: 'Publish now' },
                  { value: 'draft', label: 'Save as draft' }
                ]}
              />
            </div>
            {mode !== 'now' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <input type="datetime-local" className={cx(inputClass, 'w-60')} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Date and time" />
                  <span className="text-xs text-muted">Your computer's timezone</span>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
                    <Lightbulb size={13} /> {suggestions.learned ? 'Best times based on your analytics' : 'Popular posting times (not personalized yet)'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.slots.map((d) => (
                      <button key={d.toISOString()} onClick={() => { setWhen(toLocalInput(d.toISOString())); if (mode === 'draft') setMode('schedule') }} className="no-drag rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-accent hover:text-accent">
                        {slotLabel(d)}
                      </button>
                    ))}
                  </div>
                </div>
                {mode === 'schedule' && whenInvalid && when && <p className="text-xs text-bad">Pick a time in the future.</p>}
              </div>
            )}
            {mode === 'now' && <p className="text-sm text-muted">The post is sent as soon as you confirm. The app must stay open until it finishes.</p>}
          </Card>

          <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-line bg-bg/90 px-1 py-4 backdrop-blur">
            {mode !== 'draft' && hasErrors && <span className="mr-auto text-xs text-bad">Fix the issues in “Checks” before {mode === 'now' ? 'publishing' : 'scheduling'}.</span>}
            <Button onClick={() => go({ page: 'calendar' })}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={mode !== 'draft' && (hasErrors || whenInvalid)} onClick={() => void submit()}>
              {primaryLabel}
            </Button>
          </div>
        </div>

        {/* Right column */}
        <div className="sticky top-0 w-[340px] shrink-0 space-y-5">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Preview</h2>
              {selectedAccounts.length > 1 && (
                <div className="flex gap-1">
                  {selectedAccounts.map((a) => (
                    <button key={a.id} onClick={() => setTab(a.id)} className={cx('no-drag rounded-lg p-0.5 transition', previewAccount?.id === a.id ? 'ring-2 ring-accent' : 'opacity-60 hover:opacity-100')}>
                      <PlatformIcon id={a.platform} size={22} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {previewInfo && previewAccount ? (
              <Preview info={previewInfo} handle={previewAccount.handle} format={format} media={selectedMedia[0]} title={previewTarget.title} caption={buildCaption(previewTarget.description, parseHashtags(previewTarget.hashtags))} />
            ) : (
              <p className="py-10 text-center text-sm text-muted">Choose an account to see how the post will look.</p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Checks</h2>
            {allIssues.length === 0 && selectedAccounts.length > 0 && selectedMedia.length > 0 ? (
              <p className="flex items-center gap-2 text-sm text-good"><CheckCircle2 size={16} /> Everything looks good.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {selectedMedia.length === 0 && <li className="flex gap-2 text-muted"><AlertCircle size={14} className="shrink-0" /> Choose media.</li>}
                {selectedAccounts.length === 0 && <li className="flex gap-2 text-muted"><AlertCircle size={14} className="shrink-0" /> Select at least one account.</li>}
                {[...accountIssues.entries()].flatMap(([id, issues]) =>
                  issues.map((i, k) => (
                    <li key={id + k} className={cx('flex gap-2', i.severity === 'error' ? 'text-bad' : 'text-warn')}>
                      <AlertCircle size={14} className="mt-px shrink-0" />
                      <span><b>{platformName(accountMap.get(id)?.platform ?? '')}:</b> {i.message}</span>
                    </li>
                  ))
                )}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <MediaPicker
        open={picker}
        onClose={() => setPicker(false)}
        selected={mediaIds}
        onConfirm={(ids) => {
          setMediaIds(ids)
          setPicker(false)
        }}
      />
    </>
  )
}

const slotLabel = (d: Date): string => formatDate(d, 'EEE d MMM, HH:mm')
