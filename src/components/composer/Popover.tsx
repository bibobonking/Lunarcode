import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useClickOutside } from '../../lib/hooks'
import { cn } from '../../lib/utils'
import { RadioMark } from '../ui'

const EDGE = 12
const GAP = 8

/**
 * A trigger plus a floating panel. It opens on the side with room (flipping above/below, and
 * left/right), never grows past `maxHeight` or the viewport, and scrolls inside when longer.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  width = 260,
  placement = 'above',
  maxHeight = 260,
  className,
}: {
  open: boolean
  onClose: () => void
  trigger: ReactNode
  children: ReactNode
  width?: number
  /** Preferred side; flips when the other side has clearly more room. */
  placement?: 'above' | 'below'
  /** Upper bound for the panel height before it scrolls. */
  maxHeight?: number
  className?: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ side: placement, height: maxHeight, alignRight: false })
  useClickOutside(wrapperRef, onClose, open)

  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const wrapper = wrapperRef.current
      if (!wrapper) return
      const rect = wrapper.getBoundingClientRect()
      const above = rect.top - EDGE - GAP
      const below = window.innerHeight - rect.bottom - EDGE - GAP
      const natural = Math.min(panelRef.current?.scrollHeight ?? maxHeight, maxHeight)
      const fits = (room: number) => room >= natural
      const preferred = placement === 'above' ? above : below
      const other = placement === 'above' ? below : above
      const side = fits(preferred) || preferred >= other ? placement : placement === 'above' ? 'below' : 'above'
      const room = side === 'above' ? above : below
      setLayout({
        side,
        height: Math.max(96, Math.min(maxHeight, room)),
        alignRight: rect.left + width > window.innerWidth - EDGE,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, placement, maxHeight, width])

  return (
    <div ref={wrapperRef} className="relative">
      {trigger}
      {open && (
        <div
          ref={panelRef}
          style={{ width, maxHeight: layout.height }}
          className={cn(
            'adw-popover thin-scroll absolute z-40 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain',
            layout.alignRight ? 'right-0' : 'left-0',
            layout.side === 'above' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+6px)]',
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 pt-1.5 text-[12px] font-semibold text-muted">{children}</p>
}

/** A radio-style option row: label + hint with an 18px indicator. */
export function MenuOption({
  selected,
  label,
  hint,
  onClick,
}: {
  selected: boolean
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-[9px] px-3 py-2 text-left transition-colors hover:bg-ink/[.08]"
    >
      <RadioMark checked={selected} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[14px] leading-snug text-ink">{label}</span>
        {hint && <span className="block text-[12px] leading-snug text-muted">{hint}</span>}
      </span>
    </button>
  )
}

/** A flat text toolbar button: no fill until hovered or its panel is open. */
export function TextButton({
  children,
  open,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { open?: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      {...props}
      className={cn('adw-btn adw-btn-flat h-8 gap-1 px-2.5 text-[13px] text-muted hover:text-ink', open && 'bg-ink/[.1] text-ink', className)}
    >
      {children}
    </button>
  )
}
