export interface ExtensionPatchInfo {
  scope: 'web' | 'server'
  target: string
  note: string
  /** null = not evaluated yet (a server patch applies when its module loads). */
  applied: boolean | null
  matches: number
  error: string | null
}

export interface ExtensionThemeSpec {
  id: string
  label: string
  dark: boolean
  tokens?: Record<string, string>
  css?: string
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high'

export interface ExtensionFinding {
  id: string
  level: Exclude<RiskLevel, 'none'>
  message: string
  file: string
  line: number
  snippet: string
}

export interface ExtensionAnomaly {
  at: number
  kind: string
  level: 'low' | 'medium' | 'high'
  message: string
  count: number
}

/** `sandbox`: isolated window code only. `trusted`: the person lifted the sandbox; full access. */
export type ExtensionTrust = 'sandbox' | 'trusted'

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  author: string
  homepage: string
  license: string
  engine: string
  hasIcon: boolean
  enabled: boolean
  trust: ExtensionTrust
  /** Set when an update sent a Trusted extension back to the sandbox. */
  trustRevoked: 'updated' | null
  risk: { level: RiskLevel; findings: ExtensionFinding[] }
  anomalies: ExtensionAnomaly[]
  source: 'cce' | 'folder' | string
  installedAt: string | null
  dir: string
  dataDir: string
  /** Changes whenever a file of the extension changes; the window reloads the extension when it does. */
  hash: string
  summary: {
    renderer: boolean
    server: boolean
    styles: number
    themes: number
    webPatches: number
    serverPatches: number
  } | null
  error: string | null
  main: string | null
  styles: string[]
  themes: ExtensionThemeSpec[]
  patches: ExtensionPatchInfo[]
  server: { state: 'off' | 'sandboxed' | 'stopped' | 'starting' | 'running' | 'error'; error: string | null; routes: number; rpcs: string[] } | null
}

export interface ExtensionListing {
  extensions: ExtensionInfo[]
  dir: string
  appVersion: string
  serverPatchesSupported: boolean
  serverPatchesPreloaded: boolean
  restartRequired: boolean
}
