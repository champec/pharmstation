// ============================================================
// stripe-connect (v4)
// Stripe Connect Express onboarding for PharmStation entities.
//
// Entities:
//   - 'org'   (default) — pharmacy organisation, account stored in ps_org_billing
//   - 'locum'           — locum pharmacist, account stored in ps_locum_profiles
//
// Actions:
//   - start_onboarding : create Express account (if needed) + onboarding link
//   - get_status       : report account status (charges/payouts enabled)
//
// Deployed via MCP. Do not run local supabase CLI deploys.
// ============================================================

import Stripe from 'npm:stripe@18.0.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getStripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, { apiVersion: '2025-03-31.basil' });
}

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ------------------------------------------------------------
// Caller identity (JWT -> auth user id)
// ------------------------------------------------------------
async function getCaller(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await anon.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

// ------------------------------------------------------------
// Org membership check: caller must be the org auth user OR an
// active member of the organisation.
// ------------------------------------------------------------
async function verifyOrgMember(callerId: string, orgId: string): Promise<boolean> {
  const admin = getAdminClient();

  const { data: org } = await admin
    .from('ps_organisations')
    .select('id, auth_user_id')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return false;
  if (org.auth_user_id === callerId) return true;

  const { data: member } = await admin
    .from('ps_organisation_members')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('user_id', callerId)
    .eq('status', 'active')
    .maybeSingle();
  return !!member;
}

// ------------------------------------------------------------
// Entity adapters
// ------------------------------------------------------------
interface EntityCtx {
  /** metadata stamped onto the Stripe account (used by webhook to route updates) */
  metadata: Record<string, string>;
  /** existing Stripe account id, if any */
  accountId: string | null;
  /** display/business name hint for Stripe */
  displayName: string | null;
  /** persist a newly created Stripe account id */
  saveAccountId: (accountId: string) => Promise<void>;
  /** persist latest status snapshot from Stripe */
  syncStatus: (status: {
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    status: string;
  }) => Promise<void>;
}

async function orgContext(orgId: string): Promise<EntityCtx> {
  const admin = getAdminClient();

  const { data: org, error } = await admin
    .from('ps_organisations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !org) throw new Error('Organisation not found');

  const { data: billing } = await admin
    .from('ps_org_billing')
    .select('stripe_account_id')
    .eq('org_id', orgId)
    .maybeSingle();

  return {
    metadata: { org_id: orgId },
    accountId: billing?.stripe_account_id ?? null,
    displayName: org.name ?? null,
    saveAccountId: async (accountId: string) => {
      const { error: upErr } = await admin
        .from('ps_org_billing')
        .upsert(
          {
            org_id: orgId,
            stripe_account_id: accountId,
            account_status: 'onboarding',
            charges_enabled: false,
            payouts_enabled: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id' },
        );
      if (upErr) throw new Error(`Failed to save account id: ${upErr.message}`);
    },
    syncStatus: async (s) => {
      const { error: upErr } = await admin
        .from('ps_org_billing')
        .upsert(
          {
            org_id: orgId,
            stripe_account_id: s.accountId,
            account_status: s.status,
            charges_enabled: s.chargesEnabled,
            payouts_enabled: s.payoutsEnabled,
            details_submitted: s.detailsSubmitted,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id' },
        );
      if (upErr) throw new Error(`Failed to sync status: ${upErr.message}`);
    },
  };
}

async function locumContext(userId: string): Promise<EntityCtx> {
  const admin = getAdminClient();

  const { data: locum, error } = await admin
    .from('ps_locum_profiles')
    .select('id, user_id, stripe_account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !locum) {
    throw new Error('No locum profile found — complete your locum profile first');
  }

  const { data: profile } = await admin
    .from('ps_user_profiles')
    .select('full_name')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    metadata: { locum_user_id: userId },
    accountId: locum.stripe_account_id ?? null,
    displayName: profile?.full_name ?? null,
    saveAccountId: async (accountId: string) => {
      const { error: upErr } = await admin
        .from('ps_locum_profiles')
        .update({ stripe_account_id: accountId, stripe_onboarded: false })
        .eq('user_id', userId);
      if (upErr) throw new Error(`Failed to save account id: ${upErr.message}`);
    },
    syncStatus: async (s) => {
      const { error: upErr } = await admin
        .from('ps_locum_profiles')
        .update({
          stripe_account_id: s.accountId,
          stripe_onboarded: s.status === 'active',
        })
        .eq('user_id', userId);
      if (upErr) throw new Error(`Failed to sync status: ${upErr.message}`);
    },
  };
}

// ------------------------------------------------------------
// Resolve entity context from request body + caller auth
// ------------------------------------------------------------
async function resolveEntity(
  req: Request,
  body: Record<string, unknown>,
): Promise<{ ctx: EntityCtx } | { errorResponse: Response }> {
  const callerId = await getCaller(req);
  if (!callerId) {
    return { errorResponse: json({ error: 'Not authenticated' }, 401) };
  }

  const entity = (body.entity as string) || 'org';

  if (entity === 'locum') {
    try {
      const ctx = await locumContext(callerId);
      return { ctx };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Locum profile error';
      return { errorResponse: json({ error: msg }, 403) };
    }
  }

  // default: org
  const orgId = body.org_id as string | undefined;
  if (!orgId) {
    return { errorResponse: json({ error: 'org_id is required' }, 400) };
  }
  const allowed = await verifyOrgMember(callerId, orgId);
  if (!allowed) {
    return { errorResponse: json({ error: 'Not authorised for this organisation' }, 403) };
  }
  try {
    const ctx = await orgContext(orgId);
    return { ctx };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Organisation error';
    return { errorResponse: json({ error: msg }, 404) };
  }
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------
async function startOnboarding(
  ctx: EntityCtx,
  body: Record<string, unknown>,
): Promise<Response> {
  const stripe = getStripe();

  const returnUrl = body.return_url as string | undefined;
  const refreshUrl = body.refresh_url as string | undefined;
  if (!returnUrl || !refreshUrl) {
    return json({ error: 'return_url and refresh_url are required' }, 400);
  }

  let accountId = ctx.accountId;

  if (!accountId) {
    const isLocum = !!ctx.metadata.locum_user_id;
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      ...(isLocum ? { business_type: 'individual' as const } : {}),
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      ...(ctx.displayName
        ? { business_profile: { name: ctx.displayName } }
        : {}),
      metadata: ctx.metadata,
    });
    accountId = account.id;
    await ctx.saveAccountId(account.id);
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });

  return json({ url: link.url, account_id: accountId });
}

async function getStatus(ctx: EntityCtx): Promise<Response> {
  if (!ctx.accountId) {
    return json({
      status: 'not_onboarded',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
  }

  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(ctx.accountId);

  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  const detailsSubmitted = !!account.details_submitted;

  let status = 'onboarding';
  if (chargesEnabled && payoutsEnabled) status = 'active';
  else if (detailsSubmitted) status = 'pending_verification';

  await ctx.syncStatus({
    accountId: ctx.accountId,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    status,
  });

  return json({
    status,
    account_id: ctx.accountId,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    details_submitted: detailsSubmitted,
  });
}

// ------------------------------------------------------------
// Router
// ------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body.action as string | undefined;

    const resolved = await resolveEntity(req, body);
    if ('errorResponse' in resolved) return resolved.errorResponse;
    const { ctx } = resolved;

    switch (action) {
      case 'start_onboarding':
        return await startOnboarding(ctx, body);
      case 'get_status':
        return await getStatus(ctx);
      default:
        return json({ error: `Unknown action: ${action ?? '(none)'}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('stripe-connect error:', msg);
    return json({ error: msg }, 500);
  }
});
