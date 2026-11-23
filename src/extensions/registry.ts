import { useSyncExternalStore } from 'react'
import { kernel } from '../core/kernel'
import type { UiSnapshot } from '../core/services/ui'

/** React view of everything extensions added to the interface (commands, panels, actions, settings, themes). */
export function useUiRegistry(): UiSnapshot {
  return useSyncExternalStore(kernel.ui.subscribe, kernel.ui.snapshot, kernel.ui.snapshot)
}
