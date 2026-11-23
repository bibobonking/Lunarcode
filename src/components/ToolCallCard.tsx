import { useEffect, useState } from 'react'
import { Bot, Check, ChevronRight, FileDiff as FileDiffIcon, FilePenLine, FilePlus2, FileText, FolderTree, Globe, ListChecks, GitBranch, HelpCircle, Package, Plug, Search, Sparkles, Terminal, TriangleAlert, Wrench, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FileDiff, ToolMedia, ToolMessage, ToolName } from '../types'
import { toolLabel, toolSummary } from '../lib/tool-meta'
import { resolveApproval } from '../core/services/approval'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'
import { diffLines, diffStats } from '../lib/diff'
import { colorizeShellOutput, escapeHtml, highlightCode, langFromPath } from '../lib/highlight'
import { DiffView } from './DiffView'
import { TodoCard } from './TodoList'
import { QuestionCard } from './QuestionCard'

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'rewrite_file'])

/** The diff the daemon reported, or one worked out from the call itself for older chats. */
export function diffForTool(message: ToolMessage): FileDiff | undefined {
  if (message.diff) return message.diff
  if (message.status !== 'done' || message.call.name !== 'edit_file') return undefined
  const { oldText, newText } = message.call.args
  if (typeof oldText !== 'string' || typeof newText !== 'string') return undefined
  return diffStats(diffLines(oldText, newText))
}

function durationLabel(ms?: number) {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function approvalCopy(name: ToolName) {
  switch (name) {
    case 'shell':
      return 'Lunarcode wants to run this command in the open workspace.'
    case 'write_file':
      return 'Lunarcode wants to create or overwrite this file on disk.'
    case 'edit_file':
    case 'rewrite_file':
      return 'Lunarcode wants to change this file on disk.'
    case 'git':
      return 'Lunarcode wants to change the Git state of this repository.'
    case 'subagent':
      return 'Lunarcode wants to start a read-only subagent to investigate.'
    case 'skill':
      return 'Lunarcode wants to load an installed skill.'
    case 'ask_question':
      return 'Lunarcode wants to ask you a question.'
    case 'web_search':
      return 'Lunarcode wants to search the web.'
    case 'read_url':
      return 'Lunarcode wants to read this public page.'
    default:
      return 'Lunarcode wants to use this tool.'
  }
}

export function ToolCallCard({ message, compact = false }: { message: ToolMessage; compact?: boolean }) {
  if (message.call.name === 'ask_question') return <QuestionCard message={message} />
  if (message.call.name === 'todo_write') return <TodoCard message={message} />
  return <GenericToolCard message={message} compact={compact} />
}

function mediaBlobUrl(item: ToolMedia): string {
  const bytes = Uint8Array.from(atob(item.data), (char) => char.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: item.mimeType }))
}

function ToolMediaView({ item, index }: { item: ToolMedia; index: number }) {
  const src = `data:${item.mimeType};base64,${item.data}`
  if (item.kind === 'image') {
    return (
      <button
        type="button"
        title="Open image"
        onClick={() => {
          try {
            window.open(mediaBlobUrl(item), '_blank', 'noopener')
          } catch {
            /* ignore */
          }
        }}
      >
        <img src={src} alt={`Tool image ${index + 1}`} className="max-h-64 max-w-full rounded-[9px] border border-line object-contain" />
      </button>
    )
  }
  if (item.kind === 'audio') {
    return <audio controls src={src} className="h-9 max-w-full" aria-label={item.name || `Tool audio ${index + 1}`} />
  }
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.open(mediaBlobUrl(item), '_blank', 'noopener')
        } catch {
          /* ignore */
        }
      }}
      className="adw-btn h-8 text-[12px]"
    >
      Open {item.name || 'document'} ({item.mimeType})
    </button>
  )
}

const TOOL_ICONS: Partial<Record<string, LucideIcon>> = {
  shell: Terminal,
  read_file: FileText,
  list_files: FolderTree,
  write_file: FilePlus2,
  edit_file: FilePenLine,
  rewrite_file: FileDiffIcon,
  grep: Search,
  web_search: Globe,
  read_url: Globe,
  git: GitBranch,
  subagent: Bot,
  skill: Sparkles,
  ask_question: HelpCircle,
  todo_write: ListChecks,
}

function toolIcon(name: string): LucideIcon {
  if (name.startsWith('mcp__')) return Plug
  if (name.startsWith('ext__')) return Package
  return TOOL_ICONS[name] ?? Wrench
}

/** Five tiny blocks showing the add/remove proportion of a change. */
function DiffBar({ added, removed }: { added: number; removed: number }) {
  const total = added + removed
  if (total === 0) return null
  const addBlocks = Math.max(added > 0 ? 1 : 0, Math.round((added / total) * 5))
  const delBlocks = removed > 0 ? 5 - addBlocks : 0
  return (
    <span className="diff-bar" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <i key={index} className={index < addBlocks ? 'add' : index < addBlocks + delBlocks ? 'del' : ''} />
      ))}
    </span>
  )
}

function splitPath(path: string) {
  const clean = path.replace(/\\/g, '/')
  const index = clean.lastIndexOf('/')
  return index === -1 ? { dir: '', base: clean } : { dir: clean.slice(0, index + 1), base: clean.slice(index + 1) }
}

function GenericToolCard({ message, compact = false }: { message: ToolMessage; compact?: boolean }) {
  const [decided, setDecided] = useState<'allow' | 'deny' | null>(null)
  const [open, setOpen] = useState((!compact && message.status === 'awaiting') || message.status === 'error')
  const [everOpen, setEverOpen] = useState(open)
  const [copied, setCopied] = useState(false)
  const notify = useUi((state) => state.notify)
  const summary = toolSummary(message.call.name, message.call.args)
  const args = message.call.args
  const diff = diffForTool(message)
  const isFileTool = FILE_TOOLS.has(message.call.name)
  const command = typeof args.command === 'string' ? args.command : ''
  const content =
    typeof args.content === 'string'
      ? args.content
      : typeof args.newText === 'string'
        ? args.newText
        : typeof args.oldText === 'string'
          ? args.oldText
          : ''
  const Icon = toolIcon(message.call.name)
  const filePath = typeof args.path === 'string' ? args.path : undefined
  const lang = langFromPath(filePath)
  const isShell = message.call.name === 'shell'
  const path = isFileTool && typeof args.path === 'string' ? splitPath(args.path) : null
  const isNewFile = message.call.name === 'write_file' && message.status === 'done' && (diff?.removed ?? 0) === 0

  useEffect(() => {
    if (message.status === 'awaiting' || message.status === 'error') {
      setOpen(true)
      setEverOpen(true)
    }
  }, [message.status])

  const toggle = () => {
    setEverOpen(true)
    setOpen((value) => !value)
  }

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(message.result ?? '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  const showDiff = isFileTool && diff && message.status === 'done'
  const duration = message.status === 'done' && message.durationMs !== undefined ? durationLabel(message.durationMs) : ''

  return (
    <div
      className="tool-card text-[13px]"
      data-status={message.status}
      data-kind={isFileTool ? 'file' : 'tool'}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex min-h-[40px] w-full min-w-0 items-center gap-2.5 py-1.5 pl-3.5 pr-2.5 text-left transition-colors hover:bg-ink/[.035]"
        aria-expanded={open}
      >
        <span className="tool-icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <span className="shrink-0 text-[12px] font-semibold text-ink">{toolLabel(message.call.name)}</span>
        {path ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={typeof args.path === 'string' ? args.path : undefined}>
            <span className="text-faint">{path.dir}</span>
            <span className="font-semibold text-ink">{path.base}</span>
          </span>
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 truncate font-mono text-[12px]',
              message.status === 'running' ? 'shimmer-text' : 'text-muted',
            )}
          >
            {summary || '—'}
          </span>
        )}

        {isNewFile && <span className="tool-chip" data-tone="done">new</span>}
        {showDiff && (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="diff-pill diff-pill-add">+{diff.added}</span>
            <span className="diff-pill diff-pill-del">−{diff.removed}</span>
            <DiffBar added={diff.added} removed={diff.removed} />
            {diff.line ? (
              <span className="hidden font-mono text-[11px] text-faint sm:inline">
                L{diff.line}
                {diff.column ? `:${diff.column}` : ''}
              </span>
            ) : null}
          </span>
        )}
        {message.status === 'running' && (
          <span className="tool-chip shrink-0" data-tone="running">
            <span className="moon-spinner h-3 w-3" aria-hidden="true" />
            Running
          </span>
        )}
        {message.status === 'awaiting' && (
          <span className="tool-chip shrink-0" data-tone="awaiting">
            <TriangleAlert size={11} /> Needs approval
          </span>
        )}
        {message.status === 'error' && (
          <span className="tool-chip shrink-0" data-tone="error">
            <X size={11} /> Failed
          </span>
        )}
        {message.status === 'denied' && <span className="tool-chip shrink-0">Denied</span>}
        {message.status === 'done' && (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-faint">
            {!showDiff && <Check size={13} className="tool-check text-success" aria-label="Done" />}
            {duration && <span className="tabular-nums">{duration}</span>}
          </span>
        )}
        <ChevronRight size={14} className={cn('ws-chevron shrink-0 text-muted', open && 'is-open')} />
      </button>

      {message.status === 'awaiting' && !decided && (
        <div className="mx-3 mb-2.5 ml-3.5 rounded-[8px] border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-[12px] leading-relaxed text-ink">{approvalCopy(message.call.name)}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDecided('allow')
                resolveApproval(message.call.id, true)
              }}
              className="adw-btn adw-btn-suggested h-7"
            >
              Allow once
            </button>
            <button
              type="button"
              onClick={() => {
                setDecided('deny')
                resolveApproval(message.call.id, false)
              }}
              className="adw-btn h-7"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {message.status === 'awaiting' && decided && (
        <p className="pb-2 pl-4 text-[12px] text-muted">{decided === 'allow' ? 'Allowed — running…' : 'Denied.'}</p>
      )}

      <div className={cn('collapse-grid', open && 'is-open')}>
        <div className="collapse-inner">
          {everOpen && (
            <div className="space-y-2 border-t border-line/70 px-3.5 pb-3 pt-2.5">
              {command && (
                <pre className="tool-output thin-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[12px] leading-relaxed text-ink">
                  <span className="select-none text-accent">$ </span>
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightCode(command, 'bash') }} />
                </pre>
              )}
              {message.call.name === 'edit_file' && typeof args.oldText === 'string' && typeof args.newText === 'string' && (
                <DiffView before={args.oldText} after={args.newText} startLine={diff?.line ?? 1} lang={lang} />
              )}
              {content && message.call.name !== 'edit_file' && (
                <pre className="tool-output thin-scroll max-h-60 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[12px] leading-relaxed text-ink">
                  <code
                    className="hljs"
                    dangerouslySetInnerHTML={{
                      __html:
                        highlightCode(content.length > 4000 ? content.slice(0, 4000) : content, lang) +
                        (content.length > 4000 ? `\n… ${content.length - 4000} more characters` : ''),
                    }}
                  />
                </pre>
              )}

              {message.result !== undefined && (
                <div>
                  <p className="mb-1 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <span className="text-muted">{message.status === 'error' ? 'Error' : 'Output'}</span>
                    <button type="button" onClick={copyOutput} className="font-medium normal-case tracking-normal text-link hover:underline">
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </p>
                  <pre
                    className={cn(
                      'tool-output thin-scroll max-h-72 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[12.5px] leading-[1.6]',
                      message.status === 'error' ? 'text-danger' : 'text-ink/90',
                    )}
                  >
                    <code
                      className="hljs"
                      dangerouslySetInnerHTML={{
                        __html: !message.result
                          ? '(no output)'
                          : isShell || message.status === 'error'
                            ? colorizeShellOutput(message.result)
                            : message.call.name === 'read_file' && lang
                              ? highlightCode(message.result, lang)
                              : escapeHtml(message.result),
                      }}
                    />
                  </pre>
                </div>
              )}

              {message.media && message.media.length > 0 && (
                <div className="flex flex-wrap items-start gap-2">
                  {message.media.map((item, index) => (
                    <ToolMediaView key={index} item={item} index={index} />
                  ))}
                </div>
              )}

              {message.result === undefined && !command && !content && message.status !== 'awaiting' && (
                <p className="text-[12px] text-muted">{message.status === 'running' ? 'Working…' : 'No result was recorded.'}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
