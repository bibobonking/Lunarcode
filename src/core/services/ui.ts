import { Service, type Context } from 'cordis'
import { registerTheme as registerThemeInApp, unregisterTheme as unregisterThemeInApp } from '../../lib/themes'

/** `render` may return a cleanup function. */
type Render = (host: HTMLElement) => void | (() => void)

export interface UiCommand {
  id: string
  label: string
  hint?: string
  owner?: string
  run: () => void
}

export interface UiPanel {
  id: string
  label: string
  /** Emoji / short text, or an `<svg …>` string. */
  icon?: string
  owner?: string
  render: Render
}

export interface UiAction {
  id: string
  label: string
  icon?: string
  owner?: string
  placement: 'topbar' | 'sidebar'
  run: () => void
}

export interface UiSettings {
  id: string
  label: string
  owner?: string
  render: Render
}

export interface UiTheme {
  id: string
  label: string
  dark: boolean
  owner?: string
  palette: Record<string, string>
}

export interface UiSnapshot {
  commands: UiCommand[]
  panels: UiPanel[]
  actions: UiAction[]
  settings: UiSettings[]
  themes: UiTheme[]
}

const STYLE_ID = (id: string) => `lunarcode-theme-${id}`

function tokens(palette: Record<string, string>): Array<[string, string]> {
  return Object.entries(palette).filter(([token, value]) => /^[a-z][a-z0-9-]*$/.test(token) && /^[\d\s.]+$/.test(value))
}

function isDarkPalette(palette: Record<string, string>): boolean {
  const canvas = (palette.canvas ?? '').trim().split(/\s+/).map(Number)
  const [r, g, b] = canvas.length === 3 ? canvas : [255, 255, 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
}

export function themeCss(themeId: string, palette: Record<string, string>): string {
  const entries = tokens(palette).map(([token, value]) => `--${token}:${value.trim()}`)
  return entries.length === 0 ? '' : `[data-theme='${themeId}']{${entries.join(';')}}`
}

function applyThemeStyles(id: string, css: string) {
  if (typeof document === 'undefined') return
  let node = document.getElementById(STYLE_ID(id)) as HTMLStyleElement | null
  if (!node) {
    node = document.createElement('style')
    node.id = STYLE_ID(id)
    document.head.append(node)
  }
  node.textContent = css
}

function removeThemeStyles(id: string) {
  if (typeof document === 'undefined') return
  document.getElementById(STYLE_ID(id))?.remove()
}

/**
 * Everything an extension can add to the interface. React reads it through `useUiRegistry`
 * (`src/extensions/registry.ts`); registering returns the function that takes it away again.
 */
export class UiService extends Service {
  static provide = 'ui'
  private _commands = new Map<string, UiCommand>()
  private _panels = new Map<string, UiPanel>()
  private _actions = new Map<string, UiAction>()
  private _settings = new Map<string, UiSettings>()
  private _themes = new Map<string, UiTheme>()
  private _listeners = new Set<() => void>()
  private _snapshot: UiSnapshot | null = null

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  private changed() {
    this._snapshot = null
    for (const listener of [...this._listeners]) listener()
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  /** Stable between changes, so it is safe for `useSyncExternalStore`. */
  snapshot = (): UiSnapshot => {
    this._snapshot ??= {
      commands: [...this._commands.values()],
      panels: [...this._panels.values()],
      actions: [...this._actions.values()],
      settings: [...this._settings.values()],
      themes: [...this._themes.values()],
    }
    return this._snapshot
  }

  private add<T extends { id: string }>(map: Map<string, T>, item: T): () => void {
    map.set(item.id, item)
    this.changed()
    return () => {
      if (map.get(item.id) === item) {
        map.delete(item.id)
        this.changed()
      }
    }
  }

  registerCommand(id: string, label: string, run: () => void, options: { owner?: string; hint?: string } = {}): () => void {
    return this.add(this._commands, { id, label, run, ...options })
  }

  registerPanel(id: string, label: string, render: Render, options: { owner?: string; icon?: string } = {}): () => void {
    return this.add(this._panels, { id, label, render, ...options })
  }

  registerAction(
    id: string,
    action: { label: string; run: () => void; icon?: string; placement?: 'topbar' | 'sidebar'; owner?: string },
  ): () => void {
    return this.add(this._actions, { id, placement: 'topbar', ...action })
  }

  registerSettings(id: string, label: string, render: Render, options: { owner?: string } = {}): () => void {
    return this.add(this._settings, { id, label, render, ...options })
  }

  registerTheme(
    id: string,
    label: string,
    palette: Record<string, string>,
    options: { dark?: boolean; owner?: string } = {},
  ): () => void {
    const theme: UiTheme = { id, label, palette, dark: options.dark ?? isDarkPalette(palette), owner: options.owner }
    this._themes.set(id, theme)
    registerThemeInApp({ id, label, dark: theme.dark })
    applyThemeStyles(id, themeCss(id, palette))
    this.changed()
    return () => {
      if (this._themes.get(id) === theme) {
        this._themes.delete(id)
        unregisterThemeInApp(id)
        removeThemeStyles(id)
        this.changed()
      }
    }
  }

  /** Removes everything one extension added, whatever way it registered it. */
  unregisterOwner(owner: string): void {
    let touched = false
    for (const map of [this._commands, this._panels, this._actions, this._settings] as Array<Map<string, { owner?: string }>>) {
      for (const [id, item] of [...map]) {
        if (item.owner === owner) {
          map.delete(id)
          touched = true
        }
      }
    }
    for (const [id, theme] of [...this._themes]) {
      if (theme.owner === owner) {
        this._themes.delete(id)
        unregisterThemeInApp(id)
        removeThemeStyles(id)
        touched = true
      }
    }
    if (touched) this.changed()
  }

  commands(): UiCommand[] {
    return [...this._commands.values()]
  }

  panels(): UiPanel[] {
    return [...this._panels.values()]
  }

  themes(): Array<{ id: string; label: string; dark: boolean }> {
    return [...this._themes.values()].map((theme) => ({ id: theme.id, label: theme.label, dark: theme.dark }))
  }
}
