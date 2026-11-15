// Cross-platform shell resolution for the `shell` tool and deploy builds.
// Pure helpers (resolveShell, planShellAllowed, describeShell) take injected platform/env so
// Windows and macOS behaviour is unit-tested from any OS.
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

const PS_PROLOGUE = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ErrorActionPreference="Continue";'
// Keeps the exit code of the last native command; PowerShell otherwise reports 0.
const PS_EPILOGUE = ';if($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0){exit $LASTEXITCODE}elseif(-not $?){exit 1}'

function platformName(platform) {
  return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
}

function posixShell(id, file) {
  return { id, file, family: 'posix', label: id, args: (command) => ['-lc', command] }
}

function powershell(id, file) {
  return {
    id,
    file,
    family: 'powershell',
    label: id === 'pwsh' ? 'PowerShell 7' : 'PowerShell',
    args: (command) => [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `${PS_PROLOGUE}${command}${PS_EPILOGUE}`,
    ],
  }
}

function cmdShell(file) {
  return { id: 'cmd', file, family: 'cmd', label: 'cmd', args: (command) => ['/d', '/s', '/c', command] }
}

function findOnPath(name, env, platform, exists) {
  const sep = platform === 'win32' ? ';' : ':'
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  const join = platform === 'win32' ? path.win32.join : path.posix.join
  for (const dir of String(env.PATH ?? env.Path ?? '').split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`)
      if (exists(candidate)) return candidate
    }
  }
  return ''
}

/** Picks the shell used to run agent commands. OPENSOL_SHELL (path or name) overrides detection. */
export function resolveShell({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const override = String(env.OPENSOL_SHELL ?? '').trim()
  if (override) {
    const base = path.basename(override.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '')
    if (base === 'pwsh' || base === 'powershell') return powershell(base, override)
    if (base === 'cmd') return cmdShell(override)
    return posixShell(base || 'sh', override)
  }

  if (platform === 'win32') {
    const pwsh = findOnPath('pwsh', env, platform, exists)
    if (pwsh) return powershell('pwsh', pwsh)
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
    const legacy = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (exists(legacy)) return powershell('powershell', legacy)
    const onPath = findOnPath('powershell', env, platform, exists)
    if (onPath) return powershell('powershell', onPath)
    return cmdShell(env.ComSpec ?? env.COMSPEC ?? 'cmd.exe')
  }

  if (platform === 'darwin') {
    const user = String(env.SHELL ?? '')
    const base = path.posix.basename(user)
    if ((base === 'zsh' || base === 'bash') && user && exists(user)) return posixShell(base, user)
    for (const [id, file] of [['zsh', '/bin/zsh'], ['bash', '/bin/bash'], ['sh', '/bin/sh']]) {
      if (exists(file)) return posixShell(id, file)
    }
    return posixShell('sh', '/bin/sh')
  }

  const userShell = String(env.SHELL ?? '')
  const userBase = path.posix.basename(userShell)
  if ((userBase === 'zsh' || userBase === 'bash') && userShell && exists(userShell)) return posixShell(userBase, userShell)
  for (const [id, file] of [['bash', '/bin/bash'], ['bash', '/usr/bin/bash'], ['bash', '/usr/local/bin/bash']]) {
    if (exists(file)) return posixShell(id, file)
  }
  const bash = findOnPath('bash', env, platform, exists)
  if (bash) return posixShell('bash', bash)
  return posixShell('sh', exists('/bin/sh') ? '/bin/sh' : 'sh')
}

let cached
export function currentShell() {
  cached ??= resolveShell()
  return cached
}

// ---- PATH repair -------------------------------------------------------------------------------
// A daemon started from the desktop app, a launcher or a service inherits a bare PATH, and `bash -lc`
// never reads ~/.bashrc / ~/.zshrc, which is where nvm, fnm, volta and friends are set up. The result:
// `node -v` works in the user's terminal but "command not found" for the agent.

const PATH_MARK = '__OPENSOL_PATH__'

/** Joins PATH lists, keeping first-seen order and dropping blanks and duplicates. */
export function mergePathLists(lists, sep = ':') {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    const parts = Array.isArray(list) ? list : String(list ?? '').split(sep)
    for (const part of parts) {
      const dir = part.trim()
      if (!dir || seen.has(dir)) continue
      seen.add(dir)
      out.push(dir)
    }
  }
  return out.join(sep)
}

/** Well-known install locations for version managers and package managers (POSIX only). */
export function fallbackToolDirs({ env = process.env, exists = existsSync, list = (dir) => readdirSync(dir) } = {}) {
  const home = String(env.HOME ?? '')
  const dirs = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin']
  if (home) {
    dirs.push(`${home}/.local/bin`, `${home}/.volta/bin`, `${home}/.bun/bin`, `${home}/.cargo/bin`, `${home}/.deno/bin`)
    dirs.push(`${env.FNM_DIR || `${home}/.local/share/fnm`}/aliases/default/bin`)
    const nvm = env.NVM_DIR || `${home}/.nvm`
    try {
      const versions = list(`${nvm}/versions/node`)
        .filter((name) => /^v\d/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      if (versions.length > 0) dirs.push(`${nvm}/versions/node/${versions[versions.length - 1]}/bin`)
    } catch {
      // nvm is not installed.
    }
  }
  return dirs.filter((dir) => exists(dir))
}

/** Pulls the PATH out of probe output, ignoring any banner or prompt noise around the markers. */
export function parseProbedPath(output) {
  const text = String(output ?? '')
  const start = text.indexOf(PATH_MARK)
  if (start < 0) return ''
  const end = text.indexOf(PATH_MARK, start + PATH_MARK.length)
  return end < 0 ? '' : text.slice(start + PATH_MARK.length, end).trim()
}

function probeUserPath(shell, env) {
  if (shell.family !== 'posix' || !['bash', 'zsh'].includes(shell.id)) return ''
  // Interactive login covers profile files; bash also needs a plain interactive run because terminal
  // emulators on Linux start non-login shells that read ~/.bashrc, which a login shell skips.
  const modes = shell.id === 'bash' ? ['-ilc', '-ic'] : ['-ilc']
  const found = []
  for (const mode of modes) {
    try {
      const result = spawnSync(shell.file, [mode, `printf '%s' "${PATH_MARK}${'${PATH}'}${PATH_MARK}"`], {
        env: { ...env, TERM: env.TERM || 'dumb' },
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
      found.push(parseProbedPath(result.stdout))
    } catch {
      // Try the next mode.
    }
  }
  return mergePathLists(found)
}

let repairedPath
/** The PATH commands should run with: user's real shell PATH first, then the inherited one, then known tool dirs. */
export function userPath({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') return String(env.PATH ?? env.Path ?? '')
  if (repairedPath === undefined) {
    repairedPath = mergePathLists([probeUserPath(currentShell(), env), env.PATH, fallbackToolDirs({ env })])
  }
  return repairedPath
}

/** Call once at daemon start so every child process (shell tool, git, deploy, MCP) sees the repaired PATH. */
export function repairProcessEnv() {
  if (process.platform !== 'win32') {
    const fixed = userPath()
    if (fixed) process.env.PATH = fixed
  }
  // Set by the desktop app to run this daemon on Electron's Node; it must not leak into user commands.
  delete process.env.ELECTRON_RUN_AS_NODE
}

export function describeShell(shell = currentShell(), { platform = process.platform, arch = os.arch() } = {}) {
  const system = platformName(platform)
  return `${shell.label} on ${system}${platform === 'darwin' ? ` (${arch})` : ''}`
}

/** Kills a spawned command and everything it started. */
export function killTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => child.kill('SIGKILL'))
    } else {
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'branch', 'remote', 'rev-parse', 'ls-files'])
const POSIX_READ = new Set([
  'pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'tree', 'file', 'stat', 'du', 'df', 'date', 'whoami', 'git',
])
const WINDOWS_READ = new Set([
  'dir', 'type', 'cd', 'where', 'where.exe', 'findstr', 'hostname', 'whoami', 'echo', 'git',
  'get-childitem', 'gci', 'ls', 'get-content', 'gc', 'cat', 'select-string', 'sls', 'get-location', 'pwd',
  'get-item', 'gi', 'test-path', 'get-date', 'get-command', 'measure-object',
])

/**
 * Plan mode runs only read-only commands. Chaining, redirection and substitution are refused
 * outright so an allowlisted head cannot smuggle a second command.
 */
export function planShellAllowed(command, shell = currentShell()) {
  if (/[;&|><`$(){}[\]\n\r%^]/.test(command)) return false
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  const windows = shell.family !== 'posix'
  const head = windows ? tokens[0].toLowerCase() : tokens[0]
  if (!(windows ? WINDOWS_READ : POSIX_READ).has(head)) return false
  if (head === 'git' && !GIT_READ.has(tokens[1] ?? '')) return false
  if (head === 'find' && tokens.some((t) => /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(t))) return false
  return true
}
