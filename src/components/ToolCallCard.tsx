import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { FileDiff, ToolMedia, ToolMessage, ToolName } from '../types'
import { toolLabel, toolSummary } from '../lib/tool-meta'
import { resolveApproval } from '../core/services/approval'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'
import { diffLines, diffStats } from '../lib/diff'
import { DiffBadge, DiffView } from './DiffView'
import { QuestionCard } from './QuestionCard'
import { Spinner } from './ui'

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'rewrite_file'])

/** The diff the daemon reported, or one worked out from the call itself for older chats. */
export function diffForTool(message: ToolMessage): FileDiff | undefined {
  if (message.diff) return message.diff
  if (message.status !== 'done' || message.call.name !== 'edit_file') return undefined
  const { oldText, newText } = message.call.args
  if (typeof oldText !== 'string' || typeof newText !== 'string') return undefined
  return diffStats(diffLines(oldText, newText))
}

function statusMeta(status: ToolMessage['status']) {
  switch (status) {
    case 'awaiting':
      return { label: 'Needs approval', className: 'text-warning', dot: 'bg-warning' }
    case 'running':
      return { label: 'Running', className: 'text-accent', dot: 'bg-accent' }
    case 'done':
      return { label: 'Done', className: 'text-success', dot: 'bg-success' }
    case 'denied':
      return { label: 'Denied', className: 'text-muted', dot: 'bg-faint' }
    default:
      return { label: 'Failed', className: 'text-danger', dot: 'bg-danger' }
  }
}

function durationLabel(ms?: number) {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function approvalCopy(name: ToolName) {
  switch (name) {
    case 'shell':
      return 'OpenSol wants to run this command in the open workspace.'
    case 'write_file':
      return 'OpenSol wants to create or overwrite this file on disk.'
    case 'edit_file':
    case 'rewrite_file':
      return 'OpenSol wants to change this file on disk.'
    case 'git':
      return 'OpenSol wants to change the Git state of this repository.'
    case 'subagent':
      return 'OpenSol wants to start a read-only subagent to investigate.'
    case 'skill':
      return 'OpenSol wants to load an installed skill.'
    case 'ask_question':
      return 'OpenSol wants to ask you a question.'
    case 'web_search':
      return 'OpenSol wants to search the web.'
    case 'read_url':
      return 'OpenSol wants to read this public page.'
    default:
      return 'OpenSol wants to use this tool.'
  }
}

export function ToolCallCard({ message, compact = false }: { message: ToolMessage; compact?: boolean }) {
  if (message.call.name === 'ask_question') return <QuestionCard message={message} />
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

function GenericToolCard({ message, compact = false }: { message: ToolMessage; compact?: boolean }) {
  const [decided, setDecided] = useState<'allow' | 'deny' | null>(null)
  const [open, setOpen] = useState((!compact && message.status === 'awaiting') || message.status === 'error')
  const [copied, setCopied] = useState(false)
  const notify = useUi((state) => state.notify)
  const status = statusMeta(message.status)
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

  useEffect(() => {
    if (message.status === 'awaiting' || message.status === 'error') setOpen(true)
  }, [message.status])

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(message.result ?? '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  const trailing =
    message.status === 'done' && message.durationMs !== undefined
      ? durationLabel(message.durationMs)
      : message.status === 'done'
        ? ''
        : status.label.toLowerCase()

  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[32px] w-full min-w-0 items-center gap-1.5 rounded-[6px] px-1 text-left hover:bg-ink/[.05]"
        aria-expanded={open}
      >
        <ChevronRight size={16} className={cn('shrink-0 text-muted transition-transform duration-150', open && 'rotate-90')} />
        <span className="shrink-0 font-semibold text-ink">{toolLabel(message.call.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{summary || '—'}</span>
        {isFileTool && diff && message.status === 'done' ? (
          <DiffBadge added={diff.added} removed={diff.removed} line={diff.line} column={diff.column} className="shrink-0" />
        ) : (
          trailing && (
            <span className={cn('flex shrink-0 items-center gap-1.5 text-[12px]', message.status === 'done' ? 'text-faint' : status.className)}>
              {message.status === 'running' && <Spinner size={12} />}
              {trailing}
            </span>
          )
        )}
      </button>

      {message.status === 'awaiting' && !decided && (
        <div className="mx-1 my-1 rounded-[9px] border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-[13px] leading-relaxed text-ink">{approvalCopy(message.call.name)}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDecided('allow')
                resolveApproval(message.call.id, true)
              }}
              className="adw-btn adw-btn-suggested h-8"
            >
              Allow once
            </button>
            <button
              type="button"
              onClick={() => {
                setDecided('deny')
                resolveApproval(message.call.id, false)
              }}
              className="adw-btn h-8"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {message.status === 'awaiting' && decided && (
        <p className="py-1 pl-7 text-[12px] text-muted">{decided === 'allow' ? 'Allowed — running…' : 'Denied.'}</p>
      )}

      {open && (
        <div className="space-y-2 pb-1.5 pl-7 pt-0.5">
          {command && (
            <pre className="adw-recessed thin-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
              $ {command}
            </pre>
          )}
          {message.call.name === 'edit_file' && typeof args.oldText === 'string' && typeof args.newText === 'string' && (
            <DiffView before={args.oldText} after={args.newText} startLine={diff?.line ?? 1} />
          )}
          {content && message.call.name !== 'edit_file' && (
            <pre className="thin-scroll max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-muted">
              {content.length > 4000 ? `${content.slice(0, 4000)}\n… ${content.length - 4000} more characters` : content}
            </pre>
          )}

          {message.result !== undefined && (
            <div>
              <p className="mb-1 flex items-center gap-3 text-[12px] text-muted">
                <span>{message.status === 'error' ? 'Error' : 'Output'}</span>
                <button type="button" onClick={copyOutput} className="text-link hover:underline">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </p>
              <pre
                className={cn(
                  'thin-scroll max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.65]',
                  message.status === 'error' ? 'text-danger' : 'text-muted',
                )}
              >
                {message.result || '(no output)'}
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
            <p className="text-[12px] text-muted">
              {message.status === 'running' ? 'Working…' : 'No result was recorded.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
