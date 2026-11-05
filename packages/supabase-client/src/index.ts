// ============================================
// PharmStation Supabase Dual-Client
// TWO clients, because two sessions run concurrently on one device:
//   orgClient  (ps-org-session)  — the pharmacy workstation, signed in all day
//   userClient (ps-user-session) — the current human at the keyboard
//
// Everything else — locum, patient, driver, dispenser — is a ROLE on the
// user account, not an account type. Roles are profile/permission rows;
// RLS keys off auth.uid(). Portals are just differently-gated routes that
// ride the user session. Do NOT add per-role clients.
// ============================================

import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js'

let _orgClient: SupabaseClient | null = null
let _userClient: SupabaseClient | null = null
let _config: SupabaseConfig | null = null

export interface SupabaseConfig {
  url: string
  anonKey: string
}

/**
 * Initialize the dual Supabase clients.
 * Must be called once at app startup.
 */
export function initSupabase(config: SupabaseConfig) {
  // detectSessionInUrl is off for BOTH clients. With two clients on one page,
  // an email-confirmation redirect would otherwise be picked up by whichever
  // client reads the URL first, so a staff member's personal session could
  // land in the pharmacy (org) slot or vice versa. After confirming, people
  // sign in with their password instead.
  stripAuthTokensFromUrl()
  _config = config

  _orgClient = createClient(config.url, config.anonKey, {
    auth: {
      storageKey: 'ps-org-session',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })

  _userClient = createClient(config.url, config.anonKey, {
    auth: {
      storageKey: 'ps-user-session',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })

  return { orgClient: _orgClient, userClient: _userClient }
}

let _authRedirectType: string | null = null

/** Remove auth tokens from the URL hash (so they don't sit in history) and
 *  remember what kind of redirect it was. */
function stripAuthTokensFromUrl() {
  if (typeof window === 'undefined') return
  const hash = window.location.hash
  if (!hash || !/(access_token|error_description)=/.test(hash)) return
  const params = new URLSearchParams(hash.slice(1))
  _authRedirectType = params.get('error_description') ? 'error' : params.get('type')
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
}

/** 'signup' when the page was opened from an email-confirmation link. */
export function getAuthRedirectType(): string | null {
  return _authRedirectType
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
 * User client — the current human. Switches when staff change.
 * Used for: all writes (entered_by = auth.uid()), user profile access,
 * and every role-gated portal (locum, patient, driver, …).
 */
export function getUserClient(): SupabaseClient {
  if (!_userClient) throw new Error('Supabase not initialized. Call initSupabase() first.')
  return _userClient
}

/**
 * @deprecated Patient is a role, not an account — alias of getUserClient().
 * Kept so existing patient-portal pages keep working unchanged.
 */
export function getPatientClient(): SupabaseClient {
  return getUserClient()
}

// ============================================
// Password reset
// Works for every kind of account (pharmacy login, staff, personal,
// patient) without touching the org or user session on this device:
// a throwaway, non-persisting client verifies the one-time token from
// the email, sets the new password and signs straight out again.
// The recovery email template links to
//   {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery
// ============================================

function makeEphemeralClient(): SupabaseClient {
  if (!_config) throw new Error('Supabase not initialized. Call initSupabase() first.')
  return createClient(_config.url, _config.anonKey, {
    auth: {
      storageKey: 'ps-password-reset',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

/** Email a password reset link. Resolves even if no account has that
 *  email, so the form can't be used to discover who has an account. */
export async function requestPasswordReset(email: string, redirectTo: string) {
  const { error } = await makeEphemeralClient().auth.resetPasswordForEmail(email.trim(), { redirectTo })
  if (error) throw error
}

/** Use the token from a reset email to set a new password. */
export async function completePasswordReset(tokenHash: string, newPassword: string) {
  const client = makeEphemeralClient()
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
  if (error) throw error
  if (!data.session) throw new Error('This reset link is no longer valid. Request a new one.')
  const { error: updateError } = await client.auth.updateUser({ password: newPassword })
  // Sign this account out everywhere: anyone holding an old session is
  // removed, and the person signs in again with the new password.
  await client.auth.signOut()
  if (updateError) throw updateError
}

/** Change the password of the person signed in on the user layer.
 *  Checks the current password first, so an unattended session can't be
 *  used to lock the owner out. */
export async function changeUserPassword(currentPassword: string, newPassword: string) {
  const client = getUserClient()
  const { data: userData } = await client.auth.getUser()
  const email = userData.user?.email
  if (!email) throw new Error('Sign in again, then try once more.')
  const check = makeEphemeralClient()
  const { error: checkError } = await check.auth.signInWithPassword({ email, password: currentPassword })
  if (checkError) throw new Error('Your current password is not right.')
  await check.auth.signOut({ scope: 'local' })
  const { error } = await client.auth.updateUser({ password: newPassword })
  if (error) throw error
}

/** Client-side password rule, matching the London auth settings
 *  (10+ characters with letters and numbers). Returns an error message
 *  or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers'
  return null
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

/** A locum with an approved booking at this pharmacy around now gets
 *  temporary access (1 hour before the shift to 2 hours after). Returns
 *  true when they now have an active membership. */
export async function claimLocumShiftAccess(orgId: string): Promise<boolean> {
  const { data, error } = await getUserClient().rpc('ps_locum_claim_shift_access', { p_org_id: orgId })
  if (error) return false
  return data === true
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

// ============================================
// Patient auth helpers
// ============================================

export async function patientSignIn(email: string, password: string) {
  const { data, error } = await getPatientClient().auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function patientSignUp(
  email: string,
  password: string,
  metadata: { first_name: string; last_name: string; organisation_id: string; account_type: 'patient' }
) {
  const { data, error } = await getPatientClient().auth.signUp({
    email,
    password,
    options: {
      data: metadata,
      emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/patient/login?confirmed=1` : undefined,
    },
  })
  if (error) throw error
  return data
}

export async function patientSignOut() {
  const { error } = await getPatientClient().auth.signOut()
  if (error) throw error
}

export async function getPatientSession(): Promise<Session | null> {
  const { data } = await getPatientClient().auth.getSession()
  return data.session
}

/**
 * The signed-in patient's record. A patient can be registered with more than
 * one pharmacy (one ps_patients row each); the first one is their profile.
 * Links any unlinked records with the same confirmed email first.
 */
export async function fetchPatientProfile(authUserId: string) {
  const client = getPatientClient()
  await client.rpc('ps_link_my_patient_account')
  const { data, error } = await client
    .from('ps_patients')
    .select('*')
    .eq('auth_user_id', authUserId)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No patient record is linked to this account yet. If you have just signed up, please confirm your email first.')
  return data
}

// ============================================
// Locum role helper
// Locum is a role on the user account — there is no separate locum
// login/session. Fetches the ps_locum_profiles row (null if the role
// hasn't been activated yet) using the normal user-layer session.
// ============================================

export async function fetchLocumExtendedProfile(userId: string) {
  const { data, error } = await getUserClient()
    .from('ps_locum_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

// Pharmacy onboarding + team management
export * from './team'

// Two-step sign-in
export * from './mfa'

// Account self-service and sign-in activity
export * from './account'
