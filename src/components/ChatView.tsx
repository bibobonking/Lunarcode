import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bug, ChevronRight, Gamepad2, KeyRound, LayoutTemplate } from 'lucide-react'
import type { Attachment } from '../types'
import { createId, useChats } from '../store/chats'
import { activeModelId, hasCredentials, useSettings } from '../store/settings'
import { useActiveModel } from '../store/models'
import { useRuntime, useUi } from '../store/ui'
import { getProviderName } from '../data/providers'
import { stopRun, runAgent } from '../agent'
import { kernel } from '../core/kernel'
import { getContextUsage } from '../lib/context'
import { formatTokens } from '../lib/usage'
import { groupConversationTurns } from '../lib/conversation'
import type { ChatViewMode } from './TopBar'
import { Composer } from './Composer'
import { TurnBlock } from './MessageItem'
import { HomeDashboard, HomeGreeting } from './HomeDashboard'
import { TrajectoryView } from './TrajectoryView'
import { BoxedList, ListRow, PageGroup } from './ui'

const STARTERS = [
  {
    icon: Gamepad2,
    label: 'Build a game',
    prompt:
      'Build a small browser game as one self-contained index.html (canvas, no build step). Make it playable with keyboard and touch, with a score and a restart button. Put the whole file in a single html code block so I can preview it.',
  },
  {
    icon: LayoutTemplate,
    label: 'Design a landing page',
    prompt:
      'Design a polished, responsive landing page for a small indie game studio. Choose a distinctive typographic style, keep it to one file, and put everything in a single html code block so I can preview it.',
  },
  {
    icon: Bug,
    label: 'Trace a bug',
    prompt:
      'Inspect this workspace for a real bug. Explain the root cause, make the smallest correct fix, and run the project checks.',
  },
]

export function ChatView({ view, onViewChange }: { view: ChatViewMode; onViewChange: (view: ChatViewMode) => void }) {
  const sessions = useChats((state) => state.sessions)
  const activeId = useChats((state) => state.activeId)
  const session = sessions.find((item) => item.id === activeId) ?? null
  const streaming = useRuntime((state) => (activeId ? Boolean(state.streaming[activeId]) : false))
  const settings = useSettings()
  const setMode = useSettings((state) => state.setMode)
  const update = useSettings((state) => state.update)
  const notify = useUi((state) => state.notify)
  const openSettings = useUi((state) => state.openSettings)
  const focusComposer = useUi((state) => state.focusComposer)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const askConfirm = useUi((state) => state.askConfirm)
  const activeModel = useActiveModel()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const lastSessionRef = useRef<string | null>(activeId)
  const lastMessageIdRef = useRef<string | null>(null)

  const messages = session?.messages ?? []
  const lastMessage = messages[messages.length - 1]
  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id
  const connected = hasCredentials(settings)
  const selectedModel = activeModelId(settings)
  const turns = groupConversationTurns(messages)
  const context = getContextUsage(messages, activeModel)
  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior })
  }

  useEffect(() => {
    if (lastSessionRef.current !== activeId) {
      lastSessionRef.current = activeId
      setAtBottom(true)
      onViewChange('chat')
      requestAnimationFrame(() => scrollToBottom('auto'))
      const current = useChats.getState().sessions.find((item) => item.id === activeId)
      if (current?.mode) setMode(current.mode)
    }
  }, [activeId, setMode])

  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessage.id
      if (lastMessage.role === 'user') {
        setAtBottom(true)
        requestAnimationFrame(() => scrollToBottom('auto'))
      } else if (atBottom) {
        requestAnimationFrame(() => scrollToBottom('auto'))
      }
    } else if (atBottom) {
      scrollToBottom('auto')
    }
  }, [lastMessage, atBottom])

  useEffect(() => {
    if (!atBottom) return
    const timer = window.setTimeout(() => scrollToBottom('auto'), 40)
    return () => window.clearTimeout(timer)
  }, [messages, atBottom])

  const send = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    const current = useSettings.getState()
    if (!hasCredentials(current)) {
      notify(
        current.provider === 'custom'
          ? 'Add a base URL for your custom endpoint in Settings → Models.'
          : `Add an API key for ${getProviderName(current.provider)} in Settings → Models.`,
        'error',
      )
      openSettings('models')
      return false
    }
    const modelId = activeModelId(current)
    if (!modelId) {
      notify('Choose a model before sending a message.', 'error')
      openSettings('models')
      return false
    }

    let sessionId = activeId
    if (!sessionId || !useChats.getState().sessions.some((item) => item.id === sessionId)) {
      sessionId = useChats.getState().createSession(current.provider, modelId, current.mode)
    }
    const content = text.trim()
    const userMessageId = createId('msg')
    useChats.getState().addMessage(sessionId, {
      id: userMessageId,
      role: 'user',
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: Date.now(),
    })
    useChats.getState().updateSession(sessionId, { mode: current.mode })
    setDraft('')
    setAtBottom(true)
    runAgent(sessionId, userMessageId)
    return true
  }

  const useStarter = (prompt: string) => {
    setDraft(prompt)
    focusComposer()
  }

  const handleCommand = async (command: string, args: string): Promise<boolean> => {
    switch (command) {
      case 'search': {
        if (!args.trim()) {
          setDraft('/search ')
          notify('Type what you want Lunarcode to research.', 'info')
          focusComposer()
          return false
        }
        update({ webSearchEnabled: true })
        return send(
          `Use the web to research this: ${args.trim()}\n\nRead the most useful sources, cite the URLs you actually opened, and answer for this workspace.`,
          [],
        )
      }
      case 'plan': {
        setMode('plan')
        if (!args.trim()) {
          notify('Plan mode is on: investigation only until you switch to Build.', 'info')
          focusComposer()
          return true
        }
        return send(args.trim(), [])
      }
      case 'build': {
        setMode('build')
        if (!args.trim()) {
          notify('Build mode is on: Lunarcode can edit files and run commands.', 'info')
          focusComposer()
          return true
        }
        return send(args.trim(), [])
      }
      case 'new': {
        useChats.getState().newChat()
        focusComposer()
        return true
      }
      case 'workspace': {
        setWorkspaceOpen(true)
        return true
      }
      case 'deploy': {
        setDeployOpen(true)
        return true
      }
      case 'settings': {
        openSettings('models')
        return true
      }
      case 'compact': {
        const current = useChats.getState().sessions.find((item) => item.id === activeId)
        if (!current || current.messages.length < 4) {
          notify('There is not enough conversation to compact yet.', 'info')
          return true
        }
        if (streaming) {
          notify('Wait for the current answer to finish, then run /compact.', 'info')
          return true
        }
        await kernel.compaction.compact(current.id, { focus: args.trim() || undefined, manual: true })
        return true
      }
      case 'clear': {
        const current = useChats.getState().sessions.find((item) => item.id === activeId)
        if (!current || current.messages.length === 0) return true
        const confirmed = await askConfirm({
          title: 'Clear this conversation?',
          body: 'The messages in this conversation will be removed from your local history. The workspace files are not touched.',
          confirmLabel: 'Clear conversation',
          tone: 'danger',
        })
        if (!confirmed) return true
        stopRun(current.id)
        useChats.getState().updateSession(current.id, { messages: [] })
        useChats.getState().updateSession(current.id, { title: 'New conversation' })
        notify('Conversation cleared.', 'success')
        return true
      }
      default:
        return false
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      {!session || messages.length === 0 ? (
        <div className="thin-scroll lunar-aurora min-h-0 flex-1 overflow-y-auto">
          <div className="welcome-stagger mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center gap-6 px-4 py-8 sm:px-6">
            <HomeGreeting />

            <div className="w-full space-y-3">
              {(!connected || !selectedModel) && (
                <BoxedList>
                  <ListRow
                    icon={<KeyRound size={16} />}
                    title={connected ? 'Choose a model to start' : 'Connect a provider to start'}
                    subtitle="Open settings"
                    trailing={<ChevronRight size={16} />}
                    onClick={() => openSettings('models')}
                  />
                </BoxedList>
              )}
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={send}
                onStop={() => undefined}
                onCommand={handleCommand}
                streaming={false}
                hints
                autoFocus
                placeholder={connected ? 'How can I help you today?' : 'Add a provider key to start'}
              />
            </div>

            <PageGroup title="Get started">
              <div className="grid gap-2 sm:grid-cols-3">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.label}
                    type="button"
                    onClick={() => useStarter(starter.prompt)}
                    className="lift-card group/start flex items-center gap-2.5 rounded-[10px] border border-line bg-card px-3 py-2.5 text-left"
                  >
                    <span className="tool-icon h-7 w-7" aria-hidden="true">
                      <starter.icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{starter.label}</span>
                    <ChevronRight size={14} className="shrink-0 text-faint transition-transform duration-200 group-hover/start:translate-x-0.5 group-hover/start:text-accent" />
                  </button>
                ))}
              </div>
            </PageGroup>

            <HomeDashboard />
          </div>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            {view === 'trajectory' ? (
              <TrajectoryView session={session} />
            ) : (
              <>
                <div
                  ref={scrollRef}
                  onScroll={(event) => {
                    const node = event.currentTarget
                    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
                    setAtBottom(distance < 90)
                  }}
                  className="thin-scroll h-full overflow-y-auto"
                >
                  <div className="mx-auto w-full max-w-[780px] px-4 pb-10 pt-6 sm:px-6">
                    {turns.map((turn, index) => (
                      <div key={turn.id} className={index === 0 ? 'turn-in' : 'turn-in mt-8'}>
                        <TurnBlock
                          turn={turn}
                          sessionId={session.id}
                          streaming={streaming}
                          lastAssistantId={lastAssistantId}
                          activeTurn={streaming && index === turns.length - 1}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {!atBottom && (
                  <button
                    type="button"
                    onClick={() => {
                      setAtBottom(true)
                      scrollToBottom('smooth')
                    }}
                    className="adw-btn jump-in absolute bottom-4 left-1/2 -translate-x-1/2 border border-line bg-panel shadow-popover hover:bg-raised"
                  >
                    <ArrowUp size={16} />
                    Jump to latest
                  </button>
                )}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-line bg-panel px-4 pb-3 pt-3 sm:px-6">
            <div className="mx-auto w-full max-w-[780px]">
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={send}
                onStop={() => session && stopRun(session.id)}
                onCommand={handleCommand}
                streaming={streaming}
                placeholder={connected ? 'How can I help you today?' : 'Add a provider key to start'}
                contextPct={context.pct}
                contextTitle={`Context: ~${formatTokens(context.used)} / ${formatTokens(context.limit)} tokens`}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
