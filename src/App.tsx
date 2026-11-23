import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TopBar, type ChatViewMode } from './components/TopBar'
import { ChatView } from './components/ChatView'
import { WorkspacePanel } from './components/WorkspacePanel'
import { SettingsModal } from './components/SettingsModal'
import { DeployModal } from './components/DeployModal'
import { McpPanel } from './components/McpPanel'
import { ExtensionsPanel } from './components/ExtensionsPanel'
import { ExtensionPanelDock } from './components/ExtensionDock'
import { TerminalPanel } from './components/TerminalPanel'
import { CommandPalette } from './components/CommandPalette'
import { Splash } from './components/Splash'
import { ConfirmDialog, ToastHost } from './components/ui'
import { useSettings } from './store/settings'
import { useModelSync } from './store/models'
import { useUi } from './store/ui'
import { useChats } from './store/chats'
import { useBoot } from './lib/boot'
import { resolveTheme, themeIsDark } from './lib/themes'
import { startExtensions } from './extensions'

const MIN_SPLASH_MS = 2600

export default function App() {
  const phase = useBoot((state) => state.phase)
  const error = useBoot((state) => state.error)
  const boot = useBoot((state) => state.boot)
  const theme = useSettings((state) => state.theme)
  const uiStyle = useSettings((state) => state.uiStyle)
  const chatFontSize = useSettings((state) => state.chatFontSize)
  const mobileSidebarOpen = useUi((state) => state.mobileSidebarOpen)
  const setMobileSidebarOpen = useUi((state) => state.setMobileSidebarOpen)
  const setPaletteOpen = useUi((state) => state.setPaletteOpen)

  const activeId = useChats((state) => state.activeId)
  const session = useChats((state) => state.sessions.find((item) => item.id === state.activeId) ?? null)
  const [view, setView] = useState<ChatViewMode>('chat')
  useEffect(() => setView('chat'), [activeId])

  useModelSync()

  // Keep the splash up briefly so it never flashes, then fade it out over the app instead of cutting.
  const [splash, setSplash] = useState<'show' | 'leaving' | 'gone'>('show')
  useEffect(() => {
    if (phase !== 'ready' || splash !== 'show') return
    const started = useBoot.getState().startedAt || Date.now()
    const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - started))
    const t1 = window.setTimeout(() => setSplash('leaving'), wait)
    return () => window.clearTimeout(t1)
  }, [phase, splash])
  useEffect(() => {
    if (splash !== 'leaving') return
    const t2 = window.setTimeout(() => setSplash('gone'), 520)
    return () => window.clearTimeout(t2)
  }, [splash])

  useEffect(() => {
    void boot()
  }, [boot])

  // Enabled extensions are loaded once the app knows the daemon answered, and follow every later change.
  useEffect(() => {
    if (phase !== 'ready') return
    startExtensions()
  }, [phase])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = resolveTheme(theme, media.matches)
      root.dataset.theme = resolved
      root.classList.toggle('dark', themeIsDark(theme, media.matches))
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', themeIsDark(theme, media.matches) ? '#121215' : '#e8eaf1')
      try {
        localStorage.setItem('opensol.theme', theme)
      } catch {
        // Storage can be unavailable in private mode; the theme still applies.
      }
    }
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    if (uiStyle === 'glass') root.dataset.style = 'glass'
    else delete root.dataset.style
    try {
      localStorage.setItem('lunarcode.style', uiStyle)
    } catch {
      // Storage can be unavailable; the style still applies for this session.
    }
  }, [uiStyle])

  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-size', `${chatFontSize}px`)
  }, [chatFontSize])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === 'k') {
        event.preventDefault()
        setPaletteOpen(!useUi.getState().paletteOpen)
        return
      }
      if (mod && !event.shiftKey && !event.altKey) {
        if (key === 'b') {
          event.preventDefault()
          useUi.getState().toggleSidebar()
          return
        }
        if (key === ',') {
          event.preventDefault()
          useUi.getState().openSettings('general')
          return
        }
        if (key === '`' || key === 'j') {
          event.preventDefault()
          const ui = useUi.getState()
          ui.setTerminalOpen(!ui.terminalOpen)
          return
        }
        if (key === '.') {
          event.preventDefault()
          const ui = useUi.getState()
          ui.setWorkspaceOpen(!ui.workspaceOpen)
          return
        }
      }
      if (event.key === 'Escape' && useUi.getState().mobileSidebarOpen) {
        setMobileSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setMobileSidebarOpen, setPaletteOpen])

  const ready = phase === 'ready'

  return (
    <div className="adw-window">
      {ready && (
        <>
          <TopBar session={session} view={view} onViewChange={setView} />
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <Sidebar />
            {mobileSidebarOpen && (
              <button
                type="button"
                aria-label="Close sidebar"
                onClick={() => setMobileSidebarOpen(false)}
                className="adw-scrim z-40 cursor-default lg:hidden"
              />
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <main className="relative flex min-h-0 min-w-0 flex-1 bg-panel">
                <ChatView view={view} onViewChange={setView} />
                <WorkspacePanel />
                <ExtensionPanelDock />
              </main>
              <TerminalPanel />
            </div>
          </div>
          <SettingsModal />
          <McpPanel />
          <ExtensionsPanel />
          <DeployModal />
          <CommandPalette />
          <ConfirmDialog />
        </>
      )}
      <ToastHost />
      {splash !== 'gone' && (
        <Splash phase={phase} error={error} leaving={splash === 'leaving'} onRetry={() => void boot(true)} />
      )}
    </div>
  )
}
