import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
  maxHeight = 400,
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
  const [layout, setLayout] = useState<{ top?: number; bottom?: number; left: number; height: number }>({
    left: 0,
    height: maxHeight,
  })
  useClickOutside(wrapperRef, onClose, open, panelRef)

  // The panel is portalled to <body> and positioned with fixed coordinates, so no ancestor
  // stacking context (animated welcome cards, transformed panes) can paint over it.
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
      const panelWidth = Math.min(width, window.innerWidth - EDGE * 2)
      const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - panelWidth - EDGE))
      setLayout({
        left,
        height: Math.max(96, Math.min(maxHeight, room)),
        ...(side === 'above' ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, placement, maxHeight, width])

  return (
    <div ref={wrapperRef} className="relative">
      {trigger}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ width, maxHeight: layout.height, left: layout.left, top: layout.top, bottom: layout.bottom }}
            className={cn(
              'adw-popover thin-scroll fixed z-[95] max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain',
              className,
            )}
          >
            {children}
          </div>,
          document.body,
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
        <span className="block text-[13px] leading-snug text-ink">{label}</span>
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
