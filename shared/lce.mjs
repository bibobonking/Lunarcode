// Lunarcode Extension (.lce) package contract.
//
// An .lce file is a plain ZIP archive. There is no capability list, no API version and no
// sandbox: an extension is a folder of files that Lunarcode runs with full privileges, the way a
// userscript or a BepInEx mod does. This module is the one place that knows the archive layout:
// a Node-only, zero-dependency ZIP reader/writer (node:zlib) plus manifest validation.
//
//   my-extension.lce
//   ├── extension.json     manifest (required)
//   ├── main.js            renderer ES module, runs inside the Lunarcode window   (optional)
//   ├── server.mjs         Node module, runs inside the daemon with full Node      (optional)
//   ├── style.css          stylesheets                                              (optional)
//   └── …                  any other files: more modules, images, wasm, data

import { crc32 as zlibCrc32, deflateRawSync, inflateRawSync } from 'node:zlib'

export const MANIFEST_FILE = 'extension.json'

/** Generous on purpose: "any size of extension installs". These only stop zip bombs. */
export const LIMITS = Object.freeze({
  archiveBytes: 256 * 1024 * 1024,
  unpackedBytes: 1024 * 1024 * 1024,
  fileBytes: 512 * 1024 * 1024,
  files: 20_000,
  manifestBytes: 256 * 1024,
})

export class LceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LceError'
  }
}

function fail(message) {
  throw new LceError(message)
}

// ---------------------------------------------------------------------------------------------
// Paths and versions
// ---------------------------------------------------------------------------------------------

/** A relative, forward-slash path with no traversal. Returns the cleaned path or throws. */
export function safeRelativePath(value, what = 'path') {
  if (typeof value !== 'string' || !value) fail(`${what} must be a non-empty string`)
  const normalized = value.replaceAll('\\', '/')
  if (
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..' || part === '')
  ) {
    fail(`unsafe ${what} "${value}"`)
  }
  return normalized.split('/').filter((part) => part !== '.').join('/')
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(value) {
  const match = SEMVER.exec(String(value ?? '').trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/** `>=4.0.0`, `^4.0.0`, `~4.1.0`, `4.0.0`, `>=4.0.0 <5.0.0`, `*`. Tiny on purpose. */
export function satisfies(version, range) {
  const current = parseVersion(version)
  if (!current) return false
  const text = String(range ?? '').trim()
  if (!text || text === '*' || text === 'x') return true
  return text.split(/\s+/).every((token) => {
    const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+(?:\.\d+){0,2})(?:-[0-9A-Za-z.-]+)?$/.exec(token)
    if (!match) return false
    const op = match[1] ?? '='
    const parts = match[2].split('.').map(Number)
    const target = [parts[0], parts[1] ?? 0, parts[2] ?? 0]
    const order = compareVersions(current, target)
    switch (op) {
      case '>=':
        return order >= 0
      case '>':
        return order > 0
      case '<=':
        return order <= 0
      case '<':
        return order < 0
      case '=':
        return order === 0
      case '^':
        return order >= 0 && current[0] === target[0] && (target[0] !== 0 || current[1] === target[1])
      case '~':
        return order >= 0 && current[0] === target[0] && current[1] === target[1]
      default:
        return false
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------

const ID = /^[a-z0-9][a-z0-9_-]{1,63}$/
const THEME_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/
const TOKEN = /^[a-z][a-z0-9-]*$/
const TRIPLET = /^\s*\d{1,3}(?:\.\d+)?\s+\d{1,3}(?:\.\d+)?\s+\d{1,3}(?:\.\d+)?\s*$/

function optionalText(value, name, max) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') fail(`manifest.${name} must be a string`)
  if (value.length > max) fail(`manifest.${name} is too long`)
  return value
}

function authorText(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return optionalText(value.name, 'author.name', 120)
  return optionalText(value, 'author', 120)
}

function scriptPath(value, name, extensions) {
  if (value === undefined || value === null) return undefined
  const clean = safeRelativePath(value, `manifest.${name}`)
  if (!extensions.some((ext) => clean.endsWith(ext))) {
    fail(`manifest.${name} must end with ${extensions.join(' or ')}`)
  }
  return clean
}

function normalizeTheme(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`manifest.themes[${index}] must be an object`)
  const { id, label, dark, tokens, css } = raw
  if (typeof id !== 'string' || !THEME_ID.test(id)) fail(`manifest.themes[${index}].id is invalid`)
  if (typeof label !== 'string' || !label.trim() || label.length > 60) fail(`manifest.themes[${index}].label is invalid`)
  const out = { id, label: label.trim(), dark: dark !== false }
  if (tokens !== undefined) {
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) fail(`manifest.themes[${index}].tokens must be an object`)
    out.tokens = {}
    for (const [token, value] of Object.entries(tokens)) {
      if (!TOKEN.test(token)) fail(`manifest.themes[${index}] has an invalid token name "${token}"`)
      if (typeof value !== 'string' || !TRIPLET.test(value)) {
        fail(`manifest.themes[${index}].tokens.${token} must be an RGB triplet like "34 34 38"`)
      }
      out.tokens[token] = value.trim().replace(/\s+/g, ' ')
    }
  }
  if (css !== undefined) out.css = safeRelativePath(css, `manifest.themes[${index}].css`)
  return out
}

const PATCH_TEXT_OPS = ['replace', 'insertBefore', 'insertAfter', 'append', 'prepend']

function normalizePatch(raw, index) {
  const where = `manifest.patches[${index}]`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${where} must be an object`)
  const scope = raw.scope ?? 'web'
  if (scope !== 'web' && scope !== 'server') fail(`${where}.scope must be "web" or "server"`)
  if (typeof raw.target !== 'string' || !raw.target.trim() || raw.target.length > 200) fail(`${where}.target is required`)
  const target = raw.target.trim().replaceAll('\\', '/').replace(/^\/+/, '')
  if (target.split('/').some((part) => part === '..')) fail(`${where}.target must stay inside the app`)

  const patch = { scope, target }
  const ops = PATCH_TEXT_OPS.filter((key) => raw[key] !== undefined)
  if (ops.length !== 1) fail(`${where} needs exactly one of ${PATCH_TEXT_OPS.join(', ')}`)
  const op = ops[0]
  if (raw.file !== undefined) {
    patch.file = safeRelativePath(raw.file, `${where}.file`)
    // The text comes from the file; an inline value is only a placeholder then.
    patch[op] = typeof raw[op] === 'string' ? raw[op] : ''
  } else if (typeof raw[op] !== 'string') {
    fail(`${where}.${op} must be a string`)
  } else {
    patch[op] = raw[op]
  }
  if (op === 'append' || op === 'prepend') {
    if (raw.find !== undefined) fail(`${where}: ${op} works on the whole file and takes no "find"`)
  } else {
    const { find } = raw
    if (typeof find === 'string') {
      if (!find) fail(`${where}.find must not be empty`)
      patch.find = find
    } else if (find && typeof find === 'object' && typeof find.regex === 'string') {
      const flags = typeof find.flags === 'string' ? find.flags : ''
      if (!/^[dgimsuvy]*$/.test(flags)) fail(`${where}.find.flags is invalid`)
      try {
        new RegExp(find.regex, flags)
      } catch (error) {
        fail(`${where}.find.regex does not compile: ${error.message}`)
      }
      patch.find = { regex: find.regex, flags }
    } else {
      fail(`${where}.find must be a string or { regex, flags }`)
    }
  }
  if (raw.all !== undefined) patch.all = Boolean(raw.all)
  if (raw.optional !== undefined) patch.optional = Boolean(raw.optional)
  if (raw.note !== undefined) patch.note = optionalText(raw.note, `patches[${index}].note`, 300)
  return patch
}

/** Validates `extension.json` and returns a normalised copy. Unknown fields are kept (forward compatible). */
export function validateManifest(value, { appVersion } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('extension.json must be a JSON object')
  const { id, name, version } = value
  if (typeof id !== 'string' || !ID.test(id)) {
    fail('manifest.id must be 2–64 characters: lowercase letters, digits, "-" or "_" (it is the folder name)')
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 100) fail('manifest.name is required (max 100 characters)')
  if (typeof version !== 'string' || !SEMVER.test(version)) fail('manifest.version must look like 1.2.3')

  const manifest = {
    ...value,
    id,
    name: name.trim(),
    version,
    description: optionalText(value.description, 'description', 600),
    author: authorText(value.author),
    homepage: optionalText(value.homepage, 'homepage', 300),
    license: optionalText(value.license, 'license', 60),
    icon: value.icon === undefined ? undefined : safeRelativePath(value.icon, 'manifest.icon'),
    engine: optionalText(value.engine, 'engine', 80),
    main: scriptPath(value.main, 'main', ['.js', '.mjs']),
    server: scriptPath(value.server, 'server', ['.mjs', '.js', '.cjs']),
  }

  if (value.styles !== undefined) {
    if (!Array.isArray(value.styles)) fail('manifest.styles must be an array of CSS files')
    manifest.styles = value.styles.map((file) => {
      const clean = safeRelativePath(file, 'manifest.styles entry')
      if (!clean.endsWith('.css')) fail('manifest.styles entries must be .css files')
      return clean
    })
  }
  if (value.themes !== undefined) {
    if (!Array.isArray(value.themes)) fail('manifest.themes must be an array')
    manifest.themes = value.themes.map(normalizeTheme)
    if (new Set(manifest.themes.map((theme) => theme.id)).size !== manifest.themes.length) fail('duplicate theme id')
  }
  if (value.patches !== undefined) {
    if (!Array.isArray(value.patches)) fail('manifest.patches must be an array')
    manifest.patches = value.patches.map(normalizePatch)
  }

  if (manifest.engine && appVersion && !satisfies(appVersion, manifest.engine)) {
    fail(`needs Lunarcode ${manifest.engine}, this is ${appVersion}`)
  }
  for (const key of Object.keys(manifest)) if (manifest[key] === undefined) delete manifest[key]
  return manifest
}

/** What an extension contains, for the install prompt and the manager. */
export function summarizeManifest(manifest) {
  return {
    renderer: Boolean(manifest.main),
    server: Boolean(manifest.server),
    styles: manifest.styles?.length ?? 0,
    themes: manifest.themes?.length ?? 0,
    webPatches: manifest.patches?.filter((patch) => patch.scope === 'web').length ?? 0,
    serverPatches: manifest.patches?.filter((patch) => patch.scope === 'server').length ?? 0,
  }
}

// ---------------------------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------------------------

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50

let crcTable = null
function crc32(buffer) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buffer) >>> 0
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function toBuffer(content) {
  if (Buffer.isBuffer(content)) return content
  if (content instanceof Uint8Array) return Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  return Buffer.from(String(content), 'utf8')
}

/** Builds a ZIP from `{ 'path/in/zip': string | Uint8Array }`. Output is deterministic. */
export function writeZip(files) {
  const names = Object.keys(files).sort()
  if (names.length > LIMITS.files) fail('too many files')
  const locals = []
  const centrals = []
  let offset = 0
  // 2026-01-01 00:00, fixed so packing the same folder twice gives the same bytes.
  const dosTime = 0
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const rawName of names) {
    const name = safeRelativePath(rawName, 'file path')
    const nameBytes = Buffer.from(name, 'utf8')
    const data = toBuffer(files[rawName])
    if (data.length > LIMITS.fileBytes) fail(`"${name}" is too large`)
    const deflated = deflateRawSync(data, { level: 9 })
    const useDeflate = deflated.length < data.length
    const body = useDeflate ? deflated : data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(0x031e, 4) // made by: unix, 3.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(useDeflate ? 8 : 0, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(0o100644 * 0x10000, 38) // unix file mode in the high half
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)

    offset += 30 + nameBytes.length + body.length
    if (offset > 0xfffffff0) fail('archive is too large for this format')
  }
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(names.length, 8)
  eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, eocd])
}

/** Reads a ZIP into `Map<path, Buffer>`. Rejects traversal, zip bombs, encryption and zip64. */
export function readZip(input) {
  const zip = toBuffer(input)
  if (zip.length < 22) fail('the file is not a valid .lce archive (too small)')
  if (zip.length > LIMITS.archiveBytes) fail('the archive is too large')

  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i -= 1) {
    if (zip.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) fail('the file is not a valid .lce archive (it is not a ZIP)')
  if (eocd >= 20 && zip.readUInt32LE(eocd - 20) === SIG_ZIP64_EOCD_LOCATOR) fail('zip64 archives are not supported')

  const count = zip.readUInt16LE(eocd + 10)
  const centralSize = zip.readUInt32LE(eocd + 12)
  const centralOffset = zip.readUInt32LE(eocd + 16)
  if (count === 0xffff || centralOffset === 0xffffffff) fail('zip64 archives are not supported')
  if (count > LIMITS.files) fail('the archive has too many files')
  if (centralOffset + centralSize > eocd) fail('the archive directory is damaged')

  const files = new Map()
  let total = 0
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== SIG_CENTRAL) fail('the archive directory is damaged')
    const flags = zip.readUInt16LE(cursor + 8)
    const method = zip.readUInt16LE(cursor + 10)
    const crc = zip.readUInt32LE(cursor + 16)
    const compressedSize = zip.readUInt32LE(cursor + 20)
    const size = zip.readUInt32LE(cursor + 24)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)
    const rawName = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    cursor += 46 + nameLength + extraLength + commentLength

    if (flags & 1) fail('encrypted archives are not supported')
    const normalized = rawName.replaceAll('\\', '/')
    if (normalized.endsWith('/')) continue // directory entry
    if (normalized.startsWith('__MACOSX/') || normalized.endsWith('/.DS_Store') || normalized === '.DS_Store') continue
    const name = safeRelativePath(normalized, 'archive entry')
    if (size > LIMITS.fileBytes) fail(`"${name}" is too large`)
    total += size
    if (total > LIMITS.unpackedBytes) fail('the archive is too large once unpacked')

    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== SIG_LOCAL) fail('the archive is damaged')
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
    const raw = zip.subarray(dataStart, dataStart + compressedSize)
    if (raw.length !== compressedSize) fail('the archive is truncated')
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) })
      } catch {
        fail(`"${name}" could not be decompressed`)
      }
    } else fail(`"${name}" uses an unsupported compression method`)
    if (data.length !== size) fail(`"${name}" has the wrong size`)
    if (crc32(data) !== crc) fail(`"${name}" is corrupted (checksum mismatch)`)
    files.set(name, data)
  }
  return files
}

// ---------------------------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------------------------

/**
 * Reads an .lce (or a zipped extension folder: a single top-level directory is unwrapped).
 * Returns `{ manifest, files }` where `files` is a Map of every file including extension.json.
 */
export function readExtensionArchive(input, { appVersion } = {}) {
  const raw = readZip(input)
  let files = raw
  if (!files.has(MANIFEST_FILE)) {
    const roots = new Set([...files.keys()].map((name) => name.split('/')[0]))
    const [only] = roots
    if (roots.size === 1 && files.has(`${only}/${MANIFEST_FILE}`)) {
      files = new Map([...files].map(([name, data]) => [name.slice(only.length + 1), data]))
    }
  }
  const manifestBytes = files.get(MANIFEST_FILE)
  if (!manifestBytes) fail(`${MANIFEST_FILE} is missing: this is not a Lunarcode extension`)
  if (manifestBytes.length > LIMITS.manifestBytes) fail('extension.json is too large')
  let parsed
  try {
    parsed = JSON.parse(manifestBytes.toString('utf8').replace(/^﻿/, ''))
  } catch (error) {
    fail(`extension.json is not valid JSON: ${error.message}`)
  }
  const manifest = validateManifest(parsed, { appVersion })
  for (const key of ['main', 'server', 'icon']) {
    if (manifest[key] && !files.has(manifest[key])) fail(`manifest.${key} points to "${manifest[key]}", which is not in the package`)
  }
  for (const file of manifest.styles ?? []) if (!files.has(file)) fail(`style "${file}" is not in the package`)
  for (const theme of manifest.themes ?? []) if (theme.css && !files.has(theme.css)) fail(`theme css "${theme.css}" is not in the package`)
  for (const patch of manifest.patches ?? []) if (patch.file && !files.has(patch.file)) fail(`patch file "${patch.file}" is not in the package`)
  return { manifest, files }
}

/** Packs `{ manifest, files }` (files: path → string | bytes) into .lce bytes. */
export function packExtension({ manifest, files }) {
  const clean = validateManifest(manifest)
  const all = { ...files, [MANIFEST_FILE]: `${JSON.stringify(manifest, null, 2)}\n` }
  const bytes = writeZip(all)
  // Round-trip so a package that cannot be installed is never produced.
  readExtensionArchive(bytes)
  return { bytes, manifest: clean }
}
