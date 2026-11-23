import { create } from 'zustand'
import type { ExtensionInfo, ExtensionListing } from '../extensions/types'

export type RuntimeState = 'loading' | 'active' | 'error'

interface ExtensionsState {
  listing: ExtensionListing | null
  loading: boolean
  error: string
  /** State of the window part of each extension. */
  runtime: Record<string, { state: RuntimeState; error?: string }>
  /** The page must reload: CSP mode or web patches differ from what this page was served with. */
  reloadNeeded: boolean
  setListing: (listing: ExtensionListing) => void
  setLoading: (loading: boolean, error?: string) => void
  setRuntime: (id: string, state: RuntimeState | null, error?: string) => void
  setReloadNeeded: (needed: boolean) => void
}

export const useExtensions = create<ExtensionsState>()((set) => ({
  listing: null,
  loading: false,
  error: '',
  runtime: {},
  reloadNeeded: false,
  setListing: (listing) => set({ listing, loading: false, error: '' }),
  setLoading: (loading, error = '') => set({ loading, error }),
  setRuntime: (id, state, error) =>
    set((current) => {
      const runtime = { ...current.runtime }
      if (state === null) delete runtime[id]
      else runtime[id] = { state, error }
      return { runtime }
    }),
  setReloadNeeded: (reloadNeeded) => set({ reloadNeeded }),
}))

/** What the page was served with: enabling the first extension changes the CSP; web patches need a fresh load. */
export function pageSignature(extensions: ExtensionInfo[]): string {
  const enabled = extensions.filter((item) => item.enabled)
  if (enabled.length === 0) return 'none'
  return `on:${enabled
    .filter((item) => item.patches.some((patch) => patch.scope === 'web'))
    .map((item) => `${item.id}@${item.hash}`)
    .join(',')}`
}
