// Who may change a pharmacy's money settings: the subscription, text credit
// purchases and the Stripe Connect payout account.
//
// Mirrors DEFAULT_ROLE_PERMISSIONS.billing in packages/types: owners have it by
// default, every other role only when a per-member override switches it on, and
// an override of false takes it away even from an owner. The shared pharmacy
// login (ps_organisations.auth_user_id) never has it, because anyone at the
// counter can use that login and could otherwise redirect payouts.

// deno-lint-ignore no-explicit-any
type Db = any

export type BillingAccess =
  | { ok: true }
  | { ok: false; status: 403 | 404; error: string }

/** Is the caller an active member of the org? The org login does not count. */
export async function isActiveMember(db: Db, callerId: string, orgId: string): Promise<boolean> {
  const { data } = await db
    .from('ps_organisation_members')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('user_id', callerId)
    .eq('status', 'active')
    .maybeSingle()
  return !!data
}

export async function checkBillingPermission(db: Db, callerId: string, orgId: string): Promise<BillingAccess> {
  const { data: org } = await db
    .from('ps_organisations')
    .select('id, auth_user_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return { ok: false, status: 404, error: 'Organisation not found' }

  if (org.auth_user_id === callerId) {
    return {
      ok: false,
      status: 403,
      error: 'Sign in with your own staff account to change billing or payout details.',
    }
  }

  const { data: member } = await db
    .from('ps_organisation_members')
    .select('role, permissions')
    .eq('organisation_id', orgId)
    .eq('user_id', callerId)
    .eq('status', 'active')
    .maybeSingle()
  if (!member) return { ok: false, status: 403, error: 'You are not a member of this organisation' }

  const override = (member.permissions as Record<string, unknown> | null)?.billing
  const allowed = typeof override === 'boolean' ? override : member.role === 'owner'
  return allowed
    ? { ok: true }
    : { ok: false, status: 403, error: 'Only the pharmacy owner, or staff they give billing access, can do this.' }
}
