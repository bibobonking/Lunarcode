import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ScrollText } from 'lucide-react'
import type { ChatSession } from '../types'
import { useSettings } from '../store/settings'
import { useChats } from '../store/chats'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { inheritedPrompt, resolveBasePrompt } from '../lib/system-prompt'
import { useClickOutside } from '../lib/hooks'
import { cn } from '../lib/utils'
import { RadioMark, Segmented } from './ui'

type Scope = 'session' | 'workspace'

function Choice({
  active,
  title,
  description,
  onClick,
  disabled,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-ink/[.08] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RadioMark checked={active} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[13px] leading-snug text-ink">{title}</span>
        <span className="block text-[12px] leading-snug text-muted">{description}</span>
      </span>
    </button>
  )
}

/** Small editor for the base system prompt: shared, custom for this session, or custom for this workspace. */
export function SystemPromptButton({ session }: { session: ChatSession | null }) {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const updateSession = useChats((state) => state.updateSession)
  const notify = useUi((state) => state.notify)
  const root = useWorkspace((state) => state.root || state.info.root)
  const workspaceName = useWorkspace((state) => state.info.name)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('session')
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useClickOutside(panelRef, () => setOpen(false), open, triggerRef)
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 56, right: 12 })

  // Render the popover in a portal and place it from the trigger's rectangle.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPosition({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  const effective = resolveBasePrompt(settings, session, root)
  const sessionCustom = typeof session?.systemPrompt === 'string'
  const workspaceCustom = Boolean(root) && typeof settings.workspacePrompts[root] === 'string'
  const customized = sessionCustom || workspaceCustom

  // Session needs a conversation, workspace needs a folder; fall back to whichever scope is usable.
  const activeScope: Scope = scope === 'session' && !session && root ? 'workspace' : scope
  const isSession = activeScope === 'session'
  const custom = isSession ? sessionCustom : workspaceCustom
  const value = isSession ? (session?.systemPrompt ?? '') : (settings.workspacePrompts[root] ?? '')
  const fallback = isSession ? inheritedPrompt(settings, root) : { text: settings.systemPrompt, source: 'app' as const }
  const unavailable = isSession ? !session : !root

  const setCustom = (text: string | undefined) => {
    if (isSession) {
      if (session) updateSession(session.id, { systemPrompt: text })
      return
    }
    if (!root) return
    const next = { ...settings.workspacePrompts }
    if (text === undefined) delete next[root]
    else next[root] = text
    update({ workspacePrompts: next })
  }

  const sharedDescription = isSession
    ? fallback.source === 'workspace'
      ? 'Uses this workspace’s custom prompt.'
      : 'Uses the app-wide prompt from Settings → General.'
    : 'Uses the app-wide prompt from Settings → General.'

  return (
    <div className="relative hidden sm:block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={`System prompt · ${effective.source === 'session' ? 'custom for this session' : effective.source === 'workspace' ? 'custom for this workspace' : 'shared'}`}
        aria-label="Edit system prompt"
        aria-expanded={open}
        className={cn('adw-icon-btn relative', open && 'bg-ink/[.1]')}
      >
        <ScrollText size={16} />
        {customized && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" aria-label="Customized" />}
      </button>

      {open &&
        createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="System prompt"
          style={{ top: position.top, right: position.right }}
          className="adw-popover thin-scroll fixed z-[95] max-h-[calc(100dvh-80px)] w-[min(440px,92vw)] overflow-y-auto p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="adw-heading">System prompt</p>
            <Segmented<Scope>
              value={activeScope}
              onChange={setScope}
              options={[
                { value: 'session', label: 'Session', title: 'Only this conversation' },
                { value: 'workspace', label: 'Workspace', title: 'Every conversation in this folder' },
              ]}
            />
          </div>

          <p className="mb-2 text-[12px] text-muted">
            {isSession ? (session ? 'Applies to this conversation only.' : 'Send a message to start a conversation first.') : root ? `Applies to every conversation in ${workspaceName || 'this folder'}.` : 'Open a workspace folder first.'}
          </p>

          <div role="radiogroup" aria-label="Prompt source" className="space-y-0.5">
            <Choice
              active={!custom}
              disabled={unavailable}
              title="Use shared prompt"
              description={sharedDescription}
              onClick={() => setCustom(undefined)}
            />
            <Choice
              active={custom}
              disabled={unavailable}
              title={isSession ? 'Custom for this session' : 'Custom for this workspace'}
              description="Write a prompt that replaces the shared one here."
              onClick={() => {
                if (!custom) {
                  setCustom(fallback.text)
                  notify('Started from the current shared prompt. Edit it below.', 'info')
                }
              }}
            />
          </div>

          {custom && !unavailable && (
            <textarea
              value={value}
              onChange={(event) => setCustom(event.target.value)}
              rows={9}
              spellCheck={false}
              aria-label="Custom system prompt"
              className="adw-entry thin-scroll mt-2 resize-y bg-raised font-mono text-[13px]"
              placeholder="You are…"
            />
          )}

          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Order of precedence: session, then workspace, then shared. Skills, workspace context and mode rules are always added after it.
          </p>
        </div>,
        document.body,
        )}
    </div>
  )
}
