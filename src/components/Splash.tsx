import { useEffect, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { BrandFooter } from './Logo'
import { cn } from '../lib/utils'

const STATUS = ['Waking the local daemon', 'Unlocking your keys', 'Loading workspace', 'Almost there']

/**
 * Intro build of the Lunarcode mark: the tile pops in, the ring draws itself, the prompt chevron is
 * written, then the moon lands in the opening with a shockwave. Pure SVG + CSS (see `.splash-logo`).
 */
function LogoBuild({ size = 104 }: { size?: number }) {
  return (
    <div className="splash-logo relative" style={{ width: size * 1.7, height: size * 1.7 }}>
      <span
        className="absolute inset-0 m-auto rounded-full bg-accent/15 blur-3xl"
        style={{ width: size * 1.5, height: size * 1.5 }}
        aria-hidden="true"
      />
      <span className="sl-shock" style={{ width: size, height: size, animationDelay: '1s' }} aria-hidden="true" />
      <span className="sl-shock" style={{ width: size, height: size, animationDelay: '1.25s' }} aria-hidden="true" />
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className="sl-svg absolute inset-0 m-auto" aria-hidden="true">
        <defs>
          <linearGradient id="sl-bg" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2a2d5e" />
            <stop offset="1" stopColor="#0a0b18" />
          </linearGradient>
          <linearGradient id="sl-ring" x1="14" y1="12" x2="50" y2="52" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#d8dbff" />
            <stop offset="0.45" stopColor="#8e96ff" />
            <stop offset="1" stopColor="#4fc6ea" />
          </linearGradient>
          <radialGradient id="sl-sun" cx="46" cy="18" r="6" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#dfe2ff" />
            <stop offset="1" stopColor="#a9b0ff" />
          </radialGradient>
        </defs>
        <g className="sl-tile">
          <rect width="64" height="64" rx="15" fill="url(#sl-bg)" />
          <rect x=".75" y=".75" width="62.5" height="62.5" rx="14.25" stroke="#fff" strokeOpacity=".09" strokeWidth="1.5" />
        </g>
        <path className="sl-ring" d="M51.32 26.82A20 20 0 1 1 37.18 12.68" stroke="url(#sl-ring)" strokeWidth="5.6" strokeLinecap="round" pathLength={1} />
        <circle className="sl-sun" cx="46.14" cy="17.86" r="5" fill="url(#sl-sun)" />
        <g stroke="#e6e9ff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round">
          <path className="sl-chev" d="M25.2 25.6L34 32l-8.8 6.4" pathLength={1} />
          <path className="sl-under" d="M37.6 39.2h6" />
        </g>
      </svg>
    </div>
  )
}

export function Splash({
  phase,
  error,
  leaving,
  onRetry,
}: {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  leaving: boolean
  onRetry: () => void
}) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (phase === 'error') return
    const timer = window.setInterval(() => setStep((value) => Math.min(STATUS.length - 1, value + 1)), 650)
    return () => window.clearInterval(timer)
  }, [phase])

  return (
    <div className={cn('splash', leaving && 'is-leaving')} role="status" aria-live="polite">
      <div className="hero-wash pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative flex w-full max-w-[400px] flex-col items-center px-6 text-center">
        <LogoBuild />
        <h1 className="splash-word -mt-2 text-[26px] font-semibold leading-none tracking-[-0.04em] text-ink" aria-label="Lunarcode">
          {'Lunarcode'.split('').map((char, index) => (
            <span key={index} style={{ animationDelay: `${1.15 + index * 0.055}s` }} className={index >= 5 ? 'text-accent' : undefined}>
              {char}
            </span>
          ))}
        </h1>
        <p className="mt-2 animate-fade text-[11px] font-medium uppercase tracking-[0.22em] text-faint [animation-delay:1.7s]">
          by OpenSoftX
        </p>

        {phase === 'error' ? (
          <div className="mt-8 w-full animate-rise">
            <div className="w-full rounded-xl border border-danger/25 bg-danger/[0.05] px-4 py-3 text-left">
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                <AlertCircle size={14} className="text-danger" />
                The local daemon did not answer
              </p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted">{error}</p>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-[12.5px] font-medium text-panel transition-all hover:opacity-85 active:scale-95"
            >
              <RefreshCw size={13} />
              Try again
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              Start Lunarcode with <code className="rounded bg-raised px-1 py-0.5 font-mono text-[10.5px]">npm start</code> in the
              Lunarcode folder, then reload this page.
            </p>
          </div>
        ) : (
          <div className="mt-9 flex animate-fade flex-col items-center gap-3 [animation-delay:1.5s]">
            <div className="loading-bar h-[2px] w-32 rounded-full" />
            <p key={step} className="animate-rise text-[12px] text-muted">
              {STATUS[step]}…
            </p>
          </div>
        )}
        <div className="mt-12 animate-fade [animation-delay:2s]">
          <BrandFooter />
        </div>
      </div>
    </div>
  )
}
