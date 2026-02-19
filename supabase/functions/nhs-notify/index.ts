// ============================================
// PharmStation Edge Function: nhs-notify
// Handles all NHS Notify (GOV.UK Notify) API interactions
// Actions: send_sms, send_email, send_letter, send_broadcast,
//          check_status, test_connection, save_settings
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
  // A UUID has 5 hyphen-separated parts: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  // So the last 10 hyphen parts form the 2 UUIDs
  const parts = apiKey.split('-')
  if (parts.length < 10) throw new Error('Invalid API key format')
  const secretParts = parts.slice(-5)
  const issParts = parts.slice(-10, -5)
  return {
    iss: issParts.join('-'),
    secret: secretParts.join('-'),
  }
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
  const sig = base64url(new Uint8Array(signature))

  return `${data}.${sig}`
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

// ============================================
// Get org settings (with API key — server-side only)
// ============================================

async function getOrgSettings(admin: ReturnType<typeof getAdminClient>, orgId: string) {
  const { data, error } = await admin
    .from('ps_notify_settings')
    .select('*')
    .eq('org_id', orgId)
    .single()

  if (error || !data) throw new Error('Messaging not configured for this organisation')
  if (!data.is_active) throw new Error('Messaging is not active for this organisation')
  if (!data.api_key) throw new Error('NHS Notify API key not configured')

  return data
}

// ============================================
// Log message to DB
// ============================================

async function logMessage(admin: ReturnType<typeof getAdminClient>, msg: Record<string, unknown>) {
  const { data, error } = await admin
    .from('ps_messages')
    .insert(msg)
    .select()
    .single()

  if (error) throw new Error(`Failed to log message: ${error.message}`)
  return data
}

// ============================================
// Sleep helper for rate limiting
// ============================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ============================================
// Action: send_sms
// ============================================

async function handleSendSms(body: Record<string, unknown>, userId: string) {
  const { org_id, phone_number, body: msgBody, patient_id, reference, broadcast_id } = body as {
    org_id: string; phone_number: string; body: string; patient_id?: string;
    reference?: string; broadcast_id?: string
  }

  if (!org_id || !phone_number || !msgBody) {
    throw new Error('Missing required fields: org_id, phone_number, body')
  }

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  if (!settings.sms_template_id) throw new Error('SMS template not configured')

  const result = await notifyFetch(settings.api_key, '/v2/notifications/sms', {
    method: 'POST',
    body: JSON.stringify({
      phone_number,
      template_id: settings.sms_template_id,
      personalisation: { body: msgBody },
      reference: reference || undefined,
    }),
  })

  return logMessage(admin, {
    org_id,
    patient_id: patient_id || null,
    recipient_phone: phone_number,
    channel: 'sms',
    body: msgBody,
    personalisation: { body: msgBody },
    status: 'sending',
    notify_message_id: result.id,
    broadcast_id: broadcast_id || null,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

// ============================================
// Action: send_email
// ============================================

async function handleSendEmail(body: Record<string, unknown>, userId: string) {
  const { org_id, email_address, subject, body: msgBody, patient_id, reference, broadcast_id } = body as {
    org_id: string; email_address: string; subject?: string; body: string;
    patient_id?: string; reference?: string; broadcast_id?: string
  }

  if (!org_id || !email_address || !msgBody) {
    throw new Error('Missing required fields: org_id, email_address, body')
  }

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  if (!settings.email_template_id) throw new Error('Email template not configured')

  const emailSubject = subject || 'Message from your pharmacy'

  const result = await notifyFetch(settings.api_key, '/v2/notifications/email', {
    method: 'POST',
    body: JSON.stringify({
      email_address,
      template_id: settings.email_template_id,
      personalisation: { subject: emailSubject, body: msgBody },
      reference: reference || undefined,
    }),
  })

  return logMessage(admin, {
    org_id,
    patient_id: patient_id || null,
    recipient_email: email_address,
    channel: 'email',
    subject: emailSubject,
    body: msgBody,
    personalisation: { subject: emailSubject, body: msgBody },
    status: 'sending',
    notify_message_id: result.id,
    broadcast_id: broadcast_id || null,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

// ============================================
// Action: send_letter
// ============================================

async function handleSendLetter(body: Record<string, unknown>, userId: string) {
  const { org_id, address, body: msgBody, patient_id, reference, broadcast_id } = body as {
    org_id: string; address: Record<string, string>; body: string;
    patient_id?: string; reference?: string; broadcast_id?: string
  }

  if (!org_id || !address || !msgBody) {
    throw new Error('Missing required fields: org_id, address, body')
  }

  if (!address.address_line_1 || !address.address_line_2 || !address.address_line_3) {
    throw new Error('Letters require at least 3 address lines')
  }

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  if (!settings.letter_template_id) throw new Error('Letter template not configured')

  const personalisation = { ...address, body: msgBody }

  const result = await notifyFetch(settings.api_key, '/v2/notifications/letter', {
    method: 'POST',
    body: JSON.stringify({
      template_id: settings.letter_template_id,
      personalisation,
      reference: reference || undefined,
    }),
  })

  return logMessage(admin, {
    org_id,
    patient_id: patient_id || null,
    recipient_address: address,
    channel: 'letter',
    body: msgBody,
    personalisation,
    status: 'sending',
    notify_message_id: result.id,
    broadcast_id: broadcast_id || null,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

// ============================================
// Action: send_broadcast
// ============================================

async function handleSendBroadcast(body: Record<string, unknown>, userId: string) {
  const { org_id, broadcast_id } = body as { org_id: string; broadcast_id: string }

  if (!org_id || !broadcast_id) throw new Error('Missing org_id or broadcast_id')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  // Fetch the broadcast
  const { data: broadcast, error: bErr } = await admin
    .from('ps_broadcasts')
    .select('*')
    .eq('id', broadcast_id)
    .eq('org_id', org_id)
    .single()

  if (bErr || !broadcast) throw new Error('Broadcast not found')
  if (broadcast.status !== 'draft') throw new Error('Broadcast already processed')

  // Fetch matching patients
  let query = admin.from('ps_patients').select('*').eq('organisation_id', org_id)

  if (broadcast.channel === 'sms') query = query.not('phone', 'is', null)
  if (broadcast.channel === 'email') query = query.not('email', 'is', null)
  if (broadcast.channel === 'letter') query = query.not('address_line_1', 'is', null)

  const { data: patients, error: pErr } = await query
  if (pErr) throw new Error(`Failed to fetch patients: ${pErr.message}`)
  if (!patients || patients.length === 0) throw new Error('No matching patients found')

  // Update broadcast status to sending
  await admin.from('ps_broadcasts').update({
    status: 'sending',
    total_count: patients.length,
  }).eq('id', broadcast_id)

  let sentCount = 0
  let failedCount = 0

  for (const patient of patients) {
    try {
      if (broadcast.channel === 'sms' && patient.phone) {
        await handleSendSms({
          org_id,
          phone_number: patient.phone,
          body: broadcast.body,
          patient_id: patient.id,
          reference: `broadcast-${broadcast_id}`,
          broadcast_id,
        }, userId)
      } else if (broadcast.channel === 'email' && patient.email) {
        await handleSendEmail({
          org_id,
          email_address: patient.email,
          subject: broadcast.subject || 'Message from your pharmacy',
          body: broadcast.body,
          patient_id: patient.id,
          reference: `broadcast-${broadcast_id}`,
          broadcast_id,
        }, userId)
      } else if (broadcast.channel === 'letter' && patient.address_line_1) {
        await handleSendLetter({
          org_id,
          address: {
            address_line_1: `${patient.first_name} ${patient.last_name}`,
            address_line_2: patient.address_line_1,
            address_line_3: [patient.city, patient.postcode].filter(Boolean).join(', '),
            ...(patient.address_line_2 ? { address_line_4: patient.address_line_2 } : {}),
          },
          body: broadcast.body,
          patient_id: patient.id,
          reference: `broadcast-${broadcast_id}`,
          broadcast_id,
        }, userId)
      }
      sentCount++
    } catch (_e) {
      failedCount++
    }

    // Rate limiting: ~50/sec, well under GOV.UK Notify 3,000/min limit
    await sleep(20)
  }

  // Update broadcast final status
  const finalStatus = failedCount === patients.length ? 'failed' : 'sent'
  await admin.from('ps_broadcasts').update({
    status: finalStatus,
    sent_count: sentCount,
    failed_count: failedCount,
  }).eq('id', broadcast_id)

  return { sent_count: sentCount, failed_count: failedCount, total_count: patients.length, status: finalStatus }
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
    .from('ps_messages')
    .select('notify_message_id')
    .eq('id', message_id)
    .eq('org_id', org_id)
    .single()

  if (error || !msg?.notify_message_id) throw new Error('Message not found or has no Notify ID')

  const result = await notifyFetch(settings.api_key, `/v2/notifications/${msg.notify_message_id}`)

  // Map GOV.UK Notify status to our status
  let status = 'sending'
  const notifyStatus = result.status as string
  if (['delivered', 'sent'].includes(notifyStatus)) status = 'delivered'
  else if (notifyStatus === 'permanent-failure') status = 'permanent-failure'
  else if (notifyStatus === 'temporary-failure') status = 'temporary-failure'
  else if (notifyStatus === 'technical-failure') status = 'technical-failure'
  else if (notifyStatus === 'failed') status = 'failed'

  await admin.from('ps_messages').update({ status }).eq('id', message_id)

  return { status, notify_status: notifyStatus }
}

// ============================================
// Action: test_connection
// ============================================

async function handleTestConnection(body: Record<string, unknown>) {
  const { org_id } = body as { org_id: string }

  if (!org_id) throw new Error('Missing org_id')

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('ps_notify_settings')
    .select('api_key')
    .eq('org_id', org_id)
    .single()

  if (error || !data?.api_key) throw new Error('API key not configured')

  try {
    const templates = await notifyFetch(data.api_key, '/v2/templates')

    await admin.from('ps_notify_settings')
      .update({ last_tested_at: new Date().toISOString(), is_active: true })
      .eq('org_id', org_id)

    return { valid: true, templates: templates.templates || [] }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error'
    return { valid: false, error: errMsg }
  }
}

// ============================================
// Action: save_settings
// ============================================

async function handleSaveSettings(body: Record<string, unknown>) {
  const { org_id, api_key, sms_template_id, email_template_id, letter_template_id } = body as {
    org_id: string; api_key?: string; sms_template_id?: string;
    email_template_id?: string; letter_template_id?: string
  }

  if (!org_id) throw new Error('Missing org_id')

  const admin = getAdminClient()

  // Check if settings already exist
  const { data: existing } = await admin
    .from('ps_notify_settings')
    .select('id')
    .eq('org_id', org_id)
    .single()

  const updates: Record<string, unknown> = {}
  if (api_key !== undefined) updates.api_key = api_key
  if (sms_template_id !== undefined) updates.sms_template_id = sms_template_id
  if (email_template_id !== undefined) updates.email_template_id = email_template_id
  if (letter_template_id !== undefined) updates.letter_template_id = letter_template_id

  if (existing) {
    const { data, error } = await admin
      .from('ps_notify_settings')
      .update(updates)
      .eq('org_id', org_id)
      .select('id, org_id, sms_template_id, email_template_id, letter_template_id, is_active, last_tested_at, created_at')
      .single()
    if (error) throw new Error(`Failed to update settings: ${error.message}`)
    return data
  } else {
    if (!api_key) throw new Error('API key is required for initial setup')
    const { data, error } = await admin
      .from('ps_notify_settings')
      .insert({ org_id, api_key, ...updates })
      .select('id, org_id, sms_template_id, email_template_id, letter_template_id, is_active, last_tested_at, created_at')
      .single()
    if (error) throw new Error(`Failed to create settings: ${error.message}`)
    return data
  }
}

// ============================================
// Main handler
// ============================================

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const body = await req.json()
    const { action } = body

    if (!action) throw new Error('Missing action parameter')

    // All actions require authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    // Verify the user's JWT
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    let result: unknown

    switch (action) {
      case 'send_sms':
        result = await handleSendSms(body, user.id)
        break
      case 'send_email':
        result = await handleSendEmail(body, user.id)
        break
      case 'send_letter':
        result = await handleSendLetter(body, user.id)
        break
      case 'send_broadcast':
        result = await handleSendBroadcast(body, user.id)
        break
      case 'check_status':
        result = await handleCheckStatus(body)
        break
      case 'test_connection':
        result = await handleTestConnection(body)
        break
      case 'save_settings':
        result = await handleSaveSettings(body)
        break
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }
})
