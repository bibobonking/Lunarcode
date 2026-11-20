import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  HardDrive,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { WorkspaceEntry } from '../types'
import { browseFolders } from '../lib/daemon'
import { cn, formatBytes } from '../lib/utils'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { PreviewPane } from './PreviewPane'
import { FileIcon, FolderIcon } from './FileIcon'
import { SessionsTab } from './SessionsTab'
import { useChats } from '../store/chats'
import { Spinner } from './ui'

interface TreeNode {
  entry: WorkspaceEntry
  children: TreeNode[]
}

function buildTree(entries: WorkspaceEntry[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const entry of entries) nodes.set(entry.path, { entry, children: [] })
  const roots: TreeNode[] = []
  const sorted = [...entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  for (const entry of sorted) {
    const node = nodes.get(entry.path)
    if (!node) continue
    const slash = entry.path.lastIndexOf('/')
    const parent = slash === -1 ? null : nodes.get(entry.path.slice(0, slash))
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (items: TreeNode[]) => {
    items.sort((a, b) =>
      a.entry.type === b.entry.type
        ? a.entry.name.localeCompare(b.entry.name)
        : a.entry.type === 'dir'
          ? -1
          : 1,
    )
    items.forEach((item) => sort(item.children))
  }
  sort(roots)
  return roots
}

function extension(path: string) {
  const match = /\.([a-z0-9]+)$/i.exec(path)
  return match ? match[1].toUpperCase() : 'TEXT'
}

function FolderPicker({ onDone }: { onDone?: () => void }) {
  const addWorkspace = useWorkspace((state) => state.addWorkspace)
  const workspaces = useWorkspace((state) => state.info.workspaces)
  const notify = useUi((state) => state.notify)
  const [path, setPath] = useState('')
  const [parent, setParent] = useState('')
  const [home, setHome] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)

  const load = async (target: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await browseFolders(target)
      setPath(result.path)
      setParent(result.parent)
      setHome(result.home)
      setEntries(result.entries)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that folder.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('')
  }, [])

  const open = async (target: string) => {
    setOpening(true)
    try {
      await addWorkspace(target)
      onDone?.()
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not open that folder.', 'error')
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-4">
        <p className="text-[16px] font-bold text-ink">Choose a real folder</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Lunarcode works directly in this folder through the local daemon. Nothing is uploaded.
        </p>
      </div>

      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <button
          type="button"
          className="adw-icon-btn adw-icon-btn-sm"
          onClick={() => void load(parent)}
          disabled={!parent || loading}
          aria-label="Parent folder"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="adw-icon-btn adw-icon-btn-sm"
          onClick={() => void load(home)}
          disabled={!home || loading}
          aria-label="Home folder"
        >
          <HardDrive size={16} />
        </button>
        <p className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" title={path}>
          {path || 'Home'}
        </p>
        {loading && <Spinner size={16} />}
        <button
          type="button"
          onClick={() => void open(path)}
          disabled={!path || opening}
          className="adw-btn adw-btn-suggested h-8"
        >
          {opening ? <Spinner size={16} /> : <Check size={16} />}
          Open
        </button>
      </div>

      {workspaces.length > 0 && (
        <div className="border-b border-line px-3 py-2">
          <p className="adw-section-label mb-1.5">Recent</p>
          <div className="flex flex-wrap gap-1">
            {workspaces.slice(0, 6).map((workspace) => (
              <button
                key={workspace.path}
                type="button"
                onClick={() => void open(workspace.path)}
                className="adw-btn h-7 max-w-full truncate px-2 text-[12px]"
                title={workspace.path}
              >
                {workspace.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && <p className="px-2 py-3 text-[12px] text-danger">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p className="px-2 py-4 text-[12px] text-muted">This folder has no subfolders.</p>
        )}
        {entries.map((entry) => (
          <div key={entry.path} className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load(entry.path)}
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 text-left text-[13px] text-ink transition-colors hover:bg-ink/[.07]"
            >
              <Folder size={16} className="shrink-0 text-accent" />
              <span className="truncate">{entry.name}</span>
            </button>
            <button
              type="button"
              onClick={() => void open(entry.path)}
              className="adw-btn adw-btn-flat hidden h-7 px-2 text-[12px] text-link group-hover:inline-flex"
            >
              Use
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WorkspacePanel() {
  const open = useUi((state) => state.workspaceOpen)
  const setOpen = useUi((state) => state.setWorkspaceOpen)
  const notify = useUi((state) => state.notify)
  const askConfirm = useUi((state) => state.askConfirm)
  const info = useWorkspace((state) => state.info)
  const root = useWorkspace((state) => state.root)
  const entries = useWorkspace((state) => state.entries)
  const loadingTree = useWorkspace((state) => state.loadingTree)
  const treeError = useWorkspace((state) => state.treeError)
  const activeFile = useWorkspace((state) => state.activeFile)
  const file = useWorkspace((state) => state.file)
  const content = useWorkspace((state) => state.content)
  const dirty = useWorkspace((state) => state.dirty)
  const saving = useWorkspace((state) => state.saving)
  const openingFile = useWorkspace((state) => state.openingFile)
  const git = useWorkspace((state) => state.git)
  const gitLoading = useWorkspace((state) => state.gitLoading)
  const setActiveFile = useWorkspace((state) => state.setActiveFile)
  const saveFile = useWorkspace((state) => state.saveFile)
  const setContent = useWorkspace((state) => state.setContent)
  const createEntry = useWorkspace((state) => state.createEntry)
  const renameEntry = useWorkspace((state) => state.renameEntry)
  const deleteEntry = useWorkspace((state) => state.deleteEntry)
  const forgetWorkspace = useWorkspace((state) => state.forgetWorkspace)
  const loadGit = useWorkspace((state) => state.loadGit)
  const refresh = useWorkspace((state) => state.refresh)

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const sessionCount = useChats((state) => state.sessions.length)
  const [tab, setTab] = useState<'files' | 'preview' | 'git' | 'sessions'>('files')
  const [choosing, setChoosing] = useState(!info.available)
  const [editor, setEditor] = useState<{ mode: 'create-file' | 'create-dir' | 'rename'; value: string } | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const editorRef = useRef<HTMLInputElement>(null)

  const tree = useMemo(() => buildTree(entries), [entries])
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase()
    if (!clean) return null
    return entries.filter((entry) => entry.path.toLowerCase().includes(clean)).slice(0, 300)
  }, [entries, query])
  const lineCount = content ? content.split('\n').length : 0

  useEffect(() => {
    if (editor) editorRef.current?.focus()
  }, [editor])

  useEffect(() => {
    setChoosing(!info.available)
  }, [info.available])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      if (!useUi.getState().workspaceOpen || !useWorkspace.getState().activeFile) return
      event.preventDefault()
      void useWorkspace.getState().saveFile()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const gitStatus = useMemo(() => {
    const files = new Map<string, string>()
    const dirs = new Set<string>()
    for (const change of git.entries) {
      files.set(change.path, change.status.trim() || 'M')
      let slash = change.path.lastIndexOf('/')
      while (slash > 0) {
        dirs.add(change.path.slice(0, slash))
        slash = change.path.lastIndexOf('/', slash - 1)
      }
    }
    return { files, dirs }
  }, [git.entries])

  if (!open) return null

  const submitEditor = async () => {
    if (!editor) return
    const value = editor.value.trim().replace(/^\/+/, '')
    if (!value) return setEditor(null)
    try {
      if (editor.mode === 'rename') {
        if (!activeFile) return
        await renameEntry(activeFile, value)
      } else {
        await createEntry(value, editor.mode === 'create-dir' ? 'dir' : 'file')
      }
      setEditor(null)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'That change failed.', 'error')
    }
  }

  const removeEntry = async (path: string) => {
    const confirmed = await askConfirm({
      title: 'Delete this path?',
      body: `${path} will be deleted from disk. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await deleteEntry(path)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not delete that path.', 'error')
    }
  }

  const copyFile = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      notify('Clipboard access was blocked.', 'error')
    }
  }

  const statusTone = (status: string) =>
    status.includes('?') || status.includes('A') ? 'text-success' : status.includes('D') ? 'text-danger' : 'text-warning'

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const path = node.entry.path
    const indent = 8 + depth * 16
    if (node.entry.type === 'dir') {
      const closed = collapsed.has(path)
      const touched = gitStatus.dirs.has(path)
      return (
        <div key={path}>
          <button
            type="button"
            onClick={() =>
              setCollapsed((current) => {
                const next = new Set(current)
                if (next.has(path)) next.delete(path)
                else next.add(path)
                return next
              })
            }
            className="group flex h-8 w-full items-center gap-1.5 rounded-[6px] pr-1.5 text-left text-[13px] text-ink transition-colors hover:bg-ink/[.07]"
            style={{ paddingLeft: indent }}
            title={path}
            aria-expanded={!closed}
          >
            <ChevronRight size={16} className={cn('shrink-0 text-muted transition-transform duration-150', !closed && 'rotate-90')} />
            <FolderIcon name={node.entry.name} open={!closed} size={16} />
            <span className="min-w-0 flex-1 truncate">{node.entry.name}</span>
            {touched && closed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Contains changes" />}
            {closed && node.children.length > 0 && (
              <span className="shrink-0 text-[12px] tabular-nums text-muted group-hover:hidden">{node.children.length}</span>
            )}
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                void removeEntry(path)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void removeEntry(path)
              }}
              className="hidden h-6 w-6 items-center justify-center rounded-[6px] text-muted hover:text-danger group-hover:flex"
              aria-label={`Delete ${path}`}
            >
              <Trash2 size={16} />
            </span>
          </button>
          {!closed && node.children.length > 0 && (
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute bottom-0.5 top-0 w-px bg-line" style={{ left: indent + 5 }} />
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      )
    }
    const active = activeFile === path
    const status = gitStatus.files.get(path)
    return (
      <button
        key={path}
        type="button"
        onClick={() => setActiveFile(path)}
        className={cn(
          'group relative flex h-8 w-full items-center gap-1.5 rounded-[6px] pr-2 text-left text-[13px] transition-colors',
          active ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-ink/[.07]',
        )}
        style={{ paddingLeft: indent + 18 }}
        title={path}
      >
        <FileIcon name={node.entry.name} size={16} />
        <span className={cn('min-w-0 flex-1 truncate', status && statusTone(status))}>{node.entry.name}</span>
        {status && <span className={cn('shrink-0 font-mono text-[12px] font-semibold', statusTone(status))}>{status.slice(0, 1)}</span>}
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close workspace"
        onClick={() => setOpen(false)}
        className="adw-scrim fixed inset-0 z-40 cursor-default xl:hidden"
      />
      <aside className={cn(
          'workspace-panel fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(96vw,400px)] flex-col border-l border-line bg-panel shadow-popover xl:static xl:z-auto xl:h-auto xl:shadow-none',
          tab === 'preview' && info.available && !choosing ? 'sm:w-[min(96vw,620px)] xl:w-[560px]' : 'xl:w-[360px]',
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
          <FolderOpen size={16} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-ink">
              {info.available ? info.name : 'Workspace'}
            </p>
            <p className="truncate text-[12px] text-muted" title={root}>
              {info.available ? root : 'No folder open'}
            </p>
          </div>
          {info.available && (
            <>
              <button
                type="button"
                className="adw-icon-btn adw-icon-btn-sm"
                onClick={() => setChoosing(true)}
                title="Change folder"
                aria-label="Change folder"
              >
                <Folder size={16} />
              </button>
              <button
                type="button"
                className="adw-icon-btn adw-icon-btn-sm"
                onClick={() => void refresh().catch(() => undefined)}
                title="Refresh tree"
                aria-label="Refresh tree"
              >
                {loadingTree ? <Spinner size={16} /> : <RefreshCw size={16} />}
              </button>
            </>
          )}
          <button
            type="button"
            className="adw-icon-btn adw-icon-btn-sm"
            onClick={() => setOpen(false)}
            title="Close workspace"
            aria-label="Close workspace"
          >
            <X size={16} />
          </button>
        </div>

        {choosing || !info.available ? (
          <FolderPicker onDone={() => setChoosing(false)} />
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
              <button
                type="button"
                onClick={() => setTab('files')}
                aria-pressed={tab === 'files'}
                className={cn(
                  'h-8 rounded-[6px] px-2.5 text-[13px] font-semibold',
                  tab === 'files' ? 'bg-ink/[.11] text-ink' : 'text-muted hover:bg-ink/[.07] hover:text-ink',
                )}
              >
                Files
              </button>
              <button
                type="button"
                onClick={() => setTab('preview')}
                aria-pressed={tab === 'preview'}
                className={cn(
                  'h-8 rounded-[6px] px-2.5 text-[13px] font-semibold',
                  tab === 'preview' ? 'bg-ink/[.11] text-ink' : 'text-muted hover:bg-ink/[.07] hover:text-ink',
                )}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setTab('sessions')}
                aria-pressed={tab === 'sessions'}
                className={cn(
                  'h-8 rounded-[6px] px-2.5 text-[13px] font-semibold',
                  tab === 'sessions' ? 'bg-ink/[.11] text-ink' : 'text-muted hover:bg-ink/[.07] hover:text-ink',
                )}
              >
                Sessions <span className="text-muted">· {sessionCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('git')}
                aria-pressed={tab === 'git'}
                className={cn(
                  'h-8 rounded-[6px] px-2.5 text-[13px] font-semibold',
                  tab === 'git' ? 'bg-ink/[.11] text-ink' : 'text-muted hover:bg-ink/[.07] hover:text-ink',
                )}
              >
                Git {git.entries.length > 0 && <span className="text-warning">· {git.entries.length}</span>}
              </button>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  className="adw-icon-btn adw-icon-btn-sm"
                  onClick={() => setEditor({ mode: 'create-file', value: '' })}
                  title="New file"
                  aria-label="New file"
                >
                  <FilePlus2 size={16} />
                </button>
                <button
                  type="button"
                  className="adw-icon-btn adw-icon-btn-sm"
                  onClick={() => setEditor({ mode: 'create-dir', value: '' })}
                  title="New folder"
                  aria-label="New folder"
                >
                  <FolderPlus size={16} />
                </button>
              </div>
            </div>

            {tab === 'files' ? (
              <>
                <div className="shrink-0 border-b border-line px-2.5 py-2">
                  <div className="adw-searchbox">
                    <Search size={16} className="shrink-0 text-muted" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Find a file"
                      aria-label="Find a file"
                    />
                  </div>
                  {editor && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <input
                        ref={editorRef}
                        value={editor.value}
                        onChange={(event) => setEditor({ ...editor, value: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void submitEditor()
                          if (event.key === 'Escape') setEditor(null)
                        }}
                        placeholder={editor.mode === 'rename' ? activeFile ?? 'new/path' : 'folder/file.ts'}
                        className="adw-entry h-8 min-w-0 flex-1 font-mono text-[12px]"
                      />
                      <button
                        type="button"
                        onClick={() => void submitEditor()}
                        className="adw-btn adw-btn-suggested h-8 px-2"
                        aria-label="Create"
                      >
                        <Plus size={16} />
                      </button>
                      <button type="button" onClick={() => setEditor(null)} className="adw-icon-btn adw-icon-btn-sm" aria-label="Cancel">
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="thin-scroll max-h-[32dvh] min-h-[92px] shrink-0 overflow-y-auto px-1.5 py-1.5 xl:max-h-[38%]">
                  {treeError && <p className="px-2 py-2 text-[12px] text-danger">{treeError}</p>}
                  {loadingTree && entries.length === 0 && (
                    <p className="flex items-center gap-1.5 px-2 py-3 text-[12px] text-muted">
                      <Spinner size={16} /> Reading folder…
                    </p>
                  )}
                  {filtered
                    ? filtered.map((entry) => (
                        <button
                          key={entry.path}
                          type="button"
                          onClick={() => entry.type === 'file' && setActiveFile(entry.path)}
                          className={cn(
                            'flex h-8 w-full items-center gap-1.5 rounded-[6px] px-2 text-left font-mono text-[12px]',
                            activeFile === entry.path ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-ink/[.07]',
                          )}
                        >
                          {entry.type === 'dir' ? <FolderIcon name={entry.name} size={16} /> : <FileIcon name={entry.name} size={16} />}
                          <span className="truncate">{entry.path}</span>
                        </button>
                      ))
                    : tree.map((node) => renderNode(node, 0))}
                  {!loadingTree && !treeError && entries.length === 0 && (
                    <p className="px-2 py-4 text-center text-[12px] text-muted">This folder is empty.</p>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col border-t border-line">
                  {activeFile && file ? (
                    <>
                      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[12px] font-semibold text-ink">{activeFile}</p>
                          <p className="mt-0.5 text-[12px] text-muted">
                            {extension(activeFile)} · {lineCount} lines · {formatBytes(file.size)}
                            {dirty ? ' · unsaved' : ' · saved'}
                          </p>
                        </div>
                        {openingFile && <Spinner size={16} />}
                        <button
                          type="button"
                          className="adw-icon-btn adw-icon-btn-sm"
                          onClick={() => setEditor({ mode: 'rename', value: activeFile })}
                          title="Rename"
                          aria-label="Rename"
                        >
                          <Pencil size={16} />
                        </button>
                        <button type="button" className="adw-icon-btn adw-icon-btn-sm" onClick={copyFile} title="Copy" aria-label="Copy">
                          {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                        </button>
                        <button
                          type="button"
                          className="adw-icon-btn adw-icon-btn-sm hover:!text-danger"
                          onClick={() => void removeEntry(activeFile)}
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveFile()}
                          disabled={!dirty || saving}
                          className="adw-btn adw-btn-suggested h-8 px-2.5"
                        >
                          {saving ? <Spinner size={16} /> : <Save size={16} />}
                          Save
                        </button>
                      </div>
                      {file.binary ? (
                        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted">
                          This file is binary and cannot be edited here.
                        </div>
                      ) : (
                        <textarea
                          value={content}
                          onChange={(event) => setContent(event.target.value)}
                          spellCheck={false}
                          wrap="off"
                          aria-label={`Edit ${activeFile}`}
                          className="thin-scroll min-h-0 flex-1 resize-none overflow-auto bg-panel p-3.5 font-mono text-[13px] leading-[1.7] text-ink outline-none"
                        />
                      )}
                      <div className="flex h-7 shrink-0 items-center justify-between border-t border-line px-3 text-[12px] text-muted">
                        <span className="flex items-center gap-1">
                          <span className={cn('h-1.5 w-1.5 rounded-full', dirty ? 'bg-warning' : 'bg-success')} />
                          {dirty ? 'Unsaved changes' : 'Saved to disk'}
                        </span>
                        <span>⌘S to save · UTF-8</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                      <FileText size={32} className="text-muted" />
                      <p className="text-[16px] font-bold text-ink">No file selected</p>
                      <p className="max-w-[260px] text-[13px] leading-relaxed text-muted">
                        Pick a file from the tree. The agent reads and writes these same files.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : tab === 'preview' ? (
              <PreviewPane />
            ) : tab === 'sessions' ? (
              <SessionsTab />
            ) : (
              <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="flex items-center gap-2 border-b border-line px-3 py-3">
                  <GitBranch size={16} className="text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      {git.available ? git.branch || 'detached HEAD' : 'Not a git repository'}
                    </p>
                    <p className="text-[12px] text-muted">
                      {git.available ? `${git.entries.length} changed path${git.entries.length === 1 ? '' : 's'}` : git.error}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="adw-icon-btn adw-icon-btn-sm"
                    onClick={() => void loadGit()}
                    aria-label="Refresh git"
                  >
                    {gitLoading ? <Spinner size={16} /> : <RefreshCw size={16} />}
                  </button>
                </div>
                {git.entries.length === 0 ? (
                  <p className="px-3 py-5 text-[13px] text-muted">The working tree is clean.</p>
                ) : (
                  git.entries.map((entry) => (
                    <button
                      key={`${entry.status}-${entry.path}`}
                      type="button"
                      onClick={() => setActiveFile(entry.path)}
                      className="flex min-h-[36px] w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] hover:bg-ink/[.07]"
                      title={entry.path}
                    >
                      <span className="w-6 shrink-0 font-mono font-semibold text-warning">{entry.status}</span>
                      <FileIcon name={entry.path.split('/').pop() ?? entry.path} size={16} />
                      <span className="truncate text-muted">{entry.path}</span>
                    </button>
                  ))
                )}
                <div className="border-t border-line p-3">
                  <button
                    type="button"
                    onClick={async () => {
                      const confirmed = await askConfirm({
                        title: 'Forget this workspace?',
                        body: 'The folder stays on disk. Lunarcode stops showing it and closes the current file.',
                        confirmLabel: 'Forget workspace',
                      })
                      if (confirmed) await forgetWorkspace()
                    }}
                    className="adw-btn adw-btn-flat h-8 text-[13px] text-danger"
                  >
                    Forget this workspace
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {info.available && !choosing && (
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-t border-line px-3 text-[12px] text-muted">
            {loadingTree ? <Spinner size={12} /> : <LoaderCircle size={12} />}
            Real folder · daemon-scoped access
            <span className="ml-auto">{entries.length} entries</span>
          </div>
        )}
      </aside>
    </>
  )
}
