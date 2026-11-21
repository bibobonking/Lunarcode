import { Check, ChevronDown, ListChecks } from 'lucide-react'
import { useState } from 'react'
import { useChats } from '../store/chats'
import { normalizeTodos, todoProgress, type TodoItem } from '../lib/todos'
import { cn } from '../lib/utils'
import type { ToolMessage } from '../types'

function Row({ item }: { item: TodoItem }) {
  return (
    <li className="flex items-start gap-2.5 py-[3px]">
      <span
        className={cn(
          'mt-[3px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-300',
          item.status === 'completed' && 'border-transparent bg-success text-on-accent',
          item.status === 'in_progress' && 'border-accent bg-accent/15',
          item.status === 'pending' && 'border-line',
        )}
        aria-hidden="true"
      >
        {item.status === 'completed' && <Check size={11} strokeWidth={3} className="tool-check" />}
        {item.status === 'in_progress' && <span className="moon-spinner h-2.5 w-2.5" />}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-[13px] leading-snug transition-colors duration-300',
          item.status === 'completed' && 'text-faint line-through decoration-faint/60',
          item.status === 'in_progress' && 'font-semibold text-ink',
          item.status === 'pending' && 'text-muted',
        )}
      >
        {item.content}
      </span>
    </li>
  )
}

export function TodoChecklist({ items }: { items: TodoItem[] }) {
  const { done, total } = todoProgress(items)
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-[rgb(var(--lunar-b))] transition-[width] duration-500 ease-out"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted">
          {done}/{total}
        </span>
      </div>
      <ul>
        {items.map((item, index) => (
          <Row key={`${index}-${item.content}`} item={item} />
        ))}
      </ul>
    </div>
  )
}

/** Card shown in the conversation for each todo_write call. */
export function TodoCard({ message }: { message: ToolMessage }) {
  const items = normalizeTodos(message.call.args)
  const { done, total } = todoProgress(items)
  return (
    <div className="tool-card" data-status={message.status} data-kind="todo">
      <div className="flex items-center gap-2.5 py-2 pl-3.5 pr-3">
        <span className="tool-icon" aria-hidden="true">
          <ListChecks size={14} />
        </span>
        <span className="text-[12px] font-semibold text-ink">Todo list</span>
        <span className="tool-chip" data-tone={done === total && total > 0 ? 'done' : 'running'}>
          {done}/{total}
        </span>
      </div>
      <div className="border-t border-line/70 px-3.5 pb-2.5 pt-2.5">
        {items.length > 0 ? <TodoChecklist items={items} /> : <p className="text-[12px] text-muted">{message.result ?? 'Empty list.'}</p>}
      </div>
    </div>
  )
}

/** Pinned above the composer: the latest todo list of the open conversation. */
export function TodoDock() {
  const items = useChats((state) => {
    const session = state.sessions.find((entry) => entry.id === state.activeId)
    if (!session) return null
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      const message = session.messages[index]
      if (message.role === 'tool' && message.call.name === 'todo_write') return message
    }
    return null
  })
  const [open, setOpen] = useState(true)
  if (!items) return null
  const list = normalizeTodos(items.call.args)
  if (list.length === 0) return null
  const { done, total, active } = todoProgress(list)
  if (done === total) return null
  return (
    <div className="tool-card mb-2" data-status="running" data-kind="todo">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 py-2 pl-3.5 pr-3 text-left"
        aria-expanded={open}
      >
        <span className="tool-icon" aria-hidden="true">
          <ListChecks size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
          <span className="font-semibold">{active ? active.content : 'Tasks'}</span>
        </span>
        <span className="tool-chip" data-tone="running">
          {done}/{total}
        </span>
        <ChevronDown size={14} className={cn('shrink-0 text-muted transition-transform duration-200', !open && '-rotate-90')} />
      </button>
      <div className={cn('collapse-grid', open && 'is-open')}>
        <div className="collapse-inner">
          <div className="thin-scroll max-h-52 overflow-y-auto border-t border-line/70 px-3.5 pb-2.5 pt-2.5">
            <TodoChecklist items={list} />
          </div>
        </div>
      </div>
    </div>
  )
}
