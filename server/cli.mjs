#!/usr/bin/env node
// Lunarcode desktop CLI. Desktop only: there is no npm package and no `lunarcode` bin any more.
//   - `Lunarcode ext …` runs it inside the desktop binary (see desktop/electron/main.mjs)
//   - resources/app/bin/lunarcode[.cmd] runs it with ELECTRON_RUN_AS_NODE (works headless, prints on Windows)
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const HELP = `Lunarcode CLI (desktop)

Usage:
  lunarcode ext <command>     manage extensions (lunarcode ext help)
  lunarcode version
  lunarcode help
`

const EXT_HELP = `Lunarcode extensions (.lce)

  lunarcode ext list                         installed extensions
  lunarcode ext new <id> [--template=hello|theme|tool|patch] [--name="My Ext"]
                                             create an editable starter in the extensions folder
  lunarcode ext pack <folder> [out.lce] [--name="My Ext"] [--version=1.0.0] [--desc="short description"]
                                             zip any folder into an .lce. Without an extension.json one is
                                             generated from the flags (also: --id, --author); with one, the
                                             flags override it. Output defaults to <id>-<version>.lce
  lunarcode ext unpack <file.lce> [folder]   unzip an .lce to read or edit it
  lunarcode ext install <file.lce|folder> [--enable]
  lunarcode ext enable|disable|remove <id>   (remove: add --data to delete its data too)
  lunarcode ext path                         where extensions live

An extension runs with full access: it can change the app, run Node code in the daemon and use any file or
network. Only install extensions you trust.`

const VALUE_FLAGS = new Set(['template', 'name', 'version', 'desc', 'description', 'id', 'author'])
const MAIN_FILES = ['main.js', 'main.mjs', 'index.js', 'index.mjs']
const SERVER_FILES = ['server.mjs', 'server.js']
const ICON_FILES = ['icon.png', 'icon.svg']
const SKIP_DIRS = new Set(['.git'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db'])

/** `--key=value`, `--key value` (value flags only) and `--flag`; everything else is positional. */
export function parseArgs(args) {
  const flags = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const key = (eq < 0 ? arg.slice(2) : arg.slice(2, eq)).trim()
    if (eq >= 0) flags[key] = arg.slice(eq + 1)
    else if (VALUE_FLAGS.has(key) && i + 1 < args.length && !args[i + 1].startsWith('--')) flags[key] = args[++i]
    else flags[key] = true
  }
  return { flags, positional }
}

const slug = (text) => {
  const clean = String(text).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+|[-_]+$/g, '')
  return (clean.length >= 2 ? clean : `${clean || 'ext'}-ext`).slice(0, 64)
}

async function collectFiles(root, skipFile) {
  const files = {}
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(absolute)
      } else if (entry.isFile() && !SKIP_FILES.has(entry.name) && absolute !== skipFile) {
        files[path.relative(root, absolute).replaceAll(path.sep, '/')] = await readFile(absolute)
      }
    }
  }
  await walk(root)
  return files
}

/** extension.json for a folder that has none: entry files are picked up by their conventional names. */
function generateManifest(root, files, flags) {
  const names = Object.keys(files)
  const pick = (list) => list.find((name) => names.includes(name))
  const styles = names.filter((name) => !name.includes('/') && name.endsWith('.css'))
  const manifest = {
    id: flags.id ? String(flags.id) : slug(path.basename(root)),
    name: String(flags.name ?? path.basename(root)),
    version: String(flags.version ?? '1.0.0'),
    engine: '>=4.0.0',
  }
  const main = pick(MAIN_FILES)
  const server = pick(SERVER_FILES)
  const icon = pick(ICON_FILES)
  if (main) manifest.main = main
  if (server) manifest.server = server
  if (styles.length) manifest.styles = styles
  if (icon) manifest.icon = icon
  return manifest
}

async function packFolder(dir, out, flags) {
  const { packExtension, MANIFEST_FILE } = await import('../shared/lce.mjs')
  const root = path.resolve(dir)
  if (!(await stat(root).catch(() => null))?.isDirectory()) throw new Error(`Not a folder: ${root}`)
  const target = out ? path.resolve(out) : null
  const files = await collectFiles(root, target)

  let manifest
  const existing = files[MANIFEST_FILE]
  delete files[MANIFEST_FILE]
  if (existing) {
    manifest = JSON.parse(existing.toString('utf8').replace(/^\uFEFF/, ''))
  } else {
    manifest = generateManifest(root, files, flags)
    if (!manifest.main && !manifest.server && !manifest.styles) {
      console.warn(`Warning: no entry file (main.js, server.mjs or a .css) in ${root}; the extension will do nothing unless you add one.`)
    }
  }
  if (flags.id) manifest.id = String(flags.id)
  if (flags.name) manifest.name = String(flags.name)
  if (flags.version) manifest.version = String(flags.version)
  if (flags.author) manifest.author = String(flags.author)
  const description = flags.desc ?? flags.description
  if (description && description !== true) manifest.description = String(description)

  const { bytes, manifest: clean } = packExtension({ manifest, files })
  const file = target ?? path.resolve(`${clean.id}-${clean.version}.lce`)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, bytes)
  console.log(`Packed ${clean.name} ${clean.version} (${clean.id}): ${Object.keys(files).length + 1} files → ${file} (${(bytes.length / 1024).toFixed(1)} KB)`)
}

async function commandExt(args) {
  const [sub = 'help', ...rest] = args
  if (sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(EXT_HELP)
    return
  }
  const { flags, positional } = parseArgs(rest)

  // pack never touches the data folder, so it does not need the extension runtime.
  if (sub === 'pack') {
    const [dir, out] = positional
    if (!dir) throw new Error('Usage: lunarcode ext pack <folder> [out.lce] [--name=…] [--version=…] [--desc=…]')
    await packFolder(dir, out, flags)
    return
  }

  // Extension patches for the daemon's own modules are armed first, so everything imported below can be patched.
  await import('./lib/ext-boot.mjs')
  const ext = await import('./lib/extensions.mjs')
  const { readExtensionArchive } = await import('../shared/lce.mjs')
  ext.disableServerRuntime()
  const version = JSON.parse(await readFile(path.join(HERE, '..', 'package.json'), 'utf8')).version
  await ext.prepareExtensions(version)
  try {
    switch (sub) {
      case 'list': {
        const { extensions } = await ext.listExtensions()
        if (extensions.length === 0) console.log(`No extensions. Folder: ${ext.EXTENSIONS_DIR}`)
        for (const item of extensions) {
          const parts = [item.summary?.renderer && 'window', item.summary?.server && 'daemon', item.patches.length && `${item.patches.length} patch`, item.themes.length && 'theme'].filter(Boolean)
          console.log(`${item.enabled ? '●' : '○'} ${item.id}  ${item.version}  ${item.name}${parts.length ? `  [${parts.join(', ')}]` : ''}${item.error ? `  ERROR: ${item.error}` : ''}`)
        }
        break
      }
      case 'path':
        console.log(ext.EXTENSIONS_DIR)
        break
      case 'new': {
        const [id] = positional
        if (!id) throw new Error('Usage: lunarcode ext new <id> [--template=hello|theme|tool|patch] [--name="My Ext"]')
        await ext.createExtension({ id, name: typeof flags.name === 'string' ? flags.name : id, template: typeof flags.template === 'string' ? flags.template : 'hello' })
        console.log(`Created ${path.join(ext.EXTENSIONS_DIR, id)}`)
        console.log(`Edit it, then: lunarcode ext enable ${id}  (the running app reloads on save)`)
        break
      }
      case 'unpack': {
        const [file, dir] = positional
        if (!file) throw new Error('Usage: lunarcode ext unpack <file.lce> [folder]')
        const { manifest, files } = readExtensionArchive(await readFile(path.resolve(file)))
        const target = path.resolve(dir ?? manifest.id)
        for (const [name, data] of files) {
          const destination = path.join(target, name)
          await mkdir(path.dirname(destination), { recursive: true })
          await writeFile(destination, data)
        }
        console.log(`Unpacked ${files.size} files → ${target}`)
        break
      }
      case 'install': {
        const [source] = positional
        if (!source) throw new Error('Usage: lunarcode ext install <file.lce|folder> [--enable]')
        const absolute = path.resolve(source)
        const enable = flags.enable === true
        const info = await stat(absolute)
        const result = info.isDirectory() ? await ext.installDirectory(absolute, { enable }) : await ext.installArchive(await readFile(absolute), { enable })
        console.log(`${result.updated ? 'Updated' : 'Installed'} ${result.extension.name} ${result.extension.version} (${result.extension.enabled ? 'enabled' : 'disabled'}).`)
        if (!result.extension.enabled) console.log(`Turn it on with: lunarcode ext enable ${result.extension.id}`)
        break
      }
      case 'enable':
      case 'disable': {
        const [id] = positional
        if (!id) throw new Error(`Usage: lunarcode ext ${sub} <id>`)
        await ext.setExtensionEnabled(id, sub === 'enable')
        console.log(`${id} ${sub}d. A running Lunarcode picks this up on its own.`)
        break
      }
      case 'remove': {
        const [id] = positional
        if (!id) throw new Error('Usage: lunarcode ext remove <id> [--data]')
        await ext.uninstallExtension(id, { removeData: flags.data === true })
        console.log(`Removed ${id}.`)
        break
      }
      default:
        console.log(EXT_HELP)
    }
  } finally {
    ext.stopWatching()
  }
}

/** Runs one CLI invocation and resolves to the exit code. */
export async function runCli(args) {
  const [command = 'help', ...rest] = args
  try {
    switch (command) {
      case 'ext':
      case 'extension':
      case 'extensions':
        await commandExt(rest)
        break
      case 'version':
      case '--version':
      case '-v':
        console.log(JSON.parse(await readFile(path.join(HERE, '..', 'package.json'), 'utf8')).version)
        break
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP)
        break
      default:
        console.error(`Unknown command: ${command}\n`)
        console.log(HELP)
        return 1
    }
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    return 1
  }
}

// Run directly (ELECTRON_RUN_AS_NODE launcher, or `node server/cli.mjs` from a checkout).
const entry = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null
if (entry && entry === (await realpath(fileURLToPath(import.meta.url)))) {
  process.exitCode = await runCli(process.argv.slice(2))
}
