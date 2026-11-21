import { create } from 'zustand'
import { streamTerminal } from '../lib/daemon'
import { parseAnsi, type AnsiSpan, type AnsiState } from '../lib/ansi'

export interface TerminalLine {
  id: number
  kind: 'command' | 'output' | 'info'
  cwd?: string
  spans: AnsiSpan[]
}

const MAX_LINES = 4000
let nextId = 1
let controller: AbortController | null = null
let ansiState: AnsiState = {}
let partial = ''

interface TerminalState {
  lines: TerminalLine[]
  cwd: string
  running: boolean
  history: string[]
  exitCode: number | null
  setCwd: (cwd: string) => void
  run: (command: string, fallbackCwd: string) => Promise<void>
  stop: () => void
  clear: () => void
}

function appendOutput(lines: TerminalLine[], text: string): TerminalLine[] {
  const next = lines.slice()
  const combined = partial + text.replace(/\r\n/g, '\n')
  const parts = combined.split('\n')
  partial = parts.pop() ?? ''
  for (const part of parts) {
    const parsed = parseAnsi(part, ansiState)
    ansiState = parsed.state
    next.push({ id: nextId++, kind: 'output', spans: parsed.spans.length ? parsed.spans : [{ text: ' ' }] })
  }
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
}

export const useTerminal = create<TerminalState>((set, get) => ({
  lines: [],
  cwd: '',
  running: false,
  history: [],
  exitCode: null,
  setCwd: (cwd) => set({ cwd }),
  clear: () => {
    partial = ''
    ansiState = {}
    set({ lines: [] })
  },
  stop: () => controller?.abort(),
  run: async (command, fallbackCwd) => {
    const trimmed = command.trim()
    if (!trimmed || get().running) return
    const cwd = get().cwd || fallbackCwd
    if (trimmed === 'clear' || trimmed === 'cls') {
      get().clear()
      return
    }
    partial = ''
    ansiState = {}
    controller = new AbortController()
    set((state) => ({
      running: true,
      exitCode: null,
      history: [trimmed, ...state.history.filter((entry) => entry !== trimmed)].slice(0, 100),
      lines: [...state.lines, { id: nextId++, kind: 'command', cwd, spans: [{ text: trimmed }] }],
    }))
    try {
      for await (const event of streamTerminal(trimmed, cwd, controller.signal)) {
        if (event.type === 'out') {
          set((state) => ({ lines: appendOutput(state.lines, event.data) }))
        } else if (event.type === 'error') {
          set((state) => ({ lines: appendOutput(state.lines, `${event.message}\n`) }))
        } else if (event.type === 'exit') {
          set({ cwd: event.cwd, exitCode: event.code })
        }
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      set((state) => ({
        lines: [
          ...appendOutput(state.lines, ''),
          { id: nextId++, kind: 'info', spans: [{ text: aborted ? '^C' : error instanceof Error ? error.message : 'Command failed.' }] },
        ],
        exitCode: aborted ? 130 : 1,
      }))
    } finally {
      if (partial) {
        const tail = partial
        partial = ''
        set((state) => ({ lines: appendOutput(state.lines, `${tail}\n`) }))
      }
      controller = null
      set({ running: false })
    }
  },
}))
