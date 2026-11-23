import { FolderOpen, Menu, Moon, PanelLeft, Rocket, Search, Settings, SquarePen, SquareTerminal, Sun } from 'lucide-react'
import type { ChatSession } from '../types'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { useChats } from '../store/chats'
import { useWorkspace } from '../store/workspace'
import { useActiveModel } from '../store/models'
import { themeIsDark } from '../lib/themes'
import { ContextBar } from './ContextBar'
import { SystemPromptButton } from './SystemPromptButton'
import { Segmented } from './ui'
import { ExtensionTopActions } from './ExtensionDock'

export type ChatViewMode = 'chat' | 'trajectory'

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The window headerbar: solid, full width, 48px. Left: sidebar toggle. Center: title. Right: actions. */
export function TopBar({
  session,
  view,
  onViewChange,
}: {
  session: ChatSession | null
  view: ChatViewMode
  onViewChange: (view: ChatViewMode) => void
}) {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const toggleSidebar = useUi((state) => state.toggleSidebar)
  const mobileOpen = useUi((state) => state.mobileSidebarOpen)
  const setMobileOpen = useUi((state) => state.setMobileSidebarOpen)
  const setPaletteOpen = useUi((state) => state.setPaletteOpen)
  const openSettings = useUi((state) => state.openSettings)
  const workspaceOpen = useUi((state) => state.workspaceOpen)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const terminalOpen = useUi((state) => state.terminalOpen)
  const setTerminalOpen = useUi((state) => state.setTerminalOpen)
  const workspace = useWorkspace((state) => state.info)
  const activeModel = useActiveModel()
  const newChat = useChats((state) => state.newChat)
  const focusComposer = useUi((state) => state.focusComposer)

  // Go through the theme registry so every dark variant and extension theme counts as dark.
  const isDark = themeIsDark(
    settings.theme,
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const hasConversation = Boolean(session && session.messages.length > 0)
  const turns = session?.messages.filter((message) => message.role === 'user').length ?? 0
  const subtitle = [
    workspace.available ? workspace.name : null,
    hasConversation ? (settings.mode === 'plan' ? 'Plan mode' : 'Build mode') : null,
    hasConversation ? `${turns} turn${turns === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <header className="adw-headerbar">
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className="adw-icon-btn lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
        >
          <Menu size={16} />
        </button>
        <button
          type="button"
          className="adw-icon-btn hidden lg:inline-flex"
          onClick={toggleSidebar}
          title={`${sidebarCollapsed ? 'Show' : 'Hide'} sidebar (${isApple ? '⌘' : 'Ctrl'} B)`}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={!sidebarCollapsed}
        >
          <PanelLeft size={16} />
        </button>
        <button
          type="button"
          className="adw-icon-btn"
          onClick={() => {
            newChat()
            focusComposer()
          }}
          title="New chat"
          aria-label="New chat"
        >
          <SquarePen size={16} />
        </button>
      </div>

      <div className="min-w-0 flex-1 px-2 text-center">
        <h1 className="adw-headerbar-title">{session?.title ?? 'New conversation'}</h1>
        {subtitle && <p className="adw-headerbar-subtitle hidden sm:block">{subtitle}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {hasConversation && (
          <div className="mr-2 hidden md:block">
            <ContextBar messages={session?.messages ?? []} model={activeModel} sessionId={session?.id ?? null} />
          </div>
        )}
        {hasConversation && (
          <Segmented
            className="mr-1 hidden md:inline-flex"
            value={view}
            onChange={onViewChange}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'trajectory', label: 'Trajectory' },
            ]}
          />
        )}
        <button
          type="button"
          onClick={() => setWorkspaceOpen(!workspaceOpen)}
          title={workspace.available ? workspace.root : 'Choose a workspace folder'}
          aria-pressed={workspaceOpen}
          aria-label="Toggle workspace pane"
          className="adw-icon-btn"
        >
          <FolderOpen size={16} />
        </button>
        <ExtensionTopActions />
        <SystemPromptButton session={session} />
        <button
          type="button"
          className="adw-icon-btn"
          onClick={() => setTerminalOpen(!terminalOpen)}
          title={`Terminal (${isApple ? '⌘' : 'Ctrl'} \`)`}
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
        >
          <SquareTerminal size={16} className={terminalOpen ? 'text-accent' : undefined} />
        </button>
        <button
          type="button"
          className="adw-icon-btn hidden sm:inline-flex"
          onClick={() => setDeployOpen(true)}
          title="Deploy the open workspace or another project"
          aria-label="Deploy"
        >
          <Rocket size={16} />
        </button>
        <button
          type="button"
          className="adw-icon-btn"
          onClick={() => setPaletteOpen(true)}
          title={`Search and commands (${isApple ? '⌘' : 'Ctrl'} K)`}
          aria-label="Open search and commands"
        >
          <Search size={16} />
        </button>
        <button
          type="button"
          className="theme-toggle adw-icon-btn hidden sm:inline-flex"
          onClick={() => update({ theme: isDark ? 'light' : 'lunar' })}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          className="adw-icon-btn"
          onClick={() => openSettings('general')}
          title={`Settings (${isApple ? '⌘' : 'Ctrl'} ,)`}
          aria-label="Open settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
