// Backs the built-in terminal panel: runs one command at a time in the user's shell and streams the
// output. Not a PTY (no interactive programs), but colours, `cd`, exit codes and Ctrl+C all work.
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { currentShell, killTree } from './shell.mjs'

const MARKER = '__LC_CWD__'
const MAX_COMMAND = 20_000
const MAX_RUNTIME_MS = 30 * 60_000

/** Appends a tail that reports the final directory, so `cd` carries over to the next command. */
function wrapCommand(command, shell) {
  if (shell.family === 'powershell') return `${command}\n$__lc=$LASTEXITCODE; Write-Output "${MARKER}$($PWD.Path)"; if($__lc -is [int]){exit $__lc}`
  if (shell.family === 'cmd') return `${command} & echo ${MARKER}%cd%`
  return `${command}\n__lc_code=$?; printf '\\n${MARKER}%s\\n' "$PWD"; exit $__lc_code`
}

function validDir(dir) {
  try {
    return Boolean(dir) && existsSync(dir) && statSync(dir).isDirectory()
  } catch {
    return false
  }
}

export function startTerminalCommand({ command, cwd, root }, { signal, onData }) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('A command is required.')
  if (command.length > MAX_COMMAND) throw new Error('That command is too long.')
  const shell = currentShell()
  const requested = typeof cwd === 'string' && cwd ? path.resolve(cwd) : ''
  const workdir = validDir(requested) ? requested : validDir(root) ? root : os.homedir()
  const wrapped = wrapCommand(command, shell)
  const args = shell.args(wrapped)

  return new Promise((resolve) => {
    const child = spawn(shell.file, args, {
      cwd: workdir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
        CLICOLOR_FORCE: '1',
        CREATECODE: '1',
        CREATECODE_WORKSPACE: root || workdir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    let finalCwd = workdir
    let settled = false
    const timer = setTimeout(() => {
      onData('\n[stopped: this command ran for more than 30 minutes]\n')
      killTree(child)
    }, MAX_RUNTIME_MS)
    const abort = () => killTree(child)
    signal?.addEventListener('abort', abort, { once: true })

    const feed = (chunk) => {
      let text = chunk.toString('utf8')
      const at = text.indexOf(MARKER)
      if (at !== -1) {
        const after = text.slice(at + MARKER.length)
        const line = after.split(/\r?\n/)[0].trim()
        if (line) finalCwd = line
        text = text.slice(0, at).replace(/\r?\n$/, '')
      }
      if (text) onData(text)
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', (chunk) => onData(chunk.toString('utf8')))
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      resolve({ code: typeof code === 'number' ? code : -1, cwd: finalCwd, killed: Boolean(signal?.aborted) })
    }
    child.on('error', (error) => {
      onData(`${error.message}\n`)
      finish(127)
    })
    child.on('close', finish)
  })
}
