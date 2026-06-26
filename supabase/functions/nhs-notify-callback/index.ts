// ============================================
// PharmStation Edge Function: nhs-notify-callback
//
// A SINGLE shared callback endpoint for every pharmacy's GOV.UK Notify
// account. Each pharmacy pastes this URL + their unique callback token
// (from PharmStation → Integrations → Messaging) into their Notify
// dashboard (API integration → Callbacks).
//
// GOV.UK Notify cannot set callbacks via API, so this is configured once
// per pharmacy in their dashboard. Notify then POSTs a delivery receipt
// here whenever a message is delivered or fails, with:
//   Authorization: Bearer <callback_token>
//   body: { id, reference, to, status, created_at, completed_at,
//           sent_at, notification_type, template_id, template_version }
//
// We authenticate by matching the bearer token to an org, then update the
// matching ps_messages row (by Notify's notification id).
//
// verify_jwt is OFF — auth is the per-org bearer token, not a Supabase JWT.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function mapNotifyStatus(notifyStatus: string): string {
  if (['delivered', 'sent', 'received'].includes(notifyStatus)) return 'delivered'
  if (notifyStatus === 'permanent-failure') return 'permanent-failure'
  if (notifyStatus === 'temporary-failure') return 'temporary-failure'
  if (notifyStatus === 'technical-failure') return 'technical-failure'
  if (notifyStatus === 'failed') return 'failed'
  return 'sending'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = getAdminClient()

  // ---- Authenticate the pharmacy by its callback token ----
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Missing bearer token' }, 401)

  const { data: settings, error: sErr } = await admin
    .from('ps_notify_settings')
    .select('org_id')
    .eq('callback_token', token)
    .maybeSingle()

  if (sErr || !settings) return json({ error: 'Invalid callback token' }, 403)
  const orgId = settings.org_id

  // ---- Parse the receipt ----
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const notifyId = payload.id as string | undefined
  const notifyStatus = payload.status as string | undefined
  if (!notifyId || !notifyStatus) return json({ error: 'Missing id or status' }, 400)

  const status = mapNotifyStatus(notifyStatus)
  const now = new Date().toISOString()
  const completedAt = (payload.completed_at as string) || now

  const updates: Record<string, unknown> = {
    status,
    completed_at: completedAt,
    updated_at: now,
  }
  if (status === 'delivered') updates.delivered_at = completedAt
  if (['failed', 'permanent-failure', 'temporary-failure', 'technical-failure'].includes(status)) {
    updates.failed_at = completedAt
    updates.failure_reason = notifyStatus
  }
  if (payload.sent_at) updates.sent_at = payload.sent_at

  // Match by Notify's notification id, scoped to the authenticated org.
  const { data: updated, error: uErr } = await admin
    .from('ps_messages')
    .update(updates)
    .eq('notify_message_id', notifyId)
    .eq('org_id', orgId)
    .select('id')

  if (uErr) {
    console.error('callback update error', uErr)
    // 200 so Notify does not retry forever on a transient/data issue.
    return json({ received: true, updated: 0, note: 'update_error' })
  }

  // Acknowledge even when no row matched (e.g. smoke-test sends never persist).
  return json({ received: true, updated: updated?.length ?? 0 })
})
