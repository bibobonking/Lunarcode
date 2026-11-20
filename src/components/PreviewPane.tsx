import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react'
import { getPreviewToken } from '../lib/daemon'
import { cn } from '../lib/utils'
import { useWorkspace } from '../store/workspace'
import { Spinner } from './ui'

const DEVICES = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: '100%' },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: '768px' },
  { id: 'phone', label: 'Phone', icon: Smartphone, width: '390px' },
] as const

type DeviceId = (typeof DEVICES)[number]['id']

function pickEntry(pages: string[]): string {
  if (pages.includes('index.html')) return 'index.html'
  return [...pages].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0] ?? ''
}

/** Live, sandboxed preview of an HTML file in the open workspace. Reloads when files change. */
export function PreviewPane() {
  const entries = useWorkspace((state) => state.entries)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [device, setDevice] = useState<DeviceId>('desktop')
  const [nonce, setNonce] = useState(0)

  const pages = useMemo(
    () => entries.filter((entry) => entry.type === 'file' && /\.html?$/i.test(entry.path)).map((entry) => entry.path),
    [entries],
  )
  // Any file change reloads the page, so edits from the agent or the editor show up on their own.
  const version = useMemo(() => {
    const files = entries.filter((entry) => entry.type === 'file')
    return `${files.length}-${files.reduce((latest, entry) => Math.max(latest, entry.mtime), 0)}`
  }, [entries])

  const page = pages.includes(selected) ? selected : pickEntry(pages)

  const fetchToken = useCallback(async () => {
    setError('')
    try {
      setToken((await getPreviewToken()).token)
    } catch (cause) {
      setToken('')
      setError(cause instanceof Error ? cause.message : 'Could not start the preview.')
    }
  }, [])

  useEffect(() => {
    void fetchToken()
  }, [fetchToken])

  const src = token && page ? `/preview/${token}/${encodeURI(page)}?v=${version}.${nonce}` : ''
  const width = DEVICES.find((entry) => entry.id === device)?.width ?? '100%'

  if (pages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <Monitor size={32} className="text-muted" />
        <p className="text-[18px] font-bold text-ink">Nothing to preview yet</p>
        <p className="max-w-[280px] text-[14px] leading-relaxed text-muted">
          Ask OpenSol to build a page or a game. The first HTML file it writes shows up here and reloads as it changes.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-2">
        <select
          value={page}
          onChange={(event) => setSelected(event.target.value)}
          className="adw-select min-w-0 flex-1 truncate font-mono text-[12px]"
          aria-label="Page to preview"
        >
          {pages.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <div className="flex items-center rounded-[9px] bg-ink/[.07] p-0.5">
          {DEVICES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setDevice(entry.id)}
              aria-pressed={device === entry.id}
              title={entry.label}
              aria-label={entry.label}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors',
                device === entry.id ? 'bg-panel text-ink' : 'text-muted hover:text-ink',
              )}
            >
              <entry.icon size={16} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="adw-icon-btn"
          onClick={() => {
            void fetchToken()
            setNonce((value) => value + 1)
          }}
          title="Reload preview"
          aria-label="Reload preview"
        >
          <RefreshCw size={16} />
        </button>
        <button
          type="button"
          className="adw-icon-btn"
          disabled={!src}
          onClick={() => window.open(src, '_blank', 'noopener')}
          title="Open in a new tab"
          aria-label="Open in a new tab"
        >
          <ExternalLink size={16} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto bg-raised p-2">
        {error && (
          <div className="mx-auto mt-6 max-w-[300px] rounded-[12px] border border-danger/30 bg-danger/10 px-4 py-3 text-center">
            <p className="text-[14px] font-semibold text-ink">The preview could not start</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">{error}</p>
            <button
              type="button"
              onClick={() => void fetchToken()}
              className="adw-btn mt-2 h-8"
            >
              Try again
            </button>
          </div>
        )}
        {!error && !src && (
          <p className="flex items-center justify-center gap-2 py-8 text-[14px] text-muted">
            <Spinner size={16} /> Starting preview…
          </p>
        )}
        {src && (
          <iframe
            key={`${page}-${nonce}`}
            title={`Preview of ${page}`}
            src={src}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
            className="mx-auto block h-full min-h-[320px] max-w-full rounded-[9px] border border-line bg-white"
            style={{ width }}
          />
        )}
      </div>

      <p className="shrink-0 border-t border-line px-3 py-1.5 text-[12px] text-muted">
        Runs in a sandbox: it can load your files and public CDNs, but cannot reach OpenSol or your keys.
      </p>
    </div>
  )
}
