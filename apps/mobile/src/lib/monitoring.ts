// Platform monitoring for the Expo app: crash/error tracking + light usage
// analytics (screen views). Data goes to the London Supabase project (UK)
// only and only platform admins can read it (web Monitoring page).
// Health data rule: no form contents or params are sent; ids are removed
// from screen paths, and the database scrubs identifiers again on insert.

import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { userClient } from './supabase'
import { useAuthStore } from '@/stores/auth-store'

const MAX_ERRORS_PER_SESSION = 25
const FLUSH_MS = 20_000
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

let installed = false
let errorsSent = 0
const recent = new Map<string, number>()
let queue: Array<Record<string, unknown>> = []
let timer: ReturnType<typeof setTimeout> | null = null

function release(): string {
  const v = Constants.expoConfig?.version ?? '0'
  const update = Updates.updateId ? `+${Updates.updateId.slice(0, 8)}` : ''
  return `app-${v}${update}`.slice(0, 80)
}

function device(): string {
  return `${Platform.OS} ${String(Platform.Version)}`
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
    .replace(/\d{6,}/g, '<n>')
}

function orgId(): string | null {
  try {
    return useAuthStore.getState().organisation?.id ?? null
  } catch {
    return null
  }
}

let currentPath = '/'

export function captureError(error: unknown, extra: Record<string, unknown> = {}) {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
    const message = scrub(`${err.name && err.name !== 'Error' ? err.name + ': ' : ''}${err.message || 'Unknown error'}`).slice(0, 1500)
    const key = message + '|' + currentPath
    const now = Date.now()
    if ((recent.get(key) ?? 0) > now - 60_000) return
    recent.set(key, now)
    if (errorsSent >= MAX_ERRORS_PER_SESSION) return
    errorsSent++
    void userClient
      .from('ps_monitor_errors')
      .insert({
        source: 'mobile',
        message,
        stack: err.stack ? scrub(err.stack).slice(0, 6000) : null,
        route: cleanPath(currentPath),
        release: release(),
        device: device(),
        organisation_id: orgId(),
        session_id: SESSION_ID,
        context: Object.keys(extra).length ? extra : null,
      })
      .then(() => undefined)
  } catch {
    /* never let monitoring break the app */
  }
}

async function flush() {
  timer = null
  if (!queue.length) return
  const batch = queue
  queue = []
  try {
    const { data } = await userClient.auth.getSession()
    if (!data.session) return
    await userClient.from('ps_monitor_events').insert(batch)
  } catch {
    /* ignore */
  }
}

export function trackScreen(path: string) {
  currentPath = path
  trackEvent('screen_view', path)
}

export function trackEvent(name: string, path: string = currentPath) {
  try {
    queue.push({ source: 'mobile', name, path: cleanPath(path), organisation_id: orgId(), session_id: SESSION_ID, release: release(), device: device() })
    if (queue.length >= 20) void flush()
    else if (!timer) timer = setTimeout(flush, FLUSH_MS)
  } catch {
    /* ignore */
  }
}

export function flushMonitoring() {
  void flush()
}

export function initMonitoring() {
  if (installed) return
  installed = true
  const EU = (globalThis as any).ErrorUtils
  if (EU?.getGlobalHandler && EU?.setGlobalHandler) {
    const previous = EU.getGlobalHandler()
    EU.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      captureError(error, { kind: isFatal ? 'fatal' : 'global' })
      if (isFatal) void flush()
      previous?.(error, isFatal)
    })
  }
  const hermes = (globalThis as any).HermesInternal
  if (!__DEV__ && hermes?.enablePromiseRejectionTracker) {
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id: number, reason: unknown) => captureError(reason, { kind: 'unhandledrejection' }),
    })
  }
}
