import { Component, type ErrorInfo, type ReactNode } from 'react'
import { LogoMark } from './Logo'

interface State {
  error: Error | null
  copied: boolean
}

/** Keeps a render error from blanking the whole app; chats are already saved by the daemon. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, copied: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[createcode] render error', error, info.componentStack)
  }

  private details() {
    const { error } = this.state
    return `${error?.name}: ${error?.message}\n\n${error?.stack ?? ''}`
  }

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(this.details())
      this.setState({ copied: true })
    } catch {
      // Clipboard can be blocked; the details stay visible below.
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-dvh items-center justify-center bg-panel px-5 text-ink">
        <div className="w-full max-w-[460px]">
          <LogoMark size={34} />
          <h1 className="mt-4 text-[21px] font-bold">Something broke on this screen</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Your conversations are saved on this computer. Try the screen again, or reload the app.
          </p>
          <pre className="thin-scroll mt-4 max-h-40 overflow-auto rounded-[18px] border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-muted">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="adw-btn adw-btn-suggested"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="adw-btn"
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={() => void this.copy()}
              className="adw-btn adw-btn-flat"
            >
              {this.state.copied ? 'Copied' : 'Copy details'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
