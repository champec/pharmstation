// ============================================
// PharmStation Edge Function: appointments
// Patient-facing booking actions. Deploy with verify_jwt = false: guests
// have no session, and every action does its own checks.
//
// Actions:
//   book        — public booking. Verifies Cloudflare Turnstile, then calls
//                 ps_book_public_appointment() with the service role and the
//                 caller's IP (for rate limits). A signed-in portal patient's
//                 booking is linked to their account. Free services get a
//                 "booking received" text straight away; paid ones get a
//                 "confirmed" text from stripe-webhook once paid.
//                 body: { org_id, service_id, slot_id, first_name, last_name,
//                         email?, phone?, dob?, nhs_number?, form_id?,
//                         form_data?, notes?, turnstile_token? }
//   manage_get  — what the patient's manage link shows.
//                 body: { token }
//   cancel      — patient cancels by manage token, or a signed-in portal
//                 patient by appointment id. Refunds in full when the
//                 pharmacy's cancellation window allows.
//                 body: { token } | { appointment_id } (+ Authorization)
//   staff_set_status — staff confirm/cancel with patient text and optional
//                 refund. body: { appointment_id, status, refund?, notify? }
//   available_slots / reschedule — patient moves their own booking (same
//                 notice rule as a free cancellation). body: { token | appointment_id, slot_id? }
//   staff_slots / staff_reschedule — staff move a booking.
//   run_jobs    — pg_cron (x-internal-secret): reminder texts, video rooms.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'
import { ensureVideoConsult } from '../_shared/video-rooms.ts'
import {
  appUrl, formatWhen, holdMinutes, loadBooking, paidPaymentFor, pounds, refundBookingPayment, rulesFrom, textPatient,
  type BookingView,
} from '../_shared/appointment-helpers.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

class PublicError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}
type Db = ReturnType<typeof admin>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : null)

function clientIp(req: Request): string | null {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-real-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? null
}

/** The signed-in user's id, or null for guests / invalid tokens. */
async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  // The anon key is sent as a bearer by the browser for guests.
  if (token === Deno.env.get('SUPABASE_ANON_KEY')) return null
  const { data } = await admin().auth.getUser(token)
  return data?.user?.id ?? null
}

// ------------------------------------------------------------
// Cloudflare Turnstile
// ------------------------------------------------------------
async function verifyTurnstile(token: string | null, ip: string | null): Promise<void> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret) {
    // Not configured yet: rate limits still apply. Turn it on by setting the
    // secret here and VITE_TURNSTILE_SITE_KEY on the web app.
    return
  }
  if (!token) throw new PublicError('Please complete the security check and try again.')
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
  const out = await res.json().catch(() => ({})) as { success?: boolean }
  if (!out.success) throw new PublicError('The security check failed. Please refresh the page and try again.')
}

// ------------------------------------------------------------
// book
// ------------------------------------------------------------
async function book(req: Request, body: Record<string, unknown>) {
  const ip = clientIp(req)
  await verifyTurnstile(str(body.turnstile_token, 4096), ip)

  for (const k of ['org_id', 'service_id', 'slot_id']) {
    if (typeof body[k] !== 'string' || !UUID.test(body[k] as string)) throw new PublicError(`Missing ${k}`)
  }
  if (body.form_id != null && (typeof body.form_id !== 'string' || !UUID.test(body.form_id))) {
    throw new PublicError('Invalid form_id')
  }
  const dob = str(body.dob, 10)
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new PublicError('Please check your date of birth')
  const formData = body.form_data && typeof body.form_data === 'object' && !Array.isArray(body.form_data)
    ? body.form_data : null

  const authUser = await callerId(req)
  const db = admin()

  const { data, error } = await db.rpc('ps_book_public_appointment', {
    p_org_id: body.org_id,
    p_service_id: body.service_id,
    p_slot_id: body.slot_id,
    p_first_name: str(body.first_name, 100),
    p_last_name: str(body.last_name, 100),
    p_email: str(body.email, 254),
    p_phone: str(body.phone, 30),
    p_dob: dob || null,
    p_nhs_number: str(body.nhs_number, 20),
    p_form_id: body.form_id ?? null,
    p_form_data: formData,
    p_notes: str(body.notes, 2000),
    p_ip: ip,
    p_auth_user_id: authUser,
    p_hold_minutes: holdMinutes(),
  })
  if (error) {
    // Our own checks raise P0001/P0002 with patient-friendly wording.
    if (error.code === 'P0001' || error.code === 'P0002') {
      throw new PublicError(error.message, error.code === 'P0002' ? 429 : 400)
    }
    if (/fully booked/i.test(error.message)) throw new PublicError('That time has just been taken. Please pick another.')
    console.error('book failed', error)
    throw new PublicError('Sorry, the booking could not be saved. Please try again.', 500)
  }

  const result = data as {
    appointment_id: string; patient_id: string; manage_token: string
    requires_payment: boolean; hold_expires_at: string | null
  }

  if (!result.requires_payment) {
    const b = await loadBooking(db, { id: result.appointment_id })
    if (b) await textPatient(db, b, 'requested')
  }

  return json(result)
}

// ------------------------------------------------------------
// Patient access: by manage token, or signed-in owner
// ------------------------------------------------------------
async function bookingForPatient(req: Request, body: Record<string, unknown>): Promise<BookingView> {
  const db = admin()
  if (typeof body.token === 'string') {
    if (!UUID.test(body.token)) throw new PublicError('This link is not valid.', 404)
    const b = await loadBooking(db, { manage_token: body.token })
    if (!b) throw new PublicError('We could not find this booking.', 404)
    return b
  }
  if (typeof body.appointment_id === 'string' && UUID.test(body.appointment_id)) {
    const uid = await callerId(req)
    if (!uid) throw new PublicError('Please sign in.', 401)
    const b = await loadBooking(db, { id: body.appointment_id })
    if (!b || !b.patient_id) throw new PublicError('We could not find this booking.', 404)
    const { data: owner } = await db.from('ps_patients').select('id')
      .eq('id', b.patient_id).eq('auth_user_id', uid).maybeSingle()
    if (!owner) throw new PublicError('We could not find this booking.', 404)
    return b
  }
  throw new PublicError('Missing booking reference.')
}

function cancelTerms(b: BookingView, paidPence: number) {
  const rules = rulesFrom(b.org_settings)
  const start = b.start_time ? new Date(b.start_time).getTime() : 0
  const hoursBefore = (start - Date.now()) / 3_600_000
  const active = b.status === 'pending' || b.status === 'confirmed'
  const canCancel = active && rules.patient_can_cancel && hoursBefore > 0
  const refundDue = canCancel && paidPence > 0 && hoursBefore >= rules.refund_cutoff_hours
  // Moving is allowed while a free cancellation would be (same notice rule),
  // and never while an unpaid hold is running.
  const canMove = canCancel && !b.hold_expires_at && hoursBefore >= rules.refund_cutoff_hours
  return { rules, hoursBefore, canCancel, refundDue, canMove }
}

async function manageGet(req: Request, body: Record<string, unknown>) {
  const b = await bookingForPatient(req, body)
  const db = admin()
  const p = await paidPaymentFor(db, b.id)
  const paidPence = p ? p.amount_pence - (p.refunded_pence ?? 0) : 0
  const t = cancelTerms(b, paidPence)
  return json({
    booking: {
      id: b.id,
      status: b.status,
      awaiting_payment: b.status === 'pending' && !!b.hold_expires_at,
      start_time: b.start_time,
      end_time: b.end_time,
      service_name: b.service_name,
      is_video: b.is_video,
      org_name: b.org_name,
      org_slug: b.org_slug,
      org_phone: b.org_phone,
      patient_first_name: b.patient_first_name,
      paid_pence: paidPence,
    },
    can_cancel: t.canCancel,
    can_move: t.canMove,
    refund_on_cancel: t.refundDue,
    refund_cutoff_hours: t.rules.refund_cutoff_hours,
    video: await videoFor(db, b),
  })
}

/** The video link and code, once the room exists (made with the reminder). */
async function videoFor(db: Db, b: BookingView) {
  if (!b.is_video || b.status !== 'confirmed') return null
  const { data } = await db.from('ps_video_consultations')
    .select('id, patient_access_code')
    .eq('appointment_id', b.id).not('status', 'in', '(completed,cancelled)')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data ? { consultation_id: data.id, access_code: data.patient_access_code } : null
}

// ------------------------------------------------------------
// available_slots / reschedule — patient moves their own booking
// ------------------------------------------------------------
async function openSlots(db: Db, b: BookingView) {
  const { data } = await db.from('ps_appointment_slots')
    .select('id, start_time, end_time, max_bookings, booked_count')
    .eq('org_id', b.org_id).eq('service_id', b.service_id ?? '')
    .eq('is_active', true)
    .gt('start_time', new Date(Date.now() + 30 * 60_000).toISOString())
    .lte('start_time', new Date(Date.now() + 90 * 86_400_000).toISOString())
    .order('start_time').limit(300)
  return (data ?? [])
    .filter((s) => s.booked_count < s.max_bookings && s.id !== b.slot_id)
    .map((s) => ({ id: s.id, start_time: s.start_time, end_time: s.end_time }))
}

async function availableSlots(req: Request, body: Record<string, unknown>) {
  const b = await bookingForPatient(req, body)
  const db = admin()
  const t = cancelTerms(b, 0)
  if (!t.canMove) throw new PublicError('This booking can no longer be moved online. Please contact the pharmacy.')
  return json({ slots: await openSlots(db, b) })
}

async function moveBooking(db: Db, b: BookingView, slotId: string) {
  const { data: slot } = await db.from('ps_appointment_slots')
    .select('id, org_id, service_id, start_time, is_active')
    .eq('id', slotId).maybeSingle()
  if (!slot || slot.org_id !== b.org_id || slot.service_id !== b.service_id || !slot.is_active) {
    throw new PublicError('That time is not available for this service.')
  }
  if (new Date(slot.start_time).getTime() <= Date.now()) throw new PublicError('That time has already passed.')
  let q = db.from('ps_appointments').update({ slot_id: slotId })
    .eq('id', b.id).in('status', ['pending', 'confirmed'])
  q = b.slot_id ? q.eq('slot_id', b.slot_id) : q.is('slot_id', null)
  const { data: moved, error } = await q.select('id')
  if (error) {
    if (error.code === 'P0001') throw new PublicError(error.message)
    throw new PublicError('Sorry, the booking could not be moved. Please try again.', 500)
  }
  if (!moved?.length) throw new PublicError('This booking has already changed. Please refresh.')
  // The video room is tied to the old time: cancel it so a new one is made.
  await db.from('ps_video_consultations').update({ status: 'cancelled' })
    .eq('appointment_id', b.id).eq('status', 'scheduled')
  const after = await loadBooking(db, { id: b.id })
  if (after) await textPatient(db, after, 'moved')
  return after
}

async function reschedule(req: Request, body: Record<string, unknown>) {
  const b = await bookingForPatient(req, body)
  if (typeof body.slot_id !== 'string' || !UUID.test(body.slot_id)) throw new PublicError('Pick a new time.')
  const t = cancelTerms(b, 0)
  if (!t.canMove) throw new PublicError('This booking can no longer be moved online. Please contact the pharmacy.')
  const db = admin()
  const after = await moveBooking(db, b, body.slot_id)
  await db.rpc('ps_fanout_notification', {
    p_org_id: b.org_id,
    p_event_type: 'appointment',
    p_title: 'Booking moved by patient',
    p_body: `${b.patient_first_name ?? 'A patient'} moved ${b.service_name} to ${after?.start_time ? formatWhen(after.start_time) : 'a new time'}`,
    p_link: `/appointments/${b.id}`,
    p_metadata: { appointment_id: b.id },
  })
  return json({ moved: true, start_time: after?.start_time, end_time: after?.end_time })
}

async function cancel(req: Request, body: Record<string, unknown>) {
  const b = await bookingForPatient(req, body)
  const db = admin()
  const p = await paidPaymentFor(db, b.id)
  const paidPence = p ? p.amount_pence - (p.refunded_pence ?? 0) : 0
  const t = cancelTerms(b, paidPence)
  if (!t.canCancel) {
    throw new PublicError(
      b.status === 'cancelled'
        ? 'This booking is already cancelled.'
        : 'This booking can no longer be cancelled online. Please contact the pharmacy.',
    )
  }

  const { data: updated, error } = await db.from('ps_appointments')
    .update({ status: 'cancelled', cancelled_by: 'patient' })
    .eq('id', b.id).in('status', ['pending', 'confirmed'])
    .select('id')
  if (error) throw new PublicError('Sorry, the booking could not be cancelled. Please try again.', 500)
  if (!updated?.length) throw new PublicError('This booking has already changed. Please refresh.')

  let refunded = 0
  let refundError: string | null = null
  if (t.refundDue) {
    try {
      refunded = await refundBookingPayment(db, b.id, 'patient')
    } catch (e) {
      console.error('patient cancel refund failed', e)
      refundError = 'Your booking is cancelled, but the refund did not go through automatically. The pharmacy has been told and will refund you.'
    }
  }

  // Tell the pharmacy (and flag a failed refund for them to do by hand).
  await db.rpc('ps_fanout_notification', {
    p_org_id: b.org_id,
    p_event_type: 'appointment',
    p_title: refundError ? 'Booking cancelled: refund needed' : 'Booking cancelled by patient',
    p_body: `${b.patient_first_name ?? 'A patient'} cancelled ${b.service_name}`
      + (refunded ? ` (refunded ${pounds(refunded)})` : refundError ? ' (automatic refund failed, refund from Payments)' : ''),
    p_link: `/appointments/${b.id}`,
    p_metadata: { appointment_id: b.id },
  })

  const extra = refunded
    ? `${pounds(refunded)} will be refunded to your card within 5 to 10 days.`
    : paidPence > 0 && !refundError
      ? `As this was within ${t.rules.refund_cutoff_hours} hours of the appointment, no refund is due.`
      : ''
  await textPatient(db, b, 'cancelled', extra)

  return json({ cancelled: true, refunded_pence: refunded, refund_error: refundError })
}

// ------------------------------------------------------------
// staff_set_status — confirm or cancel from the staff app, texting the
// patient and (for cancel) optionally refunding in the same step.
// body: { appointment_id, status: 'confirmed' | 'cancelled', refund?, notify? }
// ------------------------------------------------------------
async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const db = admin()
  const { data: org } = await db.from('ps_organisations').select('auth_user_id').eq('id', orgId).maybeSingle()
  if (!org) return false
  if (org.auth_user_id === userId) return true
  const { data: m } = await db.from('ps_organisation_members').select('user_id')
    .eq('organisation_id', orgId).eq('user_id', userId).eq('status', 'active').maybeSingle()
  return !!m
}

async function staffSetStatus(req: Request, body: Record<string, unknown>) {
  const uid = await callerId(req)
  if (!uid) throw new PublicError('Please sign in.', 401)
  if (typeof body.appointment_id !== 'string' || !UUID.test(body.appointment_id)) throw new PublicError('Missing appointment_id')
  const status = body.status
  if (status !== 'confirmed' && status !== 'cancelled') throw new PublicError('Status must be confirmed or cancelled')

  const db = admin()
  const b = await loadBooking(db, { id: body.appointment_id })
  if (!b || !(await isOrgMember(uid, b.org_id))) throw new PublicError('Appointment not found', 404)

  const from = status === 'confirmed' ? ['pending'] : ['pending', 'confirmed']
  const patch: Record<string, unknown> = { status }
  if (status === 'cancelled') patch.cancelled_by = 'pharmacy'
  if (status === 'confirmed') patch.hold_expires_at = null
  const { data: updated, error } = await db.from('ps_appointments').update(patch)
    .eq('id', b.id).in('status', from).select('id')
  if (error) throw new PublicError(error.message, 500)
  if (!updated?.length) throw new PublicError('This appointment has already changed. Please refresh.')

  let refunded = 0
  let refundError: string | null = null
  if (status === 'cancelled' && body.refund === true) {
    try {
      refunded = await refundBookingPayment(db, b.id, uid)
    } catch (e) {
      refundError = `Cancelled, but the refund failed: ${(e as Error).message}. Try again from Payments.`
    }
  }

  let texted = false
  if (body.notify !== false) {
    const extra = status === 'cancelled'
      ? refunded ? `${pounds(refunded)} will be refunded to your card within 5 to 10 days.` : 'Please contact the pharmacy if you have any questions.'
      : ''
    texted = (await textPatient(db, b, status === 'confirmed' ? 'confirmed' : 'cancelled', extra)).sent
  }
  return json({ ok: true, refunded_pence: refunded, refund_error: refundError, texted })
}

async function staffBooking(req: Request, body: Record<string, unknown>) {
  const uid = await callerId(req)
  if (!uid) throw new PublicError('Please sign in.', 401)
  if (typeof body.appointment_id !== 'string' || !UUID.test(body.appointment_id)) throw new PublicError('Missing appointment_id')
  const db = admin()
  const b = await loadBooking(db, { id: body.appointment_id })
  if (!b || !(await isOrgMember(uid, b.org_id))) throw new PublicError('Appointment not found', 404)
  return { db, b }
}

async function staffSlots(req: Request, body: Record<string, unknown>) {
  const { db, b } = await staffBooking(req, body)
  return json({ slots: await openSlots(db, b) })
}

async function staffReschedule(req: Request, body: Record<string, unknown>) {
  const { db, b } = await staffBooking(req, body)
  if (typeof body.slot_id !== 'string' || !UUID.test(body.slot_id)) throw new PublicError('Pick a new time.')
  if (b.status !== 'pending' && b.status !== 'confirmed') throw new PublicError('Only an upcoming booking can be moved.')
  const after = await moveBooking(db, b, body.slot_id)
  return json({ moved: true, start_time: after?.start_time })
}

// ------------------------------------------------------------
// run_jobs — called by pg_cron every 15 minutes (ps_run_appointment_jobs).
// Sends reminder texts, setting up the video room first for video services.
// ------------------------------------------------------------
async function runJobs(req: Request) {
  const db = admin()
  const { data: secret } = await db.from('ps_internal_secrets').select('value')
    .eq('key', 'appointments_cron_secret').maybeSingle()
  const given = req.headers.get('x-internal-secret') ?? ''
  if (!secret?.value || given.length !== secret.value.length || given !== secret.value) {
    throw new PublicError('Forbidden', 403)
  }

  const horizon = new Date(Date.now() + 49 * 3_600_000).toISOString()
  const { data: due } = await db.from('ps_appointments')
    .select('id, created_at, slot:ps_appointment_slots!inner(start_time)')
    .eq('status', 'confirmed').is('reminder_sent_at', null)
    .gt('slot.start_time', new Date().toISOString())
    .lte('slot.start_time', horizon)
    .limit(500)

  let sent = 0
  let skipped = 0
  for (const row of due ?? []) {
    // deno-lint-ignore no-explicit-any
    const start = new Date((row as any).slot.start_time).getTime()
    const b = await loadBooking(db, { id: row.id })
    if (!b) continue
    const rules = rulesFrom(b.org_settings)
    const hoursLeft = (start - Date.now()) / 3_600_000
    if (rules.reminder_hours <= 0 || hoursLeft > rules.reminder_hours) continue
    // Booked within the last few hours of the appointment: no reminder.
    if (start - new Date(row.created_at).getTime() < 3 * 3_600_000) {
      await db.from('ps_appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', b.id)
      skipped++
      continue
    }

    let extra = ''
    if (b.is_video && b.start_time) {
      try {
        const v = await ensureVideoConsult(db, {
          id: b.id, org_id: b.org_id, patient_id: b.patient_id,
          patient_name: b.patient_first_name ?? 'Patient', patient_phone: b.patient_phone, start_time: b.start_time,
        })
        extra = `Video call: ${appUrl()}/consult/${v.id} code ${v.patient_access_code}.`
      } catch (e) {
        console.error('video room setup failed', b.id, e)
        await db.rpc('ps_fanout_notification', {
          p_org_id: b.org_id, p_event_type: 'appointment',
          p_title: 'Video room could not be set up',
          p_body: `Set up the video call for ${b.patient_first_name ?? 'a patient'} (${b.service_name}) by hand.`,
          p_link: `/appointments/${b.id}`, p_metadata: { appointment_id: b.id },
        })
      }
    }
    await textPatient(db, b, 'reminder', extra)
    await db.from('ps_appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', b.id)
    sent++
  }
  return json({ reminders_sent: sent, skipped })
}

// ------------------------------------------------------------
// Router
// ------------------------------------------------------------
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
      case 'book': return await book(req, body)
      case 'manage_get': return await manageGet(req, body)
      case 'cancel': return await cancel(req, body)
      case 'staff_set_status': return await staffSetStatus(req, body)
      case 'available_slots': return await availableSlots(req, body)
      case 'reschedule': return await reschedule(req, body)
      case 'staff_slots': return await staffSlots(req, body)
      case 'staff_reschedule': return await staffReschedule(req, body)
      case 'run_jobs': return await runJobs(req)
      default: return json({ error: `Unknown action: ${body.action}` }, 400)
    }
  } catch (e) {
    if (e instanceof PublicError) return json({ error: e.message }, e.status)
    console.error('appointments error', e)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})
