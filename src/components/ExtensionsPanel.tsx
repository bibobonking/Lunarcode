import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Code2,
  Download,
  FileCode2,
  FolderOpen,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react'
import {
  createExtension,
  exportExtension,
  extensionLogs,
  installExtensionArchive,
  reloadExtensionsOnDisk,
  removeExtension,
  restartDaemon,
  setExtensionEnabled,
} from '../lib/daemon'
import { refreshExtensions } from '../extensions'
import { useUiRegistry } from '../extensions/registry'
import type { ExtensionInfo } from '../extensions/types'
import { useExtensions } from '../store/extensions'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'
import { Modal, ModalHeader, Spinner, Switch } from './ui'

const TEMPLATES = [
  { value: 'hello', label: 'Window', hint: 'Command, panel and styles' },
  { value: 'tool', label: 'Window + daemon', hint: 'Agent tool backed by Node code' },
  { value: 'project', label: 'Multi-file project', hint: 'src/, server/ and styles/ folders for larger extensions' },
  { value: 'theme', label: 'Theme', hint: 'A palette, no code' },
  { value: 'patch', label: 'Patch', hint: 'Edit the app with find/replace' },
]

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function Host({ render }: { render: (host: HTMLElement) => void | (() => void) }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    let cleanup: void | (() => void)
    try {
      cleanup = render(ref.current)
    } catch (error) {
      ref.current.textContent = error instanceof Error ? error.message : String(error)
    }
    return () => {
      if (typeof cleanup === 'function') cleanup()
      if (ref.current) ref.current.replaceChildren()
    }
  }, [render])
  return <div ref={ref} />
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'ok' | 'bad' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[11px] font-semibold',
        tone === 'bad' ? 'bg-danger/15 text-danger' : tone === 'warn' ? 'bg-warning/15 text-warning' : tone === 'ok' ? 'bg-success/15 text-success' : 'bg-ink/[.08] text-muted',
      )}
    >
      {children}
    </span>
  )
}

function ExtensionCard({ ext }: { ext: ExtensionInfo }) {
  const notify = useUi((state) => state.notify)
  const askConfirm = useUi((state) => state.askConfirm)
  const runtime = useExtensions((state) => state.runtime[ext.id])
  const registry = useUiRegistry()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<Array<{ at: number; level: string; text: string }> | null>(null)
  const settings = registry.settings.filter((item) => item.owner === ext.id)

  const run = async (task: () => Promise<unknown>, failure: string) => {
    setBusy(true)
    try {
      await task()
    } catch (error) {
      notify(error instanceof Error ? error.message : failure, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (enabled: boolean) => {
    if (enabled) {
      const parts = [
        ext.summary?.renderer && 'run code inside the Lunarcode window',
        ext.summary?.server && 'run Node code in the Lunarcode daemon on your computer',
        (ext.summary?.webPatches ?? 0) + (ext.summary?.serverPatches ?? 0) > 0 && 'edit the app itself with patches',
      ].filter(Boolean)
      const ok = await askConfirm({
        title: `Enable ${ext.name}?`,
        body: `This extension can ${parts.length ? parts.join(', ') : 'change how Lunarcode looks'}. Extensions are not sandboxed: they can read your files, your chats and your provider keys' use, run commands and reach the network. Only enable extensions from people you trust.`,
        confirmLabel: 'Enable',
      })
      if (!ok) return
    }
    await run(async () => {
      await setExtensionEnabled(ext.id, enabled)
      await refreshExtensions()
      if (useExtensions.getState().reloadNeeded) {
        notify('Applying the extension: reloading Lunarcode…', 'info')
        window.setTimeout(() => window.location.reload(), 700)
      }
    }, 'Could not change the extension.')
  }

  const remove = async () => {
    const ok = await askConfirm({
      title: `Remove ${ext.name}?`,
      body: `Its files are deleted. Data it saved in ${ext.dataDir} is kept.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!ok) return
    await run(async () => {
      await removeExtension(ext.id, false)
      await refreshExtensions()
      if (useExtensions.getState().reloadNeeded) window.setTimeout(() => window.location.reload(), 500)
    }, 'Could not remove the extension.')
  }

  const failing = ext.patches.filter((patch) => patch.error)
  const serverBad = ext.server?.state === 'error'
  const windowBad = runtime?.state === 'error'

  return (
    <div className="adw-boxed overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <span className="tool-icon mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-[11px]" aria-hidden="true">
          {ext.hasIcon ? <img src={`/api/extensions/${ext.id}/icon`} alt="" className="h-full w-full object-cover" /> : <Package size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h4 className="truncate text-[14px] font-bold text-ink">{ext.name}</h4>
            <span className="text-[12px] text-muted">{ext.version}</span>
            {ext.author && <span className="text-[12px] text-faint">by {ext.author}</span>}
          </div>
          {ext.description && <p className="mt-0.5 text-[13px] leading-snug text-muted">{ext.description}</p>}
          {ext.error ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {ext.error}
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {ext.summary?.renderer && <Chip><Code2 size={11} /> Window</Chip>}
              {ext.summary?.server && (
                <Chip tone={serverBad ? 'bad' : ext.server?.state === 'running' ? 'ok' : undefined}>
                  <Server size={11} /> Daemon{ext.enabled ? ` · ${ext.server?.state ?? ''}` : ''}
                </Chip>
              )}
              {ext.patches.length > 0 && (
                <Chip tone={failing.length ? 'warn' : undefined}>
                  <FileCode2 size={11} /> {ext.patches.length} patch{ext.patches.length === 1 ? '' : 'es'}
                </Chip>
              )}
              {ext.themes.length > 0 && <Chip><Palette size={11} /> {ext.themes.length} theme{ext.themes.length === 1 ? '' : 's'}</Chip>}
              {windowBad && <Chip tone="bad">Window part failed</Chip>}
              {ext.source === 'folder' && <Chip>Folder</Chip>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {busy && <Spinner size={14} />}
          <Switch checked={ext.enabled} disabled={busy || Boolean(ext.error)} label={`${ext.enabled ? 'Disable' : 'Enable'} ${ext.name}`} onChange={(next) => void toggle(next)} />
          <button type="button" className="adw-icon-btn" aria-expanded={open} aria-label="Details" onClick={() => setOpen(!open)}>
            <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </div>

      {(windowBad || serverBad) && (
        <div className="border-t border-line bg-danger/10 px-3 py-2 font-mono text-[12px] leading-relaxed text-danger">
          {windowBad && <p>Window: {runtime?.error}</p>}
          {serverBad && <p className="whitespace-pre-wrap break-words">Daemon: {ext.server?.error?.split('\n').slice(0, 4).join('\n')}</p>}
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-line bg-raised/40 p-3 text-[12.5px]">
          {ext.patches.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-ink">Patches</p>
              <ul className="space-y-1">
                {ext.patches.map((patch, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <Chip tone={patch.error ? 'warn' : patch.applied ? 'ok' : undefined}>{patch.scope}</Chip>
                    <code className="font-mono text-ink">{patch.target}</code>
                    <span className="text-muted">
                      {!ext.enabled ? 'off' : patch.error ? patch.error : patch.applied ? `applied (${patch.matches})` : 'applies when the file loads'}
                    </span>
                    {patch.note && <span className="text-faint">— {patch.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ext.server && ext.server.rpcs.length > 0 && (
            <p className="text-muted">
              Daemon rpc: {ext.server.rpcs.map((name) => <code key={name} className="mr-1.5 font-mono text-ink">{name}</code>)}
            </p>
          )}
          <p className="break-all text-muted">
            <FolderOpen size={12} className="mr-1 inline" />
            <code className="font-mono">{ext.dir}</code>
          </p>
          {settings.map((item) => (
            <div key={item.id} className="rounded-[10px] border border-line bg-card p-3">
              <p className="mb-2 font-semibold text-ink">{item.label}</p>
              <Host render={item.render} />
            </div>
          ))}
          {logs && (
            <div className="max-h-44 overflow-y-auto rounded-[8px] border border-line bg-panel p-2 font-mono text-[12px] leading-relaxed">
              {logs.length === 0 && <p className="text-faint">No log lines from the daemon part.</p>}
              {logs.map((line, index) => (
                <p key={index} className={cn(line.level === 'error' ? 'text-danger' : line.level === 'warn' ? 'text-warning' : 'text-muted')}>
                  {new Date(line.at).toLocaleTimeString()} {line.text}
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="adw-btn" disabled={busy} onClick={() => void run(async () => { await reloadExtensionsOnDisk(ext.id); await refreshExtensions() }, 'Reload failed.')}>
              <RefreshCw size={13} /> Reload
            </button>
            {ext.server && (
              <button type="button" className="adw-btn" onClick={() => void run(async () => setLogs((await extensionLogs(ext.id)).logs), 'Could not read logs.')}>
                <Terminal size={13} /> Daemon log
              </button>
            )}
            <button type="button" className="adw-btn" disabled={busy || Boolean(ext.error)} onClick={() => void run(async () => download(await exportExtension(ext.id), `${ext.id}-${ext.version}.lce`), 'Export failed.')}>
              <Download size={13} /> Export .lce
            </button>
            <button type="button" className="adw-btn text-danger" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={13} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function NewExtension({ onDone }: { onDone: () => void }) {
  const notify = useUi((state) => state.notify)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('hello')
  const [busy, setBusy] = useState(false)
  const valid = /^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)
  const create = async () => {
    setBusy(true)
    try {
      const result = await createExtension({ id, name: name.trim() || id, template })
      await refreshExtensions()
      notify(`Created in ${result.extension.dir}. Edit the files and save: it reloads live.`, 'success')
      onDone()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create the extension.', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="adw-boxed space-y-3 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[12px] font-semibold text-ink">Id (folder name)</span>
          <input className="adw-entry w-full" value={id} placeholder="my-extension" onChange={(event) => setId(event.target.value.toLowerCase())} data-autofocus />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] font-semibold text-ink">Name</span>
          <input className="adw-entry w-full" value={name} placeholder="My Extension" onChange={(event) => setName(event.target.value)} />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {TEMPLATES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTemplate(item.value)}
            className={cn('rounded-[10px] border px-3 py-2 text-left', template === item.value ? 'border-accent bg-accent/10' : 'border-line hover:bg-ink/[.05]')}
          >
            <span className="block text-[13px] font-semibold text-ink">{item.label}</span>
            <span className="block text-[12px] text-muted">{item.hint}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="adw-btn adw-btn-flat" onClick={onDone}>Cancel</button>
        <button type="button" className="adw-btn adw-btn-suggested" disabled={!valid || busy} onClick={() => void create()}>
          {busy ? <Spinner size={13} /> : <Wand2 size={13} />} Create
        </button>
      </div>
    </div>
  )
}

export function ExtensionsPanel() {
  const open = useUi((state) => state.extensionsOpen)
  const setOpen = useUi((state) => state.setExtensionsOpen)
  const notify = useUi((state) => state.notify)
  const listing = useExtensions((state) => state.listing)
  const loading = useExtensions((state) => state.loading)
  const reloadNeeded = useExtensions((state) => state.reloadNeeded)
  const [creating, setCreating] = useState(false)
  const [installing, setInstalling] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) void refreshExtensions()
  }, [open])

  const install = async (file: File) => {
    setInstalling(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await installExtensionArchive(bytes, false)
      await refreshExtensions()
      notify(`${result.updated ? 'Updated' : 'Installed'} ${result.extension.name}. Turn it on when you are ready.`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not install that file.', 'error')
    } finally {
      setInstalling(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const extensions = listing?.extensions ?? []

  return (
    <Modal open={open} onClose={() => setOpen(false)} labelledBy="extensions-title" className="sm:!w-[min(860px,96vw)]">
      <ModalHeader
        id="extensions-title"
        title="Extensions"
        description={`${extensions.filter((item) => item.enabled).length} on · ${extensions.length} installed`}
        onClose={() => setOpen(false)}
        actions={
          <>
            <button type="button" className="adw-btn adw-btn-flat" onClick={() => setCreating(!creating)}>
              <Plus size={14} /> New
            </button>
            <button type="button" className="adw-btn adw-btn-suggested" disabled={installing} onClick={() => fileRef.current?.click()}>
              {installing ? <Spinner size={13} /> : <Upload size={14} />} Install .lce
            </button>
            <input ref={fileRef} type="file" accept=".lce,application/zip" hidden onChange={(event) => event.target.files?.[0] && void install(event.target.files[0])} />
          </>
        }
      />
      <div className="max-h-[calc(92dvh-44px)] space-y-3 overflow-y-auto p-4">
        <p className="text-[13px] leading-relaxed text-muted">
          An extension is a folder (or an <code className="font-mono text-ink">.lce</code> file) that Lunarcode runs with full access: code in this window, Node code in the daemon and
          direct patches to the app, with no API to hold it back. Enable only what you trust.
        </p>

        {reloadNeeded && (
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-accent/40 bg-accent/10 px-3 py-2 text-[13px]">
            <span>Reload Lunarcode to apply the latest extension changes.</span>
            <button type="button" className="adw-btn adw-btn-suggested" onClick={() => window.location.reload()}>Reload now</button>
          </div>
        )}
        {listing?.restartRequired && (
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
            <span>Daemon patches changed. Restart Lunarcode to apply them.</span>
            <button
              type="button"
              className="adw-btn"
              onClick={() => {
                void restartDaemon().catch(() => undefined)
                notify('Restarting…', 'info')
                window.setTimeout(() => window.location.reload(), 3500)
              }}
            >
              Restart
            </button>
          </div>
        )}
        {listing && !listing.serverPatchesSupported && extensions.some((item) => item.summary?.serverPatches) && (
          <p className="text-[12px] text-warning">Daemon patches need Node 22.15 or newer, or the lunarcode command / desktop app to start the daemon.</p>
        )}

        {creating && <NewExtension onDone={() => setCreating(false)} />}

        {loading && !listing && (
          <div className="flex items-center justify-center gap-2 py-10 text-muted"><Spinner /> Loading…</div>
        )}
        {listing && extensions.length === 0 && !creating && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="tool-icon h-12 w-12 rounded-[14px]"><Package size={22} /></span>
            <p className="text-[14px] font-semibold text-ink">No extensions yet</p>
            <p className="max-w-[380px] text-[13px] text-muted">Install an <code className="font-mono">.lce</code>, drop a folder into the extensions folder, or start from a template.</p>
          </div>
        )}
        {extensions.map((ext) => (
          <ExtensionCard key={ext.id} ext={ext} />
        ))}

        {listing && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1 text-[12px] text-faint">
            <span className="break-all"><FolderOpen size={12} className="mr-1 inline" />{listing.dir}</span>
            <button type="button" className="adw-btn adw-btn-flat" onClick={() => void reloadExtensionsOnDisk().then(refreshExtensions)}>
              <RefreshCw size={13} /> Rescan folder
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
