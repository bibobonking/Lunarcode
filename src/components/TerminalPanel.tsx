import { ChevronUp, Eraser, Square, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTerminal } from '../store/terminal'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { cn } from '../lib/utils'

const MIN_HEIGHT = 140

function shortPath(path: string) {
  const clean = path.replace(/\\/g, '/')
  const parts = clean.split('/').filter(Boolean)
  if (parts.length <= 2) return clean || '/'
  return `…/${parts.slice(-2).join('/')}`
}

/** Bottom dock: run commands in the workspace without leaving CreateCode. */
export function TerminalPanel() {
  const open = useUi((state) => state.terminalOpen)
  const setOpen = useUi((state) => state.setTerminalOpen)
  const root = useWorkspace((state) => state.info.root)
  const { lines, cwd, running, history, exitCode, run, stop, clear, setCwd } = useTerminal()
  const [value, setValue] = useState('')
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem('createcode.terminal.height'))
    return Number.isFinite(saved) && saved >= MIN_HEIGHT ? saved : 260
  })
  const [historyIndex, setHistoryIndex] = useState(-1)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const stick = useRef(true)

  // A different workspace means a different starting directory.
  useEffect(() => {
    if (root) setCwd(root)
  }, [root, setCwd])

  useEffect(() => {
    if (open) window.setTimeout(() => input.current?.focus(), 30)
  }, [open])

  useLayoutEffect(() => {
    const node = scroller.current
    if (node && stick.current) node.scrollTop = node.scrollHeight
  }, [lines, open])

  const startDrag = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = height
      let latest = startHeight
      const onMove = (move: PointerEvent) => {
        latest = Math.max(MIN_HEIGHT, Math.min(window.innerHeight * 0.8, startHeight + (startY - move.clientY)))
        setHeight(latest)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        try {
          localStorage.setItem('createcode.terminal.height', String(Math.round(latest)))
        } catch {
          /* storage can be unavailable */
        }
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [height],
  )

  const submit = () => {
    const command = value
    setValue('')
    setHistoryIndex(-1)
    stick.current = true
    void run(command, root)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    } else if (event.key === 'c' && event.ctrlKey && (running || !window.getSelection()?.toString())) {
      event.preventDefault()
      if (running) stop()
      else setValue('')
    } else if (event.key === 'l' && event.ctrlKey) {
      event.preventDefault()
      clear()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const next = Math.min(history.length - 1, historyIndex + 1)
      if (next >= 0) {
        setHistoryIndex(next)
        setValue(history[next])
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      setValue(next >= 0 ? history[next] : '')
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  if (!open) return null
  const where = cwd || root

  return (
    <section
      aria-label="Terminal"
      style={{ height }}
      className="terminal-dock relative flex shrink-0 flex-col border-t border-line bg-panel"
    >
      <div
        onPointerDown={startDrag}
        className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
      />
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line/70 bg-sidebar-2/60 pl-3 pr-1.5">
        <span className="tool-icon h-6 w-6" aria-hidden="true">
          <SquareTerminal size={13} />
        </span>
        <span className="text-[12px] font-semibold text-ink">Terminal</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-faint" title={where}>
          {where}
        </span>
        {running && (
          <span className="tool-chip" data-tone="running">
            <span className="adw-spinner h-3 w-3" aria-hidden="true" /> Running
          </span>
        )}
        {running && (
          <button type="button" onClick={stop} className="adw-icon-btn adw-icon-btn-sm" title="Stop (Ctrl C)" aria-label="Stop command">
            <Square size={12} fill="currentColor" />
          </button>
        )}
        <button type="button" onClick={clear} className="adw-icon-btn adw-icon-btn-sm" title="Clear (Ctrl L)" aria-label="Clear terminal">
          <Eraser size={14} />
        </button>
        <button
          type="button"
          onClick={() => setHeight((current) => (current > 420 ? 260 : Math.round(window.innerHeight * 0.65)))}
          className="adw-icon-btn adw-icon-btn-sm"
          title="Resize"
          aria-label="Toggle terminal size"
        >
          <ChevronUp size={14} />
        </button>
        <button type="button" onClick={() => setOpen(false)} className="adw-icon-btn adw-icon-btn-sm" title="Close terminal" aria-label="Close terminal">
          <X size={14} />
        </button>
      </header>

      <div
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40
        }}
        onClick={() => {
          if (!window.getSelection()?.toString()) input.current?.focus()
        }}
        className="thin-scroll terminal-screen min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12.5px] leading-[1.55]"
      >
        {lines.length === 0 && (
          <p className="text-faint">Run a command in this workspace. ↑/↓ history · Ctrl C stop · Ctrl L clear</p>
        )}
        {lines.map((line) =>
          line.kind === 'command' ? (
            <div key={line.id} className="flex gap-2 pt-1">
              <span className="shrink-0 text-faint">{shortPath(line.cwd ?? '')}</span>
              <span className="accent-text shrink-0 font-bold">❯</span>
              <span className="min-w-0 break-all font-semibold text-ink">{line.spans[0]?.text}</span>
            </div>
          ) : line.kind === 'info' ? (
            <div key={line.id} className="text-warning">
              {line.spans[0]?.text}
            </div>
          ) : (
            <div key={line.id} className="whitespace-pre-wrap break-words text-ink/90">
              {line.spans.map((span, index) => (
                <span
                  key={index}
                  style={{ color: span.color, backgroundColor: span.bg }}
                  className={cn(span.bold && 'font-bold', span.dim && 'opacity-60', span.italic && 'italic', span.underline && 'underline')}
                >
                  {span.text}
                </span>
              ))}
            </div>
          ),
        )}
        <div className="flex items-center gap-2 pt-1">
          <span className="shrink-0 text-faint">{shortPath(where)}</span>
          <span className={cn('shrink-0 font-bold', exitCode && !running ? 'text-danger' : 'accent-text')}>❯</span>
          <input
            ref={input}
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setHistoryIndex(-1)
            }}
            onKeyDown={onKeyDown}
            disabled={running}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Terminal command"
            placeholder={running ? 'Running…' : ''}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-ink caret-[rgb(var(--accent))] outline-none placeholder:text-faint"
          />
        </div>
      </div>
    </section>
  )
}
