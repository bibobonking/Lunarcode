import { cn } from '../lib/utils'

export const GEAR_PATH =
  'M44.57 13.43L44.93 11.58L47.35 11.58L47.71 13.43L48.16 13.62L49.73 12.56L51.44 14.27L50.38 15.84L50.57 16.29L52.42 16.65L52.42 19.07L50.57 19.43L50.38 19.88L51.44 21.45L49.73 23.16L48.16 22.10L47.71 22.29L47.35 24.14L44.93 24.14L44.57 22.29L44.12 22.10L42.55 23.16L40.84 21.45L41.90 19.88L41.71 19.43L39.86 19.07L39.86 16.65L41.71 16.29L41.90 15.84L40.84 14.27L42.55 12.56L44.12 13.62ZM43.94 17.86a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0Z'

export function Gear({ fill, spin = false }: { fill: string; spin?: boolean }) {
  return <path className={spin ? 'gear-spin' : undefined} d={GEAR_PATH} fill={fill} fillRule="evenodd" stroke={fill} strokeWidth="0.7" strokeLinejoin="round" />
}

/**
 * The CreateCode mark: an "O" ring left open, a small gear resting in the opening, and a command
 * prompt inside. GNOME-style soft flat in black and white. Without `tile` it follows the text colour.
 */
export function LogoMark({
  size = 28,
  className,
  spin = false,
  tile = false,
}: {
  size?: number
  className?: string
  spin?: boolean
  tile?: boolean
}) {
  const glyph = tile ? '#ffffff' : 'currentColor'
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center text-ink', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className={cn(spin && 'animate-spin-slow')}>
        {tile && (
          <g>
            <rect width="64" height="64" rx="15" fill="#0f0f11" />
            <rect width="64" height="61" rx="15" fill="#28282c" />
            <rect x=".5" y=".5" width="63" height="60" rx="14.5" stroke="#fff" strokeOpacity=".1" />
          </g>
        )}
        <g transform={tile ? 'translate(0 -1.5)' : undefined}>
          <path d="M51.32 26.82A20 20 0 1 1 37.18 12.68" stroke={glyph} strokeWidth="5.6" strokeLinecap="round" />
          <Gear fill={glyph} />
          <g stroke={glyph} strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M25.2 25.6L34 32l-8.8 6.4" />
            <path d="M37.6 39.2h6" opacity="0.55" />
          </g>
        </g>
      </svg>
    </span>
  )
}

export function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="group/logo flex items-center gap-2">
      <LogoMark
        size={compact ? 20 : 24}
        tile
        className="transition-transform duration-300 ease-out group-hover/logo:scale-105"
      />
      {!compact && (
        <span className="text-[14px] font-semibold leading-none tracking-[-0.025em] text-ink">
          Creat<span className="accent-text">Code</span>
        </span>
      )}
    </div>
  )
}
