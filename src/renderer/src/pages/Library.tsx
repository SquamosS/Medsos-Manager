import { Film, Image as ImageIcon, Images, Search, SquarePen, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { DragEvent } from 'react'
import type { Media } from '@shared/types'
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Segmented, Spinner, cx, inputClass } from '@/components/ui'
import { call, useMedia } from '@/lib/api'
import { fmtBytes, fmtDuration } from '@/lib/format'
import { importPaths, isVertical } from '@/lib/media'
import { attempt, useApp } from '@/lib/store'

/** Imports files via the system dialog or a list of paths, with user feedback. */
export function useImporter(): { importing: boolean; pickAndImport: (kinds?: 'video' | 'image' | 'any') => Promise<Media[]>; importFiles: (paths: string[]) => Promise<Media[]> } {
  const toast = useApp((s) => s.toast)
  const [importing, setImporting] = useState(false)

  const importFiles = async (paths: string[]): Promise<Media[]> => {
    if (paths.length === 0) return []
    setImporting(true)
    try {
      const { media, unreadable } = await importPaths(paths)
      if (media.length === 0) toast('No supported video or image files found.', 'error')
      else toast(`Imported ${media.length} file${media.length === 1 ? '' : 's'}`, 'success')
      if (unreadable.length > 0) toast(`Couldn't read a preview for: ${unreadable.join(', ')}. MP4 (H.264) or WebM work best.`, 'info')
      return media
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      return []
    } finally {
      setImporting(false)
    }
  }

  const pickAndImport = async (kinds: 'video' | 'image' | 'any' = 'any'): Promise<Media[]> => {
    const paths = await attempt(() => call('media:pick', kinds))
    return paths ? importFiles(paths) : []
  }
  return { importing, pickAndImport, importFiles }
}

function MediaCard({ m, onOpen }: { m: Media; onOpen: () => void }): React.JSX.Element {
  return (
    <button onClick={onOpen} className="no-drag group overflow-hidden rounded-xl border border-line bg-panel text-left transition hover:border-accent/60">
      <div className="relative aspect-[4/5] bg-panel2">
        {m.hasThumb ? (
          <img src={`medsos://thumb/${m.id}`} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">{m.kind === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}</div>
        )}
        {m.missing && <div className="absolute inset-0 flex items-center justify-center bg-black/65 text-xs font-semibold text-white">FILE MISSING</div>}
        <div className="absolute bottom-2 left-2 flex gap-1.5">
          {m.kind === 'video' && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">{fmtDuration(m.durationSec)}</span>}
          {m.width && m.height && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">{isVertical(m) ? '9:16' : m.width === m.height ? '1:1' : '16:9'}</span>}
        </div>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium">{m.filename}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span>{fmtBytes(m.sizeBytes)}</span>
          {m.usedCount > 0 && <span>· used in {m.usedCount}</span>}
        </div>
      </div>
    </button>
  )
}

export function Library(): React.JSX.Element {
  const { data: media, loading } = useMedia()
  const go = useApp((s) => s.go)
  const { importing, pickAndImport, importFiles } = useImporter()
  const [kind, setKind] = useState<'all' | 'video' | 'image'>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Media | null>(null)
  const [dragging, setDragging] = useState(false)

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    void importFiles(paths)
  }

  const shown = (media ?? []).filter((m) => (kind === 'all' || m.kind === kind) && m.filename.toLowerCase().includes(query.toLowerCase()))

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
      className="relative min-h-[70vh]"
    >
      <PageHeader
        title="Library"
        subtitle="Your videos and images. Files stay where they are; the app only remembers their location."
        actions={
          <Button variant="primary" icon={<Upload size={16} />} loading={importing} onClick={() => void pickAndImport('any')}>
            Import files
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'video', label: 'Videos' },
            { value: 'image', label: 'Images' }
          ]}
        />
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className={cx(inputClass, 'pl-9')} placeholder="Search files" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Images size={22} />}
            title={media?.length ? 'No files match' : 'Your library is empty'}
            body={media?.length ? 'Try a different filter or search.' : 'Import videos or images, or drag them into this window.'}
            action={!media?.length && <Button variant="primary" icon={<Upload size={16} />} onClick={() => void pickAndImport('any')}>Import files</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
          {shown.map((m) => (
            <MediaCard key={m.id} m={m} onOpen={() => setOpen(m)} />
          ))}
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent/10 text-lg font-medium text-accent">
          Drop files to import
        </div>
      )}

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.filename ?? ''}
        width={640}
        footer={
          open && (
            <>
              <Button
                variant="danger"
                icon={<Trash2 size={15} />}
                onClick={() => {
                  const id = open.id
                  setOpen(null)
                  void attempt(() => call('media:remove', id), 'Removed from library')
                }}
              >
                Remove from library
              </Button>
              <Button variant="primary" icon={<SquarePen size={15} />} disabled={open.missing} onClick={() => go({ page: 'compose', prefillMedia: [open.id] })}>
                Create post
              </Button>
            </>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="flex max-h-[52vh] items-center justify-center overflow-hidden rounded-xl bg-black">
              {open.missing ? (
                <div className="p-10 text-sm text-muted">The original file is missing from disk.</div>
              ) : open.kind === 'video' ? (
                <video src={`medsos://media/${open.id}`} controls className="max-h-[52vh] max-w-full" />
              ) : (
                <img src={`medsos://media/${open.id}`} alt="" className="max-h-[52vh] max-w-full object-contain" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge>{open.kind}</Badge>
              {open.width && open.height && <span>{open.width}×{open.height}</span>}
              {open.durationSec !== null && <span>· {fmtDuration(open.durationSec)}</span>}
              <span>· {fmtBytes(open.sizeBytes)}</span>
            </div>
            <div className="select-text break-all rounded-lg bg-panel2 px-3 py-2 text-xs text-muted">{open.path}</div>
          </div>
        )}
      </Modal>
    </div>
  )
}
