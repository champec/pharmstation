// ============================================
// PharmStation mobile — Supabase dual-client
//
// Mirrors the web architecture (packages/supabase-client): ONE Supabase
// project, but two independent auth clients distinguished by `storageKey`.
//
//   - userClient (ps-user-session) : the person's personal account. This is
//     the PRIMARY/standalone identity. You can log in here alone and only
//     reach personal-account features.
//   - orgClient  (ps-org-session)  : the pharmacy the person is working at.
//     This is ADDITIVE. Holding BOTH tokens (and an active membership) unlocks
//     the org-scoped modules (deliveries, scanning, pharmacy management...).
//
// On mobile, sessions are kept in the device's secure storage (Keychain /
// Keystore) via secure-session-storage.ts.
// ============================================

import 'react-native-url-polyfill/auto'
import { secureSessionStorage } from './secure-session-storage'
import { AppState } from 'react-native'
import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Add them to apps/mobile/.env (see .env.example).',
  )
}

function makeClient(storageKey: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      storage: secureSessionStorage,
      storageKey,
      autoRefreshToken: true,
      persistSession: true,
      // No URL-based session detection on native.
      detectSessionInUrl: false,
    },
  })
}

/** Personal-account client (primary identity). */
export const userClient = makeClient('ps-user-session')

/** Organisation client (additive; the pharmacy you're working at). */
export const orgClient = makeClient('ps-org-session')

// ---- Auto-refresh tokens while the app is in the foreground. ----
// Supabase recommends gating autoRefresh on AppState for React Native.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    userClient.auth.startAutoRefresh()
    orgClient.auth.startAutoRefresh()
  } else {
    userClient.auth.stopAutoRefresh()
    orgClient.auth.stopAutoRefresh()
  }
})

// ============================================
// User (personal account) helpers
// ============================================

export async function userSignIn(email: string, password: string) {
  return userClient.auth.signInWithPassword({ email, password })
}

export async function userSignOut() {
  return userClient.auth.signOut()
}

export async function getUserSession(): Promise<Session | null> {
  const { data } = await userClient.auth.getSession()
  return data.session
}

export async function fetchUserProfile(userId: string) {
  const { data, error } = await userClient
    .from('ps_user_profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function fetchLocumProfile(userId: string) {
  const { data, error } = await userClient
    .from('ps_locum_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

// ============================================
// Organisation helpers
// ============================================

export async function orgSignIn(email: string, password: string) {
  return orgClient.auth.signInWithPassword({ email, password })
}

export async function orgSignOut() {
  return orgClient.auth.signOut()
}

export async function getOrgSession(): Promise<Session | null> {
  const { data } = await orgClient.auth.getSession()
  return data.session
}

export async function fetchOrganisation(authUserId: string) {
  const { data, error } = await orgClient
    .from('ps_organisations')
    .select('*')
    .eq('auth_user_id', authUserId)
    .single()
  if (error) throw error
  return data
}

/**
 * Find the active membership linking the currently-signed-in user to the org.
 * Returns null if the user is not an approved/active member.
 */
export async function fetchOrgMembership(orgId: string, userId: string) {
  const { data, error } = await userClient
    .from('ps_organisation_members')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data
}

// ============================================
// Two-step sign-in (authenticator app)
// ============================================

/** needsCode: this account has two-step sign-in and the session hasn't
 *  entered its code yet. */
export async function getMfaStatus(): Promise<{ needsCode: boolean; factorId: string | null }> {
  const { data, error } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  const needsCode = data.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
  if (!needsCode) return { needsCode: false, factorId: null }
  const { data: factors } = await userClient.auth.mfa.listFactors()
  const factor = factors?.totp?.find((f) => f.status === 'verified')
  return { needsCode: true, factorId: factor?.id ?? null }
}

export async function verifyTotpCode(factorId: string, code: string) {
  const { error } = await userClient.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
  if (!error) return
  const msg = `${(error as { code?: string }).code ?? ''} ${error.message}`
  if (/session.?missing|session_not_found|not.?authenticated|jwt|refresh.?token/i.test(msg)) {
    throw new Error('You\u2019ve been signed out. This happens when two-step sign-in is turned on from another device. Tap \u201cUse a different account\u201d and sign in again.')
  }
  if (/factor.*not.?found/i.test(msg)) {
    throw new Error('Two-step sign-in was set up again from another device. Sign in again to use the new code.')
  }
  throw new Error('That code didn\u2019t work. Check the time on your phone is right, then try the newest code.')
}

/** Turn on two-step sign-in using this phone as the authenticator.
 *  Returns the new factor's secret so the app can keep it and make codes;
 *  call verifyTotpCode with a code from that secret to finish. */
export async function startPhoneTotpEnrollment(): Promise<{ factorId: string; secret: string; uri: string }> {
  // Clear half-finished setups so they don't block a new one.
  const { data: existing } = await userClient.auth.mfa.listFactors()
  for (const f of existing?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') {
      await userClient.auth.mfa.unenroll({ factorId: f.id })
    }
  }
  const { data, error } = await userClient.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'PharmStation',
    friendlyName: `PharmStation app ${new Date().toISOString().slice(0, 16)}`,
  })
  if (error) {
    throw new Error(
      /aal2|assurance/i.test(error.message)
        ? 'Two-step sign-in is already on for this account. Scan the QR code from the website instead, or sign in again with your code first.'
        : error.message,
    )
  }
  return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri }
}

/** True if the account already has two-step sign-in turned on. */
export async function hasVerifiedTotp(): Promise<boolean> {
  const { data } = await userClient.auth.mfa.listFactors()
  return (data?.totp ?? []).some((f) => f.status === 'verified')
}

/** Booked locums get access to the shift pharmacy around their shift. */
export async function claimLocumShiftAccess(orgId: string): Promise<boolean> {
  const { data, error } = await userClient.rpc('ps_locum_claim_shift_access', { p_org_id: orgId })
  return !error && data === true
}

/** Where people reset a forgotten password (the web app handles it). */
export const FORGOT_PASSWORD_URL = 'https://pharmstation.co.uk/forgot-password/me'
