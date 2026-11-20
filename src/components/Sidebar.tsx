import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Download,
  FileText,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Rocket,
  Plug,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useChats } from '../store/chats'
import { hasCredentials, useSettings } from '../store/settings'
import { useRuntime, useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { stopRun } from '../agent'
import { kernel } from '../core/kernel'
import { getProviderName } from '../data/providers'
import { cn, downloadText, formatRelativeTime } from '../lib/utils'
import { LogoLockup } from './Logo'
import type { ChatSession } from '../types'

function shortTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

interface ChatMenu {
  id: string
  x: number
  y: number
}

export function Sidebar() {
  const sessions = useChats((state) => state.sessions)
  const activeId = useChats((state) => state.activeId)
  const setActive = useChats((state) => state.setActive)
  const newChat = useChats((state) => state.newChat)
  const renameSession = useChats((state) => state.renameSession)
  const deleteSession = useChats((state) => state.deleteSession)
  const settings = useSettings()
  const workspace = useWorkspace((state) => state.info)
  const addWorkspace = useWorkspace((state) => state.addWorkspace)
  const removeWorkspace = useWorkspace((state) => state.removeWorkspace)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const mobileOpen = useUi((state) => state.mobileSidebarOpen)
  const setMobileOpen = useUi((state) => state.setMobileSidebarOpen)
  const openSettings = useUi((state) => state.openSettings)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const setMcpOpen = useUi((state) => state.setMcpOpen)
  const askConfirm = useUi((state) => state.askConfirm)
  const notify = useUi((state) => state.notify)
  const focusComposer = useUi((state) => state.focusComposer)
  const streaming = useRuntime((state) => state.streaming)
  const titling = useRuntime((state) => state.titling)

  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<ChatMenu | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [switching, setSwitching] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((session) => session.title.toLowerCase().includes(needle))
  }, [sessions, query])
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('lunarcode.sidebar.open') || '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('lunarcode.sidebar.open', JSON.stringify(expanded))
    } catch {
      /* storage can be unavailable */
    }
  }, [expanded])
  const workspaces = useMemo(
    () => [...workspace.workspaces].sort((a, b) => b.lastOpened - a.lastOpened),
    [workspace.workspaces],
  )
  const NONE = '__none__'
  const tree = useMemo(() => {
    const byWorkspace = new Map<string, ChatSession[]>()
    for (const session of filtered) {
      const key = session.workspace || NONE
      byWorkspace.set(key, [...(byWorkspace.get(key) ?? []), session])
    }
    for (const list of byWorkspace.values()) list.sort((a, b) => b.updatedAt - a.updatedAt)
    const known = new Set(workspaces.map((entry) => entry.path))
    const rows = workspaces.map((entry) => ({
      key: entry.path,
      name: entry.name,
      path: entry.path as string | null,
      lastOpened: entry.lastOpened,
      sessions: byWorkspace.get(entry.path) ?? [],
    }))
    for (const [key, list] of byWorkspace) {
      if (known.has(key)) continue
      rows.push({
        key,
        name: key === NONE ? 'No workspace' : key.split(/[\\/]/).filter(Boolean).pop() || key,
        path: null,
        lastOpened: list[0]?.updatedAt ?? 0,
        sessions: list,
      })
    }
    return rows
  }, [filtered, workspaces])
  const searching = query.trim().length > 0
  const isOpen = (key: string) => (searching ? true : expanded[key] ?? key === workspace.root)
  const toggleOpen = (key: string) => setExpanded((value) => ({ ...value, [key]: !(value[key] ?? key === workspace.root) }))
  const connected = hasCredentials(settings)
  const profileName =
    (settings.daemon?.home ?? '').split(/[\\/]/).filter(Boolean).pop() || workspace.name || 'Local'

  const startNewChat = () => {
    newChat()
    setMobileOpen(false)
    setMenu(null)
    focusComposer()
  }

  const newChatIn = async (path: string | null) => {
    try {
      if (path && path !== workspace.root) await addWorkspace(path)
      newChat()
      setExpanded((value) => ({ ...value, [path ?? NONE]: true }))
      setMobileOpen(false)
      setMenu(null)
      focusComposer()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open that folder.', 'error')
    }
  }

  const openChat = (id: string) => {
    setActive(id)
    setMobileOpen(false)
    setMenu(null)
  }

  const switchWorkspace = async (path: string) => {
    if (path === workspace.root) {
      setWorkspaceOpen(true)
      setMobileOpen(false)
      return
    }
    setSwitching(path)
    try {
      await addWorkspace(path)
      setMobileOpen(false)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open that folder.', 'error')
    } finally {
      setSwitching('')
    }
  }

  const deleteWorkspace = async (path: string, name: string) => {
    const confirmed = await askConfirm({
      title: 'Remove this workspace?',
      body: `“${name}” is removed from Lunarcode's list. The folder and its files stay on your disk; conversations started there are kept.`,
      confirmLabel: 'Remove workspace',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await removeWorkspace(path)
      notify(`Removed ${name} from your workspaces.`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove that workspace.', 'error')
    }
  }

  const aiRename = async (id: string) => {
    setMenu(null)
    const title = await kernel.titles?.generate(id, { force: true })
    if (!title) notify('The model could not suggest a title right now.', 'error')
  }

  const beginRename = (id: string, title: string) => {
    setEditingId(id)
    setDraftTitle(title)
    setMenu(null)
  }

  const commitRename = () => {
    if (!editingId) return
    if (draftTitle.trim()) renameSession(editingId, draftTitle)
    setEditingId(null)
    setDraftTitle('')
  }

  const removeChat = async (id: string, title: string) => {
    setMenu(null)
    const confirmed = await askConfirm({
      title: 'Delete this conversation?',
      body: `“${title}” and its messages will be removed from this computer. This cannot be undone.`,
      confirmLabel: 'Delete conversation',
      tone: 'danger',
    })
    if (!confirmed) return
    stopRun(id)
    deleteSession(id)
  }

  const exportMarkdown = (id: string) => {
    const session = sessions.find((item) => item.id === id)
    if (!session) return
    setMenu(null)
    const body = session.messages
      .flatMap((message) => {
        if (message.role === 'user') return [`## You\n\n${message.content}`]
        if (message.role === 'assistant' && message.content.trim()) return [`## Lunarcode\n\n${message.content.trim()}`]
        return []
      })
      .join('\n\n')
    downloadText(
      `lunarcode-${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'conversation'}.md`,
      `# ${session.title}\n\n${body}\n`,
      'text/markdown',
    )
    notify('Conversation exported as Markdown.', 'success')
  }

  const exportChat = (id: string) => {
    const session = sessions.find((item) => item.id === id)
    if (!session) return
    setMenu(null)
    downloadText(
      `lunarcode-${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'conversation'}.json`,
      JSON.stringify({ app: 'Lunarcode', exportedAt: new Date().toISOString(), session }, null, 2),
      'application/json',
    )
    notify('Conversation exported.', 'success')
  }

  const closeMobile = () => setMobileOpen(false)

  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-sidebar transition-transform duration-200 ease-out lg:static lg:z-auto lg:h-auto',
        mobileOpen ? 'translate-x-0 shadow-popover' : '-translate-x-full lg:translate-x-0',
        sidebarCollapsed && 'lg:hidden',
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2 lg:hidden">
        <LogoLockup />
        <button type="button" className="adw-icon-btn ml-auto" onClick={closeMobile} aria-label="Close menu">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-1 px-2 pt-2 lg:pt-3">
        <button type="button" onClick={startNewChat} className="adw-btn mb-1 w-full justify-start">
          <Plus size={16} />
          New chat
        </button>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          className="adw-search mb-1"
          aria-label="Search conversations"
        />
      </div>

      <nav aria-label="Tools" className="stagger space-y-0.5 px-2 pt-1">
        <button
          type="button"
          onClick={() => {
            closeMobile()
            openSettings('skills')
          }}
          className="adw-nav-row"
        >
          <Sparkles size={16} className="shrink-0 text-muted" />
          Skills
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Plugins are temporarily disabled for maintenance"
          className="adw-nav-row"
        >
          <Package size={16} className="shrink-0 text-muted" />
          Plugins
          <span className="adw-badge ml-auto text-warning">Maintenance</span>
        </button>
        <button
          type="button"
          onClick={() => {
            closeMobile()
            setMcpOpen(true)
          }}
          className="adw-nav-row"
        >
          <Plug size={16} className="shrink-0 text-muted" />
          MCP
        </button>
        <button
          type="button"
          onClick={() => {
            closeMobile()
            setDeployOpen(true)
          }}
          className="adw-nav-row"
        >
          <Rocket size={16} className="shrink-0 text-muted" />
          Deploy
        </button>
      </nav>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-3">
        <section aria-label="Workspaces">
          <div className="flex items-center justify-between pb-1 pr-0.5">
            <p className="adw-section-label">Workspaces</p>
            <div className="flex items-center gap-0.5">
              <span className="adw-badge">{filtered.length}</span>
              <button
                type="button"
                onClick={() => {
                  closeMobile()
                  setWorkspaceOpen(true)
                }}
                className="adw-icon-btn adw-icon-btn-sm"
                title="Open another folder"
                aria-label="Open another folder"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {tree.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                closeMobile()
                setWorkspaceOpen(true)
              }}
              className="adw-nav-row text-muted"
            >
              <Folder size={16} className="shrink-0" />
              Open a project folder
            </button>
          ) : (
            <ul className="stagger space-y-0.5">
              {tree.map((group) => {
                const open = isOpen(group.key)
                const active = group.path !== null && group.path === workspace.root
                const running = group.sessions.some((session) => streaming[session.id])
                if (searching && group.sessions.length === 0) return null
                return (
                  <li key={group.key}>
                    <div className="group/ws relative">
                      <div className={cn('adw-nav-row gap-1 pl-1 pr-1', active && 'is-active')}>
                        <button
                          type="button"
                          onClick={() => toggleOpen(group.key)}
                          className="adw-icon-btn adw-icon-btn-sm shrink-0"
                          aria-expanded={open}
                          aria-label={`${open ? 'Collapse' : 'Expand'} ${group.name}`}
                        >
                          <ChevronRight size={14} className={cn('ws-chevron', open && 'is-open')} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (group.path) void switchWorkspace(group.path)
                            setExpanded((value) => ({ ...value, [group.key]: true }))
                          }}
                          title={group.path ?? group.name}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <Folder size={15} className={cn('shrink-0', active ? 'text-accent' : 'text-muted')} />
                          <span className={cn('min-w-0 flex-1 truncate', active && 'font-semibold')}>{group.name}</span>
                          {switching === group.path ? (
                            <LoaderCircle size={12} className="shrink-0 animate-spin text-muted" />
                          ) : running ? (
                            <span className="ws-live-dot shrink-0" title="Agent is running" />
                          ) : (
                            <span className="adw-badge shrink-0 group-hover/ws:hidden">{group.sessions.length}</span>
                          )}
                        </button>
                        <span className="hidden shrink-0 items-center group-hover/ws:flex group-focus-within/ws:flex">
                          <button
                            type="button"
                            onClick={() => void newChatIn(group.path)}
                            className="adw-icon-btn adw-icon-btn-sm"
                            title={`New chat in ${group.name}`}
                            aria-label={`New chat in ${group.name}`}
                          >
                            <Plus size={14} />
                          </button>
                          {group.path && (
                            <button
                              type="button"
                              onClick={() => void deleteWorkspace(group.path as string, group.name)}
                              className="adw-icon-btn adw-icon-btn-sm"
                              title="Remove workspace from the list"
                              aria-label={`Remove workspace ${group.name}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className={cn('collapse-grid', open && 'is-open')}>
                      <div className="collapse-inner">
                        <ul className="ws-children my-0.5 space-y-0.5">
                          {group.sessions.length === 0 && (
                            <li className="px-2.5 py-1.5 text-[12px] text-faint">
                              {searching ? 'No match' : 'No chats yet'}
                            </li>
                          )}
                          {group.sessions.map((session) => (
                            <li key={session.id} className="group/item ws-chat-row relative">
                              {editingId === session.id ? (
                                <input
                                  value={draftTitle}
                                  onChange={(event) => setDraftTitle(event.target.value)}
                                  onBlur={commitRename}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') commitRename()
                                    if (event.key === 'Escape') {
                                      setEditingId(null)
                                      setDraftTitle('')
                                    }
                                  }}
                                  autoFocus
                                  className="adw-entry h-8"
                                  aria-label="Rename conversation"
                                />
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openChat(session.id)}
                                    onDoubleClick={() => beginRename(session.id, session.title)}
                                    title={`${session.title} · ${formatRelativeTime(session.updatedAt)}`}
                                    aria-current={activeId === session.id ? 'page' : undefined}
                                    className="adw-nav-row h-[30px] gap-2 pr-8"
                                  >
                                    <span className={cn('min-w-0 flex-1 truncate', titling[session.id] && 'shimmer-text')}>{session.title}</span>
                                    {streaming[session.id] ? (
                                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-link group-hover/item:hidden" title="Agent is running">
                                        <span className="moon-spinner h-3 w-3" aria-hidden="true" />
                                      </span>
                                    ) : (
                                      <span className="shrink-0 text-[11px] tabular-nums text-faint group-hover/item:hidden">
                                        {formatRelativeTime(session.updatedAt)}
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      if (menu?.id === session.id) {
                                        setMenu(null)
                                        return
                                      }
                                      const rect = event.currentTarget.getBoundingClientRect()
                                      const width = 208
                                      const height = 232
                                      const x = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
                                      const y =
                                        rect.bottom + height + 8 > window.innerHeight
                                          ? Math.max(8, rect.top - height - 4)
                                          : rect.bottom + 4
                                      setMenu({ id: session.id, x, y })
                                    }}
                                    className={cn(
                                      'adw-icon-btn adw-icon-btn-sm absolute right-1 top-1/2 -translate-y-1/2',
                                      menu?.id === session.id ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-hover/item:opacity-100',
                                    )}
                                    aria-label={`Actions for ${session.title}`}
                                    aria-expanded={menu?.id === session.id}
                                    title="Conversation actions"
                                  >
                                    <MoreHorizontal size={16} />
                                  </button>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <div className="flex items-center gap-2 rounded-[9px] px-1 py-1">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/[.12] text-[13px] font-bold text-ink"
          >
            {profileName.charAt(0).toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() => {
              closeMobile()
              openSettings('models')
            }}
            className="min-w-0 flex-1 rounded-[6px] text-left"
          >
            <p className="truncate text-[13px] font-semibold leading-tight text-ink">{profileName}</p>
            <p className="truncate text-[12px] leading-tight text-muted">
              {connected
                ? `${getProviderName(settings.provider)}${settings.provider === 'ollama' ? ' · local' : ' · your key'}`
                : 'Add a provider key'}
            </p>
          </button>
          <button
            type="button"
            className="adw-icon-btn"
            onClick={() => {
              closeMobile()
              openSettings('appearance')
            }}
            title="Preferences"
            aria-label="Preferences"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {menu && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close conversation menu"
            className="fixed inset-0 z-[60] cursor-default bg-transparent"
            onClick={() => setMenu(null)}
          />
          <div role="menu" className="adw-popover fixed z-[70] w-[208px]" style={{ left: menu.x, top: menu.y }}>
            {(() => {
              const session = sessions.find((item) => item.id === menu.id)
              if (!session) return null
              return (
                <>
                  <button type="button" role="menuitem" onClick={() => beginRename(session.id, session.title)} className="adw-menu-item">
                    <Pencil size={16} className="text-muted" /> Rename
                  </button>
                  <button type="button" role="menuitem" onClick={() => void aiRename(session.id)} className="adw-menu-item">
                    <Sparkles size={16} className="text-muted" /> Name with AI
                  </button>
                  <button type="button" role="menuitem" onClick={() => exportChat(session.id)} className="adw-menu-item">
                    <Download size={16} className="text-muted" /> Export JSON
                  </button>
                  <button type="button" role="menuitem" onClick={() => exportMarkdown(session.id)} className="adw-menu-item">
                    <FileText size={16} className="text-muted" /> Export Markdown
                  </button>
                  <div className="adw-menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void removeChat(session.id, session.title)}
                    className="adw-menu-item text-danger"
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                  <p className="px-3 pb-1 pt-1.5 text-[12px] text-muted">Updated {shortTime(session.updatedAt)}</p>
                </>
              )
            })()}
          </div>
        </>
      )}
    </aside>
  )
}
