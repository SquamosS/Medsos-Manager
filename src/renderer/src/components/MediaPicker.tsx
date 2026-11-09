import { Check, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMedia } from '@/lib/api'
import { fmtDuration } from '@/lib/format'
import { useImporter } from '@/pages/Library'
import { Button, MediaThumb, Modal, cx } from './ui'

/** Pick one or more library items; selection order is kept (it becomes carousel order). */
export function MediaPicker({ open, onClose, selected, onConfirm }: { open: boolean; onClose: () => void; selected: string[]; onConfirm: (ids: string[]) => void }): React.JSX.Element {
  const { data: media } = useMedia()
  const { importing, pickAndImport } = useImporter()
  const [picked, setPicked] = useState<string[]>(selected)

  useEffect(() => {
    if (open) setPicked(selected)
  }, [open, selected])

  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const importMore = async (): Promise<void> => {
    const added = await pickAndImport('any')
    setPicked((p) => [...p, ...added.filter((m) => !m.missing).map((m) => m.id).filter((id) => !p.includes(id))])
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose media"
      width={760}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">{picked.length} selected</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={picked.length === 0} onClick={() => onConfirm(picked)}>
            Use selected
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">Select one video or image, or several for a carousel.</p>
        <Button size="sm" icon={<Upload size={14} />} loading={importing} onClick={() => void importMore()}>
          Import files
        </Button>
      </div>
      {!media || media.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">Your library is empty. Import a video or image to get started.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
          {media.map((m) => {
            const index = picked.indexOf(m.id)
            return (
              <button
                key={m.id}
                disabled={m.missing}
                onClick={() => toggle(m.id)}
                className={cx('no-drag relative overflow-hidden rounded-lg border-2 text-left transition disabled:opacity-40', index >= 0 ? 'border-accent' : 'border-transparent hover:border-line')}
              >
                <MediaThumb media={m} className="aspect-[4/5]" />
                {index >= 0 && (
                  <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
                    {picked.length > 1 ? index + 1 : <Check size={14} />}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[11px] text-white">
                  <div className="truncate">{m.filename}</div>
                  {m.kind === 'video' && <div className="opacity-80">{fmtDuration(m.durationSec)}</div>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
