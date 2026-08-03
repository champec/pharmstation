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
// On mobile, sessions are persisted with AsyncStorage instead of localStorage.
// ============================================

import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
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
      storage: AsyncStorage,
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
