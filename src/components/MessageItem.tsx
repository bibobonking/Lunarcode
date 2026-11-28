import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  AlertCircle,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  RefreshCw,
  Settings2,
  Square,
} from 'lucide-react'
import type { AssistantMessage, ToolMessage, UserMessage } from '../types'
import type { ConversationTurn } from '../lib/conversation'
import { useUi } from '../store/ui'
import { useSettings } from '../store/settings'
import { regenerateLastTurn, runAgent } from '../agent'
import { restoreCheckpoint } from '../lib/daemon'
import { useWorkspace } from '../store/workspace'
import { createId, useChats } from '../store/chats'
import { toolLabel } from '../lib/tool-meta'
import { formatBytes, cn } from '../lib/utils'
import { Markdown } from './Markdown'
import { ToolCallCard, diffForTool } from './ToolCallCard'
import { DiffBadge } from './DiffView'
import { AgentActivity } from './AgentActivity'
import { Spinner } from './ui'

function formatTokens(value?: number) {
  if (!value) return ''
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function UserBubble({
  message,
  sessionId,
  canEdit,
}: {
  message: UserMessage
  sessionId: string
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)

  const resend = () => {
    const text = draft.trim()
    if (!text) return
    const session = useChats.getState().sessions.find((item) => item.id === sessionId)
    const index = session?.messages.findIndex((item) => item.id === message.id) ?? -1
    if (!session || index < 0) return
    const id = createId('msg')
    // Everything after the edited message belonged to the old answer, so it is dropped.
    useChats.getState().updateSession(sessionId, { messages: session.messages.slice(0, index) })
    useChats.getState().addMessage(sessionId, { ...message, id, content: text, createdAt: Date.now() })
    setEditing(false)
    runAgent(sessionId, id)
  }

  const images = (message.attachments ?? []).filter((attachment) => attachment.kind === 'image')
  const files = (message.attachments ?? []).filter((attachment) => attachment.kind === 'text')
  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[88%] rounded-[18px] border border-accent bg-panel p-2 sm:max-w-[82%]">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                resend()
              }
              if (event.key === 'Escape') setEditing(false)
            }}
            autoFocus
            rows={Math.min(10, Math.max(2, draft.split('\n').length))}
            className="chat-text block w-full resize-none bg-transparent px-2 py-1 leading-[1.55] text-ink outline-none"
            aria-label="Edit message"
          />
          <div className="mt-1 flex items-center justify-between gap-2 px-1">
            <p className="text-[12px] text-muted">Sending replaces the reply below.</p>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setEditing(false)} className="adw-btn adw-btn-flat h-8">
                Cancel
              </button>
              <button type="button" onClick={resend} disabled={!draft.trim()} className="adw-btn adw-btn-suggested h-8">
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/user flex items-start justify-end gap-1">
      {canEdit && message.content && (
        <button
          type="button"
          onClick={() => {
            setDraft(message.content)
            setEditing(true)
          }}
          className="adw-icon-btn adw-icon-btn-sm mt-2 opacity-0 focus-visible:opacity-100 group-hover/user:opacity-100"
          title="Edit and resend"
          aria-label="Edit and resend message"
        >
          <Pencil size={14} />
        </button>
      )}
      <div className="max-w-[88%] sm:max-w-[82%]">
        {images.length > 0 && (
          <div className={cn('mb-2 grid gap-2', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
            {images.map((image) => (
              <img key={image.id} src={image.dataUrl} alt={image.name} className="max-h-52 w-full rounded-[18px] border border-line object-cover" />
            ))}
          </div>
        )}
        <div className="user-bubble rounded-[18px] bg-accent-soft px-4 py-2.5">
          {files.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-panel px-2 py-1 text-[12px] text-muted"
                >
                  <FileText size={14} />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  <span>{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {message.content && <p className="chat-text whitespace-pre-wrap break-words leading-[1.55] text-ink">{message.content}</p>}
        </div>
      </div>
    </div>
  )
}

const FILE_EDIT_TOOLS = new Set(['write_file', 'rewrite_file', 'edit_file'])

function changedFiles(tools: ToolMessage[]): string[] {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (tool.status !== 'done' || !FILE_EDIT_TOOLS.has(tool.call.name)) continue
    const path = tool.call.args.path
    if (typeof path === 'string' && path) seen.add(path)
  }
  return [...seen]
}

/** Lets the person roll back every file the agent wrote or edited during one turn. */
function UndoBar({
  turnId,
  files,
  diff,
}: {
  turnId: string
  files: string[]
  diff: { added: number; removed: number } | null
}) {
  const askConfirm = useUi((state) => state.askConfirm)
  const notify = useUi((state) => state.notify)
  const [state, setState] = useState<'idle' | 'working' | 'undone'>('idle')
  const shown = files.slice(0, 2).join(', ')
  const rest = files.length - 2

  const undo = async () => {
    const confirmed = await askConfirm({
      title: 'Undo these file changes?',
      body: `${files.length === 1 ? 'This file goes' : `These ${files.length} files go`} back to how ${files.length === 1 ? 'it was' : 'they were'} before this answer. Changes made through shell commands are not affected.`,
      confirmLabel: 'Undo changes',
    })
    if (!confirmed) return
    setState('working')
    try {
      const result = await restoreCheckpoint(turnId)
      const parts = [
        result.restored.length ? `restored ${result.restored.length}` : '',
        result.removed.length ? `removed ${result.removed.length}` : '',
        result.skipped.length ? `${result.skipped.length} too large to restore` : '',
      ].filter(Boolean)
      notify(`Undone: ${parts.join(', ') || 'nothing to change'}.`, 'success')
      setState('undone')
      await useWorkspace.getState().refresh().catch(() => undefined)
    } catch (error) {
      setState('idle')
      notify(error instanceof Error ? error.message : 'Could not undo those changes.', 'error')
    }
  }

  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <span className="min-w-0 truncate">
        {state === 'undone' ? 'Changes undone' : `Changed ${shown}${rest > 0 ? ` and ${rest} more` : ''}`}
      </span>
      {state !== 'undone' && diff && <DiffBadge added={diff.added} removed={diff.removed} className="shrink-0" />}
      {state !== 'undone' && (
        <button
          type="button"
          onClick={() => void undo()}
          disabled={state === 'working'}
          className="adw-btn adw-btn-flat h-7 shrink-0 px-2 text-[12px] text-link"
        >
          {state === 'working' ? 'Undoing…' : 'Undo'}
        </button>
      )}
    </div>
  )
}

function ThoughtToggle({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-full items-center gap-1.5 rounded-[8px] py-0.5 text-left text-[13px] text-muted hover:text-ink"
        aria-expanded={open}
      >
        <ChevronRight size={16} className={cn('shrink-0 transition-transform duration-150', open && 'rotate-90')} />
        <span className="shrink-0 font-semibold">Thought</span>
        {!open && <span className="min-w-0 truncate text-[12px]">{text.replace(/\s+/g, ' ').trim().slice(0, 100)}</span>}
      </button>
      {open && <div className="adw-recessed thin-scroll mt-1 max-h-40 whitespace-pre-wrap text-[12px] text-muted">{text}</div>}
    </div>
  )
}

function totalDiff(tools: ToolMessage[]) {
  let added = 0
  let removed = 0
  let any = false
  for (const tool of tools) {
    if (!FILE_EDIT_TOOLS.has(tool.call.name)) continue
    const diff = diffForTool(tool)
    if (!diff) continue
    any = true
    added += diff.added
    removed += diff.removed
  }
  return any ? { added, removed } : null
}

export function TaskCompletedBox({
  tools,
  intermediateMessages = [],
  streaming = false,
}: {
  tools: ToolMessage[]
  intermediateMessages?: AssistantMessage[]
  streaming?: boolean
}) {
  const [open, setOpen] = useState(false)
  const autoOpened = useRef(false)
  const autoCollapse = useSettings((state) => state.autoCollapseWork)
  const detailed = useSettings((state) => state.workDetail === 'detailed')

  const awaiting = tools.some((tool) => tool.status === 'awaiting')
  const active = streaming || tools.some((tool) => tool.status === 'running')

  // Auto-open when awaiting approval or actively running
  useEffect(() => {
    if (awaiting) {
      setOpen(true)
    } else if (active) {
      autoOpened.current = true
      setOpen(true)
    } else if (autoOpened.current && autoCollapse) {
      autoOpened.current = false
      setOpen(false)
    }
  }, [active, awaiting, autoCollapse])

  if (tools.length === 0 && intermediateMessages.length === 0) return null

  const labels = [...new Set(tools.map((tool) => toolLabel(tool.call.name)))]
  const failed = tools.filter((tool) => tool.status === 'error' || tool.status === 'denied').length
  const summary = labels.length <= 3 ? labels.join(' · ') : `${labels.slice(0, 3).join(' · ')} +${labels.length - 3}`

  const taskItems = [
    ...tools.map((t) => ({ kind: 'tool' as const, tool: t, time: t.createdAt })),
    ...intermediateMessages.map((m) => ({ kind: 'assistant' as const, message: m, time: m.createdAt })),
  ].sort((a, b) => a.time - b.time)

  const total = totalDiff(tools)
  const StatusIcon = awaiting ? (
    <CircleAlert size={16} className="shrink-0 text-warning" />
  ) : active ? (
    <span className="adw-spinner h-4 w-4 shrink-0" aria-hidden="true" />
  ) : failed > 0 ? (
    <CircleAlert size={16} className="shrink-0 text-danger" />
  ) : (
    <Check size={16} className="tool-check shrink-0 text-success" />
  )

  return (
    <div className={cn('adw-boxed', active ? 'is-running' : awaiting ? undefined : 'is-settled')}>
      <button
        type="button"
        onClick={() => {
          autoOpened.current = false
          setOpen((value) => !value)
        }}
        className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-ink/[.05]"
        aria-expanded={open}
      >
        {StatusIcon}
        <span className={cn('shrink-0 text-[13px] font-semibold', awaiting && 'text-warning')}>
          {awaiting ? 'Action required' : active ? 'Running task…' : 'Task completed'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
          {tools.length > 0 && `Used ${tools.length} tool${tools.length === 1 ? '' : 's'}`}
          {summary ? ` (${summary})` : ''}
        </span>
        {failed > 0 && <span className="shrink-0 text-[12px] text-danger">{failed} failed</span>}
        {total && (
          <span className="flex shrink-0 items-center gap-1">
            <span className="diff-pill diff-pill-add">+{total.added}</span>
            <span className="diff-pill diff-pill-del">−{total.removed}</span>
          </span>
        )}
        <ChevronRight size={16} className={cn('ws-chevron shrink-0 text-muted', open && 'is-open')} />
      </button>

      <div className={cn('collapse-grid', open && 'is-open')}>
        <div className="collapse-inner">
        <div className="space-y-2 border-t border-line/70 px-3 py-2.5">
          {taskItems.map((item) =>
            item.kind === 'tool' ? (
              <ToolCallCard key={item.tool.id} message={item.tool} compact={!detailed} />
            ) : (
              <div key={item.message.id} className="py-1">
                {item.message.reasoning.trim() && <ThoughtToggle text={item.message.reasoning} />}
                {item.message.content.trim() && (
                  <div className="mt-1 text-[13px] leading-relaxed text-muted">
                    <Markdown content={item.message.content} />
                  </div>
                )}
              </div>
            ),
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

export function UsedGroup({ tools, streaming = false }: { tools: ToolMessage[]; streaming?: boolean }) {
  return <TaskCompletedBox tools={tools} streaming={streaming} />
}

const COMPACTION_PREFIX = /^\[Summary of the earlier conversation[^\n]*\]\n\n/

/** The summary that replaced older messages: a quiet divider that opens to the full text. */
function CompactionNote({ message }: { message: AssistantMessage }) {
  const [open, setOpen] = useState(false)
  const meta = message.compaction
  if (!meta) return null
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 text-[12px] text-muted hover:text-ink"
        aria-expanded={open}
      >
        <span className="h-px flex-1 bg-line" />
        <span className="shrink-0">
          Context compacted · {meta.turns} turn{meta.turns === 1 ? '' : 's'}, {meta.toolCalls} tool call{meta.toolCalls === 1 ? '' : 's'} summarised
          {meta.fallback ? ' · without the model' : ''}
        </span>
        <span className="h-px flex-1 bg-line" />
      </button>
      {open && (
        <div className="adw-boxed mt-2 bg-raised px-4 py-3">
          <Markdown content={message.content.replace(COMPACTION_PREFIX, '')} />
        </div>
      )}
    </div>
  )
}

export function AssistantBlock({
  message,
  sessionId,
  streaming,
  isLastAssistant,
  showHeader,
  turnUsage,
}: {
  message: AssistantMessage
  sessionId: string
  streaming: boolean
  isLastAssistant: boolean
  /** Summed token usage of every round in the turn (shown on the final answer). */
  turnUsage?: { input: number; output: number }
  /** Only the first answer of a turn repeats the assistant header. */
  showHeader: boolean
}) {
  const notify = useUi((state) => state.notify)
  const openSettings = useUi((state) => state.openSettings)
  const showTokenEstimate = useSettings((state) => state.showTokenEstimate)
  const [copied, setCopied] = useState(false)
  // Thoughts stay closed until the person opens them, even while the model is still thinking.
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const hasBody = Boolean(message.content.trim() || message.reasoning.trim() || message.error)
  if (message.compaction) return <CompactionNote message={message} />
  const needsConfig = Boolean(message.error && /api key|base url|settings|credential|403|401/i.test(message.error))
  const tokenBits: string[] = []
  const usedInput = turnUsage?.input || message.usage?.input
  const usedOutput = turnUsage?.output || message.usage?.output
  if (usedInput) tokenBits.push(`${formatTokens(usedInput)} in`)
  if (usedOutput) tokenBits.push(`${formatTokens(usedOutput)} out`)
  else if (showTokenEstimate && message.content.trim()) {
    tokenBits.push(`~${formatTokens(Math.ceil(message.content.length / 4))} out`)
  }
  const metaLine = [
    ...tokenBits,
    message.durationMs ? `${(message.durationMs / 1000).toFixed(1)}s` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  const header = (
    <div className="flex min-h-[28px] items-center gap-2">
      <span className="assistant-name text-[13px] font-bold">CreateCode</span>
      {message.stopped && (
        <span className="adw-badge gap-1">
          <Square size={8} fill="currentColor" />
          Stopped
        </span>
      )}
    </div>
  )

  if (!hasBody && !streaming) {
    return (
      <div>
        {showHeader && header}
        <p className="mt-1 text-[13px] text-muted">The model returned an empty response.</p>
        {isLastAssistant && (
          <button type="button" onClick={() => regenerateLastTurn(sessionId)} className="adw-btn adw-btn-flat mt-1 h-8 px-2 text-link">
            <RefreshCw size={16} /> Try again
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      {(showHeader || message.stopped) && (showHeader ? header : <span className="adw-badge gap-1"><Square size={8} fill="currentColor" />Stopped</span>)}

      {message.reasoning.trim() && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setReasoningOpen((value) => !value)}
            className="flex max-w-full items-center gap-1.5 rounded-[8px] py-0.5 text-left text-[13px] text-muted hover:text-ink"
            aria-expanded={reasoningOpen}
          >
            <ChevronRight size={16} className={cn('shrink-0 transition-transform duration-150', reasoningOpen && 'rotate-90')} />
            <span className="flex shrink-0 items-center gap-1.5 font-semibold">
              {streaming && <Spinner size={12} />}
              {streaming ? 'Thinking…' : 'Thought'}
            </span>
            {!reasoningOpen && (
              <span className="min-w-0 truncate text-[12px]">{message.reasoning.replace(/\s+/g, ' ').trim().slice(0, 120)}</span>
            )}
          </button>
          {reasoningOpen && (
            <div className="adw-recessed thin-scroll mt-1 max-h-72 whitespace-pre-wrap break-words text-[12px] text-muted">{message.reasoning}</div>
          )}
        </div>
      )}

      {message.content && (
        <div className="mt-1">
          <Markdown content={message.content} streaming={streaming} />
        </div>
      )}

      {message.error && (
        <div className="mt-3 rounded-[18px] border border-danger/30 bg-danger/10 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">The request did not finish</p>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{message.error}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {needsConfig && (
                  <button type="button" onClick={() => openSettings('models')} className="adw-btn h-8">
                    <Settings2 size={16} />
                    Open model settings
                  </button>
                )}
                {isLastAssistant && (
                  <button type="button" onClick={() => regenerateLastTurn(sessionId)} className="adw-btn h-8">
                    <RefreshCw size={16} />
                    Try again
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {hasBody && !streaming && (
        <div className="mt-1 flex min-h-[32px] flex-wrap items-center gap-0.5 text-[12px] text-muted">
          {message.content && (
            <button
              type="button"
              onClick={copy}
              className="adw-icon-btn adw-icon-btn-sm"
              aria-label="Copy response"
              title={copied ? 'Copied' : 'Copy'}
            >
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          )}
          {isLastAssistant && (
            <button
              type="button"
              onClick={() => regenerateLastTurn(sessionId)}
              className="adw-icon-btn adw-icon-btn-sm"
              aria-label="Regenerate response"
              title="Regenerate"
            >
              <RefreshCw size={16} />
            </button>
          )}
          <span className="ml-2 tabular-nums">{metaLine}</span>
        </div>
      )}
    </div>
  )
}

function TurnBlockInner({
  turn,
  sessionId,
  streaming,
  lastAssistantId,
  activeTurn = false,
}: {
  turn: ConversationTurn
  sessionId: string
  streaming: boolean
  lastAssistantId?: string
  /** True while this is the turn the agent is currently working on. */
  activeTurn?: boolean
}) {
  const allTools: ToolMessage[] = []
  const assistantMessages: AssistantMessage[] = []

  for (const segment of turn.segments) {
    if (segment.kind === 'tools') {
      allTools.push(...segment.tools)
    } else if (segment.kind === 'assistant') {
      assistantMessages.push(segment.message)
    }
  }

  const hasTools = allTools.length > 0
  const firstAssistantId = assistantMessages[0]?.id
  const finalAssistant = assistantMessages[assistantMessages.length - 1] ?? null

  // While the agent is still working, every step is shown inline. Nothing is
  // folded into "Task completed" until the whole turn actually finishes.
  if (activeTurn && hasTools) {
    return (
      <div className="flex flex-col gap-4">
        {turn.user && <UserBubble message={turn.user} sessionId={sessionId} canEdit={!streaming} />}
        {turn.segments.map((segment, index) =>
          segment.kind === 'tools' ? (
            <div key={`tools-${index}`} className="adw-boxed space-y-0.5 px-3 py-2">
              {segment.tools.map((tool) => (
                <ToolCallCard key={tool.id} message={tool} />
              ))}
            </div>
          ) : (
            <AssistantBlock
              key={segment.message.id}
              message={segment.message}
              sessionId={sessionId}
              streaming={streaming && segment.message.id === lastAssistantId}
              isLastAssistant={segment.message.id === lastAssistantId}
              showHeader={segment.message.id === firstAssistantId}
            />
          ),
        )}
      </div>
    )
  }

  // Finished turn with no tools: just the conversation.
  if (!hasTools) {
    let seen = 0
    return (
      <div className="flex flex-col gap-4">
        {turn.user && <UserBubble message={turn.user} sessionId={sessionId} canEdit={!streaming} />}
        {assistantMessages.map((message) => (
          <AssistantBlock
            key={message.id}
            message={message}
            sessionId={sessionId}
            streaming={streaming && message.id === lastAssistantId}
            isLastAssistant={message.id === lastAssistantId}
            showHeader={seen++ === 0}
          />
        ))}
      </div>
    )
  }

  // Finished turn: fold the tool calls and intermediate steps into one
  // collapsible "Task completed" block; the final answer stays outside.
  const intermediateAssistants = assistantMessages.slice(0, -1)
  const turnUsage = assistantMessages.reduce(
    (sum, item) => ({ input: sum.input + (item.usage?.input ?? 0), output: sum.output + (item.usage?.output ?? 0) }),
    { input: 0, output: 0 },
  )

  return (
    <div className="flex flex-col gap-4">
      {turn.user && <UserBubble message={turn.user} sessionId={sessionId} canEdit={!streaming} />}

      <TaskCompletedBox tools={allTools} intermediateMessages={intermediateAssistants} />

      {finalAssistant && (
        <AssistantBlock
          key={finalAssistant.id}
          message={finalAssistant}
          sessionId={sessionId}
          streaming={false}
          isLastAssistant={finalAssistant.id === lastAssistantId}
          showHeader={true}
          turnUsage={turnUsage}
        />
      )}

      {turn.user && changedFiles(allTools).length > 0 && (
        <UndoBar turnId={turn.user.id} files={changedFiles(allTools)} diff={totalDiff(allTools)} />
      )}
    </div>
  )
}

export function TurnBlock(props: {
  turn: ConversationTurn
  sessionId: string
  streaming: boolean
  lastAssistantId?: string
  activeTurn?: boolean
}) {
  const tools: ToolMessage[] = []
  for (const segment of props.turn.segments) if (segment.kind === 'tools') tools.push(...segment.tools)
  return (
    <>
      <TurnBlockInner {...props} />
      {props.activeTurn && <AgentActivity tools={tools} className="mt-1" />}
    </>
  )
}
