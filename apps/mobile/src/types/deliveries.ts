export type DeliveryRoundStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export type DeliveryStopStatus =
  | 'pending'
  | 'in_transit'
  | 'arrived'
  | 'delivered'
  | 'failed'
  | 'skipped'
  | 'pending_redelivery'
  | 'moved_to_round'
  | 'returned'
  | 'cancelled'

export type DeliveryMethod =
  | 'handed_to_patient'
  | 'handed_to_representative'
  | 'left_in_safe_place'

export interface DeliveryPatient {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  postcode: string | null
}

export interface DeliveryMedication {
  id: string
  quantity: number | null
  patient_medication: {
    id: string
    drug_name: string
    drug_form: string | null
    drug_strength: string | null
    dose: string | null
  } | null
}

export interface DeliveryStop {
  id: string
  round_id: string
  patient_id: string
  delivery_order: number
  status: DeliveryStopStatus
  delivery_address_line_1: string | null
  delivery_address_line_2: string | null
  delivery_city: string | null
  delivery_postcode: string | null
  notes: string | null
  signature_data: string | null
  proof_photo_paths: string[]
  delivery_recipient_name: string | null
  delivery_method: DeliveryMethod | null
  delivered_at: string | null
  failure_reason: string | null
  patient: DeliveryPatient | null
  medications: DeliveryMedication[]
}

export interface DeliveryRound {
  id: string
  organisation_id: string
  title: string | null
  status: DeliveryRoundStatus
  scheduled_date: string | null
  scheduled_time_start: string | null
  scheduled_time_end: string | null
  driver_id: string | null
  notes: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  patients: DeliveryStop[]
}

export const RESOLVED_STOP_STATUSES: DeliveryStopStatus[] = [
  'delivered',
  'skipped',
  'pending_redelivery',
  'moved_to_round',
  'returned',
  'cancelled',
]

export function isResolvedStop(status: DeliveryStopStatus) {
  return RESOLVED_STOP_STATUSES.includes(status)
}

export function stopAddress(stop: DeliveryStop) {
  const patient = stop.patient
  return [
    stop.delivery_address_line_1 || patient?.address_line_1,
    stop.delivery_address_line_2 || patient?.address_line_2,
    stop.delivery_city || patient?.city,
    stop.delivery_postcode || patient?.postcode,
  ]
    .filter(Boolean)
    .join(', ')
}