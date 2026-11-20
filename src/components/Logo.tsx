import { useId } from 'react'
import { cn } from '../lib/utils'

/**
 * The Lunarcode mark: an "O" ring left open, a small moon resting in the opening, and a command
 * prompt inside. Same construction as before, re-lit for night: a lavender-to-earthshine ring,
 * a cratered moon with a soft halo, a silvered prompt and (with `tile`) a glossy indigo tile.
 * It is deliberately not flat: every part carries a gradient, a highlight or a glow.
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
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = (name: string) => `lm-${uid}-${name}`
  return (
    <span
      className={cn('logo-glow inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className={cn(spin && 'animate-spin-slow')}>
        <defs>
          <linearGradient id={id('bg')} x1="8" y1="2" x2="56" y2="62" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2a2d5e" />
            <stop offset="0.55" stopColor="#15172f" />
            <stop offset="1" stopColor="#0a0b18" />
          </linearGradient>
          <radialGradient id={id('glow')} cx="20" cy="14" r="46" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#8e96ff" stopOpacity="0.38" />
            <stop offset="1" stopColor="#8e96ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id('gloss')} x1="32" y1="0" x2="32" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={id('rim')} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#c9ceff" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#70d6f0" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id={id('ring')} x1="14" y1="12" x2="50" y2="52" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#d8dbff" />
            <stop offset="0.45" stopColor="#8e96ff" />
            <stop offset="1" stopColor="#4fc6ea" />
          </linearGradient>
          <radialGradient id={id('moon')} cx="44.6" cy="16.4" r="7.2" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#dfe2ff" />
            <stop offset="1" stopColor="#a9b0ff" />
          </radialGradient>
          <radialGradient id={id('halo')} cx="46.14" cy="17.86" r="11" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#b9bfff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#b9bfff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id('prompt')} x1="25" y1="25" x2="44" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#c3c8ff" />
          </linearGradient>
          <clipPath id={id('clip')}>
            <rect width="64" height="64" rx="15" />
          </clipPath>
        </defs>
        {tile && (
          <g>
            <rect width="64" height="64" rx="15" fill={`url(#${id('bg')})`} />
            <g clipPath={`url(#${id('clip')})`}>
              <rect width="64" height="64" fill={`url(#${id('glow')})`} />
              <ellipse cx="32" cy="-6" rx="40" ry="26" fill={`url(#${id('gloss')})`} />
            </g>
            <rect x=".75" y=".75" width="62.5" height="62.5" rx="14.25" stroke={`url(#${id('rim')})`} strokeWidth="1.5" />
          </g>
        )}
        <path
          d="M51.32 26.82A20 20 0 1 1 37.18 12.68"
          stroke={`url(#${id('ring')})`}
          strokeWidth="5.6"
          strokeLinecap="round"
        />
        <circle cx="46.14" cy="17.86" r="11" fill={`url(#${id('halo')})`} />
        <circle cx="46.14" cy="17.86" r="5" fill={`url(#${id('moon')})`} />
        <circle cx="44.6" cy="16.6" r="1.1" fill="#8e96ff" opacity="0.35" />
        <circle cx="47.6" cy="19.4" r="0.8" fill="#8e96ff" opacity="0.3" />
        <circle cx="47.9" cy="15.7" r="0.55" fill="#8e96ff" opacity="0.28" />
        <g stroke={`url(#${id('prompt')})`} strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M25.2 25.6L34 32l-8.8 6.4" />
          <path d="M37.6 39.2h6" opacity="0.6" />
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
        className="transition-transform duration-500 ease-out group-hover/logo:rotate-[14deg] group-hover/logo:scale-110"
      />
      {!compact && (
        <span className="text-[14px] font-semibold leading-none tracking-[-0.025em] text-ink">
          Lunar<span className="lunar-text">code</span>
        </span>
      )}
    </div>
  )
}

export function BrandFooter() {
  return (
    <p className="text-[11px] tracking-[0.01em] text-faint">
      Lunarcode <span className="px-1 text-line">/</span> by OpenSoftX
    </p>
  )
}
