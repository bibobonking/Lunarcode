import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Brain, Check, ChevronDown, Eye, KeyRound, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react'
import { PROVIDERS, PROVIDER_MAP, EFFORT_LABELS, effortLabel } from '../data/providers'
import type { Effort, ModelInfo, ProviderId } from '../types'
import { activeModelId, providerHasCredentials, useSettings } from '../store/settings'
import { useModelCatalog } from '../store/models'
import { useUi } from '../store/ui'
import { defaultEffort, effortOptions, normalizeEffort, reasoningSummary } from '../lib/reasoning'
import { scopeGatewayModels } from '../lib/gateway'
import { cn } from '../lib/utils'
import { RadioMark, Spinner } from './ui'

const NO_MODELS: ModelInfo[] = []

function connected(providerId: ProviderId) {
  return providerHasCredentials(useSettings.getState(), providerId)
}

function contextLabel(context?: number) {
  if (!context) return ''
  if (context >= 1_000_000) return `${(context / 1_000_000).toFixed(context % 1_000_000 ? 1 : 0)}M`
  return `${Math.round(context / 1000)}k`
}

function EffortList({
  efforts,
  value,
  onChange,
  disabled,
}: {
  efforts: Effort[]
  value: Effort
  onChange: (effort: Effort) => void
  disabled: boolean
}) {
  return (
    <div className={cn('adw-boxed', disabled && 'pointer-events-none opacity-40')} role="radiogroup" aria-label="Reasoning effort">
      {[...efforts].reverse().map((effort) => {
        const checked = effort === value
        return (
          <button
            key={effort}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(effort)}
            className="adw-row w-full text-left hover:bg-ink/[.05]"
          >
            <RadioMark checked={checked} />
            <span className="min-w-0 flex-1">
              <span className="adw-row-title block">{effortLabel(effort)}</span>
              <span className="adw-row-subtitle block">{EFFORT_LABELS[effort as keyof typeof EFFORT_LABELS]?.description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ModelDeck({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings()
  const selectModel = useSettings((state) => state.selectModel)
  const update = useSettings((state) => state.update)
  const openSettings = useUi((state) => state.openSettings)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  // Only keyboard navigation may scroll the list. Hover moves the cursor too, and scrolling
  // under a moving pointer makes the rows jump up and down.
  const keyboardNav = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const railRef = useRef<HTMLElement>(null)
  const provider = settings.provider
  const models = useModelCatalog((state) => state.byProvider[provider]) ?? NO_MODELS
  const loading = useModelCatalog((state) => Boolean(state.loading[provider]))
  const error = useModelCatalog((state) => state.errors[provider] ?? '')
  const note = useModelCatalog((state) => state.notes[provider] ?? '')
  const fetchModels = useModelCatalog((state) => state.fetchModels)

  const modelId = activeModelId(settings)
  const active = models.find((model) => model.id === modelId) ?? null
  const connectedNow = connected(provider)
  const keyless = Boolean(PROVIDER_MAP[provider]?.keyless) || provider === 'custom'
  const efforts = effortOptions(active)
  const visibleModels = useMemo(
    () => (provider === 'custom' ? scopeGatewayModels(models, modelId) : models),
    [provider, models, modelId],
  )

  useEffect(() => {
    if (!open) return
    if (connectedNow || keyless) void fetchModels(provider)
  }, [open, provider, connectedNow, keyless, fetchModels])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setShowManual(false)
      return
    }
    const timer = window.setTimeout(() => searchRef.current?.focus(), 60)
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open])

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase()
    if (!clean) return visibleModels
    return visibleModels.filter(
      (model) => model.name.toLowerCase().includes(clean) || model.id.toLowerCase().includes(clean),
    )
  }, [visibleModels, query])

  useLayoutEffect(() => {
    setCursor(0)
  }, [query, provider])

  useEffect(() => {
    if (!keyboardNav.current) return
    keyboardNav.current = false
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const choose = (model: ModelInfo) => {
    const options = effortOptions(model)
    const effort = options.length > 0 ? normalizeEffort(settings.effort, model) : settings.effort
    selectModel(provider, model.id, options.length > 0 && !options.includes(effort) ? defaultEffort(model) : effort)
  }

  const chooseManual = (event?: FormEvent) => {
    event?.preventDefault()
    const id = manual.trim()
    if (!id) return
    selectModel(provider, id, settings.effort)
    setManual('')
    setShowManual(false)
  }

  const chooseProvider = (next: ProviderId) => {
    if (next === provider) return
    update({ provider: next, model: '' })
    setQuery('')
    void fetchModels(next)
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      keyboardNav.current = true
      setCursor((value) => Math.min(filtered.length - 1, value + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      keyboardNav.current = true
      setCursor((value) => Math.max(0, value - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const model = filtered[cursor]
      if (model && model.id !== modelId) choose(model)
      else onClose()
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Keep the active provider in view: the rail scrolls and the selected one can sit far down.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => railRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [open, provider])

  if (!open) return null

  const needsKey = !connectedNow && !keyless
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Close model picker" tabIndex={-1} onClick={onClose} className="adw-scrim absolute inset-0 cursor-default" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Model"
        className="adw-dialog relative flex h-[min(92dvh,800px)] w-full flex-col overflow-hidden rounded-b-none sm:w-[min(1180px,97vw)] sm:rounded-[15px]"
      >
        <header className="adw-headerbar shrink-0 border-b border-line">
          <div className="min-w-0 flex-1">
            <h2 className="adw-headerbar-title truncate">{active?.name || modelId || 'Pick a model'}</h2>
            <p className="adw-headerbar-subtitle truncate">
              {PROVIDER_MAP[provider]?.name ?? provider}
              {efforts.length > 0 ? ` · ${effortLabel(settings.effort)} effort` : ''}
              {active?.context ? ` · ${contextLabel(active.context)} context` : ''}
            </p>
          </div>
          <button
            type="button"
            className="adw-icon-btn"
            onClick={() => void fetchModels(provider, true)}
            disabled={loading || needsKey}
            title="Refresh live models"
            aria-label="Refresh live models"
          >
            {loading ? <Spinner size={16} /> : <RefreshCw size={16} />}
          </button>
          <button
            type="button"
            className="adw-icon-btn"
            onClick={() => {
              onClose()
              openSettings('models')
            }}
            title="Provider settings"
            aria-label="Provider settings"
          >
            <Settings2 size={16} />
          </button>
          <button type="button" className="adw-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Providers */}
          <nav
            ref={railRef}
            aria-label="Providers"
            className="thin-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-sidebar p-2 md:w-[230px] md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r"
          >
            {PROVIDERS.map((entry) => {
              const ready = connected(entry.id) || entry.keyless || entry.id === 'custom'
              const selected = entry.id === provider
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => chooseProvider(entry.id)}
                  disabled={!ready}
                  title={`${entry.name}${ready ? '' : ' · connect to enable'}`}
                  aria-pressed={selected}
                  aria-current={selected ? 'true' : undefined}
                  className="adw-nav-row shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', ready ? 'bg-success' : 'bg-warning')} aria-hidden="true" />
                </button>
              )
            })}
          </nav>

          {/* Models */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {needsKey ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
                <KeyRound size={32} className="text-muted" />
                <p className="text-[16px] font-bold text-ink">Connect {PROVIDER_MAP[provider]?.name ?? provider}</p>
                <p className="max-w-[320px] text-[13px] leading-relaxed text-muted">
                  Keys are encrypted by the local daemon before they touch disk and never come back to this page.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    openSettings('models')
                  }}
                  className="adw-btn adw-btn-suggested"
                >
                  Add API key
                </button>
              </div>
            ) : (
              <>
                <div className="shrink-0 px-4 pb-2 pt-3">
                  <div className="adw-searchbox">
                    <Search size={16} className="shrink-0 text-muted" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={onSearchKey}
                      placeholder={visibleModels.length > 0 ? `Search ${visibleModels.length} models…` : 'Search models…'}
                      aria-label="Search models"
                    />
                    <kbd className="adw-kbd hidden sm:inline-flex">↑↓ ↵</kbd>
                  </div>
                  {error && (
                    <div className="mt-2 flex items-start gap-2 rounded-[9px] border border-danger/30 bg-danger/10 px-3 py-2">
                      <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
                      <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink">{error}</p>
                      <button type="button" onClick={() => void fetchModels(provider, true)} className="adw-btn adw-btn-flat h-7 px-2 text-[12px]">
                        Retry
                      </button>
                    </div>
                  )}
                  {note && !error && <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-muted">{note}</p>}
                </div>

                <div ref={listRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                  {loading && visibleModels.length === 0 && (
                    <p className="flex items-center gap-2 px-3 py-4 text-[13px] text-muted">
                      <Spinner size={16} /> Loading live models…
                    </p>
                  )}
                  {filtered.length > 0 && (
                    <div className="adw-boxed" role="listbox" aria-label="Models">
                      {filtered.map((model, i) => {
                        const selected = model.id === modelId
                        const highlighted = i === cursor
                        const thinks = model.reasoningOptions.length > 0
                        return (
                          <button
                            key={model.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            data-row={i}
                            onClick={() => {
                              setCursor(i)
                              choose(model)
                            }}
                            onMouseEnter={() => setCursor(i)}
                            className={cn('adw-row w-full text-left', highlighted ? 'bg-ink/[.07]' : 'hover:bg-ink/[.05]')}
                          >
                            <span className="flex w-4 shrink-0 justify-center">{selected && <Check size={16} className="text-accent" />}</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="adw-row-title truncate">{model.name || model.id}</span>
                                {model.free && <span className="adw-badge">free</span>}
                                {!model.toolCall && <span className="adw-badge">no tools</span>}
                              </span>
                              <span className="adw-row-subtitle block truncate font-mono">{model.id}</span>
                            </span>
                            <span className="hidden shrink-0 items-center gap-2 text-muted sm:flex">
                              {thinks && <Brain size={16} aria-label="reasoning" />}
                              {model.vision && <Eye size={16} aria-label="vision" />}
                              {model.context ? <span className="w-10 text-right font-mono text-[12px] tabular-nums">{contextLabel(model.context)}</span> : null}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {!loading && filtered.length === 0 && visibleModels.length > 0 && (
                    <p className="px-3 py-6 text-center text-[13px] text-muted">No model matches “{query}”.</p>
                  )}
                  {!loading && visibleModels.length === 0 && !error && (
                    <p className="px-3 py-6 text-center text-[13px] text-muted">This provider returned no usable chat models.</p>
                  )}

                  {showManual ? (
                    <form onSubmit={chooseManual} className="mt-3 flex items-center gap-2">
                      <input
                        autoFocus
                        value={manual}
                        onChange={(event) => setManual(event.target.value)}
                        placeholder="model-id"
                        className="adw-entry min-w-0 flex-1 font-mono"
                        aria-label="Model ID"
                      />
                      <button type="submit" disabled={!manual.trim()} className="adw-btn adw-btn-suggested">
                        Use
                      </button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => setShowManual(true)} className="adw-btn adw-btn-flat mt-3">
                      <Plus size={16} /> Use a model ID that is not listed
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          {/* Reasoning effort */}
          <aside className="shrink-0 overflow-y-auto border-t border-line bg-sidebar px-4 py-4 md:w-[310px] md:border-l md:border-t-0">
            <p className="adw-section-label mb-2 flex items-center gap-2">
              <Brain size={16} /> Reasoning
            </p>

            {efforts.length > 1 ? (
              <EffortList
                efforts={efforts}
                value={normalizeEffort(settings.effort, active)}
                onChange={(effort) => active && selectModel(provider, active.id, effort)}
                disabled={!active}
              />
            ) : (
              <div className="adw-boxed px-4 py-6 text-center">
                <p className="text-[13px] font-semibold text-ink">{active ? 'No effort setting' : 'Pick a model'}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{reasoningSummary(active)}</p>
              </div>
            )}

            {efforts.length > 1 && <p className="mt-3 text-[12px] leading-relaxed text-muted">{reasoningSummary(active)}</p>}
          </aside>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3 text-[12px] text-muted">
          {active?.maxOutput ? <span>max output {contextLabel(active.maxOutput)}</span> : null}
          {active?.apiKind ? <span className="adw-badge font-mono">{active.apiKind}</span> : null}
          <span className="ml-auto hidden sm:inline">Esc to close</span>
          <button type="button" onClick={onClose} className="adw-btn adw-btn-suggested">
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** Composer trigger: model name with live effort bars, no dropdown chevron. */
/** Plain-text model name for the composer; opens the deck. */
export function ModelDeckTrigger({
  label,
  open,
  disabled,
  onClick,
  triggerRef,
  title,
}: {
  label: string
  open: boolean
  disabled: boolean
  onClick: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  title: string
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={title}
      className={cn(
        'adw-btn adw-btn-flat h-8 max-w-[180px] gap-1 px-2 text-[12px] text-muted hover:text-ink sm:max-w-[260px]',
        open && 'text-ink',
      )}
    >
      <span className="truncate">{label}</span>
      <ChevronDown size={16} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
    </button>
  )
}
