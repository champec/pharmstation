// ============================================
// Care homes (mobile): data access and plain-English labels.
// Mirrors packages/core/src/stores/care-home-store.ts and
// apps/web/src/pages/care-homes/careHomeLabels.ts. Row-level security and the
// care_home_* permissions decide what each person can read and change.
// ============================================

import { userClient } from '@/lib/supabase'

export interface CareHomePatient {
  id: string
  first_name: string
  last_name: string
  dob: string | null
  nhs_number: string | null
}

export interface CareHomeLink {
  id: string
  status: string
  contact_name: string | null
  contact_phone: string | null
  default_cycle_length_days: number | null
  pharmacy_organisation: { id: string; name: string } | null
  care_home_organisation: { id: string; name: string } | null
}

export interface CareHomeResident {
  id: string
  care_home_link_id: string
  patient_id: string
  room_number: string | null
  status: string
  gp_name: string | null
  gp_practice: string | null
  allergies: string | null
  special_instructions: string | null
  unit_id: string | null
  patient: CareHomePatient | null
  group_memberships: { group_id: string }[] | null
}

export interface CareHomeGroup {
  id: string
  name: string
  floor_name: string | null
  group_type: string
  group_state: string
  cycle_day: number | null
  state_changed_at: string | null
}

export interface CareHomeSchedule {
  id: string
  schedule_type: string
  dose: string
  route: string | null
  instructions: string | null
  round_time: string | null
  lifecycle_status: string
  patient_medication: { drug_name: string; drug_strength: string | null; drug_form: string | null } | null
}

export interface CareHomeNote {
  id: string
  note_type: string
  note_date: string
  note_text: string
  created_at: string
}

export interface CareHomeRequest {
  id: string
  care_home_link_id: string
  care_home_resident_id: string
  request_type: string
  medicine_name: string
  quantity: number | null
  needed_by: string | null
  status: string
  request_notes: string | null
  requested_by: string
  requested_at: string
  resident: { room_number: string | null; patient: CareHomePatient | null } | null
}

export interface MarDose {
  id: string
  mar_cycle_id: string
  administration_date: string
  round_time: string | null
  status: string
  dose: string | null
  notes: string | null
  administered_at: string | null
  medication_schedule: {
    route: string | null
    instructions: string | null
    patient_medication: { drug_name: string } | null
  } | null
  cycle: {
    id: string
    status: string
    care_home_resident_id: string
    resident: { id: string; room_number: string | null; care_home_link_id: string; patient: CareHomePatient | null } | null
  } | null
}

// ---------- labels ----------

const LABELS: Record<string, Record<string, string>> = {
  residentStatus: { active: 'Active', hospital: 'In hospital', leave: 'On leave', discharged: 'Discharged', deceased: 'Deceased' },
  groupType: { monthly: 'Monthly cycle', acute: 'Acute' },
  groupState: { idle: 'Idle', preparing: 'Preparing', ready: 'Ready', in_transit: 'In transit', delivered: 'Delivered' },
  requestType: { regular: 'Regular', repeat: 'Repeat', acute: 'Acute', query: 'Query', change: 'Change' },
  requestStatus: {
    draft: 'Draft', submitted: 'Submitted', acknowledged: 'Acknowledged', approved: 'Approved', sent_to_gp: 'Sent to GP',
    outstanding: 'Outstanding', received: 'Received', part_received: 'Part received', refused: 'Refused by GP',
    ordered: 'Ordered', ready: 'Ready', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled',
  },
  scheduleType: { regular: 'Regular', repeat: 'Repeat', acute: 'Acute', prn: 'When required (PRN)' },
  marEntryStatus: {
    planned: 'Due', administered: 'Given', refused: 'Refused', omitted: 'Omitted', not_available: 'Not available',
    away: 'Away', self_administered: 'Self-administered',
  },
  noteType: { general: 'General', clinical: 'Clinical', hospital: 'Hospital', incident: 'Incident', medication: 'Medication', communication: 'Communication' },
}

export function chLabel(kind: keyof typeof LABELS, value: string | null | undefined): string {
  if (!value) return 'Not set'
  const known = LABELS[kind]?.[value]
  if (known) return known
  const text = value.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function ukDate(value: string | null | undefined): string {
  if (!value) return 'Not set'
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Today in the UK as yyyy-mm-dd. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
}

export function residentName(patient: CareHomePatient | null | undefined): string {
  return [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || 'Unnamed resident'
}

export const OPEN_REQUEST_STATUSES = ['draft', 'submitted', 'acknowledged', 'approved', 'sent_to_gp', 'outstanding', 'received', 'part_received', 'refused', 'ordered', 'ready']

/** The pharmacy's next step for a request, if any. */
export const NEXT_REQUEST_STEP: Record<string, { status: string; label: string }> = {
  submitted: { status: 'acknowledged', label: 'Acknowledge' },
  acknowledged: { status: 'approved', label: 'Approve' },
  approved: { status: 'ordered', label: 'Mark ordered' },
  ordered: { status: 'ready', label: 'Mark ready' },
  ready: { status: 'completed', label: 'Complete' },
}

export function careHomeErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : ''
  if (/permission|42501|row-level security/i.test(message)) return 'You don’t have permission to do that. Ask your manager.'
  if (/network|fetch/i.test(message)) return 'No connection. Check your signal and try again.'
  return message || 'Something went wrong. Please try again.'
}

// ---------- reads ----------

const linkSelect = `id, status, contact_name, contact_phone, default_cycle_length_days,
  pharmacy_organisation:ps_organisations!ps_care_home_links_pharmacy_organisation_id_fkey(id,name),
  care_home_organisation:ps_organisations!ps_care_home_links_care_home_organisation_id_fkey(id,name)`

export async function fetchLinks(organisationId: string, isCareHome: boolean): Promise<CareHomeLink[]> {
  const { data, error } = await userClient
    .from('ps_care_home_links')
    .select(linkSelect)
    .eq(isCareHome ? 'care_home_organisation_id' : 'pharmacy_organisation_id', organisationId)
    .neq('status', 'ended')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as CareHomeLink[]
}

export async function fetchResidents(linkId: string): Promise<CareHomeResident[]> {
  const { data, error } = await userClient
    .from('ps_care_home_residents')
    .select('*, patient:ps_patients(id, first_name, last_name, dob, nhs_number), group_memberships:ps_care_home_group_members(group_id)')
    .eq('care_home_link_id', linkId)
    .order('room_number')
  if (error) throw error
  return (data ?? []) as unknown as CareHomeResident[]
}

export async function fetchGroups(linkId: string): Promise<CareHomeGroup[]> {
  const { data, error } = await userClient
    .from('ps_care_home_units')
    .select('id, name, floor_name, group_type, group_state, cycle_day, state_changed_at')
    .eq('care_home_link_id', linkId)
    .eq('is_active', true)
    .order('sort_order')
    .order('name')
  if (error) throw error
  return (data ?? []) as CareHomeGroup[]
}

export async function fetchResidentDetail(residentId: string) {
  const [schedules, notes] = await Promise.all([
    userClient
      .from('ps_care_home_medication_schedules')
      .select('id, schedule_type, dose, route, instructions, round_time, lifecycle_status, patient_medication:ps_patient_medications(drug_name, drug_strength, drug_form)')
      .eq('care_home_resident_id', residentId)
      .eq('lifecycle_status', 'active')
      .order('round_time'),
    userClient
      .from('ps_care_home_resident_notes')
      .select('id, note_type, note_date, note_text, created_at')
      .eq('care_home_resident_id', residentId)
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  if (schedules.error) throw schedules.error
  if (notes.error) throw notes.error
  return {
    schedules: (schedules.data ?? []) as unknown as CareHomeSchedule[],
    notes: (notes.data ?? []) as CareHomeNote[],
  }
}

export async function fetchRequests(linkId: string): Promise<CareHomeRequest[]> {
  const { data, error } = await userClient
    .from('ps_care_home_medication_requests')
    .select('id, care_home_link_id, care_home_resident_id, request_type, medicine_name, quantity, needed_by, status, request_notes, requested_by, requested_at, resident:ps_care_home_residents(room_number, patient:ps_patients(id, first_name, last_name, dob, nhs_number))')
    .eq('care_home_link_id', linkId)
    .order('requested_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as unknown as CareHomeRequest[]
}

/** Doses due on a day across every published MAR chart in the care home. */
export async function fetchDosesForDay(linkId: string, day: string): Promise<MarDose[]> {
  const { data, error } = await userClient
    .from('ps_care_home_mar_entries')
    .select(`id, mar_cycle_id, administration_date, round_time, status, dose, notes, administered_at,
      medication_schedule:ps_care_home_medication_schedules(route, instructions, patient_medication:ps_patient_medications(drug_name)),
      cycle:ps_care_home_mar_cycles!inner(id, status, care_home_resident_id,
        resident:ps_care_home_residents!inner(id, room_number, care_home_link_id, patient:ps_patients(id, first_name, last_name, dob, nhs_number)))`)
    .eq('administration_date', day)
    .eq('cycle.status', 'published')
    .eq('cycle.resident.care_home_link_id', linkId)
    .order('round_time', { nullsFirst: false })
  if (error) throw error
  return (data ?? []) as unknown as MarDose[]
}

// ---------- writes ----------

export async function recordDose(entryId: string, status: string, userId: string, notes?: string) {
  const now = new Date().toISOString()
  const { error } = await userClient
    .from('ps_care_home_mar_entries')
    .update({ status, notes: notes?.trim() || null, administered_by: userId, administered_at: now, updated_at: now })
    .eq('id', entryId)
  if (error) throw error
}

export async function addResidentNote(residentId: string, noteType: string, noteText: string, userId: string) {
  const { error } = await userClient
    .from('ps_care_home_resident_notes')
    .insert({ care_home_resident_id: residentId, note_type: noteType, note_date: todayIso(), note_text: noteText.trim(), created_by: userId })
  if (error) throw error
}

export async function updateResidentStatus(residentId: string, status: string) {
  const { error } = await userClient
    .from('ps_care_home_residents')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', residentId)
  if (error) throw error
}

export async function createRequest(input: {
  linkId: string
  residentId: string
  requestType: string
  medicineName: string
  quantity?: number
  notes?: string
  userId: string
  fromCareHome: boolean
}) {
  const { error } = await userClient.from('ps_care_home_medication_requests').insert({
    care_home_link_id: input.linkId,
    care_home_resident_id: input.residentId,
    request_type: input.requestType,
    medicine_name: input.medicineName.trim(),
    quantity: input.quantity || null,
    request_notes: input.notes?.trim() || null,
    requested_by: input.userId,
    request_source: input.fromCareHome ? 'care_home' : 'pharmacy_manual',
  })
  if (error) throw error
}

export async function setRequestStatus(requestId: string, status: string, userId: string) {
  const now = new Date().toISOString()
  const updates: Record<string, string> = { status, reviewed_by: userId, reviewed_at: now, updated_at: now }
  if (status === 'completed') updates.completed_at = now
  const { error } = await userClient.from('ps_care_home_medication_requests').update(updates).eq('id', requestId)
  if (error) throw error
}
