import { useMemo, useState } from 'react'
import { Cpu } from 'lucide-react'
import { useChats } from '../store/chats'
import { useSettings } from '../store/settings'
import { useWorkspace } from '../store/workspace'
import { cn } from '../lib/utils'
import { formatCredits } from '../lib/credits'
import { computeUsage, formatTokens, shortModelName, type UsageRange } from '../lib/usage'
import { PixelLogo } from './AgentActivity'
import { BoxedList, ListRow, PageGroup, Segmented } from './ui'

const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '30d', label: '30d' },
  { value: '7d', label: '7d' },
]

const HEAT_LEVELS = ['bg-ink/[.08]', 'bg-accent/25', 'bg-accent/45', 'bg-accent/65', 'bg-accent/90']

function heatLevel(count: number, busiest: number) {
  if (count <= 0) return 0
  if (busiest <= 1) return 2
  return Math.min(4, 1 + Math.floor((count / busiest) * 3))
}

/** Welcome state: static monochrome mark, title, one line of body text. */
export function HomeGreeting() {
  const daemon = useSettings((state) => state.daemon)
  const showMascot = useSettings((state) => state.showMascot)
  const workspace = useWorkspace((state) => state.info)
  const home = daemon?.home ?? ''
  const name = home.split(/[\\/]/).filter(Boolean).pop() || workspace.name || 'there'
  return (
    <div className="home-greeting flex flex-col items-center gap-3 text-center">
      <span className="lunar-stars" aria-hidden="true" style={{ inset: '-40px -80px' }} />
      {showMascot && <PixelLogo mode="orbit" size={64} />}
      <h1 className="text-[26px] font-bold leading-[1.2] text-ink">
        What should we build, <span className="lunar-text">{name}</span>?
      </h1>
      <p className="text-[13px] text-muted">Local-first agent. Your folder, your keys, your machine.</p>
    </div>
  )
}

function Value({ children }: { children: string }) {
  return <span className="max-w-[200px] truncate text-[13px] tabular-nums text-ink">{children}</span>
}

/** Usage as a compact boxed list under the welcome content. */
export function HomeDashboard() {
  const sessions = useChats((state) => state.sessions)
  const [range, setRange] = useState<UsageRange>('30d')
  const [tab, setTab] = useState<'overview' | 'models'>('overview')
  const stats = useMemo(() => computeUsage(sessions, range), [sessions, range])

  const columns = useMemo(() => {
    const weeks: typeof stats.heatmap[] = []
    for (let index = 0; index < stats.heatmap.length; index += 7) {
      weeks.push(stats.heatmap.slice(index, index + 7))
    }
    return weeks
  }, [stats.heatmap])

  const topModelTokens = stats.models[0]?.tokens ?? 0
  const row = 'min-h-[40px] py-1.5'

  return (
    <PageGroup
      title="Usage"
      actions={
        <div className="flex items-center gap-2">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'models', label: 'Models' },
            ]}
          />
          <Segmented value={range} onChange={setRange} options={RANGES} />
        </div>
      }
    >
      {tab === 'overview' ? (
        <>
          <BoxedList className="stagger">
            <ListRow className={row} title="Sessions" trailing={<Value>{String(stats.sessions)}</Value>} />
            <ListRow className={row} title="Messages" trailing={<Value>{String(stats.messages)}</Value>} />
            <ListRow className={row} title="Total tokens" trailing={<Value>{stats.tokens ? formatTokens(stats.tokens) : '0'}</Value>} />
            <ListRow className={row} title="Credits spent" trailing={<Value>{stats.cost > 0 ? formatCredits(stats.cost) : '—'}</Value>} />
            <ListRow className={row} title="Active days" trailing={<Value>{String(stats.activeDays)}</Value>} />
            <ListRow className={row} title="Peak hour" trailing={<Value>{stats.peakHour}</Value>} />
            <ListRow className={row} title="Favorite model" trailing={<Value>{shortModelName(stats.favoriteModel)}</Value>} />
            <div className="overflow-x-auto px-4 py-3">
              <div className="flex w-max gap-[3px]">
                {columns.map((week, index) => (
                  <div key={index} className="grid grid-rows-7 gap-[3px]">
                    {week.map((day) => (
                      <span
                        key={day.key}
                        className={cn('heat-cell h-[11px] w-[11px] rounded-[3px]', HEAT_LEVELS[heatLevel(day.count, stats.busiestDay)])}
                        style={{ animationDelay: `${Math.min(260, index * 9)}ms` }}
                        title={`${day.key} · ${day.count} message${day.count === 1 ? '' : 's'}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </BoxedList>
          <p className="px-1 text-[12px] leading-relaxed text-muted">
            {stats.messages === 0
              ? 'No activity in this range yet. Send a message to start the graph.'
              : `You've used ~${formatTokens(stats.tokens)} tokens across ${stats.messages} messages.`}
            {stats.favoriteModel !== '—' && ` · ${stats.favoriteShare}% on ${shortModelName(stats.favoriteModel)}`}
          </p>
        </>
      ) : stats.models.length === 0 ? (
        <BoxedList>
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <Cpu size={20} className="text-muted" />
            <p className="mt-2 text-[13px] font-semibold text-ink">No model usage yet</p>
            <p className="mt-0.5 text-[12px] text-muted">Models appear here after you send a message.</p>
          </div>
        </BoxedList>
      ) : (
        <BoxedList className="stagger">
          {stats.models.slice(0, 6).map((model) => (
            <div key={model.model} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] text-ink" title={model.model}>
                  {shortModelName(model.model)}
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-muted">
                  {formatTokens(model.tokens)} · {model.messages} msg{model.cost > 0 ? ` · ${formatCredits(model.cost)}` : ''}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[.1]">
                <div
                  className="usage-bar h-full rounded-full bg-gradient-to-r from-accent to-[rgb(var(--lunar-b))]"
                  style={{ width: `${topModelTokens ? Math.max(4, (model.tokens / topModelTokens) * 100) : 4}%` }}
                />
              </div>
            </div>
          ))}
        </BoxedList>
      )}
    </PageGroup>
  )
}
