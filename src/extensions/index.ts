import { listExtensions } from '../lib/daemon'
import { pageSignature, useExtensions } from '../store/extensions'
import { onExtensionsChanged, startExtensionEvents } from './events'
import { installGlobal, syncRuntime } from './runtime'

let servedWith: string | null = null
let started = false
let refreshing: Promise<void> | null = null

/** Reads the extension list from the daemon and brings the window in line with it. */
export function refreshExtensions(): Promise<void> {
  refreshing ??= (async () => {
    const store = useExtensions.getState()
    store.setLoading(true)
    try {
      const listing = await listExtensions()
      installGlobal(listing.appVersion)
      const signature = pageSignature(listing.extensions)
      // What the page was served with is whatever was enabled the first time we looked.
      servedWith ??= signature
      useExtensions.getState().setListing(listing)
      useExtensions.getState().setReloadNeeded(signature !== servedWith)
      await syncRuntime(listing.extensions, listing.appVersion)
    } catch (error) {
      useExtensions.getState().setLoading(false, error instanceof Error ? error.message : 'Could not load extensions.')
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** Called once the daemon answered. Keeps the window in sync with changes made anywhere (UI, CLI, file edits). */
export function startExtensions(): void {
  if (started) return
  started = true
  startExtensionEvents()
  let timer: number | undefined
  onExtensionsChanged(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void refreshExtensions(), 150)
  })
  void refreshExtensions()
}

export { useUiRegistry } from './registry'
