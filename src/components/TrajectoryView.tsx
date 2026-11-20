import { useMemo } from 'react'
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileText,
  SquareTerminal,
  UserRound,
  Wrench,
} from 'lucide-react'
import type { ChatSession, Message } from '../types'
import { toolLabel, toolSummary } from '../lib/tool-meta'
import { cn } from '../lib/utils'
import { LogoMark } from './Logo'

function timeOf(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function preview(text: string, length = 180) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > length ? `${clean.slice(0, length)}…` : clean
}

function statusTone(message: Extract<Message, { role: 'tool' }>) {
  switch (message.status) {
    case 'running':
      return { label: 'Running', className: 'text-accent', dot: 'bg-accent' }
    case 'awaiting':
      return { label: 'Needs approval', className: 'text-warning', dot: 'bg-warning' }
    case 'done':
      return { label: 'Done', className: 'text-success', dot: 'bg-success' }
    case 'denied':
      return { label: 'Denied', className: 'text-muted', dot: 'bg-faint' }
    default:
      return { label: 'Failed', className: 'text-danger', dot: 'bg-danger' }
  }
}

export function TrajectoryView({ session }: { session: ChatSession }) {
  const events = useMemo(() => session.messages, [session.messages])
  const toolCount = events.filter((message) => message.role === 'tool').length

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <Wrench size={32} className="mx-auto text-muted" />
          <p className="mt-2 text-[16px] font-bold text-ink">No trajectory yet</p>
          <p className="mt-1 text-[14px] text-muted">Send a message to see every step here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[800px] px-4 pb-12 pt-7 sm:px-6">
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-line pb-3">
          <div>
            <p className="text-[14px] font-bold text-ink">Trajectory</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {events.length} step{events.length === 1 ? '' : 's'} · {toolCount} tool call{toolCount === 1 ? '' : 's'}
            </p>
          </div>
          <span className="adw-badge">Read-only view</span>
        </div>

        <div className="relative">
          <span className="absolute bottom-3 left-[13px] top-3 w-px bg-line" aria-hidden="true" />
          <div className="stagger space-y-4">
            {events.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="relative flex gap-3">
                    <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink/[.08] text-muted">
                      <UserRound size={13} />
                    </span>
                    <div className="min-w-0 flex-1 adw-boxed px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-ink">You</span>
                        <span className="text-[12px] tabular-nums text-faint">{timeOf(message.createdAt)}</span>
                      </div>
                      <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted">{message.content || 'Attachment only'}</p>
                    </div>
                  </div>
                )
              }

              if (message.role === 'assistant') {
                const hasText = Boolean(message.content.trim() || message.reasoning.trim())
                return (
                  <div key={message.id} className="relative flex gap-3">
                    <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink/[.08]">
                      <LogoMark size={16} />
                    </span>
                    <div className="min-w-0 flex-1 adw-boxed px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink">
                          OpenSol
                          {message.model && (
                            <span className="truncate text-[12px] font-normal text-faint">{message.model}</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5 text-[12px] tabular-nums text-faint">
                          {message.stopped && <span className="text-muted">Stopped</span>}
                          {timeOf(message.createdAt)}
                        </span>
                      </div>
                      {hasText ? (
                        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                          {preview(message.content || message.reasoning)}
                        </p>
                      ) : (
                        <p className="mt-1 text-[12px] text-faint">Model turn with no text.</p>
                      )}
                      {message.error && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-danger">
                          <AlertCircle size={14} className="mt-0.5 shrink-0" />
                          {message.error}
                        </p>
                      )}
                      {message.toolCalls.length > 0 && (
                        <p className="mt-1.5 text-[12px] text-faint">
                          {message.toolCalls.length} tool call{message.toolCalls.length === 1 ? '' : 's'} in this round
                        </p>
                      )}
                    </div>
                  </div>
                )
              }

              const status = statusTone(message)
              const isShell = message.call.name === 'shell'
              const isFile = ['read_file', 'write_file', 'edit_file', 'rewrite_file'].includes(message.call.name)
              const Icon = isShell ? SquareTerminal : isFile ? FileText : Wrench
              return (
                <div key={message.id} className="relative flex gap-3">
                  <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink/[.08] text-muted">
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1 adw-boxed bg-raised px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink">{toolLabel(message.call.name)}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
                        {toolSummary(message.call.name, message.call.args) || '—'}
                      </span>
                      <span className={cn('flex shrink-0 items-center gap-1 text-[12px] font-semibold', status.className)}>
                        {message.status === 'done' ? (
                          <Check size={14} />
                        ) : (
                          <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
                        )}
                        {status.label}
                        {message.durationMs !== undefined && message.status === 'done'
                          ? ` · ${message.durationMs < 1000 ? `${message.durationMs}ms` : `${(message.durationMs / 1000).toFixed(1)}s`}`
                          : ''}
                      </span>
                    </div>
                    {message.result && (
                      <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-faint">
                        {preview(message.result, 160)}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1 text-[12px] text-faint">
          End of trajectory <ChevronRight size={14} />
        </p>
      </div>
    </div>
  )
}
