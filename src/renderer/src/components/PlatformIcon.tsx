import { usePlatformCtx } from '@/lib/platforms'

/** Simple brand-neutral glyphs. Unknown platforms fall back to a coloured initial. */
function Glyph({ id, size }: { id: string; size: number }): React.JSX.Element {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    case 'youtube':
      return (
        <svg {...common} aria-hidden>
          <path d="M9.5 8.5v7l6-3.5z" fill="#fff" stroke="none" />
        </svg>
      )
    case 'instagram':
      return (
        <svg {...common} aria-hidden>
          <rect x="5" y="5" width="14" height="14" rx="4.2" />
          <circle cx="12" cy="12" r="3.2" />
          <circle cx="16.4" cy="7.6" r="0.6" fill="#fff" />
        </svg>
      )
    case 'tiktok':
      return (
        <svg {...common} aria-hidden>
          <path d="M14 5v9.2a3 3 0 1 1-3-3" />
          <path d="M14 5c.3 2 1.8 3.4 4 3.6" />
        </svg>
      )
    default:
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="12" r="3" fill="#fff" stroke="none" />
        </svg>
      )
  }
}

export function PlatformIcon({ id, size = 28, title }: { id: string; size?: number; title?: string }): React.JSX.Element {
  const { color, name } = usePlatformCtx()
  const bg = id === 'tiktok' ? '#111' : color(id)
  return (
    <span
      title={title ?? name(id)}
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: bg,
        boxShadow: id === 'tiktok' ? 'inset 0 0 0 1.5px #25f4ee, inset 3px 0 0 -1px #fe2c55' : undefined
      }}
    >
      <Glyph id={id} size={Math.round(size * 0.66)} />
    </span>
  )
}
