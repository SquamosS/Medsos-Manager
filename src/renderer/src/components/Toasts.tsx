import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useApp } from '@/lib/store'
import { cx } from './ui'

export function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cx(
            'fade-in pointer-events-auto flex items-start gap-3 rounded-xl border bg-panel px-4 py-3 text-sm shadow-xl',
            t.kind === 'error' ? 'border-bad/50' : t.kind === 'success' ? 'border-good/40' : 'border-line'
          )}
        >
          {t.kind === 'error' ? <AlertCircle size={18} className="mt-0.5 shrink-0 text-bad" /> : t.kind === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good" /> : <Info size={18} className="mt-0.5 shrink-0 text-accent" />}
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-fg">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
