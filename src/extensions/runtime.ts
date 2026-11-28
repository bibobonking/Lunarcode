import type { Context } from 'cordis'
import { kernel } from '../core/kernel'
import { useExtensions } from '../store/extensions'
import { SERVICES, createExtensionApi, stores, type CreateCodeExtension } from './api'
import * as daemon from '../lib/daemon'
import type { ExtensionInfo, ExtensionThemeSpec } from './types'

interface Running {
  hash: string
  fiber: { dispose(): Promise<void> }
  disposers: Array<() => void | Promise<void>>
  module?: { deactivate?: () => void | Promise<void> }
  api?: CreateCodeExtension
}

const running = new Map<string, Running>()
let chain: Promise<unknown> = Promise.resolve()

/** One extension at a time: the module body may read `globalThis.createcode` while it evaluates. */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task)
  chain = next.catch(() => undefined)
  return next
}

export function themeId(ext: ExtensionInfo, theme: ExtensionThemeSpec): string {
  return `ext-${ext.id.replace(/_/g, '-')}-${theme.id}`.slice(0, 64)
}

function addLink(id: string, href: string): () => void {
  const node = document.createElement('link')
  node.rel = 'stylesheet'
  node.href = href
  node.dataset.extension = id
  document.head.append(node)
  return () => node.remove()
}

function addStyle(id: string, css: string): () => void {
  const node = document.createElement('style')
  node.dataset.extension = id
  node.textContent = css
  document.head.append(node)
  return () => node.remove()
}

async function deactivate(id: string): Promise<void> {
  const entry = running.get(id)
  if (!entry) return
  running.delete(id)
  try {
    await entry.module?.deactivate?.()
  } catch (error) {
    console.error(`[extension ${id}] deactivate failed`, error)
  }
  for (const dispose of entry.disposers.splice(0).reverse()) {
    try {
      await dispose()
    } catch (error) {
      console.error(`[extension ${id}] cleanup failed`, error)
    }
  }
  await entry.fiber.dispose().catch(() => undefined)
  kernel.ui.unregisterOwner(id)
  useExtensions.getState().setRuntime(id, null)
}

async function activate(info: ExtensionInfo, appVersion: string): Promise<void> {
  await deactivate(info.id)
  const store = useExtensions.getState()
  const hasWindowPart = Boolean(info.main) || info.styles.length > 0 || info.themes.length > 0
  if (!hasWindowPart) return
  store.setRuntime(info.id, 'loading')

  const disposers: Array<() => void | Promise<void>> = []
  const track = (dispose: () => void | Promise<void>) => void disposers.push(dispose)
  const toolsBefore = new Set<string>(kernel.tools.names())

  let resolveContext!: (ctx: Context) => void
  const contextReady = new Promise<Context>((resolve) => {
    resolveContext = resolve
  })
  const fiber = kernel.plugin(
    {
      name: `extension-${info.id}`,
      inject: [...SERVICES],
      apply: (ctx: Context) => resolveContext(ctx),
    } as never,
    undefined as never,
  )
  const entry: Running = { hash: info.hash, fiber, disposers }
  running.set(info.id, entry)

  try {
    const ctx = await contextReady
    const version = encodeURIComponent(info.hash)
    for (const file of info.styles) track(addLink(info.id, `/ext/${info.id}/${file}?v=${version}`))

    const api = createExtensionApi(info, appVersion, ctx, track)
    entry.api = api

    for (const theme of info.themes) {
      const css = theme.css ? await fetch(`/ext/${info.id}/${theme.css}?v=${version}`).then((r) => (r.ok ? r.text() : '')) : ''
      if (css) track(addStyle(info.id, css))
      if (theme.tokens) api.registerTheme(theme.id, theme.label, theme.tokens, { dark: theme.dark })
      else if (css) {
        // CSS-only theme: it styles [data-theme='ext-…'] itself; just make it selectable.
        const full = themeId(info, theme)
        kernel.ui.registerTheme(full, theme.label, {}, { dark: theme.dark, owner: info.id })
      }
    }

    if (info.main) {
      const url = `/ext/${info.id}/${info.main}?v=${version}`
      const scoped = globalThis as typeof globalThis & { createcode?: CreateCodeExtension }
      scoped.createcode = api
      let mod: Record<string, unknown>
      try {
        mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>
      } finally {
        delete scoped.createcode
      }
      entry.module = mod as Running['module']
      const start = typeof mod.default === 'function' ? mod.default : mod.activate
      if (typeof start === 'function') await (start as (api: CreateCodeExtension) => unknown)(api)
    }

    // Safety net: tools registered through the raw service during activation are removed with the extension.
    for (const name of kernel.tools.names()) {
      if (!toolsBefore.has(name)) track(() => kernel.tools.unregister(name))
    }
    store.setRuntime(info.id, 'active')
  } catch (error) {
    console.error(`[extension ${info.id}] failed to start`, error)
    store.setRuntime(info.id, 'error', error instanceof Error ? error.message : String(error))
    await deactivate(info.id)
    store.setRuntime(info.id, 'error', error instanceof Error ? error.message : String(error))
  }
}

/** Starts, reloads (when its files changed) or stops extensions so the window matches the daemon's list. */
export function syncRuntime(extensions: ExtensionInfo[], appVersion: string): Promise<void> {
  return exclusive(async () => {
    const wanted = new Map(extensions.filter((item) => item.enabled && !item.error).map((item) => [item.id, item]))
    for (const id of [...running.keys()]) if (!wanted.has(id)) await deactivate(id)
    for (const info of wanted.values()) {
      const current = running.get(info.id)
      const failed = useExtensions.getState().runtime[info.id]?.state === 'error'
      if (current && current.hash === info.hash) continue
      if (!current && failed && useExtensions.getState().runtime[info.id] && lastFailedHash.get(info.id) === info.hash) continue
      await activate(info, appVersion)
      if (useExtensions.getState().runtime[info.id]?.state === 'error') lastFailedHash.set(info.id, info.hash)
      else lastFailedHash.delete(info.id)
    }
  })
}

/** A broken extension is not retried until its files change. */
const lastFailedHash = new Map<string, string>()

export function runningExtensionIds(): string[] {
  return [...running.keys()]
}

/** `window.CreateCode`: the same live objects, for DevTools and for code that is not an extension entry. */
export function installGlobal(appVersion: string): void {
  Object.assign(globalThis, {
    CreateCode: {
      version: appVersion,
      kernel,
      stores,
      daemon,
      extensions: () => [...running.keys()],
    },
  })
}
