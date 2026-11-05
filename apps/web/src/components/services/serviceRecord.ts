import { getUserClient } from '@pharmstation/supabase-client'
import type { DeliveryOutcome, ServiceDelivery, ServiceDeliveryEvent, ServiceFormSnapshot } from '@pharmstation/types'

/** A delivery row with the joins every services screen needs. */
export interface DeliveryListRow extends ServiceDelivery {
  service: { name: string; is_nhs_service: boolean } | null
  patient: { id: string; first_name: string; last_name: string; nhs_number: string | null; dob: string | null } | null
  deliverer: { full_name: string | null; gphc_number: string | null } | null
}

export interface DeliveryRecord extends DeliveryListRow {
  outcomes: DeliveryOutcome[]
  events: Array<ServiceDeliveryEvent & { actor_profile: { full_name: string | null } | null }>
  /** Field definitions used to label the answers (snapshot, else live form) */
  fields: ServiceFormSnapshot['fields']
}

export const DELIVERY_LIST_SELECT = `
  *,
  service:ps_services(name, is_nhs_service),
  patient:ps_patients(id, first_name, last_name, nhs_number, dob),
  deliverer:ps_user_profiles!ps_service_deliveries_delivered_by_fkey(full_name, gphc_number)
`

export async function fetchDeliveryRecord(deliveryId: string): Promise<DeliveryRecord> {
  const client = getUserClient()
  const { data, error } = await client
    .from('ps_service_deliveries')
    .select(`${DELIVERY_LIST_SELECT}, outcomes:ps_delivery_outcomes(*, medications:ps_delivery_outcome_medications(*))`)
    .eq('id', deliveryId)
    .single()
  if (error) throw error
  const row = data as DeliveryListRow & { outcomes: DeliveryOutcome[] }

  const { data: events, error: eventsErr } = await client
    .from('ps_service_delivery_events')
    .select('*, actor_profile:ps_user_profiles!ps_service_delivery_events_actor_fkey(full_name)')
    .eq('delivery_id', deliveryId)
    .order('created_at')
  if (eventsErr) throw eventsErr

  // Records made before form snapshots existed fall back to the live form.
  let fields: ServiceFormSnapshot['fields'] = row.form_snapshot?.fields ?? []
  if (fields.length === 0 && row.form_id) {
    const { data: live } = await client
      .from('ps_service_form_fields')
      .select('field_key, label, field_type, options, is_required')
      .eq('form_id', row.form_id)
      .order('display_order')
    fields = (live as ServiceFormSnapshot['fields']) ?? []
  }

  for (const o of row.outcomes ?? []) {
    o.medications = [...(o.medications ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  }

  return { ...row, outcomes: row.outcomes ?? [], events: (events as DeliveryRecord['events']) ?? [], fields }
}

export async function amendDeliveryRecord(params: {
  deliveryId: string
  reason: string
  formData?: Record<string, unknown> | null
  notes?: string | null
}): Promise<void> {
  const { error } = await getUserClient().rpc('ps_amend_service_delivery', {
    p_delivery_id: params.deliveryId,
    p_reason: params.reason,
    p_form_data: params.formData ?? null,
    p_notes: params.notes ?? null,
  })
  if (error) throw error
}

const LAYOUT_TYPES = new Set(['heading', 'info'])

/** Field types whose answers can be corrected with a plain text box. */
export const SIMPLE_FIELD_TYPES = new Set(['text', 'number', 'textarea', 'date', 'select', 'boolean'])

export function isLayoutField(fieldType: string): boolean {
  return LAYOUT_TYPES.has(fieldType)
}

/** Turns a stored answer into readable text. Images are handled by the caller. */
export function formatAnswer(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) return value.map(formatAnswer).join(', ')
    return value.map((v) => formatAnswer(v)).join('\n')
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Prescribing field: show the drug and pack rather than raw JSON.
    const order = obj.clinical_order as Record<string, unknown> | undefined
    if (order?.drug_name) {
      const parts = [order.drug_name, order.dose, order.quantity && `qty ${order.quantity}`].filter(Boolean)
      return parts.join(' · ')
    }
    return Object.entries(obj)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${formatAnswer(v)}`)
      .join('; ')
  }
  return String(value)
}

export function isImageAnswer(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/')
}

export function patientName(p: DeliveryListRow['patient']): string {
  return p ? `${p.first_name} ${p.last_name}`.trim() : ''
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
