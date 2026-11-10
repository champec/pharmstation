import '../_shared/monitoring.ts' // platform error tracking (see _shared/monitoring.ts)
// ============================================
// PharmStation Edge Function: locum-notify
//
// Internal, server-to-server. Called by Postgres (ps_locum_notify via pg_net)
// when something happens to a locum's booking, and by the saved-search
// trigger when a matching shift is posted. Never called by the browser.
//
// Deploy with verify_jwt = false. Auth is the shared x-internal-secret header,
// checked against NOTIFICATION_DISPATCH_SECRET (same value as
// ps_internal_secrets.notification_dispatch_secret).
//
// Payloads:
//   { kind: 'booking', event: 'confirmed' | 'rejected' | 'cancelled' | 'reminder', booking_id }
//     → email (Resend) + phone push to the locum
//   { kind: 'new_shift', shift_id, target_user_ids: uuid[] }
//     → phone push to locums whose saved search matches
//
// Secrets: NOTIFICATION_DISPATCH_SECRET, RESEND_API (email; push still goes
// without it), SUPPORT_FROM_EMAIL (optional), APP_URL (optional, default
// https://pharmstation.co.uk).
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const APP_URL = (Deno.env.get('APP_URL') || 'https://pharmstation.co.uk').replace(/\/$/, '')

type Admin = ReturnType<typeof createClient>

function admin(): Admin {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function fmtDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' })
}

function fmtTime(t: string) { return t.slice(0, 5) }

function addressLine(address: unknown): string {
  if (!address || typeof address !== 'object') return ''
  const a = address as Record<string, unknown>
  return ['line1', 'line_1', 'address_line_1', 'line2', 'line_2', 'city', 'town', 'postcode']
    .map((k) => (typeof a[k] === 'string' ? (a[k] as string).trim() : ''))
    .filter(Boolean)
    .join(', ')
}

async function sendEmail(to: string, subject: string, text: string) {
  const apiKey = Deno.env.get('RESEND_API')
  if (!apiKey) { console.error('RESEND_API not set; locum email skipped'); return false }
  const from = Deno.env.get('SUPPORT_FROM_EMAIL') || 'PharmStation <no-reply@pharmstation.co.uk>'
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">${
    text.split('\n\n').map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
  }</div>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  })
  if (!res.ok) console.error('Resend error', res.status, await res.text())
  return res.ok
}

/** Push to every enabled phone of these users, unless they switched phone alerts off. */
async function sendPush(db: Admin, userIds: string[], title: string, body: string, data: Record<string, string>) {
  if (userIds.length === 0) return 0
  const { data: prefs } = await db.from('ps_user_notification_preferences')
    .select('user_id, mobile_enabled').in('user_id', userIds)
  const optedOut = new Set((prefs ?? []).filter((p) => p.mobile_enabled === false).map((p) => p.user_id as string))
  const { data: tokens } = await db.from('ps_mobile_push_tokens')
    .select('id, user_id, expo_push_token, failure_count')
    .in('user_id', userIds.filter((u) => !optedOut.has(u)))
    .eq('enabled', true)
  if (!tokens || tokens.length === 0) return 0

  let pushed = 0
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100)
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk.map((t) => ({
        to: t.expo_push_token, title, body, data, sound: 'default', priority: 'high', channelId: 'default',
      }))),
    })
    const out = await res.json().catch(() => ({})) as { data?: { status: string; message?: string; details?: { error?: string } }[] }
    const tickets = Array.isArray(out.data) ? out.data : []
    const now = new Date().toISOString()
    for (let j = 0; j < chunk.length; j++) {
      const t = chunk[j]
      const ticket = tickets[j]
      if (ticket?.status === 'ok') {
        pushed++
        await db.from('ps_mobile_push_tokens').update({ last_success_at: now, failure_count: 0, last_error: null }).eq('id', t.id)
      } else {
        const err = ticket?.details?.error ?? ticket?.message ?? `HTTP ${res.status}`
        const dead = err === 'DeviceNotRegistered' || (t.failure_count ?? 0) + 1 >= 10
        await db.from('ps_mobile_push_tokens')
          .update({ last_failure_at: now, last_error: String(err).slice(0, 300), failure_count: (t.failure_count ?? 0) + 1, ...(dead ? { enabled: false } : {}) })
          .eq('id', t.id)
      }
    }
  }
  return pushed
}

async function bookingEvent(db: Admin, event: string, bookingId: string) {
  const { data: booking } = await db.from('ps_locum_bookings')
    .select('id, status, cancellation_reason, locum_id, shift:ps_locum_shifts(id, org_id, date, start_time, end_time, rate_per_hour, payment_mode, notes)')
    .eq('id', bookingId).maybeSingle()
  if (!booking) return { skipped: 'booking not found' }
  const shift = (Array.isArray(booking.shift) ? booking.shift[0] : booking.shift) as Record<string, string> | null
  if (!shift) return { skipped: 'shift not found' }

  // Stale events (e.g. a reminder for a booking cancelled since) are dropped.
  const expected: Record<string, string> = { confirmed: 'approved', reminder: 'approved', rejected: 'rejected', cancelled: 'cancelled' }
  if (expected[event] && booking.status !== expected[event]) return { skipped: `booking is ${booking.status}` }

  const [{ data: locum }, { data: org }] = await Promise.all([
    db.from('ps_locum_profiles').select('user_id').eq('id', booking.locum_id).maybeSingle(),
    db.from('ps_organisations').select('name, address').eq('id', shift.org_id).maybeSingle(),
  ])
  if (!locum) return { skipped: 'locum not found' }
  const { data: profile } = await db.from('ps_user_profiles').select('first_name, full_name, email').eq('id', locum.user_id).maybeSingle()
  let email = profile?.email as string | undefined
  if (!email) {
    const { data: u } = await db.auth.admin.getUserById(locum.user_id)
    email = u?.user?.email ?? undefined
  }

  const firstName = (profile?.first_name || (profile?.full_name ?? '').split(' ')[0] || 'there') as string
  const pharmacy = (org?.name as string) || 'the pharmacy'
  const where = addressLine(org?.address)
  const when = `${fmtDate(shift.date)}, ${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}`
  const rate = `£${Number(shift.rate_per_hour).toFixed(2)}/hr`
  const bookingsUrl = `${APP_URL}/locum/bookings`
  const shiftsUrl = `${APP_URL}/locum/shifts`
  const reason = booking.cancellation_reason ? `\n\nReason: ${booking.cancellation_reason}` : ''

  let subject = ''
  let text = ''
  let pushTitle = ''
  let pushBody = ''
  switch (event) {
    case 'confirmed':
      subject = `Shift confirmed: ${pharmacy}, ${fmtDate(shift.date)}`
      text = `Hi ${firstName},\n\nYou're booked at ${pharmacy} on ${when} at ${rate}.${where ? `\nAddress: ${where}` : ''}${shift.notes ? `\nNotes from the pharmacy: ${shift.notes}` : ''}\n\nOn the day, sign in from your Bookings page (from 1 hour before the start) and sign out when you finish.${shift.payment_mode === 'external' ? ' The pharmacy pays you directly for this shift.' : ''}\n\n${bookingsUrl}\n\nPharmStation`
      pushTitle = 'Shift confirmed'
      pushBody = `${pharmacy}, ${when}`
      break
    case 'reminder':
      subject = `Tomorrow: ${pharmacy}, ${fmtTime(shift.start_time)}`
      text = `Hi ${firstName},\n\nA reminder that you're working at ${pharmacy} tomorrow, ${when}.${where ? `\nAddress: ${where}` : ''}\n\nRemember to sign in when you arrive.\n\n${bookingsUrl}\n\nPharmStation`
      pushTitle = 'Shift tomorrow'
      pushBody = `${pharmacy}, ${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}`
      break
    case 'rejected':
      subject = `Application not successful: ${pharmacy}, ${fmtDate(shift.date)}`
      text = `Hi ${firstName},\n\nYour application for ${pharmacy} on ${when} wasn't successful this time.${reason}\n\nThere are other shifts waiting:\n${shiftsUrl}\n\nPharmStation`
      pushTitle = 'Application not successful'
      pushBody = `${pharmacy}, ${fmtDate(shift.date)}`
      break
    case 'cancelled':
      subject = `Shift cancelled: ${pharmacy}, ${fmtDate(shift.date)}`
      text = `Hi ${firstName},\n\nYour booking at ${pharmacy} on ${when} has been cancelled.${reason}\n\nFind another shift:\n${shiftsUrl}\n\nPharmStation`
      pushTitle = 'Shift cancelled'
      pushBody = `${pharmacy}, ${when}`
      break
    default:
      return { skipped: `unknown event ${event}` }
  }

  const [emailed, pushed] = await Promise.all([
    email ? sendEmail(email, subject, text) : Promise.resolve(false),
    sendPush(db, [locum.user_id], pushTitle, pushBody, { type: 'locum_booking', event, booking_id: booking.id }),
  ])
  return { event, booking_id: booking.id, emailed, pushed }
}

async function newShift(db: Admin, shiftId: string, targetUserIds: string[]) {
  const { data: shift } = await db.from('ps_locum_shifts')
    .select('id, org_id, date, start_time, end_time, rate_per_hour, status').eq('id', shiftId).maybeSingle()
  if (!shift || shift.status !== 'open') return { skipped: 'shift not open' }
  const { data: org } = await db.from('ps_organisations').select('name').eq('id', shift.org_id).maybeSingle()
  const pushed = await sendPush(db, targetUserIds,
    'New shift matches your search',
    `${org?.name ?? 'A pharmacy'}, ${fmtDate(shift.date)} ${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}, £${Number(shift.rate_per_hour).toFixed(2)}/hr`,
    { type: 'locum_shift', shift_id: shift.id })
  return { shift_id: shift.id, pushed }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const expected = Deno.env.get('NOTIFICATION_DISPATCH_SECRET')
  const secret = req.headers.get('x-internal-secret')
  if (!expected || !secret || secret !== expected) return json({ error: 'Unauthorized' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid request' }, 400) }

  try {
    const db = admin()
    if (body.kind === 'booking' && typeof body.booking_id === 'string' && typeof body.event === 'string') {
      return json(await bookingEvent(db, body.event, body.booking_id))
    }
    if (body.kind === 'new_shift' && typeof body.shift_id === 'string' && Array.isArray(body.target_user_ids)) {
      const ids = (body.target_user_ids as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 500)
      return json(await newShift(db, body.shift_id, ids))
    }
    return json({ error: 'Unknown payload' }, 400)
  } catch (err) {
    console.error('locum-notify failed', err)
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
