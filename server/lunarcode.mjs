#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BOOT = pathToFileURL(path.join(HERE, 'lib', 'ext-boot.mjs')).href

// Extension patches for the daemon's own modules are armed first, so everything imported below can be patched.
await import('./lib/ext-boot.mjs')
const { DATA_DIR, ensureDataDir } = await import('./lib/store.mjs')
const { daemonStatus, startServer, stopDaemon } = await import('./daemon.mjs')
const DAEMON = path.join(HERE, 'daemon.mjs')
const LOG_FILE = path.join(DATA_DIR, 'daemon.log')
const PID_FILE = path.join(DATA_DIR, 'daemon.json')

const HELP = `Lunarcode — local coding agent daemon

Usage:
  lunarcode start [--port=4174] [--open] [--foreground]
  lunarcode stop
  lunarcode status
  lunarcode open
  lunarcode logs
  lunarcode ext <command>        manage extensions (lunarcode ext help)

The daemon serves the built app from dist/ and keeps your settings, chats and
encrypted provider keys in ${DATA_DIR}. It listens on 127.0.0.1 only.
`

function parseFlags(args) {
  const flags = { port: 4174, open: false, foreground: false }
  for (const arg of args) {
    if (arg === '--open') flags.open = true
    else if (arg === '--foreground') flags.foreground = true
    else if (arg.startsWith('--port=')) {
      const value = Number(arg.slice('--port='.length))
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error('Use --port=<1-65535>.')
      }
      flags.port = value
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return flags
}

function openerFor(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => console.log(`Open ${url} in your browser.`))
  child.unref()
}

async function tailLog(lines = 40) {
  const info = await stat(LOG_FILE).catch(() => null)
  if (!info) {
    console.log('No daemon log yet.')
    return
  }
  const raw = await readFile(LOG_FILE, 'utf8')
  const slice = raw.trimEnd().split('\n').slice(-lines)
  console.log(slice.join('\n'))
}

async function rotateLog() {
  const info = await stat(LOG_FILE).catch(() => null)
  if (info && info.size > 5 * 1024 * 1024) {
    const previous = `${LOG_FILE}.1`
    await unlink(previous).catch(() => undefined)
    const { rename } = await import('node:fs/promises')
    await rename(LOG_FILE, previous).catch(() => undefined)
  }
}

async function waitForDaemon(pid, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await daemonStatus()
    if (status.running) return status
    if (pid) {
      try {
        process.kill(pid, 0)
      } catch {
        return { running: false, info: null }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return { running: false, info: null }
}

async function commandStart(args) {
  const flags = parseFlags(args)
  if (flags.help) {
    console.log(HELP)
    return
  }
  await ensureDataDir()
  const existing = await daemonStatus()
  if (existing.running) {
    console.log(`Lunarcode is already running at ${existing.info.url}`)
    if (flags.open) openerFor(existing.info.url)
    return
  }
  await unlink(PID_FILE).catch(() => undefined)

  if (flags.foreground) {
    await startServer({ port: flags.port, open: flags.open })
    return
  }

  await rotateLog()
  const handle = await open(LOG_FILE, 'a', 0o600)
  const child = spawn(process.execPath, ['--import', BOOT, DAEMON, `--port=${flags.port}`], {
    detached: true,
    stdio: ['ignore', handle.fd, handle.fd],
    cwd: path.resolve(HERE, '..'),
    env: { ...process.env, LUNARCODE_DATA: DATA_DIR, OPENSOL_DATA: DATA_DIR, MAXCODE_DATA: DATA_DIR },
  })
  child.unref()
  await handle.close()

  const status = await waitForDaemon(child.pid)
  if (!status.running) {
    console.error('Lunarcode did not start. Recent log:')
    await tailLog(20)
    process.exitCode = 1
    return
  }
  console.log(`Lunarcode is running at ${status.info.url}`)
  console.log(`Data: ${DATA_DIR}`)
  console.log(`Log:  ${LOG_FILE}`)
  if (flags.open) openerFor(status.info.url)
}

async function commandStatus() {
  const status = await daemonStatus()
  if (!status.running) {
    console.log('Lunarcode is not running.')
    return
  }
  console.log(`Lunarcode is running at ${status.info.url}`)
  console.log(`PID: ${status.info.pid}`)
  console.log(`Data: ${status.info.dataDir ?? DATA_DIR}`)
  console.log(`Dist ready: ${status.info.dist ? 'yes' : 'no'}`)
}

async function commandOpen() {
  const status = await daemonStatus()
  if (!status.running) {
    console.error('Lunarcode is not running. Start it with: lunarcode start')
    process.exitCode = 1
    return
  }
  openerFor(status.info.url)
  console.log(`Opened ${status.info.url}`)
}

async function commandStop() {
  const result = await stopDaemon()
  if (!result.stopped) {
    console.log(result.reason ?? 'Lunarcode is not running.')
    return
  }
  console.log(`Stopped Lunarcode${result.pid ? ` (pid ${result.pid})` : ''}.`)
}


const EXT_HELP = `Lunarcode extensions (.lce)

  lunarcode ext list                         installed extensions
  lunarcode ext new <id> [--template=hello|theme|tool|patch] [--name="My Ext"]
                                             create an editable starter in the extensions folder
  lunarcode ext pack <folder> [out.lce]      zip a folder into an .lce
  lunarcode ext unpack <file.lce> [folder]   unzip an .lce to read or edit it
  lunarcode ext install <file.lce|folder> [--enable]
  lunarcode ext enable|disable|remove <id>
  lunarcode ext path                         where extensions live

An extension runs with full access: it can change the app, run Node code in the daemon and use any file or
network. Only install extensions you trust.`

async function commandExt(args) {
  const [sub = 'help', ...rest] = args
  const ext = await import('./lib/extensions.mjs')
  const { readExtensionArchive, packExtension, MANIFEST_FILE } = await import('../shared/lce.mjs')
  const { scaffold } = await import('./lib/ext-templates.mjs')
  ext.disableServerRuntime()
  const version = JSON.parse(await readFile(path.join(HERE, '..', 'package.json'), 'utf8')).version
  await ext.prepareExtensions(version)
  const flag = (name) => rest.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const positional = rest.filter((value) => !value.startsWith('--'))

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
      if (!id) throw new Error('Usage: lunarcode ext new <id> [--template=hello|theme|tool|patch]')
      const made = await ext.createExtension({ id, name: flag('name') ?? id, template: flag('template') ?? 'hello' })
      console.log(`Created ${path.join(ext.EXTENSIONS_DIR, id)}`)
      console.log(`Edit it, then: lunarcode ext enable ${id}  (the running app reloads on save)`)
      void made
      void scaffold
      break
    }
    case 'pack': {
      const [dir, out] = positional
      if (!dir) throw new Error('Usage: lunarcode ext pack <folder> [out.lce]')
      const root = path.resolve(dir)
      const files = {}
      const walkDir = async (current) => {
        const { readdir } = await import('node:fs/promises')
        for (const entry of await readdir(current, { withFileTypes: true })) {
          const absolute = path.join(current, entry.name)
          const relative = path.relative(root, absolute).replaceAll(path.sep, '/')
          if (entry.isDirectory()) {
            if (entry.name === '.git') continue
            await walkDir(absolute)
          } else if (relative !== MANIFEST_FILE) files[relative] = await readFile(absolute)
        }
      }
      await walkDir(root)
      const manifest = JSON.parse((await readFile(path.join(root, MANIFEST_FILE), 'utf8')).replace(/^\uFEFF/, ''))
      const { bytes } = packExtension({ manifest, files })
      const target = path.resolve(out ?? `${manifest.id}-${manifest.version}.lce`)
      await writeFile(target, bytes)
      console.log(`Packed ${Object.keys(files).length + 1} files → ${target} (${(bytes.length / 1024).toFixed(1)} KB)`)
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
      const enable = rest.includes('--enable')
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
      await ext.uninstallExtension(id, { removeData: rest.includes('--data') })
      console.log(`Removed ${id}.`)
      break
    }
    default:
      console.log(EXT_HELP)
  }
  ext.stopWatching()
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2)
  switch (command) {
    case 'start':
      await commandStart(args)
      break
    case 'stop':
      await commandStop()
      break
    case 'status':
      await commandStatus()
      break
    case 'open':
      await commandOpen()
      break
    case 'logs':
      await tailLog()
      break
    case 'ext':
    case 'extension':
    case 'extensions':
      await commandExt(process.argv.slice(3))
      break
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      break
    default:
      console.error(`Unknown command: ${command}\n`)
      console.log(HELP)
      process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
