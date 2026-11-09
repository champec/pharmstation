// Services: shared types and helpers for the mobile History and Deliver
// screens. Mirrors apps/web/src/components/services/serviceRecord.ts so a
// record reads the same on the phone as on the website.
import { userClient } from '@/lib/supabase'

export const SERVICES_COLOR = '#9333EA'

export type FieldType =
  | 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date' | 'textarea'
  | 'signature' | 'canvas' | 'heading' | 'info' | 'table' | 'prescribing'

export type FormField = {
  field_key: string
  label: string
  field_type: FieldType
  options: string[] | Record<string, unknown> | null
  is_required: boolean
}

export type OutcomeType = 'prescription' | 'referral' | 'advice' | 'no_treatment'

export type OutcomeMedication = {
  id: string
  drug_name: string
  drug_form: string | null
  drug_strength: string | null
  dose: string | null
  quantity: number | null
  unit: string | null
  is_controlled_drug: boolean
  sort_order: number
}

export type DeliveryOutcome = {
  id: string
  outcome_type: OutcomeType
  referral_to: string | null
  referral_reason: string | null
  referral_urgency: 'routine' | 'urgent' | 'emergency' | null
  advice_given: string | null
  medications?: OutcomeMedication[]
}

export type DeliveryRow = {
  id: string
  org_id: string
  service_id: string
  form_id: string | null
  status: 'draft' | 'completed'
  form_data: Record<string, unknown> | null
  notes: string | null
  created_at: string
  completed_at: string | null
  amendment_count: number | null
  form_snapshot: { name?: string; version?: number; fields?: FormField[] } | null
  service: { name: string; is_nhs_service: boolean } | null
  patient: { id: string; first_name: string; last_name: string; nhs_number: string | null; dob: string | null } | null
  deliverer: { full_name: string | null; gphc_number: string | null } | null
}

export type DeliveryEvent = {
  id: string
  event: 'completed' | 'amended'
  reason: string | null
  before: { form_data?: Record<string, unknown>; notes?: string } | null
  after: { form_data?: Record<string, unknown>; notes?: string } | null
  created_at: string
  actor_profile: { full_name: string | null } | null
}

export type DeliveryRecord = DeliveryRow & {
  outcomes: DeliveryOutcome[]
  events: DeliveryEvent[]
  fields: FormField[]
}

export const DELIVERY_LIST_SELECT = `
  id, org_id, service_id, form_id, status, form_data, notes, created_at, completed_at, amendment_count, form_snapshot,
  service:ps_services(name, is_nhs_service),
  patient:ps_patients(id, first_name, last_name, nhs_number, dob),
  deliverer:ps_user_profiles!ps_service_deliveries_delivered_by_fkey(full_name, gphc_number)
`

export const OUTCOME_LABELS: Record<OutcomeType, string> = {
  prescription: 'Medicine supplied',
  referral: 'Referred',
  advice: 'Advice given',
  no_treatment: 'No treatment',
}

export async function fetchDeliveryRecord(id: string): Promise<DeliveryRecord> {
  const { data, error } = await userClient
    .from('ps_service_deliveries')
    .select(`${DELIVERY_LIST_SELECT}, outcomes:ps_delivery_outcomes(*, medications:ps_delivery_outcome_medications(*))`)
    .eq('id', id)
    .single()
  if (error) throw error
  const row = data as unknown as DeliveryRow & { outcomes: DeliveryOutcome[] }

  const { data: events, error: eErr } = await userClient
    .from('ps_service_delivery_events')
    .select('*, actor_profile:ps_user_profiles!ps_service_delivery_events_actor_fkey(full_name)')
    .eq('delivery_id', id)
    .order('created_at')
  if (eErr) throw eErr

  // Records made before form snapshots existed fall back to the live form.
  let fields: FormField[] = row.form_snapshot?.fields ?? []
  if (fields.length === 0 && row.form_id) {
    const { data: live } = await userClient
      .from('ps_service_form_fields')
      .select('field_key, label, field_type, options, is_required')
      .eq('form_id', row.form_id)
      .order('display_order')
    fields = (live as FormField[]) ?? []
  }
  for (const o of row.outcomes ?? []) {
    o.medications = [...(o.medications ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  }
  return { ...row, outcomes: row.outcomes ?? [], events: (events as unknown as DeliveryEvent[]) ?? [], fields }
}

export async function amendDeliveryRecord(p: { deliveryId: string; reason: string; formData: Record<string, unknown> | null; notes: string | null }) {
  const { error } = await userClient.rpc('ps_amend_service_delivery', {
    p_delivery_id: p.deliveryId,
    p_reason: p.reason,
    p_form_data: p.formData,
    p_notes: p.notes,
  })
  if (error) throw error
}

const LAYOUT = new Set<FieldType>(['heading', 'info'])
export const isLayoutField = (t: FieldType) => LAYOUT.has(t)

/** Field types whose answers can be corrected with a simple input. */
export const SIMPLE_FIELD_TYPES = new Set<FieldType>(['text', 'number', 'textarea', 'date', 'select', 'boolean'])

export function fieldOptions(f: FormField): string[] {
  if (Array.isArray(f.options)) return f.options as string[]
  const v = (f.options as { values?: unknown } | null)?.values
  return Array.isArray(v) ? (v as string[]) : []
}

export function formatAnswer(value: unknown): string {
  if (value === undefined || value === null || value === '') return '–'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) return value.map(formatAnswer).join(', ')
    return value.map((v) => formatAnswer(v)).join('\n')
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const order = obj.clinical_order as Record<string, unknown> | undefined
    if (order?.drug_name) {
      return [order.drug_name, order.dose, order.quantity && `qty ${order.quantity}`].filter(Boolean).join(' · ')
    }
    return Object.entries(obj)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${formatAnswer(v)}`)
      .join('; ')
  }
  return String(value)
}

export const isImageAnswer = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image/')

export const patientName = (p: DeliveryRow['patient']) => (p ? `${p.first_name} ${p.last_name}`.trim() : '')

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Strips characters that would break a PostgREST `or=` filter. */
export const cleanSearch = (q: string) => q.replace(/[,()"\\%*:]/g, ' ').trim()

export function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: string } | null)?.message
  return m && m.length > 0 ? m : fallback
}
