// ============================================
// PharmStation Supabase Dual-Client
// Two real Supabase Auth clients, two sessions, no clash
// ============================================

import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js'

let _orgClient: SupabaseClient | null = null
let _userClient: SupabaseClient | null = null

export interface SupabaseConfig {
  url: string
  anonKey: string
}

/**
 * Initialize the dual Supabase clients.
 * Must be called once at app startup.
 */
export function initSupabase(config: SupabaseConfig) {
  _orgClient = createClient(config.url, config.anonKey, {
    auth: {
      storageKey: 'ps-org-session',
      autoRefreshToken: true,
      persistSession: true,
    },
  })

  _userClient = createClient(config.url, config.anonKey, {
    auth: {
      storageKey: 'ps-user-session',
      autoRefreshToken: true,
      persistSession: true,
    },
  })

  return { orgClient: _orgClient, userClient: _userClient }
}

/**
 * Organisation client — long-lived session, scopes data to the pharmacy.
 * Used for: reading org data, settings, realtime subscriptions.
 */
export function getOrgClient(): SupabaseClient {
  if (!_orgClient) throw new Error('Supabase not initialized. Call initSupabase() first.')
  return _orgClient
}

/**
 * User client — switches when staff change.
 * Used for: all writes (entered_by = auth.uid()), user profile access.
 */
export function getUserClient(): SupabaseClient {
  if (!_userClient) throw new Error('Supabase not initialized. Call initSupabase() first.')
  return _userClient
}

// ============================================
// Auth helpers
// ============================================

export async function orgSignIn(email: string, password: string) {
  const client = getOrgClient()
  return client.auth.signInWithPassword({ email, password })
}

export async function orgSignOut() {
  const client = getOrgClient()
  // If org signs out, user must too
  await getUserClient().auth.signOut()
  return client.auth.signOut()
}

export async function userSignIn(email: string, password: string) {
  const client = getUserClient()
  return client.auth.signInWithPassword({ email, password })
}

export async function userSignOut() {
  const client = getUserClient()
  return client.auth.signOut()
}

export async function getOrgSession(): Promise<Session | null> {
  const { data } = await getOrgClient().auth.getSession()
  return data.session
}

export async function getUserSession(): Promise<Session | null> {
  const { data } = await getUserClient().auth.getSession()
  return data.session
}

export async function getOrgUser(): Promise<User | null> {
  const { data } = await getOrgClient().auth.getUser()
  return data.user
}

export async function getCurrentUser(): Promise<User | null> {
  const { data } = await getUserClient().auth.getUser()
  return data.user
}

// ============================================
// Organisation helpers
// ============================================

export async function fetchOrganisation(authUserId: string) {
  const { data, error } = await getOrgClient()
    .from('ps_organisations')
    .select('*')
    .eq('auth_user_id', authUserId)
    .single()

  if (error) throw error
  return data
}

export async function fetchUserProfile(userId: string) {
  const { data, error } = await getUserClient()
    .from('ps_user_profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data
}

export async function fetchOrgMembership(orgId: string, userId: string) {
  const { data, error } = await getUserClient()
    .from('ps_organisation_members')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  if (error) throw error
  return data
}

// Re-export Supabase types
export type { SupabaseClient, Session, User } from '@supabase/supabase-js'
