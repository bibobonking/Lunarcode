import type { ToolMedia } from '../types'

/** Validates the media payload a daemon tool returns, dropping anything malformed. */
export function parseToolMedia(value: unknown): ToolMedia[] {
  const list = Array.isArray(value) ? value : []
  const out: ToolMedia[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const kind = item.kind
    const mimeType = item.mimeType
    const data = item.data
    if (
      (kind !== 'image' && kind !== 'audio' && kind !== 'document') ||
      typeof mimeType !== 'string' ||
      typeof data !== 'string' ||
      !data
    ) {
      continue
    }
    out.push({
      kind,
      mimeType,
      data,
      ...(typeof item.name === 'string' && item.name ? { name: item.name } : {}),
    })
  }
  return out
}

/** One-line tool result that explains what was attached without repeating the base64. */
export function mediaToolOutput(media: ToolMedia[], path: string, size: number): string {
  const first = media[0]
  const action = first.kind === 'audio' ? 'listen to it' : first.kind === 'document' ? 'read it' : 'see it'
  return `${path} · ${first.mimeType} · ${size} bytes. Attached so you can ${action}.`
}
