// Sandbox mode, app side. An extension that is not Trusted never touches this window's JavaScript: its window
// code runs in a sandboxed iframe (opaque origin, no network, see server/lib/ext-sandbox.mjs) and everything it
// can do goes through the small set of messages handled here. Each message is validated and capped; attempts to
// go further are recorded as anomalies and a flood suspends the extension.

import type { Context } from 'cordis'
import type { ToolName } from '../types'
import type { ToolDefinition } from '../core/types'
import * as daemon from '../lib/daemon'
import { useUi } from '../store/ui'
import {
  LIMITS,
  THEME_TOKENS,
  clampText,
  createFloodGuard,
  isPlainJson,
  normalizeToolMeta,
  normalizeToolResult,
  sanitizeCss,
  sanitizeIcon,
  validId,
} from './sandbox-protocol'
import type { ExtensionInfo } from './types'

type Role = 'logic' | 'panel' | 'settings'
type Track = (dispose: () => void | Promise<void>) => void

interface Frame {
  role: Role
  panel?: string
  nonce: string
  el: HTMLIFrameElement
  ready: boolean
  started: Promise<void>
  resolveStarted: () => void
  rejectStarted: (error: Error) => void
  disposed?: () => void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: number
}

const toolSlug = (id: string) => id.replace(/[^a-z0-9]/gi, '_')
const randomNonce = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('')

function themePayload() {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const vars: Record<string, string> = {}
  for (const name of THEME_TOKENS) {
    const value = style.getPropertyValue(`--${name}`).trim()
    if (value) vars[name] = value
  }
  return { vars, dark: root.classList.contains('dark') }
}

export async function startSandbox(args: {
  info: ExtensionInfo
  appVersion: string
  ctx: Context
  track: Track
  onSuspend: (reason: string) => void
}): Promise<void> {
  const { info, appVersion, ctx, track, onSuspend } = args
  const id = info.id
  const base = `/ext/${id}/`
  const version = encodeURIComponent(info.hash)
  const frames = new Map<Window, Frame>()
  const regs = new Map<string, () => void>()
  const calls = new Map<number, Pending>()
  const flood = createFloodGuard(LIMITS.messagesPerSecond)
  const notifyGuard = createFloodGuard(8, 10_000)
  let counter = 0
  let suspended = false
  let closed = false
  let lastToast = 0

  // ---- anomalies ------------------------------------------------------------------------------
  const report = (kind: string, level: 'low' | 'medium' | 'high', message: string) => {
    if (closed) return
    void daemon.reportExtensionAnomaly(id, { kind, level, message }).catch(() => undefined)
    if (Date.now() - lastToast > 60_000) {
      lastToast = Date.now()
      useUi.getState().notify(`${info.name} (Sandbox) tried something it is not allowed to do: ${message}. Details are in Extensions.`, 'error')
    }
    if (level === 'high') suspend(message)
  }

  function suspend(reason: string) {
    if (suspended || closed) return
    suspended = true
    void disposeAll()
    onSuspend(reason)
  }

  // ---- frames ---------------------------------------------------------------------------------
  const send = (frame: Frame, message: Record<string, unknown>) => frame.el.contentWindow?.postMessage({ cce: 1, ...message }, '*')

  function createFrame(role: Role, host: HTMLElement, panel?: string): Frame {
    const nonce = randomNonce()
    const el = document.createElement('iframe')
    el.setAttribute('sandbox', 'allow-scripts')
    el.setAttribute('referrerpolicy', 'no-referrer')
    el.setAttribute('allow', '')
    el.title = `${info.name} (${role})`
    const query = new URLSearchParams({ role, nonce, v: info.hash })
    if (panel) query.set('panel', panel)
    el.src = `/api/extensions/${encodeURIComponent(id)}/sandbox?${query}`
    let resolveStarted!: () => void
    let rejectStarted!: (error: Error) => void
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve
      rejectStarted = reject
    })
    started.catch(() => undefined)
    const frame: Frame = { role, panel, nonce, el, ready: false, started, resolveStarted, rejectStarted }
    host.append(el)
    if (el.contentWindow) frames.set(el.contentWindow, frame)
    return frame
  }

  function destroyFrame(frame: Frame) {
    const win = frame.el.contentWindow
    if (win) {
      try {
        win.postMessage({ cce: 1, type: 'dispose' }, '*')
      } catch {
        // The frame is already gone.
      }
      frames.delete(win)
    }
    frame.rejectStarted(new Error('Closed'))
    window.setTimeout(() => frame.el.remove(), 0)
  }

  const hidden = (el: HTMLIFrameElement) => {
    el.tabIndex = -1
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none'
  }

  function mountView(role: 'panel' | 'settings', host: HTMLElement, panel?: string): () => void {
    const frame = createFrame(role, host, panel)
    frame.el.style.cssText =
      role === 'panel'
        ? 'display:block;width:100%;height:100%;min-height:100%;border:0;background:transparent'
        : 'display:block;width:100%;height:160px;border:0;background:transparent'
    return () => destroyFrame(frame)
  }

  // ---- calls into the extension ---------------------------------------------------------------
  let logic: Frame | null = null
  function callFrame(kind: 'tool' | 'command' | 'action', callId: string, callArgs?: unknown): Promise<unknown> {
    const frame = logic
    if (!frame || suspended || closed) return Promise.reject(new Error('The extension is not running.'))
    return new Promise((resolve, reject) => {
      const rid = ++counter
      const timer = window.setTimeout(() => {
        calls.delete(rid)
        reject(new Error('The extension did not answer in time.'))
      }, LIMITS.rpcTimeoutMs)
      calls.set(rid, { resolve, reject, timer })
      send(frame, { type: 'call', rid, kind, id: callId, args: callArgs })
    })
  }

  // ---- storage (own namespace, size-capped) ---------------------------------------------------
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

  // ---- requests from the extension ------------------------------------------------------------
  async function handleRpc(method: string, input: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'notify': {
        if (notifyGuard.hit()) {
          report('notify-spam', 'low', 'Too many notifications')
          return null
        }
        const tone = input.tone === 'success' || input.tone === 'error' ? input.tone : 'info'
        useUi.getState().notify(clampText(input.message, 300), tone)
        return null
      }
      case 'confirm': {
        const options = input as { title?: unknown; body?: unknown; confirmLabel?: unknown; tone?: unknown }
        return useUi.getState().askConfirm({
          title: clampText(`${info.name}: ${clampText(options.title, 100)}`, 140),
          body: `${clampText(options.body, 600)}\n\n(${info.name} is running in Sandbox mode.)`,
          confirmLabel: options.confirmLabel ? clampText(options.confirmLabel, 24) : undefined,
          tone: options.tone === 'danger' ? 'danger' : 'default',
        })
      }
      case 'log':
        console.log(`[${id}${input.level === 'error' ? ' error' : ''}]`, clampText(input.text, 2000))
        return null
      case 'storage.get': {
        const all = await load()
        const key = String(input.key)
        return key in all ? { found: true, value: all[key] } : { found: false }
      }
      case 'storage.set': {
        const all = await load()
        const key = String(input.key).slice(0, 200)
        if (!isPlainJson(input.value, LIMITS.storageBytes)) throw new Error('That value is too large or is not JSON.')
        const next = { ...all, [key]: input.value }
        if (!isPlainJson(next, LIMITS.storageBytes)) throw new Error('Sandbox storage is limited to 1 MB.')
        all[key] = input.value
        schedule()
        return null
      }
      case 'storage.delete': {
        const all = await load()
        delete all[String(input.key)]
        schedule()
        return null
      }
      case 'storage.all':
        return await load()
      case 'asset': {
        const path = String(input.path ?? '').replace(/^\.?\/+/, '')
        if (!path || path.includes('..') || path.includes('\\')) throw new Error('Bad asset path.')
        await daemon.ensureSession()
        const response = await fetch(`${base}${path}?v=${version}`, { credentials: 'same-origin' })
        if (!response.ok) throw new Error(`Asset not found: ${path}`)
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength > LIMITS.assetBytes) throw new Error('Asset is too large for Sandbox mode.')
        return { bytes, type: response.headers.get('content-type') ?? '' }
      }
      default:
        report('unknown-rpc', 'low', `Unknown request "${clampText(method, 40)}"`)
        throw new Error(`Unknown request: ${method}`)
    }
  }

  // ---- registrations --------------------------------------------------------------------------
  function register(kind: string, regId: unknown, meta: unknown) {
    if (!logic) return
    if (!validId(regId)) return report('bad-register', 'low', `Invalid ${kind} id`)
    const key = `${kind}:${regId}`
    regs.get(key)?.()
    regs.delete(key)
    if (regs.size >= LIMITS.registrations) return report('flood', 'medium', 'Registered too many items')
    const info2 = (meta ?? {}) as Record<string, unknown>
    const label = clampText(info2.label, 80) || regId
    let dispose: (() => void) | null = null
    switch (kind) {
      case 'tool': {
        const parsed = normalizeToolMeta(meta)
        if (!parsed || !/^[A-Za-z0-9_-]{1,40}$/.test(regId)) return report('bad-register', 'low', 'Invalid tool definition')
        const definition: ToolDefinition = {
          name: `ext__${toolSlug(id)}__${regId}` as ToolName,
          description: parsed.description,
          parameters: parsed.parameters as never,
          approval: parsed.approval,
          allowedInMode: (mode) => (mode === 'plan' ? parsed.modes.plan : parsed.modes.build),
          execute: async (toolArgs) => normalizeToolResult(await callFrame('tool', regId, toolArgs)),
        }
        dispose = ctx.tools.register(definition)
        break
      }
      case 'command':
        dispose = ctx.ui.registerCommand(
          `${id}:${regId}`,
          label,
          () => void callFrame('command', regId).catch((error) => useUi.getState().notify(error instanceof Error ? error.message : String(error), 'error')),
          { owner: id, hint: info2.hint ? clampText(info2.hint, 120) : undefined },
        )
        break
      case 'action':
        dispose = ctx.ui.registerAction(`${id}:${regId}`, {
          label,
          icon: sanitizeIcon(info2.icon, (path) => `${base}${path.replace(/^\.?\/+/, '')}?v=${version}`),
          placement: info2.placement === 'sidebar' ? 'sidebar' : 'topbar',
          owner: id,
          run: () => void callFrame('action', regId).catch((error) => useUi.getState().notify(error instanceof Error ? error.message : String(error), 'error')),
        })
        break
      case 'panel':
        dispose = ctx.ui.registerPanel(`${id}:${regId}`, label, (host) => mountView('panel', host, regId), {
          owner: id,
          icon: sanitizeIcon(info2.icon, (path) => `${base}${path.replace(/^\.?\/+/, '')}?v=${version}`),
        })
        break
      case 'settings':
        dispose = ctx.ui.registerSettings(id, label, (host) => mountView('settings', host), { owner: id })
        break
      case 'theme': {
        const palette: Record<string, string> = {}
        for (const [token, value] of Object.entries((info2.palette ?? {}) as Record<string, unknown>).slice(0, 60)) palette[token] = clampText(value, 40)
        dispose = ctx.ui.registerTheme(`ext-${id.replace(/_/g, '-')}-${regId}`.slice(0, 64), label, palette, { dark: info2.dark === true, owner: id })
        break
      }
      case 'style': {
        const css = clampText(info2.css, LIMITS.styleBytes)
        dispose = addStyleNode(sanitizeCss(css, { base }))
        break
      }
      default:
        return report('bad-register', 'low', `Unknown item "${clampText(kind, 30)}"`)
    }
    if (dispose) regs.set(key, dispose)
  }

  function addStyleNode(css: string): () => void {
    const node = document.createElement('style')
    node.dataset.extension = id
    node.textContent = css
    document.head.append(node)
    return () => node.remove()
  }

  // ---- messages -------------------------------------------------------------------------------
  const onMessage = (event: MessageEvent) => {
    const frame = event.source ? frames.get(event.source as Window) : undefined
    if (!frame) return
    const message = event.data as Record<string, unknown> | null
    if (!message || message.cce !== 1 || typeof message.type !== 'string') return
    if (flood.hit()) return report('flood', 'high', 'Sent too many messages per second')
    switch (message.type) {
      case 'ready':
        if (message.nonce !== frame.nonce || frame.ready) return report('bad-handshake', 'medium', 'Unexpected handshake')
        frame.ready = true
        send(frame, { type: 'init', manifest: { id, name: info.name, version: info.version, description: info.description, author: info.author }, appVersion, theme: themePayload() })
        break
      case 'started':
        frame.resolveStarted()
        break
      case 'failed':
        frame.rejectStarted(new Error(clampText(message.error, 600) || 'The extension failed to start.'))
        break
      case 'register':
        if (frame.role === 'logic') register(String(message.kind), message.id, message.meta)
        break
      case 'unregister': {
        const key = `${String(message.kind)}:${String(message.id)}`
        regs.get(key)?.()
        regs.delete(key)
        break
      }
      case 'rpc': {
        const rid = message.rid
        void handleRpc(String(message.method), (message.args ?? {}) as Record<string, unknown>).then(
          (value) => send(frame, { type: 'reply', rid, ok: true, value: value ?? null }),
          (error) => send(frame, { type: 'reply', rid, ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
        break
      }
      case 'reply': {
        const pending = calls.get(message.rid as number)
        if (!pending || frame !== logic) break
        calls.delete(message.rid as number)
        window.clearTimeout(pending.timer)
        if (message.ok) pending.resolve(message.value)
        else pending.reject(new Error(clampText(message.error, 600) || 'The extension reported an error.'))
        break
      }
      case 'emit':
        if (!isPlainJson(message.data, 100_000)) break
        for (const other of frames.values()) if (other !== frame && other.ready) send(other, { type: 'event', name: clampText(message.name, 80), data: message.data })
        break
      case 'anomaly': {
        const level = message.level === 'high' ? 'medium' : message.level === 'low' ? 'low' : 'medium'
        // Anything the frame reports about itself is capped at "medium": only the app side decides to suspend.
        report(clampText(message.kind, 30), level, clampText(message.message, 280))
        break
      }
      case 'size':
        if (frame.role === 'settings' && typeof message.height === 'number') frame.el.style.height = `${Math.max(60, Math.min(1400, Math.round(message.height)))}px`
        break
      case 'disposed':
        frame.disposed?.()
        break
    }
  }
  window.addEventListener('message', onMessage)

  const themeObserver = new MutationObserver(() => {
    const theme = themePayload()
    for (const frame of frames.values()) if (frame.ready) send(frame, { type: 'theme', theme })
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })

  async function disposeAll() {
    if (closed) return
    closed = true
    window.removeEventListener('message', onMessage)
    themeObserver.disconnect()
    for (const pending of calls.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(new Error('The extension stopped.'))
    }
    calls.clear()
    const open = [...new Set(frames.values())]
    await Promise.all(
      open.map(
        (frame) =>
          new Promise<void>((resolve) => {
            frame.disposed = resolve
            window.setTimeout(resolve, 400)
            send(frame, { type: 'dispose' })
          }),
      ),
    )
    for (const frame of open) frame.el.remove()
    frames.clear()
    for (const dispose of [...regs.values()].reverse()) {
      try {
        dispose()
      } catch {
        // Already gone.
      }
    }
    regs.clear()
  }
  track(disposeAll)

  // ---- styles and themes shipped as files (sanitised) -----------------------------------------
  const fetchText = (path: string) => fetch(`${base}${path}?v=${version}`, { credentials: 'same-origin' }).then((response) => (response.ok ? response.text() : ''))
  const cssBase = (file: string) => `${base}${file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''}`
  for (const file of info.styles) {
    const css = await fetchText(file)
    if (css) {
      const dispose = addStyleNode(sanitizeCss(css, { base: cssBase(file) }))
      regs.set(`file:${file}`, dispose)
    }
  }
  for (const theme of info.themes) {
    const full = `ext-${id.replace(/_/g, '-')}-${theme.id}`.slice(0, 64)
    const css = theme.css ? await fetchText(theme.css) : ''
    if (css) regs.set(`file:${theme.css}`, addStyleNode(sanitizeCss(css, { base: cssBase(theme.css ?? '') })))
    regs.set(`theme:file:${theme.id}`, ctx.ui.registerTheme(full, theme.label, theme.tokens ?? {}, { dark: theme.dark, owner: id }))
  }

  // ---- the window code itself -----------------------------------------------------------------
  if (info.main) {
    const host = document.createElement('div')
    document.body.append(host)
    track(() => host.remove())
    logic = createFrame('logic', host)
    hidden(logic.el)
    await Promise.race([
      logic.started,
      new Promise<void>((_resolve, reject) => window.setTimeout(() => reject(new Error('The extension did not start within 15 seconds.')), 15_000)),
    ])
  }
}
