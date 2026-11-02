// ============================================
// PharmStation Edge Function: sms-works
// All SMS Works (https://thesmsworks.co.uk) outbound SMS interactions.
//
// This is the DEFAULT SMS provider for every pharmacy. NHS Notify is kept
// ONLY for NHS-affiliated organisations (nhs_channels_enabled = true) and is
// handled by the separate `nhs-notify` function. Email + letter remain on
// NHS Notify too. This function is SMS-only.
//
// Actions (mirrors the nhs-notify action contract so the client store can
// route transparently):
//   send_sms        — single direct SMS
//   notify          — reusable channel-agnostic send (the "plug & play" hook
//                     used by appointments, video, reminders, urgent alerts).
//                     channel MUST be 'sms' here.
//   send_broadcast  — bulk SMS to matching patients
//   check_status    — pull latest status for one message
//   test_connection — validate the platform SMS Works account (balance)
//   save_settings   — store per-org sender ID / signature / reply email
//   get_settings    — return the org's SMS settings (no secrets)
//   get_webhook_info— delivery-report + inbound webhook URL (platform setup)
//   list_templates / save_template / delete_template — per-org templating
//   assign_reply_number / release_reply_number — two-way reply numbers
//   usage_summary   — per-org monthly usage + estimated charge (billing)
//   network_ping    — urgent text alert for Pharmacy Network messages, sent
//                     to the RECIPIENT pharmacy's registered numbers and
//                     billed to the SENDER (see handleNetworkPing)
//
// SMS Works uses a SINGLE platform account. The JWT lives in the
// SMSWORKS_JWT edge secret and is never exposed to the browser. Per-org
// identity (sender ID, reply number, signature, templates) is stored in
// ps_sms_settings / ps_sms_templates / ps_sms_reply_numbers.
//
// Multi-tenant reply routing is belt & braces: every outbound send stamps
// metadata [{org_id},{message_id},{patient_id}] which SMS Works echoes back
// on replies, AND replies also arrive on the org's dedicated reply number.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const SMSWORKS_API_BASE = 'https://api.thesmsworks.co.uk/v1'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// GSM-restricted words that SMS Works rejects in an alphanumeric Sender ID
// (error 4012). Numeric reply numbers are exempt. Case-insensitive, whole-ish
// word match against the sender.
const RESTRICTED_SENDER_TERMS = [
  'alert', 'appointment', 'reminder', 'notify', 'confirm', 'code', 'delivery',
  'info', 'order', 'pay', 'verify', 'bank', 'reward', 'prize', 'win', 'free',
  'account', 'password', 'otp', 'pin', 'refund', 'gift', 'offer', 'claim',
  'urgent', 'nhs', 'govuk', 'gov',
]

// ============================================
// Supabase admin client
// ============================================

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

type AdminClient = ReturnType<typeof getAdminClient>

// ============================================
// SMS Works API caller
// SMS Works expects the Authorization header as "JWT <token>" (verified
// against /v1/utils/test — a bare token or "Bearer" prefix returns 401).
// ============================================

function getPlatformJwt(): string {
  const jwt = Deno.env.get('SMSWORKS_JWT')
  if (!jwt) throw new Error('SMS Works is not configured (missing SMSWORKS_JWT secret)')
  // Accept the secret stored with or without the "JWT " prefix.
  const token = jwt.trim().replace(/^(JWT|Bearer)\s+/i, '')
  return `JWT ${token}`
}

async function smsworksFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${SMSWORKS_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getPlatformJwt(),
      ...(options.headers || {}),
    },
  })

  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    // SMS Works errors look like { status, errorCode, message }
    const code = (body as Record<string, unknown>).errorCode
    const msg = (body as Record<string, unknown>).message || `HTTP ${res.status}`
    throw new Error(`SMS Works${code ? ` [${code}]` : ''}: ${msg}`)
  }

  return body as Record<string, unknown>
}

// ============================================
// Helpers
// ============================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Current billing period, e.g. "2025-01" (UTC). */
function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Normalise a UK phone number to SMS Works format: country code + number,
 * digits only, no leading '+'. e.g. '+44 7700 900000' / '07700900000'
 * → '447700900000'.
 */
function normaliseDestination(raw: string): string {
  let n = (raw || '').replace(/[^\d+]/g, '')
  if (n.startsWith('+')) n = n.slice(1)
  else if (n.startsWith('00')) n = n.slice(2)
  else if (n.startsWith('0')) n = `44${n.slice(1)}`
  else if (n.startsWith('7') && n.length === 10) n = `44${n}`
  if (!/^\d{8,15}$/.test(n)) throw new Error(`Invalid phone number: ${raw}`)
  return n
}

/** Validate an alphanumeric Sender ID (3–11 chars, restricted-term safe). */
function validateAlphaSender(sender: string) {
  const s = (sender || '').trim()
  if (!/^[A-Za-z0-9 ]{3,11}$/.test(s)) {
    throw new Error('Sender ID must be 3–11 letters/numbers (alphanumeric).')
  }
  const lower = s.toLowerCase()
  const hit = RESTRICTED_SENDER_TERMS.find((t) => lower.includes(t))
  if (hit) {
    throw new Error(
      `Sender ID "${s}" contains the restricted word "${hit}", which mobile networks block. Use your pharmacy/brand name instead.`,
    )
  }
  return s
}

/** Render {{placeholders}} in a template body from a personalisation map. */
function renderTemplate(templateBody: string, data: Record<string, unknown>): string {
  return templateBody.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const v = data?.[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

// GSM-7 default alphabet extension characters count as 2.
const GSM_EXT = new Set(['^', '{', '}', '\\', '[', ']', '~', '|', '€', '\n', '\f'])
// A minimal GSM-7 charset check for segment calc; anything outside → UCS-2.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/** Estimate SMS credits/segments for content (used as a fallback only). */
function estimateSegments(content: string): { segments: number; credits: number } {
  let isGsm = true
  let gsmLen = 0
  for (const ch of content) {
    if (GSM_BASIC.includes(ch)) gsmLen += GSM_EXT.has(ch) ? 2 : 1
    else { isGsm = false; break }
  }
  let segments: number
  if (isGsm) {
    segments = gsmLen <= 160 ? 1 : Math.ceil(gsmLen / 153)
  } else {
    const len = [...content].length
    segments = len <= 70 ? 1 : Math.ceil(len / 67)
  }
  return { segments: Math.max(segments, 1), credits: Math.max(segments, 1) }
}

// ============================================
// Per-org SMS settings
// ============================================

type SmsSettings = {
  org_id: string
  sender_type: 'alpha' | 'number'
  sender_id: string | null
  reply_enabled: boolean
  reply_number: string | null
  reply_forward_email: string | null
  signature: string | null
  is_active: boolean
  inbound_filter_mode: 'open' | 'filtered' | 'approved_only'
  inbound_rate_limit_count: number
  inbound_rate_limit_minutes: number
}

async function getOrgSettings(admin: AdminClient, orgId: string): Promise<SmsSettings> {
  const { data, error } = await admin
    .from('ps_sms_settings').select('*').eq('org_id', orgId).maybeSingle()
  if (error) throw new Error(`Failed to load SMS settings: ${error.message}`)
  if (!data) throw new Error('SMS is not configured for this organisation')
  if (!data.is_active) throw new Error('SMS is not active for this organisation')
  return data as SmsSettings
}

/** Resolve the sender string SMS Works should use for this org. */
function resolveSender(settings: SmsSettings, forceReplyNumber = false): string {
  if (forceReplyNumber || settings.sender_type === 'number') {
    if (!settings.reply_number) throw new Error('Reply number sender selected but no number assigned')
    return settings.reply_number.replace(/[^\d]/g, '')
  }
  if (!settings.sender_id) throw new Error('No Sender ID configured — set one in Messaging settings')
  return validateAlphaSender(settings.sender_id)
}

// ============================================
// Content building (template + signature)
// ============================================

async function buildContent(
  admin: AdminClient,
  settings: SmsSettings,
  args: { org_id: string; body?: string; template_id?: string; personalisation?: Record<string, unknown> },
): Promise<{ content: string; templateId: string | null }> {
  let base = args.body ?? ''
  let templateId: string | null = null

  if (args.template_id) {
    const { data: tpl, error } = await admin
      .from('ps_sms_templates').select('id, body, is_active')
      .eq('id', args.template_id).eq('org_id', args.org_id).maybeSingle()
    if (error) throw new Error(`Failed to load template: ${error.message}`)
    if (!tpl || !tpl.is_active) throw new Error('SMS template not found or inactive')
    base = renderTemplate(tpl.body as string, args.personalisation ?? {})
    templateId = tpl.id as string
  }

  base = base.trim()
  if (!base) throw new Error('Message body is empty')

  // Append the pharmacy's signature (their "unique signing") unless already present.
  const sig = (settings.signature ?? '').trim()
  const content = sig && !base.includes(sig) ? `${base}\n${sig}` : base
  return { content, templateId }
}

// ============================================
// Log message to DB
// ============================================

async function insertPending(
  admin: AdminClient,
  row: Record<string, unknown>,
): Promise<{ id: string }> {
  const { data, error } = await admin.from('ps_messages').insert({
    provider: 'smsworks',
    channel: 'sms',
    status: 'pending',
    ...row,
  }).select('id').single()
  if (error) throw new Error(`Failed to log message: ${error.message}`)
  return data as { id: string }
}

// ============================================
// SMS status mapping (SMS Works → ps_messages.status)
// ============================================

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

// ============================================
// Core send
// ============================================

type SendCommon = {
  org_id: string
  patient_id?: string
  reference?: string
  feature?: string
  broadcast_id?: string
  template_id?: string
  personalisation?: Record<string, unknown>
  use_reply_number?: boolean
}

type DeliverArgs = {
  org_id: string
  phone_number: string
  sender: string
  content: string
  feature: string
  reference: string
  patient_id?: string | null
  broadcast_id?: string | null
  template_id?: string | null
  reply_number?: string | null
  personalisation?: Record<string, unknown>
  /** Store a masked number: the sender must not learn the recipient's phone. */
  mask_recipient?: boolean
}

/** "•••• 123" — enough for staff to tell numbers apart, not to dial them. */
function maskPhone(n: string): string {
  return `•••• ${n.slice(-3)}`
}

/**
 * Log, send and bill one SMS. Every outbound text goes through here so that
 * ps_messages and the monthly usage ledger always match what SMS Works sent.
 */
async function deliverSms(admin: AdminClient, args: DeliverArgs, userId: string) {
  const destination = normaliseDestination(args.phone_number)

  // 1) Insert a pending row first so we can stamp its id into SMS Works
  //    metadata (this is what makes multi-tenant reply routing reliable).
  const pending = await insertPending(admin, {
    org_id: args.org_id,
    patient_id: args.patient_id || null,
    recipient_phone: args.mask_recipient ? maskPhone(destination) : args.phone_number,
    recipient_phone_normalized: args.mask_recipient ? null : destination,
    body: args.content,
    personalisation: args.personalisation ?? { body: args.content },
    sms_sender: args.sender,
    reply_number: args.reply_number ?? null,
    template_id: args.template_id ?? null,
    reference: args.reference,
    feature: args.feature,
    broadcast_id: args.broadcast_id || null,
    created_by_user_id: userId,
  })

  // 2) Send via SMS Works
  const payload: Record<string, unknown> = {
    sender: args.sender,
    destination,
    content: args.content,
    tag: args.feature,
    metadata: [
      { key: 'org_id', value: args.org_id },
      { key: 'message_id', value: pending.id },
      ...(args.patient_id ? [{ key: 'patient_id', value: args.patient_id }] : []),
    ],
  }

  try {
    const result = await smsworksFetch('/message/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    const messageId = (result.messageid as string) || null
    const status = mapSmsworksStatus((result.status as string) || 'SENT')
    // Prefer the values SMS Works returns; fall back to a local estimate.
    const est = estimateSegments(args.content)
    const credits = typeof result.credits === 'number' ? result.credits : est.credits
    const segments = typeof result.messageparts === 'number' ? result.messageparts : est.segments

    const { data: updated } = await admin.from('ps_messages').update({
      status,
      notify_message_id: messageId, // reuse provider message id column
      credits,
      segments,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', pending.id).select('*, patient:ps_patients(id, first_name, last_name)').single()

    // 3) Record usage for chargeback billing (best-effort).
    await admin.rpc('ps_sms_record_usage', {
      p_org_id: args.org_id,
      p_period: currentPeriod(),
      p_outbound: 1,
      p_credits: credits,
      p_segments: segments,
      p_inbound: 0,
    })

    return updated
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Send failed'
    await admin.from('ps_messages').update({
      status: 'failed', failed_at: new Date().toISOString(),
      failure_reason: msg, updated_at: new Date().toISOString(),
    }).eq('id', pending.id)
    throw e
  }
}

async function sendSms(
  admin: AdminClient,
  settings: SmsSettings,
  args: SendCommon & { phone_number: string; body?: string; footer?: string },
  userId: string,
) {
  const sender = resolveSender(settings, args.use_reply_number)
  const built = await buildContent(admin, settings, args)
  const content = args.footer ? `${built.content}\n${args.footer}` : built.content
  const reference = args.reference || `${args.feature || 'manual'}${args.patient_id ? `:${args.patient_id}` : ''}`

  return deliverSms(admin, {
    org_id: args.org_id,
    phone_number: args.phone_number,
    sender,
    content,
    feature: args.feature || 'manual',
    reference,
    patient_id: args.patient_id,
    broadcast_id: args.broadcast_id,
    template_id: built.templateId,
    reply_number: settings.reply_enabled ? settings.reply_number : null,
    personalisation: args.personalisation,
  }, userId)
}

// ============================================
// Action: send_sms
// ============================================

async function handleSendSms(body: Record<string, unknown>, userId: string) {
  const { org_id, phone_number, body: msgBody, template_id } = body as Record<string, string>
  if (!org_id || !phone_number || (!msgBody && !template_id)) {
    throw new Error('Missing required fields: org_id, phone_number, body|template_id')
  }
  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)
  return sendSms(admin, settings, { ...(body as object), phone_number, body: msgBody } as never, userId)
}

// ============================================
// Action: notify — reusable channel-agnostic send (SMS only here)
// ============================================

async function handleNotify(body: Record<string, unknown>, userId: string) {
  const { org_id, channel, to, patient_id, body: msgBody, template_id } = body as {
    org_id: string; channel: string; to?: string; patient_id?: string
    body?: string; template_id?: string
  }
  if (!org_id || !channel) throw new Error('Missing required fields: org_id, channel')
  if (channel !== 'sms') {
    throw new Error(
      `SMS Works handles SMS only. Channel "${channel}" requires NHS Notify (NHS-affiliated organisations).`,
    )
  }
  if (!msgBody && !template_id) throw new Error('Missing body or template_id')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  let recipientPhone = to
  if (patient_id && !to) {
    const { data: p } = await admin
      .from('ps_patients').select('phone')
      .eq('id', patient_id).eq('organisation_id', org_id).single()
    if (!p) throw new Error('Patient not found')
    recipientPhone = p.phone ?? undefined
  }
  if (!recipientPhone) throw new Error('No phone number available for SMS')

  return sendSms(
    admin, settings,
    { ...(body as object), phone_number: recipientPhone, body: msgBody } as never,
    userId,
  )
}

// ============================================
// Action: send_broadcast (SMS only)
// ============================================

const BROADCAST_CONCURRENCY = 5

/** Phone numbers (normalised) that have texted STOP to this pharmacy. */
async function loadOptOuts(admin: AdminClient, orgId: string): Promise<Set<string>> {
  const out = new Set<string>()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from('ps_sms_opt_outs').select('phone_normalized')
      .eq('org_id', orgId).range(from, from + pageSize - 1)
    // Fail closed: never broadcast if we cannot check who opted out.
    if (error) throw new Error(`Could not check SMS opt-outs: ${error.message}`)
    for (const row of data ?? []) out.add(row.phone_normalized as string)
    if (!data || data.length < pageSize) break
  }
  return out
}

async function handleSendBroadcast(body: Record<string, unknown>, userId: string) {
  const { org_id, broadcast_id } = body as { org_id: string; broadcast_id: string }
  if (!org_id || !broadcast_id) throw new Error('Missing org_id or broadcast_id')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  const { data: broadcast, error: bErr } = await admin
    .from('ps_broadcasts').select('*').eq('id', broadcast_id).eq('org_id', org_id).single()
  if (bErr || !broadcast) throw new Error('Broadcast not found')
  if (broadcast.channel !== 'sms') throw new Error('This function only sends SMS broadcasts')
  if (broadcast.status !== 'draft') throw new Error('Broadcast already processed')

  const { data: patients, error: pErr } = await admin
    .from('ps_patients').select('id, phone').eq('organisation_id', org_id).not('phone', 'is', null)
  if (pErr) throw new Error(`Failed to fetch patients: ${pErr.message}`)

  // Skip anyone who texted STOP, and send once per number (families often
  // share a phone; they should not get the same broadcast three times).
  const optOuts = await loadOptOuts(admin, org_id)
  const seen = new Set<string>()
  let optedOutCount = 0
  let duplicateCount = 0
  let invalidCount = 0
  const recipients: { id: string; phone: string }[] = []
  for (const p of patients ?? []) {
    let norm: string
    try { norm = normaliseDestination(p.phone as string) } catch { invalidCount++; continue }
    if (optOuts.has(norm)) { optedOutCount++; continue }
    if (seen.has(norm)) { duplicateCount++; continue }
    seen.add(norm)
    recipients.push({ id: p.id as string, phone: p.phone as string })
  }
  if (recipients.length === 0) {
    throw new Error(
      optedOutCount > 0
        ? 'No patients to message: everyone with a mobile number has opted out.'
        : 'No matching patients found',
    )
  }

  // Claim the broadcast atomically so a double-click or a retry cannot send
  // the same broadcast twice.
  const { data: claimed } = await admin.from('ps_broadcasts')
    .update({ status: 'sending', total_count: recipients.length })
    .eq('id', broadcast_id).eq('status', 'draft')
    .select('id').maybeSingle()
  if (!claimed) throw new Error('Broadcast already processed')

  // Tell patients how to opt out whenever they can actually reply.
  const sender = resolveSender(settings)
  const canReply = /^\d+$/.test(sender)
  const footer = canReply && !/\bSTOP\b/i.test(broadcast.body ?? '') ? 'Reply STOP to opt out' : undefined

  let sentCount = 0
  let failedCount = 0
  const common = { org_id, feature: 'broadcast', broadcast_id, reference: `broadcast:${broadcast_id}`, footer }

  let next = 0
  async function worker() {
    while (next < recipients.length) {
      const patient = recipients[next++]
      try {
        await sendSms(admin, settings, {
          ...common, patient_id: patient.id, phone_number: patient.phone, body: broadcast.body,
        }, userId)
        sentCount++
      } catch (_e) {
        failedCount++
      }
      await sleep(20)
    }
  }
  await Promise.all(Array.from({ length: Math.min(BROADCAST_CONCURRENCY, recipients.length) }, worker))

  const finalStatus = failedCount === recipients.length ? 'failed' : 'sent'
  await admin.from('ps_broadcasts').update({
    status: finalStatus, sent_count: sentCount, failed_count: failedCount,
  }).eq('id', broadcast_id)

  return {
    sent_count: sentCount,
    failed_count: failedCount,
    total_count: recipients.length,
    opted_out_count: optedOutCount,
    duplicate_count: duplicateCount,
    invalid_count: invalidCount,
    status: finalStatus,
  }
}

// ============================================
// Action: check_status
// ============================================

async function handleCheckStatus(body: Record<string, unknown>) {
  const { org_id, message_id } = body as { org_id: string; message_id: string }
  if (!org_id || !message_id) throw new Error('Missing org_id or message_id')

  const admin = getAdminClient()
  const { data: msg, error } = await admin
    .from('ps_messages').select('notify_message_id').eq('id', message_id).eq('org_id', org_id).single()
  if (error || !msg?.notify_message_id) throw new Error('Message not found or has no SMS Works ID')

  const result = await smsworksFetch(`/messages/${msg.notify_message_id}`)
  const status = mapSmsworksStatus((result.status as string) || '')

  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === 'delivered') updates.delivered_at = new Date().toISOString()
  if (['failed', 'permanent-failure', 'temporary-failure'].includes(status)) {
    updates.failed_at = new Date().toISOString()
    updates.failure_reason = result.status
  }
  if (typeof result.credits === 'number') updates.credits = result.credits
  if (typeof result.messageparts === 'number') updates.segments = result.messageparts

  await admin.from('ps_messages').update(updates).eq('id', message_id)
  return { status, provider_status: result.status }
}

// ============================================
// Action: test_connection — platform account balance
// ============================================

async function handleTestConnection(body: Record<string, unknown>) {
  const { org_id } = body as { org_id: string }
  if (!org_id) throw new Error('Missing org_id')
  const admin = getAdminClient()
  try {
    const balance = await smsworksFetch('/credits/balance')
    await admin.rpc('ps_sms_save_settings', { p_org_id: org_id }) // ensure row exists
    await admin.from('ps_sms_settings')
      .update({ last_tested_at: new Date().toISOString() }).eq('org_id', org_id)
    return { valid: true, balance: balance.credits ?? null }
  } catch (e: unknown) {
    return { valid: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ============================================
// Action: save_settings / get_settings
// ============================================

async function handleSaveSettings(body: Record<string, unknown>) {
  const {
    org_id, sender_type, sender_id, signature, reply_forward_email, is_active,
    inbound_filter_mode, inbound_rate_limit_count, inbound_rate_limit_minutes,
  } = body as {
    org_id: string; sender_type?: 'alpha' | 'number'; sender_id?: string
    signature?: string; reply_forward_email?: string; is_active?: boolean
    inbound_filter_mode?: 'open' | 'filtered' | 'approved_only'
    inbound_rate_limit_count?: number; inbound_rate_limit_minutes?: number
  }
  if (!org_id) throw new Error('Missing org_id')

  // Validate an alphanumeric sender before persisting so pharmacies get
  // immediate, clear feedback instead of a send-time 4012.
  if (sender_id && (sender_type ?? 'alpha') === 'alpha') validateAlphaSender(sender_id)

  const admin = getAdminClient()
  const { error } = await admin.rpc('ps_sms_save_settings', {
    p_org_id: org_id,
    p_sender_type: sender_type ?? null,
    p_sender_id: sender_id ?? null,
    p_signature: signature ?? null,
    p_reply_forward_email: reply_forward_email ?? null,
    p_is_active: typeof is_active === 'boolean' ? is_active : null,
  })
  if (error) throw new Error(`Failed to save settings: ${error.message}`)

  const inboundUpdates: Record<string, unknown> = {}
  if (inbound_filter_mode) inboundUpdates.inbound_filter_mode = inbound_filter_mode
  if (typeof inbound_rate_limit_count === 'number') inboundUpdates.inbound_rate_limit_count = inbound_rate_limit_count
  if (typeof inbound_rate_limit_minutes === 'number') inboundUpdates.inbound_rate_limit_minutes = inbound_rate_limit_minutes
  if (Object.keys(inboundUpdates).length > 0) {
    const { error: inboundError } = await admin.from('ps_sms_settings').update(inboundUpdates).eq('org_id', org_id)
    if (inboundError) throw new Error(`Failed to save inbound settings: ${inboundError.message}`)
  }

  const { data } = await admin.from('ps_sms_settings').select('*').eq('org_id', org_id).single()
  return data
}

async function handleGetSettings(body: Record<string, unknown>) {
  const { org_id } = body as { org_id: string }
  if (!org_id) throw new Error('Missing org_id')
  const admin = getAdminClient()
  await admin.rpc('ps_sms_save_settings', { p_org_id: org_id }) // ensure row exists
  const { data } = await admin.from('ps_sms_settings').select('*').eq('org_id', org_id).single()
  return data
}

// ============================================
// Action: get_webhook_info — platform sets these once in SMS Works
// ============================================

async function handleGetWebhookInfo(body: Record<string, unknown>) {
  const { org_id } = body as { org_id: string }
  if (!org_id) throw new Error('Missing org_id')
  const admin = getAdminClient()
  const { data: rn } = await admin
    .from('ps_sms_reply_numbers').select('phone_number, status')
    .eq('org_id', org_id).eq('status', 'assigned').maybeSingle()

  const webhookSecret = Deno.env.get('SMSWORKS_WEBHOOK_SECRET')
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sms-works-webhook${webhookSecret ? `?token=${webhookSecret}` : ''}`
  return {
    delivery_report_url: webhookUrl,
    inbound_url: webhookUrl,
    reply_number: rn?.phone_number ?? null,
  }
}

// ============================================
// Action: template CRUD
// ============================================

async function handleListTemplates(body: Record<string, unknown>) {
  const { org_id } = body as { org_id: string }
  if (!org_id) throw new Error('Missing org_id')
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('ps_sms_templates').select('*').eq('org_id', org_id).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

async function handleSaveTemplate(body: Record<string, unknown>, userId: string) {
  const { org_id, id, name, category, body: tplBody, description, is_active } = body as {
    org_id: string; id?: string; name?: string; category?: string
    body?: string; description?: string; is_active?: boolean
  }
  if (!org_id) throw new Error('Missing org_id')
  const admin = getAdminClient()

  if (id) {
    const { data, error } = await admin.from('ps_sms_templates').update({
      name, category, body: tplBody, description,
      is_active: typeof is_active === 'boolean' ? is_active : undefined,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('org_id', org_id).select().single()
    if (error) throw new Error(error.message)
    return data
  }

  if (!name || !tplBody) throw new Error('Missing template name or body')
  const { data, error } = await admin.from('ps_sms_templates').insert({
    org_id, name, category: category || 'custom', body: tplBody,
    description: description ?? null, created_by: userId,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

async function handleDeleteTemplate(body: Record<string, unknown>) {
  const { org_id, id } = body as { org_id: string; id: string }
  if (!org_id || !id) throw new Error('Missing org_id or id')
  const admin = getAdminClient()
  const { error } = await admin.from('ps_sms_templates').delete().eq('id', id).eq('org_id', org_id)
  if (error) throw new Error(error.message)
  return { deleted: true }
}

// ============================================
// Action: reply number assignment (two-way messaging)
// Assigns the next available number from the platform pool, or reports that
// provisioning is required when the pool is empty.
// ============================================

async function handleAssignReplyNumber(body: Record<string, unknown>) {
  const { org_id, phone_number } = body as { org_id: string; phone_number?: string }
  if (!org_id) throw new Error('Missing org_id')
  const admin = getAdminClient()

  // Already assigned? Return it.
  const { data: existing } = await admin
    .from('ps_sms_reply_numbers').select('phone_number')
    .eq('org_id', org_id).eq('status', 'assigned').maybeSingle()
  if (existing) return { assigned: true, phone_number: existing.phone_number, already: true }

  // Pick a specific number (admin) or the next available from the pool.
  let number = phone_number
  if (!number) {
    const { data: pool } = await admin
      .from('ps_sms_reply_numbers').select('phone_number')
      .eq('status', 'available').is('org_id', null).limit(1).maybeSingle()
    number = pool?.phone_number
  }
  if (!number) {
    return {
      assigned: false,
      pending_provisioning: true,
      message: 'No reply numbers are currently available. Your request has been noted and a number will be provisioned shortly.',
    }
  }

  const { error } = await admin.rpc('ps_sms_assign_reply_number', {
    p_org_id: org_id, p_phone_number: number, p_monthly_rental_pence: 1350, p_provider_ref: null,
  })
  if (error) throw new Error(`Failed to assign reply number: ${error.message}`)
  return { assigned: true, phone_number: number }
}

async function handleReleaseReplyNumber(body: Record<string, unknown>) {
  const { org_id } = body as { org_id: string }
  if (!org_id) throw new Error('Missing org_id')
  const admin = getAdminClient()
  const { error } = await admin.rpc('ps_sms_release_reply_number', { p_org_id: org_id })
  if (error) throw new Error(`Failed to release reply number: ${error.message}`)
  return { released: true }
}

// ============================================
// Action: network_ping — urgent text alert for a Pharmacy Network message
//
// The sender's browser inserts the network message(s) under RLS, then calls
// this with their ids. For each message we check that it really came from
// the caller's pharmacy and asked for a ping, then text the RECIPIENT
// pharmacy's registered numbers, respecting their on/off switch, paused
// numbers and quiet hours (UK time). The text never contains the message
// body (it could hold patient details); it says who wrote and links to the
// thread. Usage is billed to the sending pharmacy.
// ============================================

const PING_MAX_AGE_MINUTES = 10
const PING_RATE_LIMIT_MINUTES = 15
const PING_MAX_NUMBERS = 3

const NETWORK_LABEL_TEXT: Record<string, string> = {
  prescription_query: 'prescription query',
  community_alert: 'community alert',
  stock_query: 'stock query',
  other: 'message',
}

/** "HH:MM" in Europe/London for the given instant. */
function londonClock(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at)
}

/** True when `now` (HH:MM) is inside [start, end); handles overnight windows. */
function inWindow(now: string, start?: string | null, end?: string | null): boolean {
  const s = (start || '00:00').slice(0, 5)
  const e = (end || '23:59').slice(0, 5)
  if (s === e) return true
  return s < e ? now >= s && now < e : now >= s || now < e
}

type PingResult = { message_id: string; to_org_id?: string; status: string; numbers?: number }

async function handleNetworkPing(body: Record<string, unknown>, userId: string) {
  const { org_id, message_ids } = body as { org_id: string; message_ids?: unknown }
  if (!Array.isArray(message_ids) || message_ids.length === 0) throw new Error('Missing message_ids')
  if (message_ids.length > 100) throw new Error('Too many messages in one request')
  const ids = message_ids.filter((x): x is string => typeof x === 'string')

  const admin = getAdminClient()
  const sender = validateAlphaSender(Deno.env.get('NETWORK_PING_SENDER') || 'PharmStn')
  const appUrl = (Deno.env.get('PUBLIC_APP_URL') || 'https://pharmstation.co.uk').replace(/\/+$/, '')
  const since = new Date(Date.now() - PING_MAX_AGE_MINUTES * 60_000).toISOString()

  const { data: msgs, error } = await admin
    .from('ps_network_messages')
    .select('id, from_org_id, to_org_id, thread_id, label, from_org_name, request_sms_ping, sms_ping_status, created_at')
    .in('id', ids)
    .eq('from_org_id', org_id)
  if (error) throw new Error(`Failed to load messages: ${error.message}`)

  const results: PingResult[] = []
  const now = new Date()
  const clock = londonClock(now)

  for (const id of ids) {
    const m = (msgs ?? []).find((x) => x.id === id)
    if (!m) { results.push({ message_id: id, status: 'not_found' }); continue }
    if (!m.request_sms_ping) { results.push({ message_id: id, status: 'not_requested' }); continue }
    if (m.sms_ping_status) { results.push({ message_id: id, status: m.sms_ping_status }); continue }
    if (m.created_at < since) { results.push({ message_id: id, status: 'too_old' }); continue }

    // Claim the message so retries can never text twice.
    const { data: claimed } = await admin.from('ps_network_messages')
      .update({ sms_ping_status: 'processing' })
      .eq('id', id).is('sms_ping_status', null)
      .select('id').maybeSingle()
    if (!claimed) { results.push({ message_id: id, status: 'already_processed' }); continue }

    const finish = async (status: string, count = 0) => {
      await admin.from('ps_network_messages').update({
        sms_ping_status: status,
        sms_ping_count: count,
        sms_ping_sent_at: status === 'sent' ? new Date().toISOString() : null,
      }).eq('id', id)
      results.push({ message_id: id, to_org_id: m.to_org_id, status, numbers: count })
    }

    const { data: settings } = await admin
      .from('ps_network_settings').select('network_enabled, sms_pings_enabled')
      .eq('org_id', m.to_org_id).maybeSingle()
    if (!settings?.sms_pings_enabled || settings.network_enabled === false) {
      await finish('recipient_disabled'); continue
    }

    // One ping per sender → recipient pair per window, so the feature can't
    // be used to spam another pharmacy's phones.
    const { count: recent } = await admin.from('ps_network_messages')
      .select('id', { count: 'exact', head: true })
      .eq('from_org_id', org_id).eq('to_org_id', m.to_org_id)
      .gte('sms_ping_sent_at', new Date(Date.now() - PING_RATE_LIMIT_MINUTES * 60_000).toISOString())
    if ((recent ?? 0) > 0) { await finish('rate_limited'); continue }

    const { data: contacts } = await admin
      .from('ps_network_sms_contacts')
      .select('phone_number, is_enabled, pause_until, notify_start, notify_end')
      .eq('org_id', m.to_org_id).eq('is_enabled', true)
      .order('created_at', { ascending: true })
    const reachable = (contacts ?? []).filter((c) =>
      !(c.pause_until && new Date(c.pause_until) > now) &&
      inWindow(clock, c.notify_start as string | null, c.notify_end as string | null),
    ).slice(0, PING_MAX_NUMBERS)
    if (reachable.length === 0) { await finish('no_contacts_available'); continue }

    const what = NETWORK_LABEL_TEXT[m.label as string] ?? 'message'
    const from = (m.from_org_name as string | null) || 'A pharmacy'
    const content =
      `PharmStation Network: urgent ${what} from ${from}. ` +
      `Open to read and reply: ${appUrl}/messaging/network/thread/${m.thread_id}`

    let sent = 0
    for (const c of reachable) {
      try {
        await deliverSms(admin, {
          org_id,
          phone_number: c.phone_number as string,
          sender,
          content,
          feature: 'network_ping',
          reference: `network:${id}`,
          mask_recipient: true,
        }, userId)
        sent++
      } catch (e) {
        console.error('network ping send failed', e instanceof Error ? e.message : e)
      }
    }
    await finish(sent > 0 ? 'sent' : 'failed', sent)
  }

  return {
    results,
    sent: results.filter((r) => r.status === 'sent').length,
    total: results.length,
  }
}

// ============================================
// Action: usage_summary — billing view for the org
// ============================================

async function handleUsageSummary(body: Record<string, unknown>) {
  const { org_id, period } = body as { org_id: string; period?: string }
  if (!org_id) throw new Error('Missing org_id')
  const admin = getAdminClient()
  let query = admin.from('ps_sms_billing_summary').select('*').eq('org_id', org_id)
  if (period) query = query.eq('period', period)
  const { data, error } = await query.order('period', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// ============================================
// Main handler
// ============================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const body = await req.json()
    const { action } = body
    if (!action) throw new Error('Missing action parameter')

    // All actions require an authenticated staff user.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    // Every action is org-scoped, so org_id is mandatory and always checked.
    if (typeof body.org_id !== 'string') throw new Error('Missing org_id')
    const { data: membership } = await getAdminClient()
      .from('ps_organisation_members').select('user_id')
      .eq('organisation_id', body.org_id).eq('user_id', user.id)
      .eq('status', 'active').maybeSingle()
    if (!membership) throw new Error('You do not have access to this organisation')

    let result: unknown
    switch (action) {
      case 'send_sms': result = await handleSendSms(body, user.id); break
      case 'notify': result = await handleNotify(body, user.id); break
      case 'send_broadcast': result = await handleSendBroadcast(body, user.id); break
      case 'check_status': result = await handleCheckStatus(body); break
      case 'test_connection': result = await handleTestConnection(body); break
      case 'save_settings': result = await handleSaveSettings(body); break
      case 'get_settings': result = await handleGetSettings(body); break
      case 'get_webhook_info': result = await handleGetWebhookInfo(body); break
      case 'list_templates': result = await handleListTemplates(body); break
      case 'save_template': result = await handleSaveTemplate(body, user.id); break
      case 'delete_template': result = await handleDeleteTemplate(body); break
      case 'assign_reply_number': result = await handleAssignReplyNumber(body); break
      case 'release_reply_number': result = await handleReleaseReplyNumber(body); break
      case 'usage_summary': result = await handleUsageSummary(body); break
      case 'network_ping': result = await handleNetworkPing(body, user.id); break
      default: throw new Error(`Unknown action: ${action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
