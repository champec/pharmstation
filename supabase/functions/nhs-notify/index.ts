// ============================================
// PharmStation Edge Function: nhs-notify
// All NHS Notify (GOV.UK Notify) outbound interactions.
//
// Actions:
//   send_sms, send_email, send_letter   — single direct sends
//   notify                              — reusable channel-agnostic send
//                                         (the "plug & play" hook used by
//                                          appointments, video, reminders,
//                                          urgent alerts, etc.)
//   send_broadcast                      — bulk send to matching patients
//   check_status                        — pull latest status for one message
//   test_connection                     — validate a key + list templates
//   save_settings                       — store key (Vault) + templates
//   get_callback_info                   — callback URL + token for setup UI
//
// The org's API key is encrypted at rest in Supabase Vault and only ever
// decrypted server-side via the ps_notify_get_settings RPC. It is never
// returned to the browser.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const NOTIFY_API_BASE = 'https://api.notifications.service.gov.uk'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ============================================
// JWT helpers for GOV.UK Notify auth
// ============================================

function base64url(data: Uint8Array): string {
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function parseNotifyApiKey(apiKey: string): { iss: string; secret: string } {
  // GOV.UK Notify API key format: {key_name}-{iss_uuid}-{secret_key_uuid}
  // A UUID has 5 hyphen-separated parts, so the last 10 parts form 2 UUIDs.
  const parts = apiKey.trim().split('-')
  if (parts.length < 10) throw new Error('Invalid API key format')
  const secretParts = parts.slice(-5)
  const issParts = parts.slice(-10, -5)
  return { iss: issParts.join('-'), secret: secretParts.join('-') }
}

async function createNotifyJwt(apiKey: string): Promise<string> {
  const { iss, secret } = parseNotifyApiKey(apiKey)

  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'HS256' })))
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss,
    iat: Math.floor(Date.now() / 1000),
  })))

  const data = `${header}.${payload}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${base64url(new Uint8Array(signature))}`
}

// ============================================
// Notify API caller
// ============================================

async function notifyFetch(apiKey: string, path: string, options: RequestInit = {}) {
  const jwt = await createNotifyJwt(apiKey)

  const res = await fetch(`${NOTIFY_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
      ...(options.headers || {}),
    },
  })

  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    const errMsg = body.errors?.[0]?.message || `HTTP ${res.status}`
    throw new Error(`NHS Notify: ${errMsg}`)
  }

  return body
}

// ============================================
// Supabase admin client
// ============================================

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

type OrgSettings = {
  api_key: string
  sms_template_id: string | null
  email_template_id: string | null
  letter_template_id: string | null
  is_active: boolean
  callback_token: string | null
}

// Decrypted settings via SECURITY DEFINER RPC (Vault-backed). Service role only.
async function getOrgSettings(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string,
): Promise<OrgSettings> {
  const { data, error } = await admin.rpc('ps_notify_get_settings', { p_org_id: orgId })
  if (error) throw new Error(`Failed to load messaging settings: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Messaging not configured for this organisation')
  if (!row.is_active) throw new Error('Messaging is not active for this organisation')
  if (!row.api_key) throw new Error('NHS Notify API key not configured')
  return row as OrgSettings
}

// ============================================
// Log message to DB
// ============================================

async function logMessage(admin: ReturnType<typeof getAdminClient>, msg: Record<string, unknown>) {
  const { data, error } = await admin.from('ps_messages').insert(msg).select().single()
  if (error) throw new Error(`Failed to log message: ${error.message}`)
  return data
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function defaultReference(feature: string | undefined, patientId: string | undefined) {
  const f = feature || 'manual'
  return patientId ? `${f}:${patientId}` : f
}

// ============================================
// Channel sends (shared core)
// ============================================

type SendCommon = {
  org_id: string
  patient_id?: string
  reference?: string
  feature?: string
  broadcast_id?: string
}

async function sendSms(
  admin: ReturnType<typeof getAdminClient>,
  settings: OrgSettings,
  args: SendCommon & { phone_number: string; body: string },
  userId: string,
) {
  if (!settings.sms_template_id) throw new Error('SMS template not configured')
  const reference = args.reference || defaultReference(args.feature, args.patient_id)

  const result = await notifyFetch(settings.api_key, '/v2/notifications/sms', {
    method: 'POST',
    body: JSON.stringify({
      phone_number: args.phone_number,
      template_id: settings.sms_template_id,
      personalisation: { body: args.body },
      reference,
    }),
  })

  return logMessage(admin, {
    org_id: args.org_id,
    patient_id: args.patient_id || null,
    recipient_phone: args.phone_number,
    channel: 'sms',
    body: args.body,
    personalisation: { body: args.body },
    status: 'sending',
    notify_message_id: result.id,
    reference,
    feature: args.feature || 'manual',
    broadcast_id: args.broadcast_id || null,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

async function sendEmail(
  admin: ReturnType<typeof getAdminClient>,
  settings: OrgSettings,
  args: SendCommon & { email_address: string; subject?: string; body: string },
  userId: string,
) {
  if (!settings.email_template_id) throw new Error('Email template not configured')
  const reference = args.reference || defaultReference(args.feature, args.patient_id)
  const subject = args.subject || 'Message from your pharmacy'

  const result = await notifyFetch(settings.api_key, '/v2/notifications/email', {
    method: 'POST',
    body: JSON.stringify({
      email_address: args.email_address,
      template_id: settings.email_template_id,
      personalisation: { subject, body: args.body },
      reference,
    }),
  })

  return logMessage(admin, {
    org_id: args.org_id,
    patient_id: args.patient_id || null,
    recipient_email: args.email_address,
    channel: 'email',
    subject,
    body: args.body,
    personalisation: { subject, body: args.body },
    status: 'sending',
    notify_message_id: result.id,
    reference,
    feature: args.feature || 'manual',
    broadcast_id: args.broadcast_id || null,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

async function sendLetter(
  admin: ReturnType<typeof getAdminClient>,
  settings: OrgSettings,
  args: SendCommon & { address: Record<string, string>; body: string },
  userId: string,
) {
  if (!settings.letter_template_id) throw new Error('Letter template not configured')
  if (!args.address.address_line_1 || !args.address.address_line_2 || !args.address.address_line_3) {
    throw new Error('Letters require at least 3 address lines')
  }
  const reference = args.reference || defaultReference(args.feature, args.patient_id)
  const personalisation = { ...args.address, body: args.body }

  const result = await notifyFetch(settings.api_key, '/v2/notifications/letter', {
    method: 'POST',
    body: JSON.stringify({
      template_id: settings.letter_template_id,
      personalisation,
      reference,
    }),
  })

  return logMessage(admin, {
    org_id: args.org_id,
    patient_id: args.patient_id || null,
    recipient_address: args.address,
    channel: 'letter',
    body: args.body,
    personalisation,
    status: 'sending',
    notify_message_id: result.id,
    reference,
    feature: args.feature || 'manual',
    broadcast_id: args.broadcast_id || null,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

// ============================================
// Action: send_sms / send_email / send_letter
// ============================================

async function handleSendSms(body: Record<string, unknown>, userId: string) {
  const { org_id, phone_number, body: msgBody } = body as Record<string, string>
  if (!org_id || !phone_number || !msgBody) {
    throw new Error('Missing required fields: org_id, phone_number, body')
  }
  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)
  return sendSms(admin, settings, { ...(body as object), phone_number, body: msgBody } as never, userId)
}

async function handleSendEmail(body: Record<string, unknown>, userId: string) {
  const { org_id, email_address, body: msgBody } = body as Record<string, string>
  if (!org_id || !email_address || !msgBody) {
    throw new Error('Missing required fields: org_id, email_address, body')
  }
  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)
  return sendEmail(admin, settings, { ...(body as object), email_address, body: msgBody } as never, userId)
}

async function handleSendLetter(body: Record<string, unknown>, userId: string) {
  const { org_id, address, body: msgBody } = body as Record<string, unknown>
  if (!org_id || !address || !msgBody) {
    throw new Error('Missing required fields: org_id, address, body')
  }
  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id as string)
  return sendLetter(admin, settings, { ...(body as object) } as never, userId)
}

// ============================================
// Action: notify — reusable channel-agnostic send
// Resolves the recipient from a patient when not given explicitly.
// ============================================

async function handleNotify(body: Record<string, unknown>, userId: string) {
  const {
    org_id, channel, to, address, patient_id, subject, body: msgBody, feature, reference,
  } = body as {
    org_id: string; channel: 'sms' | 'email' | 'letter'; to?: string
    address?: Record<string, string>; patient_id?: string; subject?: string
    body: string; feature?: string; reference?: string
  }

  if (!org_id || !channel || !msgBody) throw new Error('Missing required fields: org_id, channel, body')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  // Resolve recipient from patient when not supplied explicitly.
  let recipientPhone = channel === 'sms' ? to : undefined
  let recipientEmail = channel === 'email' ? to : undefined
  let recipientAddress = address

  if (patient_id && (!to && !address)) {
    const { data: p } = await admin
      .from('ps_patients')
      .select('first_name, last_name, phone, email, address_line_1, address_line_2, city, postcode')
      .eq('id', patient_id)
      .eq('organisation_id', org_id)
      .single()
    if (!p) throw new Error('Patient not found')
    if (channel === 'sms') recipientPhone = p.phone ?? undefined
    if (channel === 'email') recipientEmail = p.email ?? undefined
    if (channel === 'letter') {
      recipientAddress = {
        address_line_1: `${p.first_name} ${p.last_name}`.trim(),
        address_line_2: p.address_line_1 ?? '',
        address_line_3: [p.city, p.postcode].filter(Boolean).join(', '),
        ...(p.address_line_2 ? { address_line_4: p.address_line_2 } : {}),
      }
    }
  }

  const common = { org_id, patient_id, feature: feature || 'manual', reference }

  if (channel === 'sms') {
    if (!recipientPhone) throw new Error('No phone number available for SMS')
    return sendSms(admin, settings, { ...common, phone_number: recipientPhone, body: msgBody }, userId)
  }
  if (channel === 'email') {
    if (!recipientEmail) throw new Error('No email address available for email')
    return sendEmail(admin, settings, { ...common, email_address: recipientEmail, subject, body: msgBody }, userId)
  }
  if (channel === 'letter') {
    if (!recipientAddress) throw new Error('No address available for letter')
    return sendLetter(admin, settings, { ...common, address: recipientAddress, body: msgBody }, userId)
  }
  throw new Error(`Unknown channel: ${channel}`)
}

// ============================================
// Action: send_broadcast
// ============================================

async function handleSendBroadcast(body: Record<string, unknown>, userId: string) {
  const { org_id, broadcast_id } = body as { org_id: string; broadcast_id: string }
  if (!org_id || !broadcast_id) throw new Error('Missing org_id or broadcast_id')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  const { data: broadcast, error: bErr } = await admin
    .from('ps_broadcasts').select('*').eq('id', broadcast_id).eq('org_id', org_id).single()
  if (bErr || !broadcast) throw new Error('Broadcast not found')
  if (broadcast.status !== 'draft') throw new Error('Broadcast already processed')

  let query = admin.from('ps_patients').select('*').eq('organisation_id', org_id)
  if (broadcast.channel === 'sms') query = query.not('phone', 'is', null)
  if (broadcast.channel === 'email') query = query.not('email', 'is', null)
  if (broadcast.channel === 'letter') query = query.not('address_line_1', 'is', null)

  const { data: patients, error: pErr } = await query
  if (pErr) throw new Error(`Failed to fetch patients: ${pErr.message}`)
  if (!patients || patients.length === 0) throw new Error('No matching patients found')

  await admin.from('ps_broadcasts')
    .update({ status: 'sending', total_count: patients.length }).eq('id', broadcast_id)

  let sentCount = 0
  let failedCount = 0
  const common = { org_id, feature: 'broadcast', broadcast_id, reference: `broadcast:${broadcast_id}` }

  for (const patient of patients) {
    try {
      if (broadcast.channel === 'sms' && patient.phone) {
        await sendSms(admin, settings, { ...common, patient_id: patient.id, phone_number: patient.phone, body: broadcast.body }, userId)
      } else if (broadcast.channel === 'email' && patient.email) {
        await sendEmail(admin, settings, { ...common, patient_id: patient.id, email_address: patient.email, subject: broadcast.subject || undefined, body: broadcast.body }, userId)
      } else if (broadcast.channel === 'letter' && patient.address_line_1) {
        await sendLetter(admin, settings, {
          ...common, patient_id: patient.id,
          address: {
            address_line_1: `${patient.first_name} ${patient.last_name}`.trim(),
            address_line_2: patient.address_line_1,
            address_line_3: [patient.city, patient.postcode].filter(Boolean).join(', '),
            ...(patient.address_line_2 ? { address_line_4: patient.address_line_2 } : {}),
          },
          body: broadcast.body,
        }, userId)
      } else {
        continue
      }
      sentCount++
    } catch (_e) {
      failedCount++
    }
    await sleep(20) // ~50/sec, well under the 3,000/min Notify limit
  }

  const finalStatus = failedCount === patients.length ? 'failed' : 'sent'
  await admin.from('ps_broadcasts').update({
    status: finalStatus, sent_count: sentCount, failed_count: failedCount,
  }).eq('id', broadcast_id)

  return { sent_count: sentCount, failed_count: failedCount, total_count: patients.length, status: finalStatus }
}

// ============================================
// Status mapping helpers (shared with callback semantics)
// ============================================

function mapNotifyStatus(notifyStatus: string): string {
  if (['delivered', 'sent', 'received'].includes(notifyStatus)) return 'delivered'
  if (notifyStatus === 'permanent-failure') return 'permanent-failure'
  if (notifyStatus === 'temporary-failure') return 'temporary-failure'
  if (notifyStatus === 'technical-failure') return 'technical-failure'
  if (notifyStatus === 'failed') return 'failed'
  return 'sending'
}

// ============================================
// Action: check_status
// ============================================

async function handleCheckStatus(body: Record<string, unknown>) {
  const { org_id, message_id } = body as { org_id: string; message_id: string }
  if (!org_id || !message_id) throw new Error('Missing org_id or message_id')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  const { data: msg, error } = await admin
    .from('ps_messages').select('notify_message_id').eq('id', message_id).eq('org_id', org_id).single()
  if (error || !msg?.notify_message_id) throw new Error('Message not found or has no Notify ID')

  const result = await notifyFetch(settings.api_key, `/v2/notifications/${msg.notify_message_id}`)
  const status = mapNotifyStatus(result.status as string)

  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === 'delivered') updates.delivered_at = result.completed_at || new Date().toISOString()
  if (['failed', 'permanent-failure', 'temporary-failure', 'technical-failure'].includes(status)) {
    updates.failed_at = result.completed_at || new Date().toISOString()
    updates.failure_reason = result.status
  }
  if (result.completed_at) updates.completed_at = result.completed_at
  if (typeof result.cost_in_pounds === 'number') updates.cost_in_pounds = result.cost_in_pounds

  await admin.from('ps_messages').update(updates).eq('id', message_id)
  return { status, notify_status: result.status }
}

// ============================================
// Action: test_connection
// Accepts an optional api_key to test BEFORE saving (fixes the
// "test before save" UX); falls back to the stored Vault key.
// ============================================

async function handleTestConnection(body: Record<string, unknown>) {
  const { org_id, api_key } = body as { org_id: string; api_key?: string }
  if (!org_id) throw new Error('Missing org_id')

  const admin = getAdminClient()

  let key = api_key?.trim()
  if (!key) {
    const { data } = await admin.rpc('ps_notify_get_settings', { p_org_id: org_id })
    const row = Array.isArray(data) ? data[0] : data
    key = row?.api_key
  }
  if (!key) throw new Error('No API key to test — enter your key or save it first')

  try {
    const templates = await notifyFetch(key, '/v2/templates')
    await admin.from('ps_notify_settings')
      .update({ last_tested_at: new Date().toISOString() })
      .eq('org_id', org_id)
    return { valid: true, templates: templates.templates || [] }
  } catch (e: unknown) {
    return { valid: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ============================================
// Action: save_settings (Vault-backed via RPC)
// ============================================

async function handleSaveSettings(body: Record<string, unknown>) {
  const { org_id, api_key, sms_template_id, email_template_id, letter_template_id, is_active } = body as {
    org_id: string; api_key?: string; sms_template_id?: string
    email_template_id?: string; letter_template_id?: string; is_active?: boolean
  }
  if (!org_id) throw new Error('Missing org_id')

  const admin = getAdminClient()

  const { error } = await admin.rpc('ps_notify_save_settings', {
    p_org_id: org_id,
    p_api_key: api_key ?? null,
    p_sms_template_id: sms_template_id ?? null,
    p_email_template_id: email_template_id ?? null,
    p_letter_template_id: letter_template_id ?? null,
    p_is_active: typeof is_active === 'boolean' ? is_active : null,
  })
  if (error) throw new Error(`Failed to save settings: ${error.message}`)

  const { data } = await admin
    .from('ps_notify_settings_safe').select('*').eq('org_id', org_id).single()
  return data
}

// ============================================
// Action: get_callback_info — for the integration setup UI
// ============================================

async function handleGetCallbackInfo(body: Record<string, unknown>) {
  const { org_id } = body as { org_id: string }
  if (!org_id) throw new Error('Missing org_id')

  const admin = getAdminClient()
  // Ensure a token exists even before a key is saved.
  await admin.rpc('ps_notify_save_settings', { p_org_id: org_id })

  const { data } = await admin
    .from('ps_notify_settings').select('callback_token').eq('org_id', org_id).single()

  const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/nhs-notify-callback`
  return { callback_url: callbackUrl, callback_token: data?.callback_token ?? null }
}

// ============================================
// Main handler
// ============================================

Deno.serve(async (req) => {
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

    let result: unknown
    switch (action) {
      case 'send_sms': result = await handleSendSms(body, user.id); break
      case 'send_email': result = await handleSendEmail(body, user.id); break
      case 'send_letter': result = await handleSendLetter(body, user.id); break
      case 'notify': result = await handleNotify(body, user.id); break
      case 'send_broadcast': result = await handleSendBroadcast(body, user.id); break
      case 'check_status': result = await handleCheckStatus(body); break
      case 'test_connection': result = await handleTestConnection(body); break
      case 'save_settings': result = await handleSaveSettings(body); break
      case 'get_callback_info': result = await handleGetCallbackInfo(body); break
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
