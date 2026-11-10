import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { captureError, initMonitoring, trackEvent } from '../lib/monitoring'

/** Records a page view (path only, ids removed) each time the route changes. */
export function RouteTracker() {
  const { pathname } = useLocation()
  useEffect(() => {
    initMonitoring()
  }, [])
  useEffect(() => {
    trackEvent('page_view', pathname)
  }, [pathname])
  return null
}

type BoundaryState = { failed: boolean }

/** Catches render crashes, reports them, and shows a recovery screen instead of a blank page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureError(error, { kind: 'react.render', component: (info.componentStack ?? '').trim().split('\n')[0]?.trim().slice(0, 200) })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--ps-space-lg)', background: 'var(--ps-off-white)' }}>
        <div style={{ maxWidth: 440, textAlign: 'center', color: 'var(--ps-midnight)' }}>
          <h1 style={{ fontSize: 'var(--ps-font-xl)', marginBottom: 'var(--ps-space-sm)' }}>Something went wrong on this page</h1>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            The PharmStation team has been told automatically. Reloading usually fixes it. Nothing you saved has been lost.
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => window.location.reload()}>Reload page</button>{' '}
          <button className="ps-btn ps-btn-secondary" onClick={() => { window.location.href = '/' }}>Go to dashboard</button>
        </div>
      </div>
    )
  }
}
