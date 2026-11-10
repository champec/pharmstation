// ============================================
// Shift pass: two-step sign-in once per shift on a pharmacy computer.
//
// On a shared workstation staff switch users all day. Asking for an
// authenticator code at every switch is too much, so after someone has
// signed in WITH their code (an aal2 session), "Switch user" parks that
// session on this computer instead of ending it. When the same person signs
// in again within SHIFT_HOURS, their password is checked and the parked
// session (still two-step verified) is resumed: no code needed.
//
// Limits: only on a pharmacy workstation (an org session is present), only
// for this pharmacy, only for SHIFT_HOURS, and always behind the password.
// Signing the pharmacy out, or the person signing out properly, ends it.
// ============================================

import type { Session } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseConfig, getUserClient } from './index'

export const SHIFT_HOURS = 12

interface ShiftPass {
  userId: string
  email: string
  accessToken: string
  refreshToken: string
  until: number
}

const key = (orgId: string) => `ps-shift-pass:${orgId}`

function read(orgId: string): ShiftPass[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(orgId)) || '[]') as ShiftPass[]
    return list.filter((p) => p && p.until > Date.now())
  } catch {
    return []
  }
}

function write(orgId: string, list: ShiftPass[]) {
  try {
    if (list.length) localStorage.setItem(key(orgId), JSON.stringify(list))
    else localStorage.removeItem(key(orgId))
  } catch {
    // storage blocked: shift passes just don't work on this browser
  }
}

function aalOf(session: Session): string {
  try {
    const part = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(part)).aal ?? 'aal1'
  } catch {
    return 'aal1'
  }
}

function throwaway() {
  const { url, anonKey } = getSupabaseConfig()
  return createClient(url, anonKey, {
    auth: { storageKey: 'ps-shift-pass-check', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Forget the person's session on this computer WITHOUT ending it on the
 *  server, so it can be resumed later. */
async function forgetLocally() {
  const auth = getUserClient().auth as unknown as { _removeSession?: () => Promise<void> }
  if (typeof auth._removeSession === 'function') {
    await auth._removeSession()
    return
  }
  for (const suffix of ['', '-code-verifier', '-user']) {
    try {
      localStorage.removeItem(`ps-user-session${suffix}`)
    } catch {
      // ignore
    }
  }
}

/** Until when this person can switch back in without a code, or null. */
export function shiftPassUntil(orgId: string | null | undefined, email: string): Date | null {
  if (!orgId) return null
  const p = read(orgId).find((x) => x.email === email.trim().toLowerCase())
  return p ? new Date(p.until) : null
}

/**
 * Switch user on a pharmacy computer. A two-step-verified session is parked
 * (kept for this shift); anything else is signed out as normal. Returns true
 * when a session was parked.
 */
export async function parkUserSession(orgId: string | null | undefined): Promise<boolean> {
  const client = getUserClient()
  const { data } = await client.auth.getSession()
  const session = data.session
  if (!orgId || !session?.user?.email || aalOf(session) !== 'aal2') {
    await client.auth.signOut()
    return false
  }
  const email = session.user.email.toLowerCase()
  const existing = read(orgId).find((p) => p.email === email)
  const until = existing?.until ?? Date.now() + SHIFT_HOURS * 3600 * 1000
  const list = read(orgId).filter((p) => p.email !== email)
  list.push({ userId: session.user.id, email, accessToken: session.access_token, refreshToken: session.refresh_token, until })
  write(orgId, list.slice(-15))
  await forgetLocally()
  return true
}

/**
 * Sign in with a parked session: checks the password, then resumes the
 * two-step-verified session. Returns false (and drops the pass) when there's
 * no usable pass, so the caller falls back to a normal sign-in.
 */
export async function resumeShiftPass(orgId: string | null | undefined, email: string, password: string): Promise<boolean> {
  if (!orgId) return false
  const clean = email.trim().toLowerCase()
  const pass = read(orgId).find((p) => p.email === clean)
  if (!pass) return false

  // Password first. A wrong password is an error, not a fallback.
  const check = throwaway()
  const { error: pwError } = await check.auth.signInWithPassword({ email: clean, password })
  if (pwError) throw pwError
  await check.auth.signOut({ scope: 'local' }).catch(() => {})

  const { data, error } = await getUserClient().auth.setSession({
    access_token: pass.accessToken,
    refresh_token: pass.refreshToken,
  })
  if (error || !data.session || data.session.user.id !== pass.userId || aalOf(data.session) !== 'aal2') {
    write(orgId, read(orgId).filter((p) => p.email !== clean))
    if (data.session) await forgetLocally()
    return false
  }
  return true
}

/** The person signed out properly: their pass on this computer ends too. */
export function dropShiftPass(orgId: string | null | undefined, email: string | null | undefined) {
  if (!orgId || !email) return
  write(orgId, read(orgId).filter((p) => p.email !== email.toLowerCase()))
}

/** The pharmacy signed out: end every parked session on the server and
 *  forget them here. Best effort. */
export async function endAllShiftPasses(orgId: string | null | undefined) {
  if (!orgId) return
  let list: ShiftPass[] = []
  try {
    list = JSON.parse(localStorage.getItem(key(orgId)) || '[]') as ShiftPass[]
  } catch {
    list = []
  }
  write(orgId, [])
  await Promise.all(
    list.map(async (p) => {
      try {
        const c = throwaway()
        const { error } = await c.auth.setSession({ access_token: p.accessToken, refresh_token: p.refreshToken })
        if (!error) await c.auth.signOut({ scope: 'local' })
      } catch {
        // ignore
      }
    }),
  )
}
