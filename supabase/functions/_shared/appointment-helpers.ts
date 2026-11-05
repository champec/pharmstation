// ============================================================
// Shared appointment helpers: patient-facing text wording, the manage link,
// the pharmacy's cancellation rule, and refunding a booking's payment.
// Used by the `appointments` and `stripe-webhook` functions.
// ============================================================

import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'
import { sendPatientSms, type PatientSmsResult } from './patient-sms.ts'

export function appUrl(): string {
  return (Deno.env.get('PUBLIC_APP_URL') || 'https://pharmstation.co.uk').replace(/\/+$/, '')
}

export function manageLink(token: string): string {
  return `${appUrl()}/booking/manage/${token}`
}

/** Minutes an unpaid booking holds its slot: Checkout expiry + 10 minutes. */
export function holdMinutes(): number {
  const checkout = Math.min(Math.max(Number(Deno.env.get('CHECKOUT_EXPIRY_MINUTES') ?? '30') || 30, 30), 1440)
  return checkout + 10
}

const LONDON = 'Europe/London'

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { timeZone: LONDON, weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { timeZone: LONDON, hour: '2-digit', minute: '2-digit' })
  return `${day} at ${time}`
}

export type AppointmentRules = {
  /** Patients get a full refund if they cancel at least this many hours before. */
  refund_cutoff_hours: number
  /** Patients may cancel or move their own booking online. */
  patient_can_cancel: boolean
  /** Send a reminder text this many hours before (0 = off). */
  reminder_hours: number
}

export const DEFAULT_RULES: AppointmentRules = {
  refund_cutoff_hours: 24,
  patient_can_cancel: true,
  reminder_hours: 24,
}

export function rulesFrom(settings: unknown): AppointmentRules {
  const a = ((settings ?? {}) as Record<string, unknown>).appointments as Record<string, unknown> | undefined
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  return {
    refund_cutoff_hours: num(a?.refund_cutoff_hours, DEFAULT_RULES.refund_cutoff_hours),
    patient_can_cancel: typeof a?.patient_can_cancel === 'boolean' ? a.patient_can_cancel : DEFAULT_RULES.patient_can_cancel,
    reminder_hours: num(a?.reminder_hours, DEFAULT_RULES.reminder_hours),
  }
}

/** Everything a patient-facing message or page needs about one booking. */
export type BookingView = {
  id: string
  org_id: string
  patient_id: string | null
  status: string
  manage_token: string
  hold_expires_at: string | null
  service_id: string | null
  slot_id: string | null
  start_time: string | null
  end_time: string | null
  service_name: string
  is_video: boolean
  org_name: string
  org_slug: string | null
  org_phone: string | null
  org_settings: unknown
  patient_first_name: string | null
  patient_phone: string | null
  patient_email: string | null
}

export async function loadBooking(
  db: SupabaseClient,
  by: { id?: string; manage_token?: string },
): Promise<BookingView | null> {
  let q = db.from('ps_appointments').select(`
    id, org_id, patient_id, status, manage_token, hold_expires_at, service_id, slot_id,
    slot:ps_appointment_slots(start_time, end_time),
    service:ps_services(name, is_video),
    org:ps_organisations(name, slug, settings, address),
    patient:ps_patients(first_name, phone, email)
  `)
  if (by.id) q = q.eq('id', by.id)
  else if (by.manage_token) q = q.eq('manage_token', by.manage_token)
  else return null
  const { data, error } = await q.maybeSingle()
  if (error || !data) return null
  // deno-lint-ignore no-explicit-any
  const r = data as any
  const address = (r.org?.address ?? {}) as Record<string, unknown>
  return {
    id: r.id,
    org_id: r.org_id,
    patient_id: r.patient_id,
    status: r.status,
    manage_token: r.manage_token,
    hold_expires_at: r.hold_expires_at,
    service_id: r.service_id,
    slot_id: r.slot_id,
    start_time: r.slot?.start_time ?? null,
    end_time: r.slot?.end_time ?? null,
    service_name: r.service?.name ?? 'your appointment',
    is_video: !!r.service?.is_video,
    org_name: r.org?.name ?? 'the pharmacy',
    org_slug: r.org?.slug ?? null,
    org_phone: (address.phone as string) ?? null,
    org_settings: r.org?.settings ?? null,
    patient_first_name: r.patient?.first_name ?? null,
    patient_phone: r.patient?.phone ?? null,
    patient_email: r.patient?.email ?? null,
  }
}

export type BookingTextKind = 'requested' | 'confirmed' | 'cancelled' | 'moved' | 'reminder'

export function bookingText(b: BookingView, kind: BookingTextKind, extra = ''): string {
  const hi = b.patient_first_name ? `Hi ${b.patient_first_name}, ` : ''
  const when = b.start_time ? formatWhen(b.start_time) : 'the agreed time'
  const link = manageLink(b.manage_token)
  switch (kind) {
    case 'requested':
      return `${hi}your booking for ${b.service_name} at ${b.org_name} on ${when} has been received. The pharmacy will confirm it. View or cancel: ${link}`
    case 'confirmed':
      return `${hi}your ${b.service_name} at ${b.org_name} is confirmed for ${when}.${extra ? ` ${extra}` : ''} View, move or cancel: ${link}`
    case 'moved':
      return `${hi}your ${b.service_name} at ${b.org_name} has moved to ${when}. View or cancel: ${link}`
    case 'cancelled':
      return `${hi}your ${b.service_name} at ${b.org_name} on ${when} has been cancelled.${extra ? ` ${extra}` : ''}`
    case 'reminder':
      return `Reminder: ${b.service_name} at ${b.org_name} on ${when}.${extra ? ` ${extra}` : ''} Can't make it? ${link}`
  }
}

export function textPatient(
  db: SupabaseClient,
  b: BookingView,
  kind: BookingTextKind,
  extra = '',
): Promise<PatientSmsResult> {
  return sendPatientSms(db, {
    org_id: b.org_id,
    patient_id: b.patient_id,
    phone: b.patient_phone,
    body: bookingText(b, kind, extra),
    feature: kind === 'reminder' ? 'reminder' : 'appointment',
    reference: `appointment:${b.id}:${kind}`,
  })
}

// ------------------------------------------------------------
// Refunds
// ------------------------------------------------------------

function stripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY')
  return new Stripe(key, { apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient() })
}

/** The succeeded (or part-refunded) card payment for a booking, if any. */
export async function paidPaymentFor(db: SupabaseClient, appointmentId: string) {
  const { data } = await db.from('ps_payments')
    .select('id, org_id, status, amount_pence, refunded_pence, stripe_payment_intent_id, metadata')
    .eq('appointment_id', appointmentId)
    .in('status', ['succeeded', 'partially_refunded'])
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  return data
}

/**
 * Refund whatever is left of a booking's payment. The ledger row is updated
 * by the charge.refunded webhook. Returns the pence refunded (0 if none due).
 */
export async function refundBookingPayment(
  db: SupabaseClient,
  appointmentId: string,
  actor: string,
): Promise<number> {
  const p = await paidPaymentFor(db, appointmentId)
  if (!p || !p.stripe_payment_intent_id) return 0
  const remaining = p.amount_pence - (p.refunded_pence ?? 0)
  if (remaining <= 0) return 0
  const meta = (p.metadata ?? {}) as Record<string, unknown>
  const isDestination = typeof meta.destination === 'string'
  await stripe().refunds.create({
    payment_intent: p.stripe_payment_intent_id,
    amount: remaining,
    reason: 'requested_by_customer',
    metadata: { payment_id: p.id, appointment_id: appointmentId, refunded_by: actor },
    ...(isDestination ? { reverse_transfer: true, refund_application_fee: true } : {}),
  }, { idempotencyKey: `appt-refund-${p.id}-${p.refunded_pence ?? 0}` })
  return remaining
}

export function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`
}
