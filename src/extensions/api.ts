import * as React from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from 'cordis'
import { kernel } from '../core/kernel'
import type { ToolDefinition } from '../core/types'
import type { ToolName } from '../types'
import * as daemon from '../lib/daemon'
import { useChats } from '../store/chats'
import { useMcp } from '../store/mcp'
import { useModelCatalog } from '../store/models'
import { useSettings } from '../store/settings'
import { useSkills } from '../store/skills'
import { useTerminal } from '../store/terminal'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { onServerEvent } from './events'
import type { ExtensionInfo } from './types'

export const SERVICES = [
  'sessions',
  'systemPrompt',
  'tools',
  'approval',
  'llm',
  'compaction',
  'subagents',
  'ui',
  'agentLoop',
  'titles',
] as const

const toolSlug = (id: string) => id.replace(/[^a-z0-9]/gi, '_')

/** The Zustand stores of the app, for direct reads and writes (`stores.settings.getState().update({...})`). */
export const stores = {
  settings: useSettings,
  chats: useChats,
  ui: useUi,
  workspace: useWorkspace,
  models: useModelCatalog,
  mcp: useMcp,
  skills: useSkills,
  terminal: useTerminal,
}

/** What an extension's window part receives. There is no permission list: this is the live app. */
export interface LunarcodeExtension {
  readonly id: string
  readonly manifest: ExtensionInfo
  readonly appVersion: string
  /** `/ext/<id>/` — prefix for the extension's own files (images, workers, wasm…). */
  readonly base: string
  /** The Cordis child context of this extension: every service, `ctx.on(event, …)`, `ctx.effect(…)`. Hooks added with it are removed automatically. */
  readonly ctx: Context
  readonly tools: Context['tools']
  readonly ui: Context['ui']
  readonly sessions: Context['sessions']
  readonly llm: Context['llm']
  readonly approval: Context['approval']
  readonly systemPrompt: Context['systemPrompt']
  readonly compaction: Context['compaction']
  readonly subagents: Context['subagents']
  readonly agentLoop: Context['agentLoop']
  readonly titles: Context['titles']
  readonly stores: typeof stores
  readonly daemon: typeof daemon
  readonly React: typeof React
  readonly kernel: typeof kernel

  /** Registers an agent tool; the model sees it as `ext__<extension>__<name>`. Removed when the extension stops. */
  registerTool(definition: Omit<ToolDefinition, 'name'> & { name: string }): () => void
  registerCommand(id: string, label: string, run: () => void, options?: { hint?: string }): () => void
  /** A side panel opened from the top bar. `render` gets a DOM node and may return a cleanup function. */
  registerPanel(id: string, label: string, render: (host: HTMLElement) => void | (() => void), options?: { icon?: string }): () => void
  /** A button in the top bar (or sidebar). */
  registerAction(id: string, action: { label: string; run: () => void; icon?: string; placement?: 'topbar' | 'sidebar' }): () => void
  /** A settings block shown in the extension's card in Extensions. */
  registerSettings(label: string, render: (host: HTMLElement) => void | (() => void)): () => void
  registerTheme(id: string, label: string, palette: Record<string, string>, options?: { dark?: boolean }): () => void
  /** Injects CSS until the extension stops. */
  addStyle(css: string): () => void
  on: Context['on']
  /** Runs `fn` when the extension stops. */
  dispose(fn: () => void | Promise<void>): void
  notify(message: string, tone?: 'info' | 'success' | 'error'): void
  confirm(options: { title: string; body: string; confirmLabel?: string; tone?: 'danger' | 'default' }): Promise<boolean>
  log(...args: unknown[]): void
  /** Absolute URL of a file inside this extension. */
  url(path: string): string
  /** Mounts a React element into a DOM node; returns the unmount function. */
  render(host: HTMLElement, element: React.ReactNode): () => void

  /** Persistent per-extension JSON storage in `~/.lunarcode/extension-data/<id>/`. */
  storage: {
    get<T = unknown>(key: string, fallback?: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
    all(): Promise<Record<string, unknown>>
  }
  /** The extension's daemon part (`server` in the manifest). */
  server: {
    call<T = unknown>(name: string, args?: unknown): Promise<T>
    fetch(path: string, init?: RequestInit): Promise<Response>
    on(name: string, listener: (data: unknown) => void): () => void
  }
  /** `fetch` without CORS or host limits, performed by the daemon. */
  http(url: string, init?: RequestInit): Promise<Response>
}

type Track = (dispose: () => void | Promise<void>) => void

async function bodyToProxy(body: BodyInit | null | undefined): Promise<{ body?: string; bodyBase64?: string }> {
  if (body == null) return {}
  if (typeof body === 'string') return { body }
  const bytes = new Uint8Array(await new Response(body).arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return { bodyBase64: btoa(binary) }
}

export function createExtensionApi(info: ExtensionInfo, appVersion: string, ctx: Context, track: Track): LunarcodeExtension {
  const id = info.id
  const base = `/ext/${id}/`
  const owner = id

  // Icons: an image file shipped in the extension ("assets/icon.png", "icons/a.svg") becomes its /ext URL;
  // emoji, short text, `<svg …>` markup, data: and absolute URLs pass through unchanged.
  const resolveIcon = (icon?: string): string | undefined => {
    if (!icon) return icon
    const value = icon.trim()
    if (value.startsWith('<') || /^(data:|https?:|\/)/i.test(value) || !/\.(png|svg|jpe?g|webp|gif|ico|avif)$/i.test(value)) return icon
    return `${base}${value.replace(/^\.?\/+/, '')}?v=${encodeURIComponent(info.hash)}`
  }

  const own = <T extends () => void>(dispose: T): T => {
    track(dispose)
    return dispose
  }

  // Storage is cached and written back lazily so `set` is cheap in a loop.
  let cache: Promise<Record<string, unknown>> | null = null
  let flushTimer: number | undefined
  const load = () => (cache ??= daemon.getExtensionStorage(id).then((result) => result.value ?? {}))
  const flush = async () => {
    window.clearTimeout(flushTimer)
    flushTimer = undefined
    if (cache) await daemon.setExtensionStorage(id, await cache)
  }
  const schedule = () => {
    window.clearTimeout(flushTimer)
    flushTimer = window.setTimeout(() => void flush().catch(() => undefined), 250)
  }
  track(async () => {
    if (flushTimer !== undefined) await flush().catch(() => undefined)
  })

  const api: LunarcodeExtension = {
    id,
    manifest: info,
    appVersion,
    base,
    ctx,
    tools: ctx.tools,
    ui: ctx.ui,
    sessions: ctx.sessions,
    llm: ctx.llm,
    approval: ctx.approval,
    systemPrompt: ctx.systemPrompt,
    compaction: ctx.compaction,
    subagents: ctx.subagents,
    agentLoop: ctx.agentLoop,
    titles: ctx.titles,
    stores,
    daemon,
    React,
    kernel,
    on: ctx.on.bind(ctx) as Context['on'],

    registerTool(definition) {
      const name = `ext__${toolSlug(id)}__${definition.name}` as ToolName
      return own(ctx.tools.register({ ...definition, name }))
    },
    registerCommand(commandId, label, run, options) {
      return own(ctx.ui.registerCommand(`${id}:${commandId}`, label, run, { owner, hint: options?.hint }))
    },
    registerPanel(panelId, label, render, options) {
      return own(ctx.ui.registerPanel(`${id}:${panelId}`, label, render, { owner, icon: resolveIcon(options?.icon) }))
    },
    registerAction(actionId, action) {
      return own(ctx.ui.registerAction(`${id}:${actionId}`, { ...action, icon: resolveIcon(action.icon), owner }))
    },
    registerSettings(label, render) {
      return own(ctx.ui.registerSettings(id, label, render, { owner }))
    },
    registerTheme(themeId, label, palette, options) {
      const full = `ext-${id.replace(/_/g, '-')}-${themeId}`.slice(0, 64)
      return own(ctx.ui.registerTheme(full, label, palette, { dark: options?.dark, owner }))
    },
    addStyle(css) {
      const node = document.createElement('style')
      node.dataset.extension = id
      node.textContent = css
      document.head.append(node)
      return own(() => node.remove())
    },
    dispose(fn) {
      track(fn)
    },
    notify: (message, tone = 'info') => useUi.getState().notify(message, tone),
    confirm: (options) => useUi.getState().askConfirm(options),
    log: (...args) => console.log(`[${id}]`, ...args),
    url: (path) => `${base}${path.replace(/^\/+/, '')}`,
    render(host, element) {
      const root = createRoot(host)
      root.render(element)
      return own(() => root.unmount())
    },

    storage: {
      async get(key, fallback) {
        const all = await load()
        return (key in all ? all[key] : fallback) as never
      },
      async set(key, value) {
        const all = await load()
        all[key] = value
        schedule()
      },
      async delete(key) {
        const all = await load()
        delete all[key]
        schedule()
      },
      all: load,
    },

    server: {
      call: (name, args) => daemon.callExtensionRpc(id, name, args),
      async fetch(path, init = {}) {
        await daemon.ensureSession()
        const headers = new Headers(init.headers)
        const method = (init.method ?? 'GET').toUpperCase()
        if (!['GET', 'HEAD'].includes(method)) headers.set('x-maxcode-csrf', daemon.csrfToken())
        return fetch(`/api/extensions/${encodeURIComponent(id)}/x/${path.replace(/^\/+/, '')}`, {
          ...init,
          method,
          headers,
          credentials: 'same-origin',
        })
      },
      on: (name, listener) => own(onServerEvent(id, name, listener)),
    },

    async http(url, init = {}) {
      const headers: Record<string, string> = {}
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value
      })
      const result = await daemon.extensionProxy({
        url: new URL(url, window.location.href).href,
        method: init.method,
        headers,
        ...(await bodyToProxy(init.body)),
      })
      const binary = atob(result.bodyBase64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      const nullBody = [101, 204, 205, 304].includes(result.status)
      return new Response(nullBody ? null : bytes, {
        status: result.status >= 200 && result.status <= 599 ? result.status : 502,
        statusText: result.statusText,
        headers: result.contentType ? { 'content-type': result.contentType } : undefined,
      })
    },
  }
  return api
}
