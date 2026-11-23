import { useEffect, useRef } from 'react'
import { Puzzle, X } from 'lucide-react'
import { useUiRegistry } from '../extensions/registry'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'

/** Emoji / short text, an `<svg>` string, or an image (an extension file such as "assets/icon.png", a data: or http(s) URL); anything else falls back to a puzzle piece. */
export function ExtIcon({ icon, size = 16 }: { icon?: string; size?: number }) {
  if (icon && /^(\/ext\/|data:image\/|https?:\/\/)/i.test(icon.trim())) {
    return <img src={icon.trim()} alt="" aria-hidden="true" draggable={false} style={{ width: size, height: size }} className="shrink-0 object-contain" />
  }
  if (icon?.trim().startsWith('<svg')) {
    return <span aria-hidden="true" style={{ width: size, height: size }} className="inline-flex [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: icon }} />
  }
  if (icon) return <span aria-hidden="true" className="text-[14px] leading-none">{icon.slice(0, 2)}</span>
  return <Puzzle size={size} />
}

/** Top bar buttons added by extensions: actions, plus one toggle per side panel. */
export function ExtensionTopActions() {
  const registry = useUiRegistry()
  const active = useUi((state) => state.extensionPanel)
  const setPanel = useUi((state) => state.setExtensionPanel)
  const actions = registry.actions.filter((item) => item.placement === 'topbar')
  if (actions.length === 0 && registry.panels.length === 0) return null
  return (
    <>
      {actions.map((action) => (
        <button key={action.id} type="button" className="adw-icon-btn" title={action.label} aria-label={action.label} onClick={action.run}>
          <ExtIcon icon={action.icon} />
        </button>
      ))}
      {registry.panels.map((panel) => (
        <button
          key={panel.id}
          type="button"
          className={cn('adw-icon-btn', active === panel.id && 'text-accent')}
          title={panel.label}
          aria-label={panel.label}
          aria-pressed={active === panel.id}
          onClick={() => setPanel(active === panel.id ? null : panel.id)}
        >
          <ExtIcon icon={panel.icon} />
        </button>
      ))}
    </>
  )
}

/** Sidebar rows added by extensions. */
export function ExtensionSidebarActions() {
  const registry = useUiRegistry()
  const actions = registry.actions.filter((item) => item.placement === 'sidebar')
  return (
    <>
      {actions.map((action) => (
        <button key={action.id} type="button" className="adw-nav-row" onClick={action.run}>
          <span className="shrink-0 text-muted"><ExtIcon icon={action.icon} /></span>
          {action.label}
        </button>
      ))}
    </>
  )
}

/** The open extension panel, docked on the right of the conversation. */
export function ExtensionPanelDock() {
  const registry = useUiRegistry()
  const activeId = useUi((state) => state.extensionPanel)
  const setPanel = useUi((state) => state.setExtensionPanel)
  const panel = registry.panels.find((item) => item.id === activeId) ?? null
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeId && !panel) setPanel(null)
  }, [activeId, panel, setPanel])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !panel) return
    let cleanup: void | (() => void)
    try {
      cleanup = panel.render(host)
    } catch (error) {
      host.textContent = error instanceof Error ? error.message : String(error)
    }
    return () => {
      if (typeof cleanup === 'function') cleanup()
      host.replaceChildren()
    }
  }, [panel])

  if (!panel) return null
  return (
    <aside aria-label={panel.label} className="absolute inset-y-0 right-0 z-30 flex w-[min(420px,100%)] flex-col border-l border-line bg-panel shadow-2xl lg:static lg:z-auto lg:shadow-none">
      <div className="adw-headerbar shrink-0">
        <h2 className="adw-headerbar-title min-w-0 flex-1 px-2">{panel.label}</h2>
        <button type="button" className="adw-icon-btn" aria-label="Close panel" onClick={() => setPanel(null)}>
          <X size={16} />
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-y-auto" />
    </aside>
  )
}
