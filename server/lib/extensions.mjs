// CreateCode Extensions — the daemon side.
//
// An extension is a folder in ~/.createcode/extensions/<id>/ (an .cce is just that folder zipped).
// Nothing here sandboxes it. What an extension can do:
//
//   renderer   `main` is an ES module the browser imports from /ext/<id>/…; it gets the live kernel.
//   server     `server` is a Node module imported into THIS process with full Node access.
//   patches    find/replace on the served app (web) or on daemon modules as they load (server).
//   styles / themes   plain CSS and declarative palettes.
//
// There is no permission list, no API allowlist and no manifest capability. Enabling an extension is
// the one explicit trust decision, and the UI says so.

import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, watch } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyPatches, fingerprintPatches, matchesTarget } from '../../shared/patches.mjs'
import { versionRelativeImports } from '../../shared/esm-version.mjs'
import {
  CceError,
  MANIFEST_FILE,
  packExtension,
  readExtensionArchive,
  summarizeManifest,
  validateManifest,
} from '../../shared/cce.mjs'
import { scaffold } from './ext-templates.mjs'
import { HttpError, mimeFor } from './http.mjs'
import { DATA_DIR } from './store.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = path.resolve(HERE, '..', '..')
const DIST = path.join(APP_ROOT, 'dist')

export const EXTENSIONS_DIR = path.join(DATA_DIR, 'extensions')
export const EXTENSION_DATA_DIR = path.join(DATA_DIR, 'extension-data')
const STATE_FILE = path.join(EXTENSIONS_DIR, 'state.json')
const MAX_STORAGE_BYTES = 8 * 1024 * 1024
const MAX_LOG_LINES = 300

let appVersion = '0.0.0'
let stateWrites = Promise.resolve()

/** Whether any extension is enabled; the daemon relaxes the page CSP while true (see http.mjs). */
let anyEnabled = false
export const extensionsActive = () => anyEnabled

/** The CLI manages files only; it must never run an extension's server code in its own process. */
let serverRuntime = true
export function disableServerRuntime() {
  serverRuntime = false
}

// ---------------------------------------------------------------------------------------------
// Event bus (daemon → renderer over GET /api/extensions/events)
// ---------------------------------------------------------------------------------------------

const subscribers = new Set()

export function subscribeExtensionEvents(listener) {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

function publish(event) {
  for (const listener of subscribers) {
    try {
      listener(event)
    } catch {
      subscribers.delete(listener)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// State and scanning
// ---------------------------------------------------------------------------------------------

async function ensureDirs() {
  await mkdir(EXTENSIONS_DIR, { recursive: true, mode: 0o700 })
  await mkdir(EXTENSION_DATA_DIR, { recursive: true, mode: 0o700 })
}

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.extensions && typeof parsed.extensions === 'object'
      ? parsed
      : { version: 1, extensions: {} }
  } catch {
    return { version: 1, extensions: {} }
  }
}

function writeState(state) {
  const task = stateWrites.then(async () => {
    await ensureDirs()
    const temporary = `${STATE_FILE}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, STATE_FILE)
  })
  stateWrites = task.catch(() => undefined)
  return task
}

async function mutateState(change) {
  const state = await readState()
  change(state.extensions)
  await writeState(state)
  invalidateScan()
  return state
}

async function walk(dir, base = dir, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(absolute, base, out)
    else if (entry.isFile()) out.push(absolute)
  }
  return out
}

async function directoryFingerprint(dir) {
  const hash = createHash('sha1')
  for (const file of (await walk(dir)).sort()) {
    const info = await stat(file).catch(() => null)
    if (!info) continue
    hash.update(`${path.relative(dir, file)}:${info.size}:${Math.round(info.mtimeMs)}\n`)
  }
  return hash.digest('hex').slice(0, 12)
}

const scanCache = { at: 0, value: null }
const invalidateScan = () => {
  scanCache.at = 0
}

/** Cached for a moment: every page module request asks, and fingerprinting walks the folders. */
async function scan({ fresh = false } = {}) {
  if (!fresh && scanCache.value && Date.now() - scanCache.at < 1500) return scanCache.value
  const value = await scanFolders()
  scanCache.value = value
  scanCache.at = Date.now()
  return value
}

/** Every folder under extensions/ that has (or should have) an extension.json. Broken ones are reported, not hidden. */
async function scanFolders() {
  await ensureDirs()
  const state = await readState()
  const records = []
  let names = []
  try {
    names = await readdir(EXTENSIONS_DIR, { withFileTypes: true })
  } catch {
    names = []
  }
  for (const entry of names) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = path.join(EXTENSIONS_DIR, entry.name)
    const saved = state.extensions[entry.name] ?? {}
    const base = {
      id: entry.name,
      dir,
      dataDir: path.join(EXTENSION_DATA_DIR, entry.name),
      enabled: false,
      source: saved.source ?? 'folder',
      installedAt: saved.installedAt ?? null,
    }
    try {
      const raw = await readFile(path.join(dir, MANIFEST_FILE), 'utf8')
      const manifest = validateManifest(JSON.parse(raw.replace(/^﻿/, '')), { appVersion })
      if (manifest.id !== entry.name) {
        throw new CceError(`manifest.id "${manifest.id}" must match the folder name "${entry.name}"`)
      }
      records.push({
        ...base,
        manifest,
        enabled: saved.enabled === true,
        hash: await directoryFingerprint(dir),
        summary: summarizeManifest(manifest),
      })
    } catch (error) {
      records.push({
        ...base,
        manifest: null,
        hash: '',
        summary: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id))
  anyEnabled = records.some((record) => record.enabled && !record.error)
  return records
}

// ---------------------------------------------------------------------------------------------
// Web patches (applied to the served app, in memory)
// ---------------------------------------------------------------------------------------------

const patchCache = { key: '', value: null }

async function collectPatches(records, scope) {
  const out = []
  for (const record of records) {
    if (!record.enabled || record.error) continue
    for (const [index, patch] of (record.manifest.patches ?? []).entries()) {
      if (patch.scope !== scope) continue
      let text
      if (patch.file) text = await readFile(path.join(record.dir, patch.file), 'utf8').catch(() => '')
      out.push({
        ...patch,
        __text: text,
        __index: index,
        __owner: record.id,
        __version: record.manifest.version,
        __priority: Number(record.manifest.priority) || 0,
      })
    }
  }
  return out.sort((a, b) => a.__priority - b.__priority || a.__owner.localeCompare(b.__owner))
}

const patchVars = (patch) => ({
  ext: `/ext/${patch.__owner}`,
  id: patch.__owner,
  version: patch.__version ?? '',
})

/** Runs every enabled web patch against the files it targets and reports what matched. */
async function webPatchReport(records) {
  const patches = await collectPatches(records, 'web')
  if (patches.length === 0) return { patches, status: new Map() }
  const files = (await walk(DIST)).map((file) => path.relative(DIST, file).replaceAll(path.sep, '/'))
  const keyParts = [patches.map((p) => `${p.__owner}:${JSON.stringify(p)}`).join('|')]
  for (const file of files) {
    const info = await stat(path.join(DIST, file)).catch(() => null)
    if (info && /\.(?:js|css|html|mjs)$/.test(file)) keyParts.push(`${file}:${info.size}:${Math.round(info.mtimeMs)}`)
  }
  const key = createHash('sha1').update(keyParts.join('\n')).digest('hex')
  if (patchCache.key === key && patchCache.value) return { patches, status: patchCache.value }

  const status = new Map()
  const slot = (patch) => `${patch.__owner}#${patch.__index}`
  for (const patch of patches) {
    status.set(slot(patch), { applied: false, matches: 0, error: 'target file not found' })
  }
  for (const file of files) {
    if (!/\.(?:js|css|html|mjs|json|svg)$/.test(file)) continue
    const applicable = patches.filter((patch) => matchesTarget(patch.target, file))
    if (applicable.length === 0) continue
    const source = await readFile(path.join(DIST, file), 'utf8').catch(() => null)
    if (source === null) continue
    const { results } = applyPatches(source, file, applicable, patchVars)
    for (const result of results) {
      const patch = applicable[result.index]
      const entry = status.get(slot(patch))
      if (!entry) continue
      entry.matches += result.matches
      if (result.applied) {
        entry.applied = true
        entry.error = undefined
      } else if (!entry.applied) {
        // The target exists but the pattern is not in it (a stale patch, or a different build).
        entry.error = patch.optional ? undefined : result.error ?? 'pattern not found'
      }
    }
  }
  patchCache.key = key
  patchCache.value = status
  return { patches, status }
}

/** Used by serveStatic: returns patched bytes for a dist file, or null when no patch targets it. */
export async function transformAppFile(relativePath, absolute) {
  if (!anyEnabled) return null
  if (!/\.(?:js|css|html|mjs)$/.test(relativePath)) return null
  const records = await scan()
  const patches = (await collectPatches(records, 'web')).filter((patch) => matchesTarget(patch.target, relativePath))
  if (patches.length === 0) return null
  const { source, results } = applyPatches((await readFile(absolute)).toString('utf8'), relativePath, patches, patchVars)
  for (const result of results) {
    if (result.error) console.warn(`[createcode] extension ${result.owner}: patch for ${relativePath} skipped (${result.error})`)
  }
  return Buffer.from(source, 'utf8')
}

// ---------------------------------------------------------------------------------------------
// Server runtime: extensions' `server` entries run inside this process
// ---------------------------------------------------------------------------------------------

const hosts = new Map()
const bootInfo = () => globalThis.__createcodeServerPatches ?? { hash: '', supported: false, preloaded: false, status: {}, results: [] }

class Disposables {
  #items = []
  add(fn) {
    this.#items.push(fn)
    return fn
  }
  async run() {
    const items = this.#items.splice(0).reverse()
    for (const fn of items) {
      try {
        await fn()
      } catch (error) {
        console.error('[createcode] extension cleanup failed', error)
      }
    }
  }
}

function routeMatcher(pattern) {
  const names = []
  const source = pattern
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        names.push(part.slice(1))
        return '([^/]+)'
      }
      if (part === '*') {
        names.push('rest')
        return '(.*)'
      }
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  const regex = new RegExp(`^${source}$`)
  return (value) => {
    const match = regex.exec(value.replace(/^\/+|\/+$/g, ''))
    if (!match) return null
    return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? '')]))
  }
}

function logLine(host, level, args) {
  const text = args.map((value) => (typeof value === 'string' ? value : safeInspect(value))).join(' ')
  host.logs.push({ at: Date.now(), level, text })
  if (host.logs.length > MAX_LOG_LINES) host.logs.splice(0, host.logs.length - MAX_LOG_LINES)
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  out(`[createcode:${host.id}]`, text)
}

function safeInspect(value) {
  try {
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  } catch {
    return String(value)
  }
}

async function readStorage(id) {
  try {
    const parsed = JSON.parse(await readFile(path.join(EXTENSION_DATA_DIR, id, 'storage.json'), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writeStorage(id, value) {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > MAX_STORAGE_BYTES) throw new HttpError(413, 'Extension storage is full (8 MB).', 'storage_full')
  await mkdir(path.join(EXTENSION_DATA_DIR, id), { recursive: true, mode: 0o700 })
  const file = path.join(EXTENSION_DATA_DIR, id, 'storage.json')
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, text, { mode: 0o600 })
  await rename(temporary, file)
}

function createHost(record) {
  const disposables = new Disposables()
  const handlers = { tool_before: [], tool_after: [], llm_before: [], request: [], shutdown: [], ready: [] }
  const host = {
    id: record.id,
    manifest: record.manifest,
    dir: record.dir,
    dataDir: record.dataDir,
    appVersion,
    appRoot: APP_ROOT,
    logs: [],
    routes: [],
    rpcs: new Map(),
    handlers,
    disposables,
    children: new Set(),
  }

  const api = {
    id: record.id,
    manifest: record.manifest,
    dir: record.dir,
    dataDir: record.dataDir,
    appVersion,
    appRoot: APP_ROOT,

    log: (...args) => logLine(host, 'info', args),
    info: (...args) => logLine(host, 'info', args),
    warn: (...args) => logLine(host, 'warn', args),
    error: (...args) => logLine(host, 'error', args),

    /** Registers a callable the renderer reaches with `createcode.server.call(name, args)`. */
    rpc(name, handler) {
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(name)) throw new Error(`Invalid rpc name "${name}"`)
      host.rpcs.set(name, handler)
      disposables.add(() => host.rpcs.delete(name))
    },

    /**
     * HTTP route under /api/extensions/<id>/x/<path>. `handler(ctx)` gets { req, res, url, query, params, body() }
     * and may return a value (sent as JSON) or write to `res` itself. The daemon has already checked the session.
     */
    route(method, pattern, handler) {
      const entry = { method: String(method).toUpperCase(), match: routeMatcher(pattern), handler }
      host.routes.push(entry)
      disposables.add(() => {
        const index = host.routes.indexOf(entry)
        if (index >= 0) host.routes.splice(index, 1)
      })
    },

    /**
     * Hooks into the daemon:
     *   tool:before  ({name,args,mode}) -> {args} to change them, {result} to answer instead of running the tool
     *   tool:after   ({name,args,result}) -> a new result (or nothing)
     *   llm:before   (payload {provider,kind,model,body}) -> mutate it or return a replacement
     *   request      (req,res,url) -> true when it handled the request (runs before every route, even the app's)
     *   ready        () after the daemon is listening
     *   shutdown     () before the daemon exits
     */
    on(event, handler) {
      const key = String(event).replace(':', '_')
      if (!(key in handlers)) throw new Error(`Unknown daemon event "${event}"`)
      const entry = { id: record.id, handler }
      handlers[key].push(entry)
      disposables.add(() => {
        const index = handlers[key].indexOf(entry)
        if (index >= 0) handlers[key].splice(index, 1)
      })
    },

    /** Pushes an event to every open CreateCode window; the renderer listens with `createcode.server.on(name, fn)`. */
    emit(name, data) {
      publish({ type: 'ext', ext: record.id, name: String(name), data })
    },

    storage: {
      get: async (key, fallback) => {
        const all = await readStorage(record.id)
        return key in all ? all[key] : fallback
      },
      set: async (key, value) => {
        const all = await readStorage(record.id)
        all[key] = value
        await writeStorage(record.id, all)
      },
      delete: async (key) => {
        const all = await readStorage(record.id)
        delete all[key]
        await writeStorage(record.id, all)
      },
      all: () => readStorage(record.id),
    },

    /** Imports any file of the app (`lib/tools.mjs`, `lib/store.mjs`, …): the very same module instances the daemon runs. */
    app: (relative) => import(pathToFileURL(path.join(APP_ROOT, 'server', relative)).href),

    interval(fn, ms) {
      const timer = setInterval(() => void Promise.resolve(fn()).catch((error) => api.error(error)), ms)
      disposables.add(() => clearInterval(timer))
      return () => clearInterval(timer)
    },
    timeout(fn, ms) {
      const timer = setTimeout(() => void Promise.resolve(fn()).catch((error) => api.error(error)), ms)
      disposables.add(() => clearTimeout(timer))
      return () => clearTimeout(timer)
    },

    /** child_process.spawn that is killed when the extension stops. */
    spawn(command, args = [], options = {}) {
      const child = spawn(command, args, { windowsHide: true, ...options })
      host.children.add(child)
      child.once('exit', () => host.children.delete(child))
      return child
    },

    onDispose: (fn) => void disposables.add(fn),
  }
  disposables.add(() => {
    for (const child of host.children) {
      try {
        child.kill()
      } catch {
        // already gone
      }
    }
    host.children.clear()
  })
  host.api = api
  return host
}

let activationLock = Promise.resolve()
function exclusive(task) {
  const run = activationLock.then(task, task)
  activationLock = run.catch(() => undefined)
  return run
}

async function ensureModuleType(record, entry) {
  if (!entry.endsWith('.js')) return
  const file = path.join(record.dir, 'package.json')
  if (!existsSync(file)) await writeFile(file, '{ "type": "module" }\n').catch(() => undefined)
}

async function activateServer(record) {
  await deactivateServer(record.id)
  const entry = record.manifest.server
  if (!serverRuntime || !entry || !record.enabled || record.error) return
  const host = createHost(record)
  hosts.set(record.id, host)
  host.state = 'starting'
  host.hash = record.hash
  try {
    await ensureModuleType(record, entry)
    await mkdir(record.dataDir, { recursive: true, mode: 0o700 })
    const url = `${pathToFileURL(path.join(record.dir, entry)).href}?cce-v=${record.hash}`
    globalThis.CREATECODE_HOST = host.api
    let mod
    try {
      mod = await import(url)
    } finally {
      delete globalThis.CREATECODE_HOST
    }
    host.module = mod
    const activate = typeof mod.default === 'function' ? mod.default : mod.activate
    if (typeof activate === 'function') await activate(host.api)
    host.state = 'running'
    host.api.info(`server entry running (${record.manifest.version})`)
  } catch (error) {
    host.state = 'error'
    host.error = error instanceof Error ? error.stack || error.message : String(error)
    console.error(`[createcode] extension ${record.id} failed to start`, error)
    await host.disposables.run()
  }
}

async function deactivateServer(id) {
  const host = hosts.get(id)
  if (!host) return
  hosts.delete(id)
  try {
    if (typeof host.module?.deactivate === 'function') await host.module.deactivate()
  } catch (error) {
    console.error(`[createcode] extension ${id} deactivate failed`, error)
  }
  for (const entry of host.handlers.shutdown) {
    try {
      await entry.handler()
    } catch {
      // ignore
    }
  }
  await host.disposables.run()
}

/** Runs one hook list in order; each handler may return a replacement. */
async function runHooks(key, initial, call) {
  let value = initial
  for (const host of hosts.values()) {
    if (host.state !== 'running') continue
    for (const entry of [...host.handlers[key]]) {
      try {
        const next = await call(entry.handler, value)
        if (next !== undefined) value = next
        if (value?.__stop) return value
      } catch (error) {
        host.api.error(`${key} hook failed:`, error)
      }
    }
  }
  return value
}

export const hooks = {
  /** Returns `{ args }` (possibly changed) or `{ result }` when an extension answered the call itself. */
  async toolBefore(exec) {
    let current = { args: exec.args }
    for (const host of hosts.values()) {
      if (host.state !== 'running') continue
      for (const entry of [...host.handlers.tool_before]) {
        try {
          const next = await entry.handler({ ...exec, args: current.args })
          if (!next) continue
          if (next.result) return { args: current.args, result: next.result }
          if (next.args) current = { args: next.args }
        } catch (error) {
          host.api.error('tool:before hook failed:', error)
        }
      }
    }
    return current
  },
  async toolAfter(exec, result) {
    return runHooks('tool_after', result, (handler, value) => handler({ ...exec, result: value }))
  },
  async llmBefore(payload) {
    return runHooks('llm_before', payload, (handler, value) => handler(value))
  },
  /** True when an extension answered the request. */
  async request(req, res, url) {
    for (const host of hosts.values()) {
      if (host.state !== 'running') continue
      for (const entry of [...host.handlers.request]) {
        try {
          if ((await entry.handler(req, res, url)) === true) return true
        } catch (error) {
          host.api.error('request hook failed:', error)
          if (!res.headersSent) throw error
          return true
        }
      }
    }
    return false
  },
  async ready() {
    for (const host of hosts.values()) for (const entry of host.handlers.ready) await Promise.resolve(entry.handler()).catch(() => undefined)
  },
  async shutdown() {
    stopWatching()
    for (const id of [...hosts.keys()]) await deactivateServer(id)
  },
}

/** `/api/extensions/<id>/x/...` and `/rpc/<name>`; returns true when handled. */
export async function handleExtensionRoute(req, res, id, kind, rest, { readJson, json }) {
  const host = hosts.get(id)
  if (!host || host.state !== 'running') throw new HttpError(404, 'That extension has no running server part.', 'extension_not_running')
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (kind === 'rpc') {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST for rpc calls.', 'method_not_allowed')
    const handler = host.rpcs.get(rest)
    if (!handler) throw new HttpError(404, `The extension has no rpc named "${rest}".`, 'rpc_not_found')
    const body = await readJson(req, 64 * 1024 * 1024)
    try {
      const result = await handler(body.args, { req })
      json(res, 200, { result: result === undefined ? null : result })
    } catch (error) {
      host.api.error(`rpc ${rest} failed:`, error)
      throw new HttpError(500, error instanceof Error ? error.message : String(error), 'rpc_failed')
    }
    return
  }
  for (const entry of host.routes) {
    if (entry.method !== req.method && entry.method !== '*') continue
    const params = entry.match(rest)
    if (!params) continue
    let cached
    const ctx = {
      req,
      res,
      url,
      query: Object.fromEntries(url.searchParams),
      params,
      body: async () => (cached ??= await readJson(req, 64 * 1024 * 1024)),
    }
    try {
      const value = await entry.handler(ctx)
      if (!res.writableEnded && !res.headersSent) json(res, 200, value === undefined ? { ok: true } : value)
    } catch (error) {
      if (error instanceof HttpError) throw error
      host.api.error(`route ${req.method} ${rest} failed:`, error)
      throw new HttpError(500, error instanceof Error ? error.message : String(error), 'route_failed')
    }
    return
  }
  throw new HttpError(404, 'The extension has no such route.', 'route_not_found')
}

// ---------------------------------------------------------------------------------------------
// Public records
// ---------------------------------------------------------------------------------------------

function publicRecord(record, patchStatus) {
  const host = hosts.get(record.id)
  const manifest = record.manifest
  return {
    id: record.id,
    name: manifest?.name ?? record.id,
    version: manifest?.version ?? '',
    description: manifest?.description ?? '',
    author: manifest?.author ?? '',
    homepage: manifest?.homepage ?? '',
    license: manifest?.license ?? '',
    engine: manifest?.engine ?? '',
    hasIcon: Boolean(manifest?.icon),
    enabled: record.enabled && !record.error,
    source: record.source,
    installedAt: record.installedAt,
    dir: record.dir,
    dataDir: record.dataDir,
    hash: record.hash,
    summary: record.summary,
    error: record.error ?? null,
    // What the renderer needs to load it.
    main: manifest?.main ?? null,
    styles: manifest?.styles ?? [],
    themes: manifest?.themes ?? [],
    commands: Array.isArray(manifest?.commands) ? manifest.commands : [],
    patches: (manifest?.patches ?? []).map((patch, index) => {
      const status = patch.scope === 'web' ? patchStatus?.get(`${record.id}#${index}`) : serverPatchStatus(`${record.id}#${index}`)
      return {
        scope: patch.scope,
        target: patch.target,
        note: patch.note ?? '',
        applied: status?.applied ?? null,
        matches: status?.matches ?? 0,
        error: status?.error ?? null,
      }
    }),
    server: manifest?.server
      ? { state: host?.state ?? (record.enabled ? 'stopped' : 'off'), error: host?.error ?? null, routes: host?.routes.length ?? 0, rpcs: host ? [...host.rpcs.keys()] : [] }
      : null,
  }
}

function serverPatchStatus(key) {
  const boot = bootInfo()
  if (boot.supported === false) {
    return { applied: false, matches: 0, error: boot.preloaded === false ? 'start CreateCode with the createcode command or the desktop app' : 'needs Node 22.15+ (module hooks)' }
  }
  return boot.status?.[key] ?? null
}

async function serverPatchHash(records) {
  return fingerprintPatches(await collectPatches(records, 'server'))
}

async function serverCodeHash(records) {
  return records
    .filter((record) => record.enabled && !record.error && record.manifest.server)
    .map((record) => `${record.id}:${record.hash}`)
    .join('|')
}

export async function listExtensions() {
  const records = await scan({ fresh: true })
  const { status } = await webPatchReport(records)
  const wantServerPatches = await serverPatchHash(records)
  const boot = bootInfo()
  const restartRequired = boot.supported !== false && (boot.hash ?? '') !== wantServerPatches
  return {
    extensions: records.map((record) => publicRecord(record, status)),
    dir: EXTENSIONS_DIR,
    appVersion,
    serverPatchesSupported: boot.supported !== false,
    serverPatchesPreloaded: boot.preloaded !== false,
    restartRequired,
    pageReloadRequired: false,
  }
}

async function recordFor(id) {
  const records = await scan({ fresh: true })
  const record = records.find((item) => item.id === id)
  if (!record) throw new HttpError(404, 'Extension not found.', 'extension_not_found')
  return record
}

async function describe(id) {
  const listing = await listExtensions()
  return listing.extensions.find((item) => item.id === id) ?? null
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

let watcher = null
let watchTimer = null

/**
 * Edits on disk reload extensions live: save a file in ~/.createcode/extensions/<id>/ (or install from the CLI) and
 * the window picks the change up without a click. Debounced; our own temporary folders are ignored.
 */
function startWatching() {
  if (watcher || !serverRuntime) return
  const onChange = (_event, name) => {
    const file = String(name ?? '')
    if (/(^|[\\/])(\.staging-|\.old-)/.test(file) || file.endsWith('.tmp') || file.includes('node_modules')) return
    invalidateScan()
    clearTimeout(watchTimer)
    watchTimer = setTimeout(() => void reloadExtensions().catch((error) => console.error('[createcode] extension reload failed', error)), 450)
  }
  try {
    watcher = watch(EXTENSIONS_DIR, { recursive: true }, onChange)
  } catch {
    try {
      watcher = watch(EXTENSIONS_DIR, onChange)
    } catch {
      watcher = null
    }
  }
  watcher?.on('error', () => {
    watcher?.close()
    watcher = null
  })
  watcher?.unref?.()
}

export function stopWatching() {
  clearTimeout(watchTimer)
  watcher?.close()
  watcher = null
}

/** Reads the extensions folder (sets the CSP mode). Call before the server listens. */
export async function prepareExtensions(version) {
  appVersion = version
  await ensureDirs()
  await scan({ fresh: true })
}

export async function startExtensions(version) {
  await prepareExtensions(version)
  const records = await scan()
  for (const record of records) {
    if (record.enabled && !record.error) await exclusive(() => activateServer(record))
  }
  startWatching()
}

async function writeExtensionFiles(id, files) {
  const target = path.join(EXTENSIONS_DIR, id)
  const staging = path.join(EXTENSIONS_DIR, `.staging-${id}-${randomBytes(4).toString('hex')}`)
  const backup = path.join(EXTENSIONS_DIR, `.old-${id}-${randomBytes(4).toString('hex')}`)
  await mkdir(staging, { recursive: true })
  try {
    for (const [name, data] of files) {
      const destination = path.join(staging, name)
      if (!destination.startsWith(`${staging}${path.sep}`)) throw new CceError(`unsafe path "${name}"`)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, data)
    }
    const had = existsSync(target)
    if (had) await rename(target, backup)
    try {
      await rename(staging, target)
    } catch (error) {
      if (had) await rename(backup, target).catch(() => undefined)
      throw error
    }
    if (had) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

/** Installs the bytes of an .cce. `enable` turns it on straight away (the UI asks the person first). */
export async function installArchive(bytes, { enable = false, source = 'cce' } = {}) {
  let parsed
  try {
    parsed = readExtensionArchive(bytes, { appVersion })
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid extension package.', 'invalid_extension')
  }
  return installParsed(parsed, { enable, source })
}

async function installParsed({ manifest, files }, { enable, source }) {
  await ensureDirs()
  const previous = (await readState()).extensions[manifest.id]
  const wasEnabled = previous?.enabled === true
  if (wasEnabled) await exclusive(() => deactivateServer(manifest.id))
  await writeExtensionFiles(manifest.id, files)
  invalidateScan()
  const shouldEnable = enable || wasEnabled
  await mutateState((extensions) => {
    extensions[manifest.id] = {
      enabled: shouldEnable,
      installedAt: previous?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source,
    }
  })
  const record = await recordFor(manifest.id)
  if (record.enabled && !record.error) await exclusive(() => activateServer(record))
  publish({ type: 'extensions' })
  return { extension: await describe(manifest.id), updated: Boolean(previous), reload: reloadHint() }
}

/** Creates a starter extension folder (disabled) so it can be edited in place; saves reload it live. */
export async function createExtension({ id, name, template = 'hello' }) {
  let made
  try {
    validateManifest({ id, name: name || id, version: '0.1.0' })
    made = scaffold(id, (name || id).trim(), template)
  } catch (error) {
    throw new HttpError(400, error.message, 'invalid_extension')
  }
  if (existsSync(path.join(EXTENSIONS_DIR, id))) throw new HttpError(409, `An extension with id "${id}" already exists.`, 'extension_exists')
  const files = new Map(Object.entries(made.files).map(([file, text]) => [file, Buffer.from(text, 'utf8')]))
  files.set(MANIFEST_FILE, Buffer.from(`${JSON.stringify(validateManifest(made.manifest), null, 2)}\n`, 'utf8'))
  return installParsed({ manifest: validateManifest(made.manifest), files }, { enable: false, source: 'folder' })
}

/** Installs a folder from disk (CLI `createcode ext install ./dir`). */
export async function installDirectory(dir, options = {}) {
  const absolute = path.resolve(dir)
  const found = new Map()
  for (const file of await walk(absolute)) {
    const relative = path.relative(absolute, file).replaceAll(path.sep, '/')
    if (relative.startsWith('.git/') || relative.includes('/node_modules/.cache/')) continue
    found.set(relative, await readFile(file))
  }
  const manifestBytes = found.get(MANIFEST_FILE)
  if (!manifestBytes) throw new HttpError(400, `${MANIFEST_FILE} is missing in ${absolute}`, 'invalid_extension')
  let manifest
  try {
    manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8').replace(/^﻿/, '')), { appVersion })
  } catch (error) {
    throw new HttpError(400, error.message, 'invalid_extension')
  }
  return installParsed({ manifest, files: found }, { enable: options.enable === true, source: 'folder' })
}

function reloadHint() {
  // Enabling or disabling changes the page CSP (first/last extension) and may add web patches.
  return true
}

export async function setExtensionEnabled(id, enabled) {
  if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false.', 'invalid_enabled')
  const record = await recordFor(id)
  if (record.error) throw new HttpError(409, `This extension is broken: ${record.error}`, 'extension_broken')
  if (enabled && record.manifest.engine === undefined) {
    // Nothing to check; the manifest was already validated against the running version at scan time.
  }
  await mutateState((extensions) => {
    extensions[id] = { ...(extensions[id] ?? {}), enabled, installedAt: extensions[id]?.installedAt ?? new Date().toISOString(), source: extensions[id]?.source ?? record.source }
  })
  const next = await recordFor(id)
  if (enabled) await exclusive(() => activateServer(next))
  else await exclusive(() => deactivateServer(id))
  publish({ type: 'extensions' })
  return { extension: await describe(id), reload: reloadHint() }
}

export async function uninstallExtension(id, { removeData = false } = {}) {
  await recordFor(id).catch(() => {
    throw new HttpError(404, 'Extension not found.', 'extension_not_found')
  })
  await exclusive(() => deactivateServer(id))
  await rm(path.join(EXTENSIONS_DIR, id), { recursive: true, force: true })
  invalidateScan()
  if (removeData) await rm(path.join(EXTENSION_DATA_DIR, id), { recursive: true, force: true })
  await mutateState((extensions) => {
    delete extensions[id]
  })
  await scan({ fresh: true })
  publish({ type: 'extensions' })
  return { id, removed: true, reload: reloadHint() }
}

/** Rescans the folder (hand-edited or newly dropped-in extensions) and restarts the running server parts. */
export async function reloadExtensions(id) {
  const records = await scan({ fresh: true })
  for (const record of records) {
    if (id && record.id !== id) continue
    const running = hosts.get(record.id)
    if (record.enabled && !record.error) {
      if (!running || running.hash !== record.hash || running.state !== 'running') await exclusive(() => activateServer(record))
    } else if (running) await exclusive(() => deactivateServer(record.id))
  }
  patchCache.key = ''
  publish({ type: 'extensions' })
  return { ...(await listExtensions()), reload: true }
}

/** The extension as .cce bytes, for "Export". */
export async function exportExtension(id) {
  const record = await recordFor(id)
  if (record.error) throw new HttpError(409, record.error, 'extension_broken')
  const files = {}
  for (const file of await walk(record.dir)) {
    const relative = path.relative(record.dir, file).replaceAll(path.sep, '/')
    if (relative === MANIFEST_FILE || relative.startsWith('node_modules/') || relative.startsWith('.git/')) continue
    files[relative] = await readFile(file)
  }
  const manifest = JSON.parse(await readFile(path.join(record.dir, MANIFEST_FILE), 'utf8'))
  return packExtension({ manifest, files }).bytes
}

/** Packs `{ manifest, files }` from the editor into .cce bytes without installing. */
export function buildArchive(manifest, files) {
  try {
    return packExtension({ manifest, files }).bytes
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Could not build the package.', 'invalid_extension')
  }
}

// ---------------------------------------------------------------------------------------------
// Files, storage, logs, proxy
// ---------------------------------------------------------------------------------------------

/** Absolute path of a file inside an enabled extension. The server entry is not served to the page. */
export async function resolveExtensionFile(id, relative, { requireEnabled = true } = {}) {
  const records = await scan()
  const record = records.find((item) => item.id === id)
  if (!record || record.error || (requireEnabled && !record.enabled)) throw new HttpError(404, 'Extension file not found.', 'not_found')
  let clean
  try {
    clean = decodeURIComponent(relative).replaceAll('\\', '/').replace(/^\/+/, '')
  } catch {
    throw new HttpError(400, 'Bad path.', 'invalid_path')
  }
  if (!clean || clean.includes('\0') || clean.split('/').some((part) => part === '..')) throw new HttpError(400, 'Bad path.', 'invalid_path')
  if (clean === record.manifest.server) throw new HttpError(404, 'Extension file not found.', 'not_found')
  const absolute = path.resolve(record.dir, clean)
  if (!absolute.startsWith(`${record.dir}${path.sep}`)) throw new HttpError(403, 'Outside the extension.', 'forbidden')
  const info = await stat(absolute).catch(() => null)
  if (!info?.isFile()) throw new HttpError(404, 'Extension file not found.', 'not_found')
  return { absolute, size: info.size, record }
}

export async function serveExtensionFile(req, res, id, relative) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.', 'method_not_allowed')
  const { absolute, size, record } = await resolveExtensionFile(id, relative)
  if (/\.m?js$/.test(absolute)) {
    // Multi-file extensions: relative imports carry the extension's hash so a live reload re-evaluates every
    // module instead of reusing the page's cached copies (see shared/esm-version.mjs).
    const body = Buffer.from(versionRelativeImports(await readFile(absolute, 'utf8'), record.hash), 'utf8')
    res.writeHead(200, { 'Content-Type': mimeFor(absolute), 'Content-Length': body.length, 'Cache-Control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : body)
    return
  }
  res.writeHead(200, {
    'Content-Type': mimeFor(absolute),
    'Content-Length': size,
    'Cache-Control': 'no-cache',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(absolute)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

export async function extensionIcon(req, res, id) {
  const record = await recordFor(id)
  if (!record.manifest?.icon) throw new HttpError(404, 'No icon.', 'not_found')
  const absolute = path.resolve(record.dir, record.manifest.icon)
  if (!absolute.startsWith(`${record.dir}${path.sep}`)) throw new HttpError(403, 'Outside the extension.', 'forbidden')
  const info = await stat(absolute).catch(() => null)
  if (!info?.isFile()) throw new HttpError(404, 'No icon.', 'not_found')
  res.writeHead(200, { 'Content-Type': mimeFor(absolute), 'Content-Length': info.size, 'Cache-Control': 'no-cache' })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(absolute).pipe(res)
}

export async function getStorage(id) {
  await recordFor(id)
  return readStorage(id)
}

export async function setStorage(id, value) {
  await recordFor(id)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Storage must be a JSON object.', 'invalid_storage')
  await writeStorage(id, value)
  return value
}

export function extensionLogs(id) {
  return hosts.get(id)?.logs ?? []
}

/**
 * Unrestricted HTTP for renderer code: no CORS, no allowlist, no private-network block. It exists because a
 * page cannot call arbitrary hosts; it only works while an extension is enabled.
 */
export async function proxyRequest(request) {
  if (!anyEnabled) throw new HttpError(403, 'Enable an extension to use the extension proxy.', 'proxy_disabled')
  let url
  try {
    url = new URL(String(request?.url ?? ''))
  } catch {
    throw new HttpError(400, 'Invalid URL.', 'bad_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) URLs are supported.', 'bad_url')
  const method = String(request.method ?? 'GET').toUpperCase()
  const headers = {}
  for (const [key, value] of Object.entries(request.headers ?? {})) if (typeof value === 'string') headers[key] = value
  let body
  if (typeof request.bodyBase64 === 'string') body = Buffer.from(request.bodyBase64, 'base64')
  else if (typeof request.body === 'string') body = request.body
  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: request.redirect === 'manual' ? 'manual' : 'follow',
      signal: AbortSignal.timeout(Math.min(Number(request.timeoutMs) || 30_000, 300_000)),
    })
  } catch (error) {
    throw new HttpError(502, `Request failed: ${error instanceof Error ? error.message : String(error)}`, 'proxy_failed')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') ?? ''
  return {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: Object.fromEntries(response.headers),
    contentType,
    bodyBase64: bytes.toString('base64'),
  }
}
