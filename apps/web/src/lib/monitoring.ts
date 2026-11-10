// Platform monitoring for the web app: error tracking + light usage analytics.
//
// Data goes to the London Supabase project (UK) only, never a third party.
// Only platform admins can read it (Monitoring page). Health data rule: we
// never send form contents or query strings. Paths have ids replaced, and the
// database scrubs emails, phones, NHS numbers and postcodes again on insert.

import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

const RELEASE = (import.meta.env.VITE_APP_RELEASE as string | undefined) || 'web-dev'
const MAX_ERRORS_PER_SESSION = 25
const FLUSH_MS = 15_000

let installed = false
let errorsSent = 0
const recentErrors = new Map<string, number>()
let eventQueue: Array<Record<string, unknown>> = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function sessionId(): string {
  try {
    let id = sessionStorage.getItem('ps-monitor-session')
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem('ps-monitor-session', id)
    }
    return id
  } catch {
    return 'no-storage'
  }
}

export function cleanPath(path: string): string {
  return path
    .split(/[?#]/)[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 300)
}

function scrub(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/g, '<nhs>')
    .replace(/\b(\+44\s?7\d{3}|07\d{3})\s?\d{3}\s?\d{3}\b/g, '<phone>')
    .replace(/\d{6,}/g, '<n>')
}

function device(): string {
  return `${navigator.userAgent.slice(0, 200)} | ${window.innerWidth}x${window.innerHeight}`
}

function currentOrgId(): string | null {
  try {
    return useAuthStore.getState().organisation?.id ?? null
  } catch {
    return null
  }
}

export function captureError(error: unknown, extra: Record<string, unknown> = {}) {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
    const message = scrub(`${err.name && err.name !== 'Error' ? err.name + ': ' : ''}${err.message || 'Unknown error'}`).slice(0, 1500)
    // Ignore noise that isn't ours to fix
    if (/ResizeObserver loop|^Script error\.?$/i.test(message)) return
    const key = message + '|' + location.pathname
    const now = Date.now()
    if ((recentErrors.get(key) ?? 0) > now - 60_000) return
    recentErrors.set(key, now)
    if (errorsSent >= MAX_ERRORS_PER_SESSION) return
    errorsSent++

    void getUserClient()
      .from('ps_monitor_errors')
      .insert({
        source: 'web',
        message,
        stack: err.stack ? scrub(err.stack).slice(0, 6000) : null,
        route: cleanPath(location.pathname),
        release: RELEASE,
        device: device(),
        organisation_id: currentOrgId(),
        session_id: sessionId(),
        context: Object.keys(extra).length ? extra : null,
      })
      .then(() => undefined)
  } catch {
    /* never let monitoring break the app */
  }
}

async function flushEvents() {
  flushTimer = null
  if (!eventQueue.length) return
  const batch = eventQueue
  eventQueue = []
  try {
    const { data } = await getUserClient().auth.getSession()
    if (!data.session) return // usage is only recorded for signed-in people
    await getUserClient().from('ps_monitor_events').insert(batch)
  } catch {
    /* ignore */
  }
}

export function trackEvent(name: string, path: string = location.pathname) {
  try {
    eventQueue.push({
      source: 'web',
      name,
      path: cleanPath(path),
      organisation_id: currentOrgId(),
      session_id: sessionId(),
      release: RELEASE,
      device: device(),
    })
    if (eventQueue.length >= 20) void flushEvents()
    else if (!flushTimer) flushTimer = setTimeout(flushEvents, FLUSH_MS)
  } catch {
    /* ignore */
  }
}

export function initMonitoring() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => captureError(e.error ?? e.message, { kind: 'window.error' }))
  window.addEventListener('unhandledrejection', (e) => captureError(e.reason, { kind: 'unhandledrejection' }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushEvents()
  })
}
