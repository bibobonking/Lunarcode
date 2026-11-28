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
  server: { state: 'off' | 'stopped' | 'starting' | 'running' | 'error'; error: string | null; routes: number; rpcs: string[] } | null
}

export interface ExtensionListing {
  extensions: ExtensionInfo[]
  dir: string
  appVersion: string
  serverPatchesSupported: boolean
  serverPatchesPreloaded: boolean
  restartRequired: boolean
}
