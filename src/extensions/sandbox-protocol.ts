// Pure helpers for Sandbox mode (the app side of the iframe bridge, see sandbox.ts). No imports at runtime,
// so node can unit-test them directly (sandbox-protocol.test.mjs).

/** Theme tokens copied into sandbox frames so panels look like the app. */
export const THEME_TOKENS = [
  'canvas', 'panel', 'raised', 'line', 'ink', 'muted', 'faint', 'accent', 'accent-soft', 'on-accent', 'success', 'warning',
  'danger', 'headerbar', 'sidebar', 'sidebar-2', 'card', 'popover', 'dialog', 'link',
] as const

export const LIMITS = {
  registrations: 60,
  messagesPerSecond: 600,
  text: 200_000,
  styleBytes: 200_000,
  storageBytes: 1_000_000,
  assetBytes: 8_000_000,
  schemaBytes: 20_000,
  rpcTimeoutMs: 120_000,
}

export function clampText(value: unknown, max = LIMITS.text): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const REMOTE = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/**
 * Makes an extension's stylesheet harmless for the app window: no remote `@import`/`url()` (CSS can leak data
 * through requests), no legacy script hooks, and relative `url()` pointing into the extension's own folder.
 */
export function sanitizeCss(css: string, options: { base?: string } = {}): string {
  const base = options.base ?? ''
  let out = css
    .replace(/@import[^;]*;?/gi, '/* @import removed in sandbox mode */')
    .replace(/expression\s*\(/gi, 'blocked(')
    .replace(/behaviou?r\s*:[^;}]*/gi, '')
    .replace(/-moz-binding\s*:[^;}]*/gi, '')
  out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_match, quote: string, target: string) => {
    const value = target.trim()
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(value) || value.startsWith('#')) return `url(${quote}${value}${quote})`
    if (REMOTE.test(value) || value.startsWith('/')) return 'url()'
    if (!base || value.includes('..')) return 'url()'
    return `url(${quote}${base}${value.replace(/^\.?\//, '')}${quote})`
  })
  return out
}

/** Sandbox panels and buttons may show an emoji, short text, an image of the extension or a data: image; never markup. */
export function sanitizeIcon(icon: unknown, resolve: (path: string) => string): string | undefined {
  if (typeof icon !== 'string') return undefined
  const value = icon.trim()
  if (!value || value.length > 300_000) return undefined
  if (value.startsWith('<')) return undefined
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(value)) return value
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value)) return undefined
  if (/\.(?:png|svg|jpe?g|webp|gif|ico|avif)$/i.test(value)) return value.includes('..') ? undefined : resolve(value)
  return value.length <= 4 ? value : undefined
}

export function isPlainJson(value: unknown, maxBytes = LIMITS.schemaBytes): boolean {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' && text.length <= maxBytes
  } catch {
    return false
  }
}

/** Counts events in a sliding second; `hit()` is true once the limit is exceeded. */
export function createFloodGuard(limit: number, windowMs = 1000, now: () => number = Date.now) {
  let start = 0
  let count = 0
  return {
    hit(): boolean {
      const time = now()
      if (time - start >= windowMs) {
        start = time
        count = 0
      }
      count += 1
      return count > limit
    },
  }
}

export interface ToolMeta {
  description: string
  parameters: Record<string, unknown>
  approval: 'auto' | 'ask'
  modes: { build: boolean; plan: boolean }
}

/** Checks what a sandboxed extension said about its tool; anything odd is cut down to something safe. */
export function normalizeToolMeta(meta: unknown): ToolMeta | null {
  if (!meta || typeof meta !== 'object') return null
  const source = meta as Record<string, unknown>
  const parameters = source.parameters
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || !isPlainJson(parameters)) return null
  const modes = (source.modes ?? {}) as Record<string, unknown>
  return {
    description: clampText(source.description, 4000),
    parameters: parameters as Record<string, unknown>,
    approval: source.approval === 'ask' ? 'ask' : 'auto',
    modes: { build: modes.build !== false, plan: modes.plan === true },
  }
}

/** What a sandboxed tool may hand back to the model: text only. */
export function normalizeToolResult(value: unknown): { output: string; isError: boolean } {
  if (typeof value === 'string') return { output: clampText(value), isError: false }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return { output: clampText(source.output ?? ''), isError: source.isError === true }
  }
  return { output: '', isError: false }
}

export const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value)
