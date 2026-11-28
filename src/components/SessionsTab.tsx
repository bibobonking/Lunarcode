import { useMemo, useState } from 'react'
import { Check, MessagesSquare, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useChats } from '../store/chats'
import { useRuntime, useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { stopRun } from '../agent'
import { kernel } from '../core/kernel'
import { cn, formatRelativeTime } from '../lib/utils'
import type { ChatSession } from '../types'
import { Spinner } from './ui'

function messageCount(session: ChatSession) {
  return session.messages.filter((message) => message.role === 'user').length
}

function editedFiles(session: ChatSession) {
  const files = new Set<string>()
  for (const message of session.messages) {
    if (message.role !== 'tool' || message.status !== 'done') continue
    if (!['write_file', 'edit_file', 'rewrite_file'].includes(message.call.name)) continue
    const path = message.call.args.path
    if (typeof path === 'string') files.add(path)
  }
  return files.size
}

/** Sessions that belong to the open workspace, with quick rename / AI title / delete. */
export function SessionsTab() {
  const sessions = useChats((state) => state.sessions)
  const activeId = useChats((state) => state.activeId)
  const setActive = useChats((state) => state.setActive)
  const newChat = useChats((state) => state.newChat)
  const renameSession = useChats((state) => state.renameSession)
  const deleteSession = useChats((state) => state.deleteSession)
  const root = useWorkspace((state) => state.info.root)
  const streaming = useRuntime((state) => state.streaming)
  const titling = useRuntime((state) => state.titling)
  const askConfirm = useUi((state) => state.askConfirm)
  const notify = useUi((state) => state.notify)
  const focusComposer = useUi((state) => state.focusComposer)

  const [scope, setScope] = useState<'workspace' | 'all'>('workspace')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const shown = useMemo(() => {
    const list = scope === 'all' ? sessions : sessions.filter((session) => session.workspace === root)
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [sessions, scope, root])
  const untagged = sessions.filter((session) => !session.workspace).length

  const commit = () => {
    if (editingId && draft.trim()) renameSession(editingId, draft)
    setEditingId(null)
  }

  const remove = async (session: ChatSession) => {
    const confirmed = await askConfirm({
      title: 'Delete this session?',
      body: `“${session.title}” and its messages will be removed from this computer. This cannot be undone.`,
      confirmLabel: 'Delete session',
      tone: 'danger',
    })
    if (!confirmed) return
    stopRun(session.id)
    deleteSession(session.id)
  }

  const aiName = async (id: string) => {
    const title = await kernel.titles?.generate(id, { force: true })
    if (!title) notify('The model could not suggest a title right now.', 'error')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="flex rounded-[12px] bg-ink/[.07] p-0.5 text-[12px] font-semibold">
          {(['workspace', 'all'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setScope(item)}
              aria-pressed={scope === item}
              className={cn(
                'h-7 rounded-[8px] px-2.5 transition-colors',
                scope === item ? 'bg-panel text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {item === 'workspace' ? 'This workspace' : `All · ${sessions.length}`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            newChat()
            focusComposer()
          }}
          className="adw-btn ml-auto h-8 px-2.5"
        >
          <Plus size={16} /> New
        </button>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {shown.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MessagesSquare size={32} className="mx-auto text-muted" />
            <p className="mt-2 text-[16px] font-bold text-ink">No sessions here yet</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {scope === 'workspace' && untagged > 0
                ? `${untagged} older session${untagged === 1 ? '' : 's'} were started before workspaces were tracked. Switch to “All” to see them.`
                : 'Start a conversation and it shows up here.'}
            </p>
          </div>
        ) : (
          <div className="adw-boxed">
            {shown.map((session) => {
              const running = Boolean(streaming[session.id])
              const edits = editedFiles(session)
              const isActive = activeId === session.id
              return (
                <div key={session.id} className={cn('group/session adw-row flex-col items-stretch gap-1', isActive && 'bg-accent-soft')}>
                  {editingId === session.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={commit}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commit()
                        if (event.key === 'Escape') setEditingId(null)
                      }}
                      className="adw-entry h-8 w-full"
                      aria-label="Rename session"
                    />
                  ) : (
                    <button type="button" onClick={() => setActive(session.id)} aria-current={isActive ? 'true' : undefined} className="block w-full text-left">
                      <span className="flex items-center gap-2">
                        {isActive && <Check size={16} className="shrink-0 text-accent" />}
                        <span className="adw-row-title min-w-0 flex-1 truncate">{session.title}</span>
                        {titling[session.id] && <Spinner size={12} />}
                        {running && (
                          <span className="adw-badge adw-badge-accent shrink-0 gap-1">
                            <Spinner size={10} /> running
                          </span>
                        )}
                      </span>
                      <span className="adw-row-subtitle mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>{formatRelativeTime(session.updatedAt)}</span>
                        <span>· {messageCount(session)} turn{messageCount(session) === 1 ? '' : 's'}</span>
                        {edits > 0 && <span>· {edits} file{edits === 1 ? '' : 's'} edited</span>}
                        {session.model && <span className="max-w-[120px] truncate font-mono">· {session.model}</span>}
                        {session.titleSource === 'ai' && <span>· AI title</span>}
                      </span>
                    </button>
                  )}
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/session:opacity-100">
                    <button
                      type="button"
                      className="adw-icon-btn adw-icon-btn-sm"
                      onClick={() => {
                        setEditingId(session.id)
                        setDraft(session.title)
                      }}
                      title="Rename"
                      aria-label="Rename session"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="adw-icon-btn adw-icon-btn-sm"
                      onClick={() => void aiName(session.id)}
                      disabled={Boolean(titling[session.id]) || session.messages.length === 0}
                      title="Let the model name this session"
                      aria-label="Name session with AI"
                    >
                      <Sparkles size={16} />
                    </button>
                    <button
                      type="button"
                      className="adw-icon-btn adw-icon-btn-sm hover:!text-danger"
                      onClick={() => void remove(session)}
                      title="Delete"
                      aria-label="Delete session"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
