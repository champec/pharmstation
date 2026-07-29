// ============================================
// PharmStation Edge Function: sms-works-webhook
//
// A SINGLE shared webhook for the platform SMS Works account. The platform
// owner configures this URL once in the SMS Works dashboard (Account →
// Webhooks) for BOTH delivery reports and inbound (reply) messages.
//
// SMS Works posts two shapes of payload here:
//
//  1) Delivery report (outbound status update):
//     { messageid, status, credits, messageparts, keyword?, destination,
//       senttime?, deliverytime?, failurereason?, metadata? }
//     → we match ps_messages by provider message id and update status +
//       credits/segments, then top up monthly usage.
//
//  2) Inbound message (a patient reply):
//     { id/messageid, from, to, content/message, keyword?, metadata?,
//       metatags?, outbound:false, outboundmessageid? }
//     → we route to the org via (a) the `to` reply number and (b) the
//       echoed metadata org_id, insert ps_sms_inbound, match the patient by
//       phone, and count it toward inbound usage.
//
// verify_jwt is OFF — SMS Works cannot send a Supabase JWT. We authenticate
// by source IP allow-list (SMS Works fixed egress IPs) + an optional shared
// secret in the URL query string (?token=... compared to SMSWORKS_WEBHOOK_SECRET).
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// SMS Works fixed egress IPs (delivery reports / inbound). Keep in sync with
// https://thesmsworks.co.uk docs.
const SMSWORKS_IPS = new Set(['18.170.59.20', '35.176.98.85', '52.56.112.179'])

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

type AdminClient = ReturnType<typeof getAdminClient>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function mapSmsworksStatus(status: string): string {
  switch ((status || '').toUpperCase()) {
    case 'DELIVERED': return 'delivered'
    case 'SENT': return 'sent'
    case 'SCHEDULED': return 'sending'
    case 'UNDELIVERABLE': return 'permanent-failure'
    case 'EXPIRED': return 'temporary-failure'
    case 'REJECTED': return 'failed'
    case 'FAILED': return 'failed'
    default: return 'sending'
  }
}

/** Pull a value out of the echoed SMS Works metadata array or object. */
function metaValue(meta: unknown, key: string): string | undefined {
  if (!meta) return undefined
  if (Array.isArray(meta)) {
    const hit = meta.find((m) => m && (m.key === key || m.name === key))
    return hit ? String(hit.value ?? hit.val ?? '') : undefined
  }
  if (typeof meta === 'object') {
    const v = (meta as Record<string, unknown>)[key]
    return v === undefined ? undefined : String(v)
  }
  return undefined
}

function normalisePhone(raw: string): string {
  let n = (raw || '').replace(/[^\d+]/g, '')
  if (n.startsWith('+')) n = n.slice(1)
  else if (n.startsWith('00')) n = n.slice(2)
  else if (n.startsWith('0')) n = `44${n.slice(1)}`
  else if (n.startsWith('7') && n.length === 10) n = `44${n}`
  return n
}

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') || ''
  return xff.split(',')[0].trim()
}

// ============================================
// Delivery report handler
// ============================================

async function handleDeliveryReport(admin: AdminClient, payload: Record<string, unknown>) {
  const providerId = (payload.messageid as string) || (payload.id as string)
  const rawStatus = (payload.status as string) || ''
  if (!providerId || !rawStatus) return json({ received: true, note: 'missing id/status' })

  const status = mapSmsworksStatus(rawStatus)
  const now = new Date().toISOString()

  const updates: Record<string, unknown> = { status, updated_at: now }
  if (status === 'delivered') {
    updates.delivered_at = (payload.deliverytime as string) || now
    updates.completed_at = (payload.deliverytime as string) || now
  }
  if (['failed', 'permanent-failure', 'temporary-failure'].includes(status)) {
    updates.failed_at = now
    updates.failure_reason = (payload.failurereason as string) || rawStatus
    updates.completed_at = now
  }
  if (typeof payload.credits === 'number') updates.credits = payload.credits
  if (typeof payload.messageparts === 'number') updates.segments = payload.messageparts

  const { data: updated, error } = await admin
    .from('ps_messages')
    .update(updates)
    .eq('notify_message_id', providerId)
    .eq('provider', 'smsworks')
    .select('id, org_id, credits, segments')

  if (error) {
    console.error('delivery report update error', error)
    return json({ received: true, updated: 0, note: 'update_error' })
  }

  return json({ received: true, updated: updated?.length ?? 0 })
}

// ============================================
// Inbound (reply) handler
// ============================================

async function handleInbound(admin: AdminClient, payload: Record<string, unknown>) {
  const from = (payload.from as string) || ''
  const to = (payload.to as string) || ''
  const content = (payload.content as string) || (payload.message as string) || ''
  const providerId = (payload.messageid as string) || (payload.id as string) || null
  const meta = payload.metadata ?? payload.metatags
  const outboundMessageId = (payload.outboundmessageid as string) || metaValue(meta, 'message_id') || null

  if (!from) return json({ received: true, note: 'missing from' })

  // Resolve the owning org: (1) echoed metadata org_id, else (2) the reply
  // number the message was sent TO.
  let orgId = metaValue(meta, 'org_id') || null
  const toNumber = normalisePhone(to)

  if (!orgId && toNumber) {
    const { data: rn } = await admin
      .from('ps_sms_reply_numbers').select('org_id')
      .eq('phone_number', toNumber).eq('status', 'assigned').maybeSingle()
    orgId = rn?.org_id ?? null
  }
  // Last resort: derive the org from the original outbound message.
  if (!orgId && outboundMessageId) {
    const { data: out } = await admin
      .from('ps_messages').select('org_id').eq('id', outboundMessageId).maybeSingle()
    orgId = out?.org_id ?? null
  }

  if (!orgId) {
    // Park unroutable inbound so nothing is lost, but flag it.
    console.warn('inbound could not be routed to an org', { from, to })
    return json({ received: true, routed: false, note: 'no org match' })
  }

  const fromNorm = normalisePhone(from)
  if (!fromNorm) return json({ received: true, routed: false, note: 'invalid sender' })

  // Provider retries must not create duplicate inbox entries or staff alerts.
  if (providerId) {
    const { data: duplicate } = await admin
      .from('ps_sms_inbound').select('id, disposition')
      .eq('provider_message_id', providerId).maybeSingle()
    if (duplicate) {
      return json({ received: true, routed: true, duplicate: true, disposition: duplicate.disposition })
    }
  }

  // Match only when exactly one patient owns this number. Shared family
  // numbers remain unlinked for staff to resolve deliberately.
  let patientId: string | null = metaValue(meta, 'patient_id') || null
  if (!patientId) {
    const { data: patients } = await admin
      .from('ps_patients').select('id')
      .eq('organisation_id', orgId).eq('phone_normalized', fromNorm).limit(2)
    patientId = patients?.length === 1 ? patients[0].id : null
  }

  const [{ data: settings }, { data: control }] = await Promise.all([
    admin.from('ps_sms_settings')
      .select('inbound_filter_mode, inbound_rate_limit_count, inbound_rate_limit_minutes')
      .eq('org_id', orgId).maybeSingle(),
    admin.from('ps_sms_sender_controls')
      .select('status, muted_until').eq('org_id', orgId).eq('phone_number', fromNorm).maybeSingle(),
  ])

  let disposition: 'inbox' | 'quarantine' | 'blocked' = 'inbox'
  let dispositionReason: string | null = null
  const muted = control?.status === 'muted' && control.muted_until && new Date(control.muted_until) > new Date()

  if (control?.status === 'blocked' || muted) {
    disposition = 'blocked'
    dispositionReason = control?.status === 'blocked' ? 'sender_blocked' : 'sender_muted'
  } else {
    const mode = settings?.inbound_filter_mode ?? 'open'
    const approved = control?.status === 'approved'
    if (mode === 'approved_only' && !approved) {
      disposition = 'quarantine'
      dispositionReason = 'approval_required'
    } else if (mode === 'filtered' && !patientId && !approved) {
      disposition = 'quarantine'
      dispositionReason = 'unknown_sender'
    }
  }

  // Flood protection is active in every mode but quarantines rather than
  // discarding messages, preserving evidence and avoiding notification spam.
  if (disposition === 'inbox') {
    const limit = settings?.inbound_rate_limit_count ?? 10
    const minutes = settings?.inbound_rate_limit_minutes ?? 10
    const since = new Date(Date.now() - minutes * 60_000).toISOString()
    const { count } = await admin.from('ps_sms_inbound')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('normalized_from_number', fromNorm).gte('received_at', since)
    if ((count ?? 0) >= limit) {
      disposition = 'quarantine'
      dispositionReason = 'rate_limit'
    }
  }

  const { error: insErr } = await admin.from('ps_sms_inbound').insert({
    org_id: orgId,
    reply_number: toNumber || null,
    from_number: from,
    normalized_from_number: fromNorm,
    patient_id: patientId,
    content,
    provider_message_id: providerId,
    outbound_message_id: outboundMessageId,
    metadata: meta ?? null,
    disposition,
    disposition_reason: dispositionReason,
  })
  if (insErr) {
    console.error('inbound insert error', insErr)
    return json({ received: true, stored: false, note: 'insert_error' })
  }

  // Count inbound toward monthly usage (reply-enabled orgs are billed more).
  await admin.rpc('ps_sms_record_usage', {
    p_org_id: orgId, p_period: currentPeriod(),
    p_outbound: 0, p_credits: 0, p_segments: 0, p_inbound: 1,
  })

  return json({
    received: true, routed: true, org_id: orgId, patient_id: patientId,
    disposition, disposition_reason: dispositionReason,
  })
}

// ============================================
// Main
// ============================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // ---- Authenticate the source ----
  const secret = Deno.env.get('SMSWORKS_WEBHOOK_SECRET')
  if (secret) {
    const url = new URL(req.url)
    if (url.searchParams.get('token') !== secret) return json({ error: 'Invalid token' }, 401)
  } else {
    // Fall back to IP allow-list when no shared secret is configured.
    const ip = clientIp(req)
    if (ip && !SMSWORKS_IPS.has(ip)) return json({ error: 'Forbidden' }, 403)
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const admin = getAdminClient()

  // Distinguish inbound replies from delivery reports. SMS Works marks
  // inbound with outbound === false and includes message content.
  const isInbound = payload.outbound === false ||
    (typeof payload.content === 'string' && !payload.status) ||
    (typeof payload.message === 'string' && !payload.status)

  try {
    if (isInbound) return await handleInbound(admin, payload)
    return await handleDeliveryReport(admin, payload)
  } catch (e: unknown) {
    console.error('webhook error', e)
    // 200 so SMS Works does not retry forever on a data issue.
    return json({ received: true, error: e instanceof Error ? e.message : 'error' })
  }
})
