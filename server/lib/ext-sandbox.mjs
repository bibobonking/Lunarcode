// Sandbox mode, daemon side: builds the page an untrusted extension's window code runs in.
//
// The page is served with `Content-Security-Policy: sandbox allow-scripts …`, so the browser gives it an
// opaque origin: it cannot read the app's DOM, stores, cookies or storage, cannot reach the daemon and, with
// `connect-src 'none'`, cannot touch the network. It talks to the app through postMessage only
// (src/extensions/sandbox.ts is the other end). The extension's modules are inlined, because an opaque
// origin cannot send the session cookie that /ext/<id>/… requires.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapRelativeImports, relativeImports } from '../../shared/esm-version.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAX_MODULES = 300
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MODULE_FILE = /\.(?:m?js)$/i

export const SANDBOX_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ')

const specifierFor = (file) => `@cce/${file}`

function resolveRelative(from, specifier) {
  const clean = specifier.split(/[?#]/)[0]
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), clean))
  if (joined.startsWith('../') || joined === '..' || path.posix.isAbsolute(joined)) return null
  return joined
}

/** Reads `main` and every module it imports with a relative path; specifiers become `@cce/<path>`. */
export async function collectModuleGraph(dir, main) {
  const modules = {}
  const queue = [main]
  const seen = new Set(queue)
  let total = 0
  const missing = []
  while (queue.length > 0) {
    const file = queue.shift()
    if (Object.keys(modules).length >= MAX_MODULES) throw new Error(`The extension has more than ${MAX_MODULES} modules.`)
    const absolute = path.resolve(dir, file)
    if (!absolute.startsWith(`${dir}${path.sep}`)) throw new Error(`"${file}" is outside the extension.`)
    let source
    try {
      source = await readFile(absolute, 'utf8')
    } catch {
      missing.push(file)
      continue
    }
    total += Buffer.byteLength(source)
    if (total > MAX_TOTAL_BYTES) throw new Error('The extension\'s modules are too large to run in the sandbox (6 MB).')
    for (const specifier of relativeImports(source)) {
      const target = resolveRelative(file, specifier)
      if (target && MODULE_FILE.test(target) && !seen.has(target)) {
        seen.add(target)
        queue.push(target)
      }
    }
    modules[specifierFor(file)] = mapRelativeImports(source, (specifier) => {
      const target = resolveRelative(file, specifier)
      return target && MODULE_FILE.test(target) ? specifierFor(target) : null
    })
  }
  return { modules, entry: specifierFor(main), missing }
}

const jsonForHtml = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export async function renderSandboxFrame({ record, role, panel, nonce }) {
  const runtime = await readFile(path.join(HERE, 'ext-sandbox-frame.js'), 'utf8')
  const graph = record.manifest.main ? await collectModuleGraph(record.dir, record.manifest.main) : { modules: {}, entry: null, missing: [] }
  // Stylesheets listed in the manifest also style the extension's own panels (the app's CSS does not reach the iframe).
  let styles = ''
  if (role !== 'logic') {
    for (const file of record.manifest.styles ?? []) {
      const css = await readFile(path.resolve(record.dir, file), 'utf8').catch(() => '')
      if (css && css.length < 500_000) styles += `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`
    }
  }
  const boot = {
    id: record.id,
    role,
    panel: panel ?? null,
    nonce,
    entry: graph.entry,
    modules: graph.modules,
    missing: graph.missing,
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${record.id}</title>${styles}</head><body><div id="root"></div><script type="application/json" id="cce-boot">${jsonForHtml(boot)}</script><script>${runtime.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
}
