// Runs INSIDE the sandboxed iframe of an untrusted (Sandbox mode) extension. Inlined by ext-sandbox.mjs, so it
// is plain script: no imports. It builds the restricted `createcode` object and talks to the app with
// postMessage; src/extensions/sandbox.ts is the other end. Nothing here is a security boundary by itself:
// the boundary is the iframe's opaque origin and CSP. This file adds the API surface and reports attempts.
;(() => {
  'use strict'
  const boot = JSON.parse(document.getElementById('cce-boot').textContent)
  const root = document.getElementById('root')
  const parentWindow = window.parent
  const post = (message) => {
    try {
      parentWindow.postMessage({ cce: 1, ...message }, '*')
    } catch {
      try {
        parentWindow.postMessage(JSON.parse(JSON.stringify({ cce: 1, ...message })), '*')
      } catch {
        // Not cloneable; nothing to send.
      }
    }
  }
  const report = (kind, level, message) => post({ type: 'anomaly', kind, level, message: String(message).slice(0, 300) })

  // ---- request/response with the app ----------------------------------------------------------
  const pending = new Map()
  let counter = 0
  const rpc = (method, args) =>
    new Promise((resolve, reject) => {
      const rid = ++counter
      pending.set(rid, { resolve, reject })
      post({ type: 'rpc', rid, method, args })
    })

  // ---- what the extension registered -----------------------------------------------------------
  const logic = boot.role === 'logic'
  const handlers = { tool: new Map(), command: new Map(), action: new Map() }
  const panels = new Map()
  let settingsRender = null
  const listeners = new Map()
  const disposers = []
  let module = null
  let cleanupView = null

  const noop = () => {}
  const registered = (kind, id, meta) => {
    post({ type: 'register', kind, id, meta })
    return () => post({ type: 'unregister', kind, id })
  }
  const safeMode = (definition, mode) => {
    try {
      return typeof definition.allowedInMode === 'function' ? Boolean(definition.allowedInMode(mode)) : true
    } catch {
      return false
    }
  }

  const baseApi = {
    id: boot.id,
    sandbox: true,
    role: boot.role,
    manifest: {},
    appVersion: '',
    base: '',

    registerTool(definition) {
      if (!logic) return noop
      const name = String(definition && definition.name)
      handlers.tool.set(name, definition.execute)
      const off = registered('tool', name, {
        description: String(definition.description ?? ''),
        parameters: definition.parameters ?? { type: 'object', properties: {} },
        approval: definition.approval === 'ask' ? 'ask' : 'auto',
        modes: { build: safeMode(definition, 'build'), plan: safeMode(definition, 'plan') },
      })
      return () => {
        handlers.tool.delete(name)
        off()
      }
    },
    registerCommand(id, label, run, options) {
      if (!logic) return noop
      handlers.command.set(String(id), run)
      const off = registered('command', String(id), { label: String(label), hint: options && options.hint ? String(options.hint) : undefined })
      return () => {
        handlers.command.delete(String(id))
        off()
      }
    },
    registerAction(id, action) {
      if (!logic) return noop
      handlers.action.set(String(id), action.run)
      const off = registered('action', String(id), { label: String(action.label), icon: action.icon, placement: action.placement === 'sidebar' ? 'sidebar' : 'topbar' })
      return () => {
        handlers.action.delete(String(id))
        off()
      }
    },
    registerPanel(id, label, render, options) {
      panels.set(String(id), render)
      if (!logic) return noop
      const off = registered('panel', String(id), { label: String(label), icon: options && options.icon })
      return () => {
        panels.delete(String(id))
        off()
      }
    },
    registerSettings(label, render) {
      settingsRender = render
      if (!logic) return noop
      return registered('settings', 'settings', { label: String(label) })
    },
    registerTheme(id, label, palette, options) {
      if (!logic) return noop
      return registered('theme', String(id), { label: String(label), palette: palette || {}, dark: Boolean(options && options.dark) })
    },
    addStyle(css) {
      if (!logic) {
        const node = document.createElement('style')
        node.textContent = String(css)
        document.head.append(node)
        return () => node.remove()
      }
      const key = `style-${++counter}`
      return registered('style', key, { css: String(css) })
    },
    on(name, listener) {
      const key = String(name)
      let set = listeners.get(key)
      if (!set) listeners.set(key, (set = new Set()))
      set.add(listener)
      return () => set.delete(listener)
    },
    emit(name, data) {
      post({ type: 'emit', name: String(name), data })
    },
    dispose(fn) {
      if (typeof fn === 'function') disposers.push(fn)
    },
    notify(message, tone) {
      void rpc('notify', { message: String(message), tone }).catch(noop)
    },
    confirm: (options) => rpc('confirm', options),
    log: (...args) => void rpc('log', { text: args.map((item) => (typeof item === 'string' ? item : safeJson(item))).join(' ') }).catch(noop),
    storage: {
      get: (key, fallback) => rpc('storage.get', { key: String(key) }).then((result) => (result.found ? result.value : fallback)),
      set: (key, value) => rpc('storage.set', { key: String(key), value }),
      delete: (key) => rpc('storage.delete', { key: String(key) }),
      all: () => rpc('storage.all', {}),
    },
    /** A blob: URL for a file shipped inside the extension (images, fonts). */
    async asset(path) {
      const file = await rpc('asset', { path: String(path) })
      return URL.createObjectURL(new Blob([file.bytes], { type: file.type || 'application/octet-stream' }))
    },
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  // Everything the trusted API has beyond the list above is reachable only after "Mark as Trusted".
  const PRIVILEGED = new Set([
    'ctx', 'tools', 'ui', 'sessions', 'llm', 'approval', 'systemPrompt', 'compaction', 'subagents', 'agentLoop', 'titles',
    'stores', 'daemon', 'React', 'kernel', 'server', 'http', 'render', 'url',
  ])
  const api = new Proxy(baseApi, {
    get(target, property) {
      if (property in target) return target[property]
      if (typeof property === 'string' && PRIVILEGED.has(property)) {
        report('blocked-api', 'medium', `Tried to use createcode.${property}, which needs Trusted mode`)
        throw new Error(`createcode.${property} is not available in Sandbox mode. Ask the person to mark this extension as Trusted.`)
      }
      return undefined
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  })

  // ---- reporting attempts to leave the sandbox -------------------------------------------------
  const blockedNetwork = (what) => {
    report('network', 'medium', `Tried to use ${what}`)
    return new TypeError(`${what} is disabled in Sandbox mode`)
  }
  try {
    window.fetch = () => Promise.reject(blockedNetwork('fetch'))
    window.XMLHttpRequest = function () {
      throw blockedNetwork('XMLHttpRequest')
    }
    window.WebSocket = function () {
      throw blockedNetwork('WebSocket')
    }
    window.EventSource = function () {
      throw blockedNetwork('EventSource')
    }
    window.Worker = function () {
      throw blockedNetwork('Worker')
    }
    navigator.sendBeacon = () => {
      report('network', 'medium', 'Tried to use sendBeacon')
      return false
    }
    window.open = () => {
      report('popup', 'medium', 'Tried to open a window')
      return null
    }
  } catch {
    // The CSP still blocks all of it.
  }
  document.addEventListener('securitypolicyviolation', (event) => {
    report('csp', 'medium', `Blocked ${event.violatedDirective}: ${String(event.blockedURI).slice(0, 120)}`)
  })

  // ---- messages from the app -------------------------------------------------------------------
  function applyTheme(theme) {
    if (!theme) return
    const style = document.documentElement.style
    for (const [name, value] of Object.entries(theme.vars || {})) style.setProperty(`--${name}`, String(value))
    style.colorScheme = theme.dark ? 'dark' : 'light'
  }

  async function start(init) {
    baseApi.manifest = init.manifest
    baseApi.appVersion = init.appVersion
    baseApi.base = ''
    applyTheme(init.theme)
    const base = document.createElement('style')
    base.textContent =
      'html,body{margin:0;min-height:100%;background:rgb(var(--panel,255 255 255));color:rgb(var(--ink,30 30 30));font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}' +
      'a{color:rgb(var(--link,40 100 220))}button,input,textarea,select{font:inherit}'
    document.head.prepend(base)
    for (const name of boot.missing) report('missing-module', 'low', `Missing file: ${name}`)
    if (!boot.entry) return
    const urls = {}
    for (const [specifier, source] of Object.entries(boot.modules)) urls[specifier] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const map = document.createElement('script')
    map.type = 'importmap'
    map.textContent = JSON.stringify({ imports: urls })
    document.head.append(map)
    globalThis.createcode = api
    try {
      module = await import(boot.entry)
    } finally {
      delete globalThis.createcode
    }
    const run = typeof module.default === 'function' ? module.default : module.activate
    if (typeof run === 'function') await run(api)
    if (boot.role === 'panel') {
      const render = panels.get(boot.panel)
      if (!render) throw new Error(`The extension has no panel "${boot.panel}".`)
      cleanupView = render(root)
    } else if (boot.role === 'settings') {
      if (!settingsRender) throw new Error('The extension has no settings block.')
      cleanupView = settingsRender(root)
    }
    if (boot.role === 'settings' && typeof ResizeObserver === 'function') {
      new ResizeObserver(() => post({ type: 'size', height: Math.ceil(document.documentElement.scrollHeight) })).observe(document.documentElement)
    }
  }

  async function dispose() {
    try {
      if (typeof cleanupView === 'function') await cleanupView()
      if (module && typeof module.deactivate === 'function') await module.deactivate()
    } catch {
      // Closing anyway.
    }
    for (const fn of disposers.splice(0).reverse()) {
      try {
        await fn()
      } catch {
        // Closing anyway.
      }
    }
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== parentWindow) return
    const message = event.data
    if (!message || message.cce !== 1) return
    switch (message.type) {
      case 'init':
        try {
          await start(message)
          post({ type: 'started' })
        } catch (error) {
          post({ type: 'failed', error: error instanceof Error ? error.message : String(error) })
        }
        break
      case 'theme':
        applyTheme(message.theme)
        break
      case 'reply': {
        const entry = pending.get(message.rid)
        if (!entry) break
        pending.delete(message.rid)
        if (message.ok) entry.resolve(message.value)
        else entry.reject(new Error(message.error || 'Request failed'))
        break
      }
      case 'event':
        for (const listener of [...(listeners.get(message.name) || [])]) {
          try {
            listener(message.data)
          } catch {
            // One bad listener must not stop the others.
          }
        }
        break
      case 'call': {
        const fn = (handlers[message.kind] || new Map()).get(message.id)
        if (typeof fn !== 'function') {
          post({ type: 'reply', rid: message.rid, ok: false, error: `No ${message.kind} named ${message.id}` })
          break
        }
        try {
          const value = await fn(message.args || {})
          post({ type: 'reply', rid: message.rid, ok: true, value: value === undefined ? null : value })
        } catch (error) {
          post({ type: 'reply', rid: message.rid, ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        break
      }
      case 'dispose':
        await dispose()
        post({ type: 'disposed' })
        break
    }
  })

  window.addEventListener('error', (event) => void rpc('log', { text: `error: ${event.message}`, level: 'error' }).catch(noop))
  window.addEventListener('unhandledrejection', (event) => void rpc('log', { text: `unhandled: ${String(event.reason && event.reason.message || event.reason)}`, level: 'error' }).catch(noop))
  post({ type: 'ready', nonce: boot.nonce })
})()
