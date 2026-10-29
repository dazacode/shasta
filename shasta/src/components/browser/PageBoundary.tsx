import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** changes when the page being shown changes, so navigating away clears a previous error */
  resetKey?: string
}

/**
 * A crash inside one Shasta page (the Store, an app view) must never take the whole browser down with it.
 * It shows what happened and offers a retry; the tab strip, other tabs and the address bar keep working.
 */
export class PageBoundary extends Component<Props, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Shasta page crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full place-items-center p-8 text-shasta-fg" role="alert">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-shasta-field"><AlertTriangle className="size-6 text-shasta-warn" /></div>
          <h1 className="text-lg font-semibold">This page ran into a problem</h1>
          <p className="mt-1 text-sm text-shasta-muted">Your other tabs are fine. If you just updated Shasta, the server may need restarting so the page and the server agree.</p>
          <p className="mt-3 rounded-lg bg-shasta-field px-3 py-2 text-left font-mono text-xs break-words text-shasta-muted">{this.state.error.message}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => this.setState({ error: null })}><RefreshCw /> Try again</Button>
            <Button variant="secondary" onClick={() => location.reload()}>Reload Shasta</Button>
          </div>
        </div>
      </div>
    )
  }
}
