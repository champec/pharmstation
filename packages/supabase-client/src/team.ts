// ============================================
// Pharmacy onboarding + team management
// All writes go through SECURITY DEFINER RPCs that enforce the rules in the
// database (see supabase/migrations/*_pharmacy_signup_and_staff_invites.sql).
// The browser never inserts membership rows directly.
// ============================================

import type {
  InvitableRole,
  InvitePreview,
  OrganisationInvite,
  Permissions,
  TeamMember,
  UserRole,
  MemberStatus,
} from '@pharmstation/types'
import { getOrgClient, getUserClient } from './index'

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

/** Turn Supabase sign-up errors into something a pharmacist can act on. */
export function friendlyAuthError(err: unknown): string {
  const message = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err
    ? String((err as { message: unknown }).message)
    : 'Something went wrong. Please try again.'
  if (/database error saving new user/i.test(message)) {
    return 'We couldn’t create that account. The GPhC premises number may already be registered. Contact hello@pharmstation.co.uk if this is your pharmacy.'
  }
  if (/already registered|already been registered|user already exists/i.test(message)) {
    return 'That email already has a PharmStation account. Sign in instead, or use a different email.'
  }
  if (/password/i.test(message) && /(weak|short|least|pwned|leaked)/i.test(message)) {
    return 'Choose a stronger password: at least 10 characters with letters and numbers, and not one that has appeared in a data breach.'
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts. Wait a few minutes and try again.'
  }
  return message
}

/** Absolute link for an invite token. */
export function inviteLink(token: string): string {
  return `${window.location.origin}/join/${token}`
}

// ---------- Workstation (org session) ----------

export async function orgNeedsOwner(): Promise<boolean> {
  const res = await getOrgClient().rpc('ps_org_needs_owner')
  if (res.error) return false
  return res.data === true
}

/**
 * Called with the pharmacy workstation session straight after sign-up.
 * Issues a one-day owner invite bound to the owner's personal email, which
 * acceptInvite() then redeems with the owner's own session.
 */
export async function startOwnerClaim(ownerEmail: string): Promise<string> {
  const rows = unwrap(await getOrgClient().rpc('ps_org_start_owner_claim', { p_email: ownerEmail })) as
    { token: string }[]
  if (!rows?.[0]?.token) throw new Error('Could not start owner setup. Please try again.')
  return rows[0].token
}

// ---------- Invites (user session) ----------

export async function createInvite(
  orgId: string,
  email: string,
  role: InvitableRole,
  permissions?: Permissions,
): Promise<{ inviteId: string; token: string; expiresAt: string }> {
  const rows = unwrap(await getUserClient().rpc('ps_org_create_invite', {
    p_org_id: orgId,
    p_email: email,
    p_role: role,
    p_permissions: permissions && Object.keys(permissions).length ? permissions : null,
  })) as { invite_id: string; token: string; expires_at: string }[]
  const row = rows?.[0]
  if (!row) throw new Error('Could not create the invite')
  return { inviteId: row.invite_id, token: row.token, expiresAt: row.expires_at }
}

export async function listInvites(orgId: string): Promise<OrganisationInvite[]> {
  return (unwrap(await getUserClient().rpc('ps_org_list_invites', { p_org_id: orgId })) ?? []) as OrganisationInvite[]
}

export async function revokeInvite(inviteId: string): Promise<void> {
  unwrap(await getUserClient().rpc('ps_org_revoke_invite', { p_invite_id: inviteId }))
}

export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const rows = unwrap(await getUserClient().rpc('ps_invite_preview', { p_token: token })) as InvitePreview[]
  return rows?.[0] ?? null
}

export async function acceptInvite(token: string): Promise<{ organisation_id: string; organisation_name: string; role: UserRole }> {
  const rows = unwrap(await getUserClient().rpc('ps_accept_org_invite', { p_token: token })) as
    { organisation_id: string; organisation_name: string; role: UserRole }[]
  if (!rows?.[0]) throw new Error('Could not accept the invite')
  return rows[0]
}

// ---------- Members ----------

export async function listMembers(orgId: string): Promise<TeamMember[]> {
  return (unwrap(await getUserClient().rpc('ps_org_list_members', { p_org_id: orgId })) ?? []) as TeamMember[]
}

export async function updateMember(
  memberId: string,
  changes: { role?: UserRole; status?: Exclude<MemberStatus, 'pending'>; permissions?: Permissions },
): Promise<void> {
  unwrap(await getUserClient().rpc('ps_org_update_member', {
    p_member_id: memberId,
    p_role: changes.role ?? null,
    p_status: changes.status ?? null,
    p_permissions: changes.permissions ?? null,
  }))
}
