// ============================================
// PharmStation Edge Function: notifications-dispatch
//
// Internal, server-to-server function. Invoked by the `ps_fanout_notification`
// Postgres function (via pg_net) immediately after a staff alert is fanned
// out to ps_notification_receipts — NEVER called directly by the browser.
//
// Auth model: this function is deployed with verify_jwt = false (there is no
// staff/user session at trigger time) and instead checks a shared secret
// header (`x-internal-secret`) against the NOTIFICATION_DISPATCH_SECRET edge
// secret, which matches the value seeded into ps_internal_secrets.
//
// Job: for the given notification_id, find every recipient receipt still
// marked sms_status = 'pending' (i.e. the org has SMS alerts enabled for
// this event type AND the staff member opted in with a phone number), send
// them a text via the org's SMS Works account, and update each receipt's
// dispatch status. Usage is recorded on the SAME ps_sms_usage_monthly ledger
// as patient messaging, since it comes out of the same org SMS allowance.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const SMSWORKS_API_BASE = 'https://api.thesmsworks.co.uk/v1'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

type AdminClient = ReturnType<typeof getAdminClient>

function getPlatformJwt(): string {
  const jwt = Deno.env.get('SMSWORKS_JWT')
  if (!jwt) throw new Error('SMS Works is not configured (missing SMSWORKS_JWT secret)')
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
    const code = (body as Record<string, unknown>).errorCode
    const msg = (body as Record<string, unknown>).message || `HTTP ${res.status}`
    throw new Error(`SMS Works${code ? ` [${code}]` : ''}: ${msg}`)
  }
  return body as Record<string, unknown>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Normalise a UK phone number to SMS Works format (same logic as sms-works). */
function normaliseDestination(raw: string): string {
  let n = (raw || '').replace(/[^\d+]/g, '')
  if (n.startsWith('+')) n = n.slice(1)
  else if (n.startsWith('00')) n = n.slice(2)
  else if (n.startsWith('0')) n = `44${n.slice(1)}`
  else if (n.startsWith('7') && n.length === 10) n = `44${n}`
  if (!/^\d{8,15}$/.test(n)) throw new Error(`Invalid phone number: ${raw}`)
  return n
}

const RESTRICTED_SENDER_TERMS = [
  'alert', 'appointment', 'reminder', 'notify', 'confirm', 'code', 'delivery',
  'info', 'order', 'pay', 'verify', 'bank', 'reward', 'prize', 'win', 'free',
  'account', 'password', 'otp', 'pin', 'refund', 'gift', 'offer', 'claim',
  'urgent', 'nhs', 'govuk', 'gov',
]

function validateAlphaSender(sender: string) {
  const s = (sender || '').trim()
  if (!/^[A-Za-z0-9 ]{3,11}$/.test(s)) throw new Error('Sender ID must be 3–11 letters/numbers.')
  const lower = s.toLowerCase()
  const hit = RESTRICTED_SENDER_TERMS.find((t) => lower.includes(t))
  if (hit) throw new Error(`Sender ID "${s}" contains the restricted word "${hit}".`)
  return s
}

type SmsSettings = {
  org_id: string
  sender_type: 'alpha' | 'number'
  sender_id: string | null
  reply_number: string | null
  signature: string | null
  is_active: boolean
}

function resolveSender(settings: SmsSettings): string {
  if (settings.sender_type === 'number') {
    if (!settings.reply_number) throw new Error('Reply number sender selected but no number assigned')
    return settings.reply_number.replace(/[^\d]/g, '')
  }
  if (!settings.sender_id) throw new Error('No Sender ID configured for this organisation')
  return validateAlphaSender(settings.sender_id)
}

const GSM_EXT = new Set(['^', '{', '}', '\\', '[', ']', '~', '|', '€', '\n', '\f'])
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

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
// Core
// ============================================

async function dispatch(admin: AdminClient, notificationId: string) {
  const { data: notification, error: nErr } = await admin
    .from('ps_notifications')
    .select('id, org_id, event_type, title, body')
    .eq('id', notificationId)
    .single()
  if (nErr || !notification) throw new Error('Notification not found')

  const { data: pendingReceipts, error: rErr } = await admin
    .from('ps_notification_receipts')
    .select('id, user_id')
    .eq('notification_id', notificationId)
    .eq('sms_status', 'pending')
  if (rErr) throw new Error(`Failed to load receipts: ${rErr.message}`)
  if (!pendingReceipts || pendingReceipts.length === 0) {
    return { notification_id: notificationId, sent: 0, failed: 0, skipped: 0 }
  }

  const { data: smsSettings } = await admin
    .from('ps_sms_settings')
    .select('org_id, sender_type, sender_id, reply_number, signature, is_active')
    .eq('org_id', notification.org_id)
    .maybeSingle()

  if (!smsSettings || !smsSettings.is_active) {
    // Best-effort: nothing to send from — mark all pending as failed with a clear reason.
    await admin.from('ps_notification_receipts')
      .update({ sms_status: 'failed', sms_error: 'SMS is not configured/active for this organisation' })
      .in('id', pendingReceipts.map((r) => r.id))
    return { notification_id: notificationId, sent: 0, failed: pendingReceipts.length, skipped: 0 }
  }

  const userIds = pendingReceipts.map((r) => r.user_id)
  const { data: prefs } = await admin
    .from('ps_user_notification_preferences')
    .select('user_id, sms_phone')
    .in('user_id', userIds)
  const phoneByUser = new Map((prefs ?? []).map((p) => [p.user_id, p.sms_phone as string | null]))

  let sender: string
  try {
    sender = resolveSender(smsSettings as SmsSettings)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sender not configured'
    await admin.from('ps_notification_receipts')
      .update({ sms_status: 'failed', sms_error: msg })
      .in('id', pendingReceipts.map((r) => r.id))
    return { notification_id: notificationId, sent: 0, failed: pendingReceipts.length, skipped: 0 }
  }

  const baseBody = notification.body ? `${notification.title} — ${notification.body}` : notification.title
  const sig = (smsSettings.signature ?? '').trim()
  const content = sig && !baseBody.includes(sig) ? `${baseBody}\n${sig}` : baseBody
  const est = estimateSegments(content)

  let sent = 0
  let failed = 0
  const period = currentPeriod()

  for (const receipt of pendingReceipts) {
    const phone = phoneByUser.get(receipt.user_id)
    if (!phone) {
      await admin.from('ps_notification_receipts')
        .update({ sms_status: 'failed', sms_error: 'No phone number on file' })
        .eq('id', receipt.id)
      failed++
      continue
    }

    try {
      const destination = normaliseDestination(phone)
      const result = await smsworksFetch('/message/send', {
        method: 'POST',
        body: JSON.stringify({
          sender,
          destination,
          content,
          tag: 'staff_alert',
          metadata: [
            { key: 'org_id', value: notification.org_id },
            { key: 'notification_id', value: notification.id },
          ],
        }),
      })
      const credits = typeof result.credits === 'number' ? result.credits : est.credits
      const segments = typeof result.messageparts === 'number' ? result.messageparts : est.segments

      await admin.from('ps_notification_receipts')
        .update({ sms_status: 'sent', sms_sent_at: new Date().toISOString() })
        .eq('id', receipt.id)

      await admin.rpc('ps_sms_record_usage', {
        p_org_id: notification.org_id, p_period: period,
        p_outbound: 1, p_credits: credits, p_segments: segments, p_inbound: 0,
      })
      sent++
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Send failed'
      await admin.from('ps_notification_receipts')
        .update({ sms_status: 'failed', sms_error: msg })
        .eq('id', receipt.id)
      failed++
    }
    await sleep(20)
  }

  return { notification_id: notificationId, sent, failed, skipped: 0 }
}

// ============================================
// Handler
// ============================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const secret = req.headers.get('x-internal-secret')
    const expected = Deno.env.get('NOTIFICATION_DISPATCH_SECRET')
    if (!expected || !secret || secret !== expected) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const { notification_id } = await req.json()
    if (!notification_id) throw new Error('Missing notification_id')

    const admin = getAdminClient()
    const result = await dispatch(admin, notification_id)

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
