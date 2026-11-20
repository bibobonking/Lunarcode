/**
 * ContextBar — quiet 12px context-usage status shown in the headerbar.
 *
 * Shows used / total context tokens, percentage and spent credits as plain tabular text.
 * While the session is compacting it shows a spinner and "Compacting…". Text grades from
 * neutral → warning → danger as the context window fills up.
 */

import { useMemo } from 'react'
import type { ModelInfo, Message } from '../types'
import { getContextUsage, AUTO_COMPACT_THRESHOLD } from '../lib/context'
import { useRuntime } from '../store/ui'
import { formatCredits, sumCost } from '../lib/credits'
import { cn } from '../lib/utils'
import { Spinner } from './ui'

interface ContextBarProps {
  messages: Message[]
  model: ModelInfo | null
  sessionId: string | null
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

export function ContextBar({ messages, model, sessionId }: ContextBarProps) {
  const usage = useMemo(() => getContextUsage(messages, model), [messages, model])
  const spent = useMemo(() => sumCost(messages), [messages])
  const compacting = useRuntime((state) => (sessionId ? Boolean(state.compacting[sessionId]) : false))

  if (messages.length === 0) return null

  const { pct, used, limit } = usage
  const isDanger = pct >= AUTO_COMPACT_THRESHOLD * 100
  const isWarning = pct >= 70 && !isDanger

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 whitespace-nowrap text-[12px] tabular-nums text-muted',
        isWarning && 'text-warning',
        isDanger && 'text-danger',
      )}
      title={`Context window: ~${used.toLocaleString()} of ${limit.toLocaleString()} tokens used (${pct}%)`}
    >
      {compacting ? (
        <>
          <Spinner size={12} />
          <span>Compacting…</span>
        </>
      ) : (
        <>
          <span>
            {formatTokens(used)} / {formatTokens(limit)}
          </span>
          <span aria-hidden="true">·</span>
          <span>{pct}%</span>
          {spent > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span title="Credits spent in this session (provider-reported, or tokens × model price)">{formatCredits(spent)}</span>
            </>
          )}
        </>
      )}
    </div>
  )
}
