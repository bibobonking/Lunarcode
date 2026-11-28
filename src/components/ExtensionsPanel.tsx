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
  Shield,
  ShieldAlert,
  ShieldCheck,
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
  setExtensionTrust,
} from '../lib/daemon'
import { refreshExtensions } from '../extensions'
import { useUiRegistry } from '../extensions/registry'
import type { ExtensionInfo, RiskLevel } from '../extensions/types'
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

const RISK_TONE: Record<RiskLevel, 'warn' | 'bad' | 'ok' | undefined> = { none: 'ok', low: undefined, medium: 'warn', high: 'bad' }

function Findings({ ext, limit = 8 }: { ext: ExtensionInfo; limit?: number }) {
  const shown = ext.risk.findings.slice(0, limit)
  if (shown.length === 0) return <p className="text-muted">Nothing suspicious found in its files.</p>
  return (
    <ul className="space-y-1">
      {shown.map((finding, index) => (
        <li key={index} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Chip tone={RISK_TONE[finding.level]}>{finding.level}</Chip>
          <span className="text-ink">{finding.message}</span>
          <code className="font-mono text-faint">{finding.file}{finding.line ? `:${finding.line}` : ''}</code>
          {finding.snippet && <code className="block w-full truncate font-mono text-[11.5px] text-muted">{finding.snippet}</code>}
        </li>
      ))}
      {ext.risk.findings.length > shown.length && <li className="text-faint">…and {ext.risk.findings.length - shown.length} more</li>}
    </ul>
  )
}

/** The last stop before an extension leaves the sandbox. */
function TrustDialog({ ext, onClose }: { ext: ExtensionInfo | null; onClose: () => void }) {
  const notify = useUi((state) => state.notify)
  const [read, setRead] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setRead(false)
    setTyped('')
    setBusy(false)
  }, [ext?.id])
  if (!ext) return null
  const serious = ext.risk.level === 'high' || ext.anomalies.length > 0
  const gets = [
    ext.summary?.renderer && 'run any code inside the CreateCode window (your chats, settings and tools)',
    ext.summary?.server && 'run Node code in the daemon with full access to your computer',
    (ext.summary?.webPatches ?? 0) + (ext.summary?.serverPatches ?? 0) > 0 && "rewrite CreateCode's own files with patches",
    'reach the network',
  ].filter(Boolean) as string[]
  const ready = read && (!serious || typed.trim() === ext.id)
  const confirm = async () => {
    setBusy(true)
    try {
      await setExtensionTrust(ext.id, 'trusted', ext.id)
      await refreshExtensions()
      notify(`${ext.name} is now Trusted.`, 'success')
      onClose()
      if (useExtensions.getState().reloadNeeded) window.setTimeout(() => window.location.reload(), 700)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not trust the extension.', 'error')
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} labelledBy="trust-title" className="sm:!w-[min(560px,96vw)]">
      <ModalHeader id="trust-title" title={`Trust ${ext.name}?`} description="It will leave the sandbox" onClose={onClose} />
      <div className="max-h-[calc(92dvh-44px)] space-y-3 overflow-y-auto p-4 text-[13px] leading-relaxed">
        <div className="flex items-start gap-2 rounded-[14px] border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>Last warning.</strong> A Trusted extension has full access and nothing can hold it back. CreateCode cannot undo what it does.
          </p>
        </div>
        <div>
          <p className="mb-1 font-semibold text-ink">It will be able to</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            {gets.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div>
          <p className="mb-1 font-semibold text-ink">What the scan found</p>
          <Findings ext={ext} limit={6} />
        </div>
        {ext.anomalies.length > 0 && (
          <div>
            <p className="mb-1 font-semibold text-danger">It already tried to break out in the sandbox</p>
            <ul className="space-y-0.5 text-muted">
              {ext.anomalies.slice(-5).map((item, index) => <li key={index}>{item.message}{item.count > 1 ? ` (×${item.count})` : ''}</li>)}
            </ul>
          </div>
        )}
        <label className="flex items-start gap-2 text-ink">
          <input type="checkbox" className="mt-1" checked={read} onChange={(event) => setRead(event.target.checked)} />
          <span>I read this extension's code, or I trust the person who wrote it.</span>
        </label>
        {serious && (
          <label className="block space-y-1">
            <span className="text-[12px] font-semibold text-ink">Type <code className="font-mono">{ext.id}</code> to confirm</span>
            <input className="adw-entry w-full" value={typed} placeholder={ext.id} onChange={(event) => setTyped(event.target.value)} />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="adw-btn adw-btn-flat" onClick={onClose}>Stay in sandbox</button>
          <button type="button" className="adw-btn adw-btn-destructive" disabled={!ready || busy} onClick={() => void confirm()}>
            {busy ? <Spinner size={13} /> : <ShieldAlert size={13} />} Trust {ext.name}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ExtensionCard({ ext, onTrust }: { ext: ExtensionInfo; onTrust: (ext: ExtensionInfo) => void }) {
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
    if (enabled && ext.trust === 'trusted') {
      const parts = [
        ext.summary?.renderer && 'run code inside the CreateCode window',
        ext.summary?.server && 'run Node code in the CreateCode daemon on your computer',
        (ext.summary?.webPatches ?? 0) + (ext.summary?.serverPatches ?? 0) > 0 && 'edit the app itself with patches',
      ].filter(Boolean)
      const ok = await askConfirm({
        title: `Enable ${ext.name}?`,
        body: `This Trusted extension can ${parts.length ? parts.join(', ') : 'change how CreateCode looks'}. It is not sandboxed: it can read your files, your chats and your provider keys' use, run commands and reach the network.`,
        confirmLabel: 'Enable',
      })
      if (!ok) return
    }
    await run(async () => {
      await setExtensionEnabled(ext.id, enabled)
      await refreshExtensions()
      if (useExtensions.getState().reloadNeeded) {
        notify('Applying the extension: reloading CreateCode…', 'info')
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
  const sandboxed = ext.trust !== 'trusted'
  const blocked = sandboxed && ((ext.summary?.server ? 1 : 0) + (ext.summary?.webPatches ?? 0) + (ext.summary?.serverPatches ?? 0) > 0)

  const backToSandbox = async () => {
    const ok = await askConfirm({ title: `Put ${ext.name} back in the sandbox?`, body: 'Its daemon code and patches stop and its window code loses full access.', confirmLabel: 'Back to sandbox' })
    if (!ok) return
    await run(async () => {
      await setExtensionTrust(ext.id, 'sandbox')
      await refreshExtensions()
      if (useExtensions.getState().reloadNeeded) window.setTimeout(() => window.location.reload(), 500)
    }, 'Could not change the extension.')
  }

  return (
    <div className="adw-boxed overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <span className="tool-icon mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-[16px]" aria-hidden="true">
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
              {sandboxed ? <Chip tone="ok"><Shield size={11} /> Sandbox</Chip> : <Chip tone="warn"><ShieldCheck size={11} /> Trusted</Chip>}
              {(ext.risk.level === 'medium' || ext.risk.level === 'high') && <Chip tone={RISK_TONE[ext.risk.level]}><ShieldAlert size={11} /> {ext.risk.level === 'high' ? 'High risk' : 'Check code'}</Chip>}
              {ext.anomalies.length > 0 && <Chip tone="bad"><AlertTriangle size={11} /> {ext.anomalies.length} blocked</Chip>}
              {ext.summary?.renderer && <Chip><Code2 size={11} /> Window</Chip>}
              {ext.summary?.server && (
                <Chip tone={serverBad ? 'bad' : ext.server?.state === 'running' ? 'ok' : undefined}>
                  <Server size={11} /> Daemon{ext.enabled ? ` · ${ext.server?.state === 'sandboxed' ? 'off in sandbox' : ext.server?.state ?? ''}` : ''}
                </Chip>
              )}
              {ext.patches.length > 0 && (
                <Chip tone={failing.length ? 'warn' : undefined}>
                  <FileCode2 size={11} /> {ext.patches.length} patch{ext.patches.length === 1 ? '' : 'es'}{sandboxed ? ' · off in sandbox' : ''}
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
          <div className="space-y-2 rounded-[14px] border border-line bg-card p-3">
            <p className="flex items-center gap-1.5 font-semibold text-ink">
              {sandboxed ? <Shield size={14} /> : <ShieldCheck size={14} />} {sandboxed ? 'Sandbox mode' : 'Trusted: full access'}
            </p>
            {ext.trustRevoked === 'updated' && <p className="text-warning">This extension was updated, so it went back to the sandbox. Trust it again if you still want to.</p>}
            <p className="text-muted">
              {sandboxed
                ? `Window code runs isolated: no network, no access to your chats, files or keys. ${blocked ? 'Its daemon code and patches do not run until you trust it.' : ''}`
                : 'Its window code, daemon code and patches run with the full power of the app.'}
            </p>
            <Findings ext={ext} />
            {ext.anomalies.length > 0 && (
              <div>
                <p className="mb-1 font-semibold text-danger">Blocked while sandboxed</p>
                <ul className="space-y-0.5 text-muted">
                  {ext.anomalies.slice(-6).map((item, index) => (
                    <li key={index}>{new Date(item.at).toLocaleTimeString()} · {item.message}{item.count > 1 ? ` (×${item.count})` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {sandboxed ? (
                <button type="button" className="adw-btn" disabled={busy || Boolean(ext.error)} onClick={() => onTrust(ext)}>
                  <ShieldCheck size={13} /> Mark as Trusted…
                </button>
              ) : (
                <button type="button" className="adw-btn" disabled={busy} onClick={() => void backToSandbox()}>
                  <Shield size={13} /> Back to sandbox
                </button>
              )}
            </div>
          </div>
          {ext.patches.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-ink">Patches</p>
              <ul className="space-y-1">
                {ext.patches.map((patch, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <Chip tone={patch.error ? 'warn' : patch.applied ? 'ok' : undefined}>{patch.scope}</Chip>
                    <code className="font-mono text-ink">{patch.target}</code>
                    <span className="text-muted">
                      {!ext.enabled || sandboxed ? 'off' : patch.error ? patch.error : patch.applied ? `applied (${patch.matches})` : 'applies when the file loads'}
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
            <div key={item.id} className="rounded-[14px] border border-line bg-card p-3">
              <p className="mb-2 font-semibold text-ink">{item.label}</p>
              <Host render={item.render} />
            </div>
          ))}
          {logs && (
            <div className="max-h-44 overflow-y-auto rounded-[10px] border border-line bg-panel p-2 font-mono text-[12px] leading-relaxed">
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
            <button type="button" className="adw-btn" disabled={busy || Boolean(ext.error)} onClick={() => void run(async () => download(await exportExtension(ext.id), `${ext.id}-${ext.version}.cce`), 'Export failed.')}>
              <Download size={13} /> Export .cce
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
            className={cn('rounded-[14px] border px-3 py-2 text-left', template === item.value ? 'border-accent bg-accent/10' : 'border-line hover:bg-ink/[.05]')}
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
  const [trusting, setTrusting] = useState<string | null>(null)
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
      notify(`${result.updated ? 'Updated' : 'Installed'} ${result.extension.name} in Sandbox mode. Turn it on when you are ready.`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not install that file.', 'error')
    } finally {
      setInstalling(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const extensions = listing?.extensions ?? []
  const trustTarget = extensions.find((item) => item.id === trusting) ?? null

  return (
    <>
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
              {installing ? <Spinner size={13} /> : <Upload size={14} />} Install .cce
            </button>
            <input ref={fileRef} type="file" accept=".cce,application/zip" hidden onChange={(event) => event.target.files?.[0] && void install(event.target.files[0])} />
          </>
        }
      />
      <div className="max-h-[calc(92dvh-44px)] space-y-3 overflow-y-auto p-4">
        <p className="text-[13px] leading-relaxed text-muted">
          An extension is a folder (or an <code className="font-mono text-ink">.cce</code> file). New ones start in <strong className="text-ink">Sandbox</strong>: their window code runs isolated,
          with no network and no access to your chats, files or keys, and their daemon code and patches stay off. Open an extension and choose <strong className="text-ink">Mark as Trusted</strong> to give it full access, after a final warning.
        </p>

        {reloadNeeded && (
          <div className="flex items-center justify-between gap-3 rounded-[14px] border border-accent/40 bg-accent/10 px-3 py-2 text-[13px]">
            <span>Reload CreateCode to apply the latest extension changes.</span>
            <button type="button" className="adw-btn adw-btn-suggested" onClick={() => window.location.reload()}>Reload now</button>
          </div>
        )}
        {listing?.restartRequired && (
          <div className="flex items-center justify-between gap-3 rounded-[14px] border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
            <span>Daemon patches changed. Restart CreateCode to apply them.</span>
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
          <p className="text-[12px] text-warning">Daemon patches need Node 22.15 or newer, or the createcode command / desktop app to start the daemon.</p>
        )}

        {creating && <NewExtension onDone={() => setCreating(false)} />}

        {loading && !listing && (
          <div className="flex items-center justify-center gap-2 py-10 text-muted"><Spinner /> Loading…</div>
        )}
        {listing && extensions.length === 0 && !creating && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="tool-icon h-12 w-12 rounded-[18px]"><Package size={22} /></span>
            <p className="text-[14px] font-semibold text-ink">No extensions yet</p>
            <p className="max-w-[380px] text-[13px] text-muted">Install an <code className="font-mono">.cce</code>, drop a folder into the extensions folder, or start from a template.</p>
          </div>
        )}
        {extensions.map((ext) => (
          <ExtensionCard key={ext.id} ext={ext} onTrust={(item) => setTrusting(item.id)} />
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
    <TrustDialog ext={trustTarget} onClose={() => setTrusting(null)} />
    </>
  )
}
