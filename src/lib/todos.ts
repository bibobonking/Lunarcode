export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  status: TodoStatus
}

const STATUSES = new Set<TodoStatus>(['pending', 'in_progress', 'completed'])

/** Model arguments are untrusted: keep well-formed items only, cap the list, default to pending. */
export function normalizeTodos(args: unknown): TodoItem[] {
  const raw = args && typeof args === 'object' ? (args as { todos?: unknown }).todos : undefined
  if (!Array.isArray(raw)) return []
  const items: TodoItem[] = []
  for (const entry of raw.slice(0, 40)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { content?: unknown; status?: unknown }
    const content = typeof record.content === 'string' ? record.content.trim().slice(0, 240) : ''
    if (!content) continue
    const status = STATUSES.has(record.status as TodoStatus) ? (record.status as TodoStatus) : 'pending'
    items.push({ content, status })
  }
  // At most one item may be in progress; later ones fall back to pending.
  let seen = false
  return items.map((item) => {
    if (item.status !== 'in_progress') return item
    if (seen) return { ...item, status: 'pending' as const }
    seen = true
    return item
  })
}

export function todoProgress(items: TodoItem[]) {
  const done = items.filter((item) => item.status === 'completed').length
  return { done, total: items.length, active: items.find((item) => item.status === 'in_progress') }
}
