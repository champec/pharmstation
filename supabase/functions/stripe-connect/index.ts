// ============================================
// PharmStation Edge Function: stripe-connect
// Pharmacy (organisation) onboarding to Stripe Connect Express.
//
// Actions:
//   start_onboarding — create Express account (if none) + hosted Account Link
//       body: { action, org_id, return_url, refresh_url }
//       Returns { url } → redirect the pharmacy to Stripe's hosted KYC flow.
//   get_status — pull live account state from Stripe, sync ps_org_billing
//       body: { action, org_id }
//       Returns { status, charges_enabled, payouts_enabled, stripe_account_id }
//
// Security: requires an authenticated org member. We verify the caller's JWT
// and check membership of org_id via ps_organisation_members / auth_user_id.
//
// Secrets required: STRIPE_SECRET_KEY
// ============================================

import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function getStripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('Stripe is not configured (missing STRIPE_SECRET_KEY secret)')
  return new Stripe(key, { apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient() })
}

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Map a Stripe account object to our ps_org_billing status
function accountStatus(acct: Stripe.Account): 'pending' | 'active' | 'restricted' {
  if (acct.charges_enabled && acct.payouts_enabled) return 'active'
  if (acct.requirements?.disabled_reason) return 'restricted'
  return 'pending'
}

async function syncBilling(db: ReturnType<typeof getAdminClient>, orgId: string, acct: Stripe.Account) {
  const status = accountStatus(acct)
  await db.from('ps_org_billing').upsert({
    org_id: orgId,
    stripe_account_id: acct.id,
    stripe_account_status: status,
    charges_enabled: !!acct.charges_enabled,
    payouts_enabled: !!acct.payouts_enabled,
  }, { onConflict: 'org_id' })
  return status
}

// ============================================
// Auth: caller must be an authenticated member of org_id
// ============================================
async function verifyOrgMember(req: Request, orgId: string): Promise<{ ok: boolean; error?: string }> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, error: 'Missing authorization' }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return { ok: false, error: 'Invalid session' }

  const db = getAdminClient()
  // Org auth account itself
  const { data: org } = await db
    .from('ps_organisations')
    .select('id, auth_user_id')
    .eq('id', orgId)
    .single()
  if (!org) return { ok: false, error: 'Organisation not found' }
  if (org.auth_user_id === user.id) return { ok: true }

  // Or an active org member (ps_organisation_members: organisation_id + user_id)
  const { data: member } = await db
    .from('ps_organisation_members')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (member) return { ok: true }

  return { ok: false, error: 'Not a member of this organisation' }
}

// ============================================
// start_onboarding
// ============================================
async function startOnboarding(req: Request, body: Record<string, unknown>): Promise<Response> {
  const org_id = body.org_id as string | undefined
  const return_url = body.return_url as string | undefined
  const refresh_url = body.refresh_url as string | undefined
  if (!org_id || !return_url || !refresh_url) {
    return json({ error: 'org_id, return_url and refresh_url are required' }, 400)
  }

  const auth = await verifyOrgMember(req, org_id)
  if (!auth.ok) return json({ error: auth.error }, 403)

  const db = getAdminClient()
  const stripe = getStripe()

  // Reuse existing account or create a new Express account
  const { data: billing } = await db
    .from('ps_org_billing')
    .select('stripe_account_id')
    .eq('org_id', org_id)
    .maybeSingle()

  let accountId = billing?.stripe_account_id as string | null
  if (!accountId) {
    const { data: org } = await db
      .from('ps_organisations')
      .select('name')
      .eq('id', org_id)
      .single()

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      business_profile: { name: org?.name ?? undefined },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { org_id },
    })
    accountId = account.id
    await db.from('ps_org_billing').upsert({
      org_id,
      stripe_account_id: accountId,
      stripe_account_status: 'pending',
    }, { onConflict: 'org_id' })
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url,
    refresh_url,
  })

  return json({ url: link.url })
}

// ============================================
// get_status
// ============================================
async function getStatus(req: Request, body: Record<string, unknown>): Promise<Response> {
  const org_id = body.org_id as string | undefined
  if (!org_id) return json({ error: 'org_id is required' }, 400)

  const auth = await verifyOrgMember(req, org_id)
  if (!auth.ok) return json({ error: auth.error }, 403)

  const db = getAdminClient()
  const { data: billing } = await db
    .from('ps_org_billing')
    .select('stripe_account_id, stripe_account_status, charges_enabled, payouts_enabled')
    .eq('org_id', org_id)
    .maybeSingle()

  if (!billing?.stripe_account_id) {
    return json({ status: 'not_onboarded', charges_enabled: false, payouts_enabled: false, stripe_account_id: null })
  }

  // Live sync from Stripe
  const stripe = getStripe()
  const acct = await stripe.accounts.retrieve(billing.stripe_account_id)
  const status = await syncBilling(db, org_id, acct)

  return json({
    status,
    charges_enabled: !!acct.charges_enabled,
    payouts_enabled: !!acct.payouts_enabled,
    stripe_account_id: acct.id,
  })
}

// ============================================
// Router
// ============================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  try {
    switch (body.action) {
      case 'start_onboarding':
        return await startOnboarding(req, body)
      case 'get_status':
        return await getStatus(req, body)
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400)
    }
  } catch (e) {
    console.error('stripe-connect error', e)
    return json({ error: (e as Error).message ?? 'Internal error' }, 500)
  }
})
