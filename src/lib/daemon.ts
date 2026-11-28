import type {
  AgentMode,
  AppSettings,
  ChatSession,
  DaemonSnapshot,
  DeployDetection,
  DeployEvent,
  DeployProviderId,
  DeployRequest,
  DeployResult,
  McpServer,
  ModelInfo,
  ProviderId,
  ProviderStatus,
  SecretsSummary,
  WorkspaceFile,
  WorkspaceInfo,
} from '../types'
import type { InstalledSkill } from '../types'
import type { ExtensionListing, ExtensionInfo } from '../extensions/types'

export class DaemonError extends Error {
  status: number
  code: string

  constructor(message: string, status = 0, code = 'daemon_error') {
    super(message)
    this.name = 'DaemonError'
    this.status = status
    this.code = code
  }
}

let csrf = ''
let sessionPromise: Promise<void> | null = null

export function csrfToken() {
  return csrf
}

async function parseError(response: Response): Promise<DaemonError> {
  const raw = await response.text().catch(() => '')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string; status?: number } }
      if (parsed.error?.message) {
        return new DaemonError(
          parsed.error.message,
          parsed.error.status ?? response.status,
          parsed.error.code ?? 'daemon_error',
        )
      }
    } catch {
      // Fall through to the raw response.
    }
  }
  return new DaemonError(
    raw.trim().slice(0, 400) || `The local daemon returned ${response.status}.`,
    response.status,
    'daemon_error',
  )
}

export async function ensureSession(force = false): Promise<void> {
  if (sessionPromise && !force) return sessionPromise
  sessionPromise = (async () => {
    let response: Response
    try {
      response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      })
    } catch {
      throw new DaemonError(
        'CreateCode’s local daemon is not reachable. Start it with “npm start” in the CreateCode folder, then reload this page.',
        0,
        'daemon_unreachable',
      )
    }
    if (!response.ok) throw await parseError(response)
    const data = (await response.json()) as { csrf?: string }
    csrf = typeof data.csrf === 'string' ? data.csrf : ''
  })().catch((error) => {
    sessionPromise = null
    throw error
  })
  return sessionPromise
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  await ensureSession()
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD'].includes(method)) headers.set('x-createcode-csrf', csrf)
  let response: Response
  try {
    response = await fetch(path, { ...init, method, headers, credentials: 'same-origin' })
  } catch {
    throw new DaemonError(
      'Lost the connection to the local daemon. Check that it is still running.',
      0,
      'daemon_unreachable',
    )
  }
  if (response.status === 401 && retry) {
    await ensureSession(true)
    return api<T>(path, init, false)
  }
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) return (await response.text()) as T
  return (await response.json()) as T
}

function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) }
}

export function getState(): Promise<DaemonSnapshot> {
  return api<DaemonSnapshot>('/api/state')
}

export function getHealth(): Promise<{ ok: boolean; pid: number; port: number; dist: boolean }> {
  return api('/api/health')
}

export function listExtensions(): Promise<ExtensionListing> {
  return api('/api/extensions')
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function installExtensionArchive(
  archive: Uint8Array,
  enable: boolean,
): Promise<{ extension: ExtensionInfo; updated: boolean }> {
  return api('/api/extensions', { method: 'POST', body: JSON.stringify({ archive: bytesToBase64(archive), enable }) })
}

export function createExtension(input: { id: string; name: string; template: string }): Promise<{ extension: ExtensionInfo }> {
  return api('/api/extensions/new', { method: 'POST', body: JSON.stringify(input) })
}

export function setExtensionEnabled(id: string, enabled: boolean): Promise<{ extension: ExtensionInfo }> {
  return api(`/api/extensions/${encodeURIComponent(id)}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) })
}

export function setExtensionTrust(id: string, trust: 'trusted' | 'sandbox', confirm?: string): Promise<{ extension: ExtensionInfo }> {
  return api(`/api/extensions/${encodeURIComponent(id)}/trust`, { method: 'PUT', body: JSON.stringify({ trust, confirm }) })
}

export function reportExtensionAnomaly(id: string, anomaly: { kind: string; level: 'low' | 'medium' | 'high'; message: string }): Promise<{ ok: boolean }> {
  return api(`/api/extensions/${encodeURIComponent(id)}/anomaly`, { method: 'POST', body: JSON.stringify(anomaly) })
}

export function clearExtensionAnomalies(id: string): Promise<{ ok: boolean }> {
  return api(`/api/extensions/${encodeURIComponent(id)}/anomaly`, { method: 'DELETE' })
}

export function removeExtension(id: string, removeData: boolean): Promise<{ id: string; removed: boolean }> {
  return api(`/api/extensions/${encodeURIComponent(id)}${removeData ? '?data=1' : ''}`, { method: 'DELETE' })
}

export function reloadExtensionsOnDisk(id?: string): Promise<ExtensionListing> {
  return api(id ? `/api/extensions/${encodeURIComponent(id)}/reload` : '/api/extensions/reload', { method: 'POST', body: '{}' })
}

export async function exportExtension(id: string): Promise<Uint8Array> {
  const result = await api<{ archive: string }>(`/api/extensions/${encodeURIComponent(id)}/export`)
  return base64ToBytes(result.archive)
}

export function extensionLogs(id: string): Promise<{ logs: Array<{ at: number; level: string; text: string }> }> {
  return api(`/api/extensions/${encodeURIComponent(id)}/logs`)
}

export function getExtensionStorage(id: string): Promise<{ value: Record<string, unknown> }> {
  return api(`/api/extensions/${encodeURIComponent(id)}/storage`)
}

export function setExtensionStorage(id: string, value: Record<string, unknown>): Promise<{ value: Record<string, unknown> }> {
  return api(`/api/extensions/${encodeURIComponent(id)}/storage`, { method: 'PUT', body: JSON.stringify({ value }) })
}

export function callExtensionRpc<T = unknown>(id: string, name: string, args?: unknown): Promise<T> {
  return api<{ result: T }>(`/api/extensions/${encodeURIComponent(id)}/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify({ args }),
  }).then((response) => response.result)
}

export function restartDaemon(): Promise<{ ok: boolean }> {
  return api('/api/extensions/restart', { method: 'POST', body: '{}' })
}

export function extensionProxy(request: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  bodyBase64?: string
  timeoutMs?: number
}): Promise<{ status: number; statusText: string; url: string; headers: Record<string, string>; contentType: string; bodyBase64: string }> {
  return api('/api/extensions/proxy', { method: 'POST', body: JSON.stringify(request) })
}

export function patchSettings(patch: Partial<AppSettings>): Promise<{ settings: AppSettings }> {
  return api('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) })
}

export function saveChats(chats: { sessions: ChatSession[]; activeId: string | null }) {
  return api<{ sessions: number; activeId: string | null }>('/api/chats', {
    method: 'PUT',
    body: JSON.stringify(chats),
  })
}

export function migrateLegacy(payload: { settings?: unknown; chats?: unknown }) {
  return api<{
    migratedSettings: boolean
    migratedChats: number
    migratedSecrets: boolean
    state: DaemonSnapshot
  }>('/api/migrate', jsonBody(payload))
}

export function listProviders(): Promise<{ providers: ProviderStatus[] }> {
  return api('/api/providers')
}

export function fetchModels(provider: ProviderId) {
  return api<{
    provider: ProviderId
    models: ModelInfo[]
    source: 'live' | 'catalog'
    fetchedAt: number
    note: string
    catalogError: string
  }>(`/api/models?provider=${encodeURIComponent(provider)}`)
}

export function setProviderKey(provider: ProviderId, apiKey: string) {
  if (!apiKey) return api<{ configured: boolean; hint: string }>(`/api/providers/${provider}/key`, { method: 'DELETE' })
  return api<{ configured: boolean; hint: string }>(`/api/providers/${provider}/key`, {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  })
}

export function setSearchKey(apiKey: string) {
  return api<{ configured: boolean; hint: string }>('/api/search/key', {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  })
}

export function setDeployCredentials(provider: DeployProviderId, fields: Record<string, string>) {
  return api(`/api/deploy/credentials/${provider}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
}

export function resetScope(scope: 'history' | 'secrets' | 'settings' | 'all'): Promise<DaemonSnapshot> {
  return api('/api/reset', jsonBody({ scope }))
}

export function addWorkspace(path: string): Promise<{ workspace: WorkspaceInfo; entry: { path: string; name: string } }> {
  return api('/api/workspaces', jsonBody({ path }))
}

export function forgetWorkspace(): Promise<WorkspaceInfo> {
  return api('/api/workspaces', { method: 'DELETE' })
}

/** Remove one folder from the saved list. The folder stays on disk. */
export function removeWorkspaceFromList(path: string): Promise<WorkspaceInfo> {
  return api(`/api/workspaces?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
}

export type { McpServerInput } from './mcp-config'
import type { McpServerInput } from './mcp-config'

export function mcpList(): Promise<{ servers: McpServer[] }> {
  return api('/api/mcp')
}

export function mcpSave(servers: McpServerInput[]): Promise<{ servers: McpServer[] }> {
  return api('/api/mcp', { method: 'PUT', body: JSON.stringify({ servers }) })
}

export function mcpAction(id: string, action: 'connect' | 'disconnect' | 'refresh'): Promise<{ servers: McpServer[] }> {
  return api(`/api/mcp/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' })
}

export function mcpAuthorize(id: string): Promise<{ url: string }> {
  return api(`/api/mcp/${encodeURIComponent(id)}/authorize`, { method: 'POST', body: '{}' })
}

export function mcpLogout(id: string): Promise<{ servers: McpServer[] }> {
  return api(`/api/mcp/${encodeURIComponent(id)}/logout`, { method: 'POST', body: '{}' })
}

/** Sent with a tool result when the call opened (or closed) tools on its server. */
export interface McpToolsChanged {
  added: string[]
  removed: string[]
  server: McpServer
}

export function mcpCall(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ result: { text: string; isError: boolean; media?: Array<{ kind: 'image' | 'audio' | 'document'; mimeType: string; data: string; name?: string }> }; toolsChanged?: McpToolsChanged }> {
  return api('/api/mcp/call', { method: 'POST', body: JSON.stringify({ server, tool, args }), signal })
}

export function browseFolders(path: string) {
  return api<{ path: string; parent: string; home: string; entries: Array<{ name: string; path: string }> }>(
    `/api/workspaces/browse?path=${encodeURIComponent(path)}`,
  )
}

export function getWorkspaceTree(path = '', depth = 6) {
  return api<{
    root: string
    path: string
    entries: Array<{ name: string; path: string; type: 'file' | 'dir' | 'link'; size: number; mtime: number }>
    truncated: boolean
    workspace: WorkspaceInfo
  }>(`/api/workspace/tree?depth=${depth}&path=${encodeURIComponent(path)}`)
}

export function readWorkspaceFile(path: string): Promise<WorkspaceFile> {
  return api(`/api/workspace/file?path=${encodeURIComponent(path)}`)
}

export function writeWorkspaceFile(path: string, content: string) {
  return api<{ path: string; size: number; mtime: number; created: boolean; hash: string }>(
    '/api/workspace/file',
    { method: 'PUT', body: JSON.stringify({ path, content }) },
  )
}

export function createWorkspaceEntry(path: string, type: 'file' | 'dir') {
  return api<{ path: string; type: 'file' | 'dir' }>('/api/workspace/file', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', path, type }),
  })
}

export function renameWorkspaceEntry(from: string, to: string) {
  return api<{ from: string; to: string }>('/api/workspace/file', {
    method: 'POST',
    body: JSON.stringify({ action: 'rename', from, to }),
  })
}

export function deleteWorkspaceEntry(path: string) {
  return api<{ path: string; type: 'file' | 'dir' }>('/api/workspace/file', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', path }),
  })
}

export function gitSummary() {
  return api<{
    available: boolean
    root: string
    branch: string
    entries: Array<{ status: string; path: string }>
    error: string
  }>('/api/git')
}

export interface DaemonToolResult {
  name: string
  result: unknown
}

export function executeDaemonTool(
  name: string,
  args: Record<string, unknown>,
  mode: AgentMode,
  signal?: AbortSignal,
  /** Groups file edits of one turn so they can be undone together. */
  checkpoint?: string,
) {
  return api<DaemonToolResult>(
    '/api/tools/execute',
    { ...jsonBody({ name, args, mode, checkpoint }), signal },
  )
}

export function getPreviewToken() {
  return api<{ token: string }>('/api/preview/token')
}

export function getProjectInstructions() {
  return api<{ file: string; content: string; truncated: boolean }>('/api/workspace/instructions')
}

export interface CheckpointSummary {
  id: string
  createdAt: number
  files: Array<{ path: string; existed: boolean; skipped: boolean }>
}

export function getCheckpoint(id: string) {
  return api<CheckpointSummary>(`/api/checkpoints/${encodeURIComponent(id)}`)
}

export function restoreCheckpoint(id: string) {
  return api<{ id: string; restored: string[]; removed: string[]; skipped: string[] }>(
    `/api/checkpoints/${encodeURIComponent(id)}/restore`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export function runGit(action: string, args: Record<string, unknown> = {}, mode: AgentMode = 'build') {
  return api<Record<string, unknown>>('/api/git', jsonBody({ action, args, mode }))
}

export async function requestLLM(
  provider: ProviderId,
  kind: string,
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  retry = true,
): Promise<Response> {
  await ensureSession()
  let response: Response
  try {
    response = await fetch('/api/llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-createcode-csrf': csrf,
      },
      body: JSON.stringify({ provider, kind, model, body }),
      signal,
      credentials: 'same-origin',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new DaemonError('Lost the connection to the local daemon while calling the model.', 0, 'daemon_unreachable')
  }
  // The daemon forgets sessions when it restarts; get a fresh one and retry once.
  if (response.status === 401 && retry) {
    await ensureSession(true)
    return requestLLM(provider, kind, model, body, signal, false)
  }
  if (!response.ok) throw await parseError(response)
  return response
}

export async function* streamDeploy(
  request: DeployRequest,
  signal?: AbortSignal,
): AsyncGenerator<DeployEvent> {
  await ensureSession()
  let response: Response
  try {
    response = await fetch('/api/deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-createcode-csrf': csrf,
      },
      body: JSON.stringify(request),
      signal,
      credentials: 'same-origin',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new DaemonError('Lost the connection to the local daemon while deploying.', 0, 'daemon_unreachable')
  }
  if (!response.ok) throw await parseError(response)
  if (!response.body) throw new DaemonError('The deploy stream was empty.', 502, 'empty_stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) {
          try {
            yield JSON.parse(line) as DeployEvent
          } catch {
            yield { type: 'log', stream: 'meta', text: line }
          }
        }
        index = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail) {
      try {
        yield JSON.parse(tail) as DeployEvent
      } catch {
        yield { type: 'log', stream: 'meta', text: tail }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export type { DeployResult, SecretsSummary }

export interface SkillUploadFile {
  path: string
  /** base64 */
  data: string
}

export function listSkillsApi(): Promise<{ skills: InstalledSkill[] }> {
  return api('/api/skills')
}

export function uploadSkillFiles(files: SkillUploadFile[]): Promise<{ installed: string[]; skills: InstalledSkill[] }> {
  return api('/api/skills/upload', jsonBody({ files }))
}

export function installSkillNpm(spec: string): Promise<{ installed: string[]; skills: InstalledSkill[] }> {
  return api('/api/skills/npm', jsonBody({ spec }))
}

export function setSkillEnabledApi(name: string, enabled: boolean): Promise<{ skills: InstalledSkill[] }> {
  return api(`/api/skills/${encodeURIComponent(name)}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) })
}

export function removeSkillApi(name: string): Promise<{ skills: InstalledSkill[] }> {
  return api(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export function readSkillApi(
  name: string,
  file?: string,
): Promise<{ name: string; file: string; directory: string; content: string; files?: string[] }> {
  return api('/api/skills/read', jsonBody({ name, file }))
}

export async function detectDeployProject(path: string): Promise<DeployDetection> {
  const result = await api<{ project: DeployDetection }>('/api/deploy/detect', jsonBody({ path }))
  return result.project
}

export type TerminalEvent =
  | { type: 'out'; data: string }
  | { type: 'exit'; code: number; cwd: string; killed?: boolean }
  | { type: 'error'; message: string }

/** Runs one command in the built-in terminal and yields its output as it arrives. */
export async function* streamTerminal(
  command: string,
  cwd: string,
  signal?: AbortSignal,
): AsyncGenerator<TerminalEvent> {
  await ensureSession()
  let response: Response
  try {
    response = await fetch('/api/terminal/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-createcode-csrf': csrf },
      body: JSON.stringify({ command, cwd }),
      signal,
      credentials: 'same-origin',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new DaemonError('Lost the connection to the local daemon.', 0, 'daemon_unreachable')
  }
  if (!response.ok) throw await parseError(response)
  if (!response.body) throw new DaemonError('The terminal stream was empty.', 502, 'empty_stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) {
          try {
            yield JSON.parse(line) as TerminalEvent
          } catch {
            yield { type: 'out', data: `${line}\n` }
          }
        }
        index = buffer.indexOf('\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}
