// ============================================
// Team management on the phone (owners and managers). Every write goes
// through the same SECURITY DEFINER RPCs as the website, so the database
// decides who may do what. Invites are created and emailed by the
// team-invite edge function.
// ============================================

import { userClient } from './supabase'
import type { MemberStatus, UserRole } from '@/types/auth'

export type InvitableRole = Exclude<UserRole, 'carehome_user'>

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  pharmacist: 'Pharmacist',
  technician: 'Technician',
  dispenser: 'Dispenser',
  locum: 'Locum pharmacist',
  carehome_user: 'Care home staff',
}

export interface TeamMember {
  member_id: string
  user_id: string
  full_name: string
  email: string | null
  role: UserRole
  status: MemberStatus
  is_locum: boolean
  last_active_at: string | null
}

export interface PendingInvite {
  id: string
  email: string
  role: InvitableRole
  expires_at: string
  invited_by_name: string | null
}

export interface SignInEvent {
  id: string
  created_at: string
  event: string
  email: string | null
  full_name: string | null
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function listMembers(orgId: string): Promise<TeamMember[]> {
  const { data, error } = await userClient.rpc('ps_org_list_members', { p_org_id: orgId })
  fail(error)
  return (data ?? []) as TeamMember[]
}

export async function listInvites(orgId: string): Promise<PendingInvite[]> {
  const { data, error } = await userClient.rpc('ps_org_list_invites', { p_org_id: orgId })
  fail(error)
  return (data ?? []) as PendingInvite[]
}

export async function revokeInvite(inviteId: string) {
  const { error } = await userClient.rpc('ps_org_revoke_invite', { p_invite_id: inviteId })
  fail(error)
}

export async function updateMember(memberId: string, changes: { role?: UserRole; status?: 'active' | 'suspended' | 'revoked' }) {
  const { error } = await userClient.rpc('ps_org_update_member', {
    p_member_id: memberId,
    p_role: changes.role ?? null,
    p_status: changes.status ?? null,
    p_permissions: null,
  })
  fail(error)
}

export async function resetMemberTwoStep(memberId: string) {
  const { error } = await userClient.rpc('ps_org_reset_member_mfa', { p_member_id: memberId })
  fail(error)
}

export async function sendInvite(orgId: string, email: string, role: InvitableRole) {
  const { data, error } = await userClient.functions.invoke('team-invite', {
    body: { org_id: orgId, email: email.trim().toLowerCase(), role },
  })
  if (error) {
    let message = 'Couldn’t create the invite.'
    try {
      const ctx = (error as { context?: Response }).context
      const parsed = ctx ? await ctx.json() : null
      if (parsed?.error) message = parsed.error
    } catch {
      // keep the default
    }
    throw new Error(message)
  }
  return data as { link: string; emailed: boolean; expires_at: string }
}

export async function listSignInActivity(orgId: string, limit = 50): Promise<SignInEvent[]> {
  const { data, error } = await userClient.rpc('ps_org_list_auth_events', { p_org_id: orgId, p_limit: limit })
  fail(error)
  return (data ?? []) as SignInEvent[]
}

export const EVENT_LABELS: Record<string, string> = {
  sign_in: 'Signed in',
  sign_out: 'Signed out',
  idle_sign_out: 'Signed out (inactive)',
  failed_sign_in: 'Failed sign-in',
  password_changed: 'Changed password',
  two_step_on: 'Turned on two-step sign-in',
  two_step_off: 'Turned off two-step sign-in',
  two_step_reset: 'Two-step reset by a manager',
  two_step_reset_by_email: 'Reset two-step by email',
  member_added: 'Added to the pharmacy',
  member_changed: 'Role or access changed',
}

/** Turn database refusals into something a manager can act on. */
export function teamErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/two-step|aal2/i.test(msg)) {
    return 'This needs two-step sign-in. Turn it on in My Account > Security, then sign out and back in with your code.'
  }
  return msg
}
