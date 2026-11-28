// Preloaded before the daemon (`node --import ./server/lib/ext-boot.mjs server/daemon.mjs`).
//
// It installs Node module hooks so extensions can change the daemon itself, like a BepInEx/Harmony mod:
//
//   • resolve hook   — relative imports inside an extension's folder inherit the `?cce-v=` version of the
//                      entry that imported them, so editing a multi-file server extension and reloading it
//                      really reloads every file.
//   • load hook      — `scope: "server"` patches from enabled extensions are applied to the source of
//                      daemon modules (`server/…`, `shared/…`) as they are loaded. The files on disk are
//                      never touched; disable the extension and restart to get the original code back.
//
// This file must stay dependency-light: it runs before any other daemon module so those can still be patched.
// It needs `module.registerHooks` (Node 22.15+/23.5+); without it the daemon still runs, only server patches
// are reported as unsupported.

import { readFileSync, readdirSync } from 'node:fs'
import module from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateManifest } from '../../shared/cce.mjs'
import { applyPatches, fingerprintPatches, matchesTarget } from '../../shared/patches.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..', '..')

function dataDir() {
  const env = process.env.CREATECODE_DATA
  if (env) return path.resolve(env)
  return path.join(os.homedir(), '.createcode')
}

const EXTENSIONS_DIR = path.join(dataDir(), 'extensions')

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch {
    return null
  }
}

function enabledServerPatches() {
  const state = readJson(path.join(EXTENSIONS_DIR, 'state.json'))
  const enabled = state?.extensions ?? {}
  const patches = []
  let names = []
  try {
    names = readdirSync(EXTENSIONS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  } catch {
    return patches
  }
  for (const entry of names) {
    // Only Trusted extensions may patch the daemon; Sandbox mode never applies patches.
    if (enabled[entry.name]?.enabled !== true || enabled[entry.name]?.trust !== 'trusted') continue
    const dir = path.join(EXTENSIONS_DIR, entry.name)
    let manifest = readJson(path.join(dir, 'extension.json'))
    try {
      manifest = manifest ? validateManifest(manifest) : null
    } catch {
      manifest = null
    }
    if (!manifest || manifest.id !== entry.name || !Array.isArray(manifest.patches)) continue
    manifest.patches.forEach((patch, index) => {
      if (!patch || patch.scope !== 'server') return
      let text
      if (patch.file) {
        try {
          text = readFileSync(path.join(dir, patch.file), 'utf8')
        } catch {
          text = ''
        }
      }
      patches.push({ ...patch, __text: text, __index: index, __owner: entry.name, __version: manifest.version, __priority: Number(manifest.priority) || 0 })
    })
  }
  return patches.sort((a, b) => a.__priority - b.__priority || a.__owner.localeCompare(b.__owner))
}

// Same shape the daemon computes (extensions.mjs `serverPatchHash`): an empty list hashes to ''.
const patches = enabledServerPatches()
const info = {
  supported: typeof module.registerHooks === 'function',
  hash: fingerprintPatches(patches),
  status: {},
  results: [],
  preloaded: true,
}
globalThis.__createcodeServerPatches = info

const EXTENSIONS_URL = pathToFileURL(`${EXTENSIONS_DIR}${path.sep}`).href

function versionOf(url) {
  const match = /[?&]cce-v=([A-Za-z0-9]+)/.exec(url ?? '')
  return match ? match[1] : ''
}

if (info.supported) {
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context)
      const version = versionOf(context.parentURL)
      if (version && result.url.startsWith(EXTENSIONS_URL) && !result.url.includes('cce-v=')) {
        return { ...result, url: `${result.url}${result.url.includes('?') ? '&' : '?'}cce-v=${version}` }
      }
      return result
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context)
      if (patches.length === 0 || !url.startsWith('file:') || loaded.source == null) return loaded
      let absolute
      try {
        absolute = fileURLToPath(url.split('?')[0])
      } catch {
        return loaded
      }
      if (!absolute.startsWith(`${APP_ROOT}${path.sep}`) || absolute.includes(`${path.sep}node_modules${path.sep}`)) return loaded
      const relative = path.relative(APP_ROOT, absolute).replaceAll(path.sep, '/')
      const applicable = patches.filter((patch) => matchesTarget(patch.target, relative))
      if (applicable.length === 0) return loaded
      const original = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')
      const { source, results } = applyPatches(original, relative, applicable, (patch) => ({
        ext: `/ext/${patch.__owner}`,
        id: patch.__owner,
        version: patch.__version ?? '',
      }))
      for (const result of results) {
        const patch = applicable[result.index]
        const key = `${patch.__owner}#${patch.__index}`
        const entry = (info.status[key] ??= { applied: false, matches: 0, error: undefined })
        entry.matches += result.matches
        if (result.applied) {
          entry.applied = true
          entry.error = undefined
        } else if (!entry.applied) entry.error = patch.optional ? undefined : result.error
        info.results.push({ owner: patch.__owner, target: relative, ...result })
        if (result.error && !patch.optional) {
          console.warn(`[createcode] extension ${patch.__owner}: server patch for ${relative} skipped (${result.error})`)
        }
      }
      return { ...loaded, source }
    },
  })
  if (patches.length && /daemon\.mjs$/.test(process.argv[1] ?? '')) {
    console.log(`[createcode] ${patches.length} server patch${patches.length === 1 ? '' : 'es'} armed`)
  }
} else if (patches.length) {
  console.warn('[createcode] server patches need Node 22.15 or newer; they are inactive on this runtime.')
}

