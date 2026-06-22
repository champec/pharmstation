// ============================================
// PEPS — Private Electronic Prescription Service
// ============================================

export type PepsPrescriberType =
  | 'doctor'
  | 'dentist'
  | 'pharmacist_ip'
  | 'nurse_ip'
  | 'optometrist_ip'
  | 'physiotherapist_ip'
  | 'paramedic_ip'
  | 'veterinarian'
  | 'other'

export type PepsPrescriberStatus = 'pending' | 'active' | 'suspended' | 'revoked'

export interface PepsPrescriber {
  id: string
  user_id: string
  full_name: string
  prescriber_type: PepsPrescriberType
  registration_number: string
  registration_body: string | null
  email: string | null
  phone: string | null
  address: string | null
  signature_data: string | null
  status: PepsPrescriberStatus
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface PepsOrg {
  id: string
  name: string
  ods_code: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  postcode: string | null
  phone: string | null
  email: string | null
  is_global: boolean
  created_by_org_id: string | null
  created_at: string
  updated_at: string
}

export type PepsPrescriptionType = 'private' | 'vet'
export type PepsPrescriptionStatus = 'available' | 'held' | 'dispensed' | 'cancelled'

export type PepsItemDmdType = 'vmp' | 'amp' | 'free_text'

export interface PepsPrescriptionItem {
  id: string
  prescription_id: string
  line_order: number
  dmd_code: string | null
  dmd_type: PepsItemDmdType | null
  drug_name: string
  strength: string | null
  form: string | null
  quantity: string
  dosage: string | null
  notes: string | null
  created_at: string
}

// Immutable legal snapshots stored on the prescription
export interface PepsPrescriberSnapshot {
  full_name?: string
  prescriber_type?: string
  registration_number?: string
  registration_body?: string | null
  address?: string | null
}

export interface PepsPatientSnapshot {
  full_name?: string
  first_name?: string
  last_name?: string
  dob?: string | null
  nhs_number?: string | null
  address?: string | null
}

export interface PepsOrgSnapshot {
  name?: string
  ods_code?: string | null
  address?: string | null
}

export interface PepsPrescription {
  id: string
  prescription_ref: string
  prescriber_id: string
  prescriber_snapshot: PepsPrescriberSnapshot
  written_by: string
  origin_org_id: string | null
  patient_id: string | null
  patient_snapshot: PepsPatientSnapshot
  prescribing_org_id: string | null
  prescribing_org_snapshot: PepsOrgSnapshot
  prescription_type: PepsPrescriptionType
  animal_name: string | null
  animal_owner: string | null
  cascade_wording: string | null
  repeats: number
  repeats_dispensed: number
  prescription_date: string
  signature_data: string | null
  status: PepsPrescriptionStatus
  assigned_org_id: string | null
  downloaded_at: string | null
  dispensed_at: string | null
  dispensed_by: string | null
  unique_code: string | null
  created_at: string
  updated_at: string
  // Joined
  items?: PepsPrescriptionItem[]
  assigned_org?: { id: string; name: string } | null
}

export type PepsEventType =
  | 'created'
  | 'sent_to_spine'
  | 'directed'
  | 'downloaded'
  | 'released'
  | 'transferred'
  | 'dispensed'
  | 'cancelled'

export interface PepsEvent {
  id: string
  prescription_id: string
  event_type: PepsEventType
  from_org_id: string | null
  to_org_id: string | null
  actor_user_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// Result of the spine "where is it" lookup (no clinical contents)
export interface PepsSpineResult {
  id: string
  prescription_ref: string
  patient_name: string | null
  prescription_date: string
  status: PepsPrescriptionStatus
  location: string
  is_open: boolean
}

// dm+d drug search result for the prescription writer
export interface PepsDmdResult {
  code: string
  dmd_type: 'vmp' | 'amp'
  name: string
}

export const PEPS_PRESCRIBER_TYPE_LABELS: Record<PepsPrescriberType, string> = {
  doctor: 'Doctor (GMC)',
  dentist: 'Dentist (GDC)',
  pharmacist_ip: 'Pharmacist Independent Prescriber (GPhC)',
  nurse_ip: 'Nurse Independent Prescriber (NMC)',
  optometrist_ip: 'Optometrist Independent Prescriber (GOC)',
  physiotherapist_ip: 'Physiotherapist Independent Prescriber (HCPC)',
  paramedic_ip: 'Paramedic Independent Prescriber (HCPC)',
  veterinarian: 'Veterinarian (RCVS)',
  other: 'Other',
}
