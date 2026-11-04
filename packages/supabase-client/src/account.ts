// ============================================
// Account self-service and sign-in activity
// ============================================

import { getOrgClient, getUserClient } from './index'

export type AuthEvent =
  | 'sign_in' | 'sign_out' | 'idle_sign_out' | 'failed_sign_in'
  | 'password_changed' | 'two_step_on' | 'two_step_off'

/** Record a sign-in event for a pharmacy. Never throws: activity logging
 *  must not get in the way of signing in or out. failed_sign_in is logged by
 *  the pharmacy's own login, because nobody is signed in yet. */
export async function logAuthEvent(orgId: string | null | undefined, event: AuthEvent, email?: string) {
  if (!orgId) return
  try {
    const client = event === 'failed_sign_in' ? getOrgClient() : getUserClient()
    await client.rpc('ps_log_auth_event', { p_org_id: orgId, p_event: event, p_email: email ?? null })
  } catch {
    // ignore
  }
}

export interface AuthEventRow {
  id: string
  created_at: string
  event: string
  email: string | null
  full_name: string | null
  detail: Record<string, unknown>
  by_name: string | null
}

export async function listAuthEvents(orgId: string, limit = 200): Promise<AuthEventRow[]> {
  const { data, error } = await getUserClient().rpc('ps_org_list_auth_events', { p_org_id: orgId, p_limit: limit })
  if (error) throw error
  return (data ?? []) as AuthEventRow[]
}

/** Change the signed-in person's email. Supabase emails both the old and
 *  the new address; the change happens once both links are followed. */
export async function changeUserEmail(newEmail: string) {
  const { error } = await getUserClient().auth.updateUser(
    { email: newEmail.trim() },
    { emailRedirectTo: `${window.location.origin}/me` },
  )
  if (error) throw error
}

export interface DeletionRequest {
  id: string
  user_id: string
  email: string | null
  reason: string | null
  status: 'pending' | 'done' | 'declined'
  admin_note: string | null
  created_at: string
  handled_at: string | null
}

export async function myDeletionRequest(): Promise<DeletionRequest | null> {
  const { data: u } = await getUserClient().auth.getUser()
  if (!u.user) return null
  const { data, error } = await getUserClient()
    .from('ps_account_deletion_requests')
    .select('*')
    .eq('user_id', u.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return null
  return (data?.[0] as DeletionRequest) ?? null
}

export async function requestAccountDeletion(reason: string) {
  const { error } = await getUserClient().rpc('ps_request_account_deletion', { p_reason: reason })
  if (error) throw error
}

export async function cancelAccountDeletion() {
  const { error } = await getUserClient().rpc('ps_cancel_account_deletion')
  if (error) throw error
}

/** Platform admins: pending account deletion requests. */
export async function adminListDeletionRequests(): Promise<DeletionRequest[]> {
  const { data, error } = await getUserClient()
    .from('ps_account_deletion_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as DeletionRequest[]
}

export async function adminSetDeletionRequest(id: string, status: 'done' | 'declined', note?: string) {
  const { error } = await getUserClient().rpc('ps_admin_set_deletion_request', {
    p_id: id, p_status: status, p_note: note ?? null,
  })
  if (error) throw error
}
