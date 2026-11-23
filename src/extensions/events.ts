import { ensureSession } from '../lib/daemon'

type Listener = (data: unknown) => void

interface ExtEvent {
  type: 'ext' | 'extensions'
  ext?: string
  name?: string
  data?: unknown
}

const listeners = new Map<string, Set<Listener>>()
const changeListeners = new Set<() => void>()
let source: EventSource | null = null
let retry: number | undefined

/** Subscribes to an event an extension's daemon part sent with `host.emit(name, data)`. */
export function onServerEvent(ext: string, name: string, listener: Listener): () => void {
  const key = `${ext}\n${name}`
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(listener)
  return () => set.delete(listener)
}

/** Fires when extensions changed on disk, from the CLI, or by another window. */
export function onExtensionsChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

export function startExtensionEvents(): void {
  if (source || typeof EventSource === 'undefined') return
  void ensureSession()
    .then(() => {
      const stream = new EventSource('/api/extensions/events', { withCredentials: true })
      source = stream
      stream.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as ExtEvent
          if (event.type === 'extensions') for (const listener of [...changeListeners]) listener()
          else if (event.type === 'ext' && event.ext && event.name) {
            for (const listener of [...(listeners.get(`${event.ext}\n${event.name}`) ?? [])]) listener(event.data)
          }
        } catch {
          // Ignore a malformed frame.
        }
      }
      stream.onerror = () => {
        stream.close()
        if (source === stream) source = null
        window.clearTimeout(retry)
        retry = window.setTimeout(startExtensionEvents, 2500)
      }
    })
    .catch(() => {
      window.clearTimeout(retry)
      retry = window.setTimeout(startExtensionEvents, 4000)
    })
}
