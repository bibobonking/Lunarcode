import { useEffect, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'
import { Gear } from './Logo'

const STATUS = ['Starting the local daemon', 'Unlocking your keys', 'Loading your workspace']

/** The app icon; only the gear moves. */
function SplashIcon() {
  return (
    <svg viewBox="0 0 64 64" width={96} height={96} fill="none" className="splash-icon" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0f0f11" />
      <rect width="64" height="61" rx="16" fill="#2e2e33" />
      <g transform="translate(0 -1.5)">
        <path d="M51.32 26.82A20 20 0 1 1 37.18 12.68" stroke="#fff" strokeWidth="5.6" strokeLinecap="round" />
        <Gear fill="#fff" spin />
        <g stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M25.2 25.6L34 32l-8.8 6.4" />
          <path d="M37.6 39.2h6" opacity="0.55" />
        </g>
      </g>
    </svg>
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
    const timer = window.setInterval(() => setStep((value) => Math.min(STATUS.length - 1, value + 1)), 700)
    return () => window.clearInterval(timer)
  }, [phase])

  return (
    <div className={cn('splash', leaving && 'is-leaving')} role="status" aria-live="polite">
      <div className="flex w-full max-w-[400px] flex-col items-center px-6 text-center">
        <SplashIcon />
        <div className="splash-title">
          <h1 className="mt-6 text-[24px] font-extrabold leading-none text-ink">CreateCode</h1>
          <p className="mt-2 text-[12.5px] text-muted">by Bibobonking</p>
        </div>

        {phase === 'error' ? (
          <div className="splash-body mt-8 flex w-full flex-col items-center">
            <div className="adw-boxed w-full px-4 py-3.5 text-left">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <AlertCircle size={15} className="text-danger" />
                The local daemon did not answer
              </p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted">{error}</p>
            </div>
            <button type="button" onClick={onRetry} className="adw-btn adw-btn-suggested mt-4">
              <RefreshCw size={13} />
              Try again
            </button>
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
              Run <code className="rounded-[8px] bg-ink/[.06] px-1.5 py-0.5 font-mono text-[11px]">npm run daemon</code> in the app
              folder, then try again.
            </p>
          </div>
        ) : (
          <div className="splash-body mt-10 flex flex-col items-center gap-3.5">
            <div className="loading-bar h-1.5 w-44" />
            <p className="text-[12px] text-faint">{STATUS[step]}…</p>
          </div>
        )}
      </div>
    </div>
  )
}
