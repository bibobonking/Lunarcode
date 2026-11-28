import type { ToolMessage } from '../types'
import { toolLabel } from '../lib/tool-meta'
import { cn } from '../lib/utils'
import { Gear } from './Logo'

export type ActivityMode = 'orbit' | 'build'

/** The CreateCode mark while the agent works: the gear turns; the ring redraws while files are written. */
export function ActivityMark({ mode, size = 26 }: { mode: ActivityMode; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className="shrink-0 text-ink" aria-hidden="true">
      <path
        className={mode === 'build' ? 'ring-draw' : undefined}
        d="M51.32 26.82A20 20 0 1 1 37.18 12.68"
        pathLength={1}
        stroke="currentColor"
        strokeWidth="5.6"
        strokeLinecap="round"
      />
      <Gear fill="currentColor" spin />
      <g stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M25.2 25.6L34 32l-8.8 6.4" />
        <path d="M37.6 39.2h6" opacity="0.55" />
      </g>
    </svg>
  )
}

const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'rewrite_file'])

export function activityFor(tools: ToolMessage[]): { mode: ActivityMode; label: string } {
  const running = [...tools].reverse().find((tool) => tool.status === 'running' || tool.status === 'awaiting')
  if (!running) return { mode: 'orbit', label: 'Thinking' }
  const name = running.call.name
  if (running.status === 'awaiting') return { mode: 'orbit', label: 'Waiting for you' }
  if (EDIT_TOOLS.has(name)) {
    const path = typeof running.call.args.path === 'string' ? running.call.args.path.split(/[\\/]/).pop() : ''
    const verb = name === 'write_file' ? 'Writing' : name === 'rewrite_file' ? 'Rewriting' : 'Editing'
    return { mode: 'build', label: path ? `${verb} ${path}` : verb }
  }
  if (name === 'shell') return { mode: 'orbit', label: 'Running shell' }
  return { mode: 'orbit', label: toolLabel(name) }
}

/** Shown under the turn only while the agent is working; unmounts when it finishes. */
export function AgentActivity({ tools, className }: { tools: ToolMessage[]; className?: string }) {
  const { mode, label } = activityFor(tools)
  return (
    <div className={cn('agent-activity flex items-center gap-2.5 py-1', className)} role="status" aria-live="polite">
      <ActivityMark mode={mode} />
      <span className="shimmer-text max-w-[60%] truncate text-[12.5px] font-medium">{label}…</span>
    </div>
  )
}
