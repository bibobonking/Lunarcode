import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, CircleX, Info, LoaderCircle, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { useUi } from '../store/ui'

/* AdwDialog: centered on desktop, bottom sheet on narrow screens. Solid surface, no blur. */
export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null)

    const timer = window.setTimeout(() => {
      const target = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0]
      ;(target ?? panel)?.focus()
    }, 30)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      restoreRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button type="button" aria-label="Close dialog" tabIndex={-1} onClick={onClose} className="adw-scrim cursor-default" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          'adw-dialog max-h-[92dvh] w-full rounded-b-none sm:max-h-[86dvh] sm:rounded-b-[15px]',
          wide ? 'sm:w-[min(920px,94vw)]' : 'sm:w-[min(640px,94vw)]',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/* Dialog headerbar: centered title (+ optional subtitle), actions left of a flat close button. */
export function ModalHeader({
  title,
  description,
  onClose,
  id,
  actions,
}: {
  title: string
  description?: string
  onClose: () => void
  id?: string
  actions?: ReactNode
}) {
  return (
    <div className="adw-headerbar shrink-0 gap-2 bg-dialog px-3">
      <div className="min-w-0 flex-1 px-1">
        <h2 id={id} className="adw-headerbar-title">
          {title}
        </h2>
        {description && <p className="adw-headerbar-subtitle">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <button type="button" className="adw-icon-btn" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

/* AdwSpinner-style indicator. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cn('animate-spin text-current', className)} aria-hidden="true" />
}

/* AdwSwitch: 48×26 pill, 22px knob. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[26px] w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-ink/[.18]',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-transform duration-200 ease-out',
          checked ? 'translate-x-[24px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

/* Visual-only 18px radio / checkbox indicators for rows that already are the interactive control. */
export function RadioMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked ? 'is-checked border-accent bg-accent' : 'border-ink/30',
        className,
      )}
    >
      {checked && <span className="h-1.5 w-1.5 rounded-full bg-on-accent" />}
    </span>
  )
}

export function CheckMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors',
        checked ? 'is-checked border-accent bg-accent text-on-accent' : 'border-ink/30',
        className,
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.2 5 8.6 9.5 3.6" />
        </svg>
      )}
    </span>
  )
}

/* View switcher / linked toggle: flat buttons, neutral selected wash. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  className,
  size = 'sm',
}: {
  options: Array<{ value: T; label: string; title?: string }>
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div
      role="group"
      className={cn('inline-flex items-center gap-0.5 rounded-[9px] bg-ink/[.06] p-0.5', disabled && 'opacity-50', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[7px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed',
            size === 'md' ? 'h-8 px-3 text-[14px]' : 'h-[26px] px-2.5 text-[13px]',
            value === option.value ? 'bg-panel text-ink shadow-[0_0_0_1px_rgb(var(--line))]' : 'text-muted hover:bg-ink/[.06] hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="adw-kbd font-sans">{children}</kbd>
}

/* Preferences page building blocks. */
export function PageGroup({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-2', className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {title && <h3 className="adw-heading">{title}</h3>}
            {description && <p className="adw-caption mt-0.5">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function BoxedList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('adw-boxed', className)}>{children}</div>
}

/* One boxed-list row: icon, title + subtitle on the left, control on the right. */
export function ListRow({
  title,
  subtitle,
  icon,
  trailing,
  onClick,
  active,
  disabled,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  className?: string
}) {
  const body = (
    <>
      {icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="adw-row-title block">{title}</span>
        {subtitle && <span className="adw-row-subtitle block">{subtitle}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-muted">{trailing}</span>}
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={cn('adw-row disabled:opacity-45', active && 'is-active', className)}>
        {body}
      </button>
    )
  }
  return <div className={cn('adw-row', active && 'is-active', disabled && 'opacity-45', className)}>{body}</div>
}

/* Welcome / empty / error status page. */
export function StatusPage({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center text-muted">{icon}</div>}
      <h2 className="text-[20px] font-bold leading-tight text-ink">{title}</h2>
      {description && <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted">{description}</p>}
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  )
}

const toneStyles = {
  info: { icon: Info, className: 'text-[#78aeed]' },
  success: { icon: CircleCheck, className: 'text-[#57e389]' },
  error: { icon: CircleX, className: 'text-[#ff7b63]' },
}

/* Bottom-center dark toast. */
export function ToastHost() {
  const toast = useUi((state) => state.toast)
  const dismiss = useUi((state) => state.dismissToast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => dismiss(toast.id), 4500)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])

  if (!toast) return null
  const tone = toneStyles[toast.tone]
  const Icon = tone.icon
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex justify-center px-4">
      <div role="status" className="adw-toast flex max-w-[min(92vw,480px)] items-center gap-2.5">
        <Icon size={16} className={cn('shrink-0', tone.className)} />
        <p className="min-w-0 flex-1 text-[14px] leading-snug">{toast.message}</p>
        <button
          type="button"
          className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => dismiss(toast.id)}
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  )
}

/* AdwMessageDialog: title, body, right-aligned Cancel + suggested/destructive action. */
export function ConfirmDialog() {
  const confirm = useUi((state) => state.confirm)
  const resolve = useUi((state) => state.resolveConfirm)
  const danger = confirm?.tone === 'danger'

  return (
    <Modal open={Boolean(confirm)} onClose={() => resolve(false)} className="sm:w-[420px]">
      <div className="p-6">
        <h2 className="text-[18px] font-bold leading-tight">{confirm?.title}</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">{confirm?.body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="adw-btn" onClick={() => resolve(false)}>
            Cancel
          </button>
          <button
            type="button"
            data-autofocus
            onClick={() => resolve(true)}
            className={cn('adw-btn', danger ? 'adw-btn-destructive' : 'adw-btn-suggested')}
          >
            {confirm?.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
