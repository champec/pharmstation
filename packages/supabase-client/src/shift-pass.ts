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
//
// Security: the parked tokens are stored ENCRYPTED (AES-GCM) with a key
// derived from the person's password (PBKDF2), so someone else at the
// computer cannot lift them from localStorage. The key is derived when the
// password is typed and kept in memory only (non-extractable) until the next
// park. The server also records the parked session (ps_shift_pass_sessions)
// and a cron job ends it when the shift is over, whatever the browser does.
// ============================================

import type { Session } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { getOrgClient, getSupabaseConfig, getUserClient } from './index'

export const SHIFT_HOURS = 12
const PBKDF2_ITERATIONS = 310_000

interface ShiftPass {
  v: 2
  userId: string
  email: string
  until: number
  salt: string // base64
  iv: string // base64
  ct: string // base64 AES-GCM of {accessToken, refreshToken}
}

const key = (orgId: string) => `ps-shift-pass:${orgId}`

// The key derived from the password the person last typed on this page.
let held: { orgId: string; email: string; key: CryptoKey; salt: Uint8Array } | null = null

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const aad = (orgId: string, p: { userId: string; email: string; until: number }) =>
  new TextEncoder().encode(`ps-shift-pass|${orgId}|${p.userId}|${p.email}|${p.until}`)

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function readAll(orgId: string): ShiftPass[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(orgId)) || '[]') as ShiftPass[]
    // Old (unencrypted) passes are dropped.
    return Array.isArray(list) ? list.filter((p) => p && p.v === 2 && p.ct) : []
  } catch {
    return []
  }
}

function read(orgId: string): ShiftPass[] {
  return readAll(orgId).filter((p) => p.until > Date.now())
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

/**
 * Call with the password the person has just typed on a pharmacy computer
 * (before it is checked is fine: a wrong password never gets a session to
 * park). Keeps a password-derived key in memory so "Switch user" can park
 * the session encrypted. Best effort.
 */
export async function primeShiftPass(orgId: string | null | undefined, email: string, password: string): Promise<void> {
  held = null
  if (!orgId || !password || typeof crypto === 'undefined' || !crypto.subtle) return
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    held = { orgId, email: email.trim().toLowerCase(), key: await deriveKey(password, salt), salt }
  } catch {
    held = null
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
 * (kept for this shift, encrypted); anything else is signed out as normal.
 * Returns true when a session was parked.
 */
export async function parkUserSession(orgId: string | null | undefined): Promise<boolean> {
  const client = getUserClient()
  const { data } = await client.auth.getSession()
  const session = data.session
  const email = session?.user?.email?.toLowerCase()
  const k = held
  held = null
  if (!orgId || !session || !email || aalOf(session) !== 'aal2' || !k || k.orgId !== orgId || k.email !== email) {
    await client.auth.signOut()
    return false
  }
  try {
    const existing = read(orgId).find((p) => p.email === email)
    let until = existing?.until ?? Date.now() + SHIFT_HOURS * 3600 * 1000
    // Server-side expiry. Best effort: the tokens are encrypted either way.
    const { data: serverUntil, error: regError } = await client.rpc('ps_shift_pass_register', {
      p_org_id: orgId,
      p_until: new Date(until).toISOString(),
    })
    if (!regError && serverUntil) until = Math.min(until, new Date(serverUntil as string).getTime())

    const meta = { userId: session.user.id, email, until }
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(orgId, meta) as BufferSource },
      k.key,
      new TextEncoder().encode(JSON.stringify({ a: session.access_token, r: session.refresh_token })),
    )
    const list = read(orgId).filter((p) => p.email !== email)
    list.push({ v: 2, ...meta, salt: b64(k.salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) })
    write(orgId, list.slice(-15))
    await forgetLocally()
    return true
  } catch {
    await client.auth.signOut()
    return false
  }
}

/**
 * Sign in with a parked session: checks the password on the server, then
 * decrypts and resumes the two-step-verified session. Returns false (and
 * drops the pass) when there's no usable pass, so the caller falls back to a
 * normal sign-in.
 */
export async function resumeShiftPass(orgId: string | null | undefined, email: string, password: string): Promise<boolean> {
  if (!orgId) return false
  const clean = email.trim().toLowerCase()
  const pass = read(orgId).find((p) => p.email === clean)
  if (!pass) return false
  const drop = () => write(orgId, readAll(orgId).filter((p) => p.email !== clean))

  // Password first, on the server. A wrong password is an error, not a fallback.
  const check = throwaway()
  const { error: pwError } = await check.auth.signInWithPassword({ email: clean, password })
  if (pwError) throw pwError
  await check.auth.signOut({ scope: 'local' }).catch(() => {})

  let tokens: { a: string; r: string }
  try {
    const salt = unb64(pass.salt)
    const k = await deriveKey(password, salt)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(pass.iv) as BufferSource, additionalData: aad(orgId, pass) as BufferSource },
      k,
      unb64(pass.ct) as BufferSource,
    )
    tokens = JSON.parse(new TextDecoder().decode(plain))
  } catch {
    // Password changed since the pass was made (or the pass was tampered with).
    drop()
    return false
  }

  const { data, error } = await getUserClient().auth.setSession({ access_token: tokens.a, refresh_token: tokens.r })
  if (error || !data.session || data.session.user.id !== pass.userId || aalOf(data.session) !== 'aal2') {
    drop()
    if (data.session) await forgetLocally()
    return false
  }
  // Ready for the next switch. Fresh salt so each park uses a new key.
  await primeShiftPass(orgId, clean, password)
  return true
}

/** The person signed out properly: their pass on this computer ends too. */
export function dropShiftPass(orgId: string | null | undefined, email: string | null | undefined) {
  held = null
  if (!orgId || !email) return
  write(orgId, readAll(orgId).filter((p) => p.email !== email.toLowerCase()))
}

/** The pharmacy signed out: end every parked session on the server and
 *  forget them here. Best effort. */
export async function endAllShiftPasses(orgId: string | null | undefined) {
  held = null
  if (!orgId) return
  write(orgId, [])
  try {
    await getOrgClient().rpc('ps_shift_pass_end_all', { p_org_id: orgId })
  } catch {
    // ignore: the cron job ends them when the shift is over
  }
}
