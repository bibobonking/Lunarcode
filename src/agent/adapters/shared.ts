import type {
  AgentMode,
  AppSettings,
  AssistantMessage,
  Message,
  ModelInfo,
  StreamHandlers,
  ToolCall,
  ToolMedia,
  Usage,
} from '../../types'
import type { ToolSchema } from '../../core/types'

export interface AdapterRequest {
  settings: AppSettings
  model: ModelInfo | null
  history: Message[]
  system: string
  mode: AgentMode
  signal: AbortSignal
  handlers: StreamHandlers
  /** Tools offered to the model. Empty for plain completions such as summaries. */
  tools: ToolSchema[]
}

export interface AdapterResult {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  thinkingBlocks?: Array<{ text: string; signature?: string }>
  usage: Usage
}

export const EMPTY_HANDLERS: StreamHandlers = {
  onText: () => undefined,
  onReasoning: () => undefined,
  onToolCalls: () => undefined,
  onUsage: () => undefined,
}

export function userText(message: Extract<Message, { role: 'user' }>): string {
  const parts = [message.content]
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === 'text' && attachment.text) {
      parts.push(`\n\n--- Attached file: ${attachment.name} ---\n${attachment.text}`)
    }
  }
  return parts.filter(Boolean).join('')
}

export function assistantHistory(message: AssistantMessage): boolean {
  return Boolean(message.content.trim() || message.toolCalls.length > 0)
}

export function imageAttachments(message: Extract<Message, { role: 'user' }>) {
  return (message.attachments ?? []).filter(
    (attachment) => attachment.kind === 'image' && attachment.dataUrl,
  )
}

export function parseToolArgs(raw: string, toolName: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('arguments must be a JSON object')
  } catch (error) {
    throw new Error(`The model returned invalid arguments for ${toolName}: ${(error as Error).message}`)
  }
}

export function toolResultText(result: string | undefined, status: string): string {
  if (status === 'done') return result ?? '(no output)'
  if (status === 'denied') return 'The user denied this tool call.'
  if (status === 'error') return `Tool error: ${result ?? 'unknown error'}`
  if (status === 'awaiting') return 'The tool call was interrupted before approval.'
  return result ?? '(no output)'
}

/** Only the newest tool messages keep their media in the request; older ones fall back to text. */
const MEDIA_TOOL_RESULTS_KEPT = 4

export function visibleToolMedia(history: Message[]): Map<string, ToolMedia[]> {
  const out = new Map<string, ToolMedia[]>()
  for (let i = history.length - 1; i >= 0 && out.size < MEDIA_TOOL_RESULTS_KEPT; i--) {
    const message = history[i]
    if (message.role === 'tool' && message.status === 'done' && message.media?.length) {
      out.set(message.id, message.media)
    }
  }
  return out
}

/** Splits a tool's media into what this provider can read and a note about what it cannot. */
export function splitToolMedia(
  media: ToolMedia[] | undefined,
  supported: ReadonlyArray<ToolMedia['kind']>,
): { sent: ToolMedia[]; note: string } {
  const sent: ToolMedia[] = []
  const skipped: string[] = []
  for (const item of media ?? []) {
    if (supported.includes(item.kind)) sent.push(item)
    else skipped.push(`${item.kind} ${item.mimeType}${item.name ? ` (${item.name})` : ''}`)
  }
  const note = skipped.length
    ? `\n[Not shown to you: ${skipped.join(', ')} — this provider cannot read that content type.]`
    : ''
  return { sent, note }
}

export function mediaDataUrl(item: ToolMedia): string {
  return `data:${item.mimeType};base64,${item.data}`
}

export function collectToolCalls(
  candidates: Array<{ id: string; name: string; args: Record<string, unknown>; thoughtSignature?: string }>,
  available: Set<string>,
): ToolCall[] {
  const calls: ToolCall[] = []
  for (const candidate of candidates) {
    if (!candidate.name) continue
    if (!available.has(candidate.name)) {
      throw new Error(`The model requested a tool that is not enabled: ${candidate.name}`)
    }
    calls.push({
      id: candidate.id,
      name: candidate.name as ToolCall['name'],
      args: candidate.args,
      ...(candidate.thoughtSignature ? { thoughtSignature: candidate.thoughtSignature } : {}),
    })
  }
  return calls
}
