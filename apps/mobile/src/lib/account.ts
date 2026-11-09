// ============================================
// Account self-service on the phone: profile, email, password, password
// reset, two-step sign-in status and account deletion requests. Mirrors
// packages/supabase-client/src/account.ts for the website.
// ============================================

import { createClient } from '@supabase/supabase-js'

import { userClient } from './supabase'
import type { UserProfile } from '@/types/auth'

const SITE = 'https://pharmstation.co.uk'

/** A throwaway client that never stores a session (used to check a password). */
function ephemeralClient() {
  return createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Same rule as the London auth settings (10+ characters, letters and numbers). */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers.'
  return null
}

export async function updateMyProfile(
  userId: string,
  fields: { first_name: string; last_name: string; phone: string; gphc_number: string },
  fallbackName: string,
): Promise<Partial<UserProfile>> {
  const fullName = `${fields.first_name.trim()} ${fields.last_name.trim()}`.trim()
  const update = {
    first_name: fields.first_name.trim() || null,
    last_name: fields.last_name.trim() || null,
    full_name: fullName || fallbackName,
    phone: fields.phone.trim() || null,
    gphc_number: fields.gphc_number.trim() || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await userClient.from('ps_user_profiles').update(update).eq('id', userId)
  if (error) throw new Error(error.message)
  return update
}

/** Checks the current password first, so an unattended phone can't be used
 *  to lock the owner out. */
export async function changeMyPassword(currentPassword: string, newPassword: string) {
  const problem = passwordProblem(newPassword)
  if (problem) throw new Error(problem)
  const { data } = await userClient.auth.getUser()
  const email = data.user?.email
  if (!email) throw new Error('Sign in again, then try once more.')
  const check = ephemeralClient()
  const { error: checkError } = await check.auth.signInWithPassword({ email, password: currentPassword })
  if (checkError) throw new Error('Your current password isn’t right.')
  await check.auth.signOut({ scope: 'local' })
  const { error } = await userClient.auth.updateUser({ password: newPassword })
  if (error) {
    if (/aal2|assurance/i.test(error.message)) {
      throw new Error('Sign out and back in with your two-step code, then change your password.')
    }
    throw new Error(error.message)
  }
}

/** Supabase emails both the old and the new address; the change happens
 *  once both links are followed. */
export async function changeMyEmail(newEmail: string) {
  const email = newEmail.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.')
  const { error } = await userClient.auth.updateUser({ email }, { emailRedirectTo: `${SITE}/me` })
  if (error) throw new Error(error.message)
}

/** Emails a reset link. Resolves even when no account has that email, so it
 *  can't be used to find out who has an account. The link opens the website. */
export async function requestPasswordResetEmail(email: string) {
  const clean = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter the email you sign in with.')
  const { error } = await ephemeralClient().auth.resetPasswordForEmail(clean, { redirectTo: `${SITE}/reset-password/me` })
  if (error && !/rate|seconds/i.test(error.message)) throw new Error(error.message)
  if (error) throw new Error('A reset email was sent a moment ago. Wait a minute, then try again.')
}

export interface TotpFactor { id: string; friendlyName: string | null; createdAt: string }

export async function listMyTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await userClient.auth.mfa.listFactors()
  if (error) throw new Error(error.message)
  return (data?.totp ?? [])
    .filter((f) => f.status === 'verified')
    .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, createdAt: f.created_at }))
}

/** Needs a session that entered its code (aal2). */
export async function removeMyTotpFactor(factorId: string) {
  const { error } = await userClient.auth.mfa.unenroll({ factorId })
  if (error) {
    if (/aal2|assurance/i.test(error.message)) {
      throw new Error('Sign out and back in with your two-step code first.')
    }
    throw new Error(error.message)
  }
}

export interface DeletionRequest {
  id: string
  status: 'pending' | 'done' | 'declined'
  reason: string | null
  admin_note: string | null
  created_at: string
}

export async function myDeletionRequest(): Promise<DeletionRequest | null> {
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return null
  const { data, error } = await userClient
    .from('ps_account_deletion_requests')
    .select('id, status, reason, admin_note, created_at')
    .eq('user_id', u.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return null
  return (data?.[0] as DeletionRequest) ?? null
}

export async function requestAccountDeletion(reason: string) {
  const { error } = await userClient.rpc('ps_request_account_deletion', { p_reason: reason })
  if (error) throw new Error(error.message)
}

export async function cancelAccountDeletion() {
  const { error } = await userClient.rpc('ps_cancel_account_deletion')
  if (error) throw new Error(error.message)
}

/** Record a sign-in event for the connected pharmacy. Never throws. */
export async function logAuthEvent(orgId: string | null | undefined, event: string) {
  if (!orgId) return
  try {
    await userClient.rpc('ps_log_auth_event', { p_org_id: orgId, p_event: event, p_email: null })
  } catch {
    // ignore
  }
}
