// Lunarcode Desktop: starts (or reuses) the Lunarcode daemon and shows its UI in an
// Electron window. The daemon runs on Electron's own Node runtime, so no
// separate Node binary is shipped.
import { app, BrowserWindow, Menu, shell } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLocalUrl, parseListeningPort } from './util.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 4174
const START_TIMEOUT_MS = 25_000
const HEALTH_TIMEOUT_MS = 15_000
const OAUTH_WINDOW = 'opensol-mcp-oauth'

let mainWindow = null
let daemonChild = null
let daemonUrl = null
let ensuring = null
let quitting = false
let restarts = []

function openExternal(url) {
  if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
}

function resolveAppDir() {
  const candidates = []
  if (process.env.OPENSOL_APP_DIR) candidates.push(path.resolve(process.env.OPENSOL_APP_DIR))
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'app'))
  candidates.push(path.resolve(HERE, '../..'))
  return (
    candidates.find(
      (dir) => existsSync(path.join(dir, 'server', 'daemon.mjs')) && existsSync(path.join(dir, 'dist', 'index.html')),
    ) ?? null
  )
}

function readAppVersion(appDir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'))
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version
  } catch {
    // Fall back to the desktop package version.
  }
  return app.getVersion()
}

async function healthy(port, version) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(800),
    })
    if (!response.ok) return false
    const health = await response.json()
    return health?.ok === true && health?.dist === true && health?.version === version
  } catch {
    return false
  }
}

function spawnDaemon(appDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(appDir, 'server', 'daemon.mjs'), '--port=0'], {
      cwd: appDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let settled = false
    let stderr = ''
    let stdout = ''
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            `The Lunarcode daemon did not start within ${START_TIMEOUT_MS / 1000} seconds.${stderr.trim() ? ` ${stderr.trim()}` : ''}`,
          ),
        ),
      START_TIMEOUT_MS,
    )

    function fail(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(error)
    }

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (settled) return
      stdout += chunk
      let index
      while ((index = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, index).trim()
        stdout = stdout.slice(index + 1)
        const port = parseListeningPort(line)
        if (port === null) continue
        settled = true
        clearTimeout(timer)
        child.stdout.removeAllListeners('data')
        child.stdout.resume()
        resolve({ child, port })
        return
      }
    })
    child.on('error', (error) => fail(new Error(`Could not start the Lunarcode daemon: ${error.message}`)))
    child.on('exit', (code) => {
      const detail = stderr.trim() ? ` ${stderr.trim()}` : ''
      fail(new Error(`The Lunarcode daemon exited (code ${code ?? 'signal'}).${detail}`))
    })
  })
}

async function waitForHealth(port, version) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await healthy(port, version)) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

/** One start at a time: activate, second-instance and a crash restart can race, and two daemons would fight over the data folder. */
function ensureDaemon() {
  ensuring ??= startDaemonOnce().finally(() => {
    ensuring = null
  })
  return ensuring
}

async function startDaemonOnce() {
  const appDir = resolveAppDir()
  if (!appDir) {
    throw new Error('Lunarcode’s app files were not found. Run “npm run build” before starting the desktop app.')
  }
  const version = readAppVersion(appDir)

  if (daemonUrl) {
    const port = Number(new URL(daemonUrl).port)
    if (await healthy(port, version)) return daemonUrl
    daemonUrl = null
    const stale = daemonChild
    daemonChild = null
    if (stale) killTree(stale)
  }

  if (await healthy(DEFAULT_PORT, version)) {
    daemonUrl = `http://127.0.0.1:${DEFAULT_PORT}/`
    return daemonUrl
  }

  const { child, port } = await spawnDaemon(appDir)
  daemonChild = child
  child.on('exit', () => onDaemonExit(child))
  if (!(await waitForHealth(port, version))) {
    daemonChild = null
    killTree(child)
    throw new Error('The Lunarcode daemon started but is not answering.')
  }
  daemonUrl = `http://127.0.0.1:${port}/`
  return daemonUrl
}

/** Kills the daemon with its children: on Windows `kill()` is a hard kill that would orphan MCP servers and shell commands. */
function killTree(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  child.kill()
}

function stopDaemon() {
  quitting = true
  if (daemonChild) killTree(daemonChild)
  daemonChild = null
}

/** The daemon the app started died while the window was open: start it again (at most 3 times a minute). */
function onDaemonExit(child) {
  if (daemonChild !== child) return
  daemonChild = null
  daemonUrl = null
  if (quitting || !mainWindow || mainWindow.isDestroyed()) return
  const now = Date.now()
  restarts = restarts.filter((time) => now - time < 60_000)
  if (restarts.length >= 3) {
    void showError(mainWindow, 'The Lunarcode daemon keeps stopping. Close and reopen Lunarcode; check ~/.lunarcode for logs.')
    return
  }
  restarts.push(now)
  void loadApp(mainWindow)
}

function loadingPage() {
  return path.join(app.getAppPath(), 'loading', 'index.html')
}

async function showError(win, message) {
  if (win.isDestroyed()) return
  await win.webContents.executeJavaScript(`window.__opensolError?.(${JSON.stringify(message)})`).catch(() => undefined)
  win.show()
}

async function loadApp(win) {
  try {
    await win.loadFile(loadingPage())
    await win.loadURL(await ensureDaemon())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lunarcode could not start.'
    await win.loadFile(loadingPage()).catch(() => undefined)
    await showError(win, message)
  }
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'Lunarcode',
    width: 1360,
    height: 860,
    minWidth: 920,
    minHeight: 600,
    show: false,
    backgroundColor: '#f8f8f6',
    autoHideMenuBar: process.platform !== 'darwin',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isLocalUrl(url)) return
    event.preventDefault()
    openExternal(url)
  })
  win.webContents.on('will-redirect', (event, url) => {
    if (isLocalUrl(url)) return
    event.preventDefault()
    openExternal(url)
  })
  if (!app.isPackaged && process.env.OPENSOL_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  return win
}

function installMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]),
  )
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      if (app.isReady()) void loadApp(createWindow())
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url, frameName }) => {
      if (frameName === OAUTH_WINDOW) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            title: 'Lunarcode sign-in',
            autoHideMenuBar: true,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
          },
        }
      }
      if (isLocalUrl(url)) return { action: 'allow' }
      openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('dev.opensoft.opensol')
    installMenu()
    void loadApp(createWindow())
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void loadApp(createWindow())
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', stopDaemon)
}
