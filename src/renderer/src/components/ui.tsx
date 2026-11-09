import { Film, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { useEffect } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Media, PostStatus, TargetStatus } from '@shared/types'
import { STATUS_LABEL } from '@/lib/format'

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')

// ---- Buttons -------------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 active:brightness-95',
  secondary: 'bg-panel2 text-fg border border-line hover:border-muted/60',
  ghost: 'text-muted hover:text-fg hover:bg-panel2',
  danger: 'bg-bad/15 text-bad hover:bg-bad/25'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className, disabled, ...rest }: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'no-drag inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        VARIANTS[variant],
        className
      )}
    >
      {loading ? <Loader2 size={15} className="spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): React.JSX.Element {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx('no-drag inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-panel2 hover:text-fg disabled:opacity-40', className)}
    >
      {children}
    </button>
  )
}

// ---- Layout --------------------------------------------------------------------------------

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div {...rest} className={cx('rounded-xl border border-line bg-panel', className)}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">{icon}</div>
      <div className="text-base font-medium">{title}</div>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Loader2 size={16} className="spin" /> {label}
    </div>
  )
}

// ---- Badges --------------------------------------------------------------------------------

const STATUS_STYLE: Record<PostStatus | TargetStatus, string> = {
  draft: 'bg-panel2 text-muted',
  scheduled: 'bg-accent-soft text-accent',
  publishing: 'bg-warn/15 text-warn',
  published: 'bg-good/15 text-good',
  partial: 'bg-warn/15 text-warn',
  failed: 'bg-bad/15 text-bad',
  missed: 'bg-bad/15 text-bad',
  pending: 'bg-panel2 text-muted'
}

export function StatusBadge({ status }: { status: PostStatus | TargetStatus }): React.JSX.Element {
  return <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn'; title?: string }): React.JSX.Element {
  const tones = { neutral: 'bg-panel2 text-muted', accent: 'bg-accent-soft text-accent', warn: 'bg-warn/15 text-warn' }
  return (
    <span title={title} className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', tones[tone])}>
      {children}
    </span>
  )
}

// ---- Form controls -------------------------------------------------------------------------

export const inputClass =
  'no-drag w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-50'

export function Field({ label, hint, right, children }: { label: string; hint?: string; right?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
        <span>{label}</span>
        {right}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Counter({ value, max }: { value: number; max: number }): React.JSX.Element {
  const over = value > max
  return (
    <span className={cx('tabular-nums', over ? 'font-semibold text-bad' : value > max * 0.9 ? 'text-warn' : 'text-muted')}>
      {value}/{max}
    </span>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('no-drag relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-line')}
    >
      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void }): React.JSX.Element {
  return (
    <div className="no-drag inline-flex rounded-lg border border-line bg-panel2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
            value === o.value ? 'bg-accent text-white' : 'text-muted hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---- Modal ---------------------------------------------------------------------------------

export function Modal({ open, onClose, title, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="fade-in flex max-h-full w-full flex-col rounded-2xl border border-line bg-panel shadow-2xl"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

// ---- Media ---------------------------------------------------------------------------------

export function MediaThumb({ media, className }: { media: Media | undefined; className?: string }): React.JSX.Element {
  return (
    <div className={cx('relative overflow-hidden bg-panel2', className)}>
      {media?.hasThumb ? (
        <img src={`medsos://thumb/${media.id}`} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted">
          {media?.kind === 'image' ? <ImageIcon size={22} /> : <Film size={22} />}
        </div>
      )}
      {media?.missing && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[11px] font-semibold text-white">MISSING</div>}
    </div>
  )
}
