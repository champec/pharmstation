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
  // dm+d controlled drug category code ('0000' = not a CD); null for free text
  cd_category?: string | null
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
  expires_at: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancel_reason: string | null
  // Tamper evidence: sha256 of the signed content, and when the prescriber signed with their PIN
  content_hash?: string | null
  signed_at?: string | null
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
  | 'claimed'
  | 'released'
  | 'transferred'
  | 'dispensed'
  | 'cancelled'
  | 'printed'
  | 'cd_evidence_attached'

// Events the app may record through ps_peps_log_event (all others are written by the server)
export type PepsLoggableEventType = 'printed' | 'cd_evidence_attached'

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
  cd_category?: string | null
}

export type PepsCdSchedule = 'none' | 'sch1' | 'sch2' | 'sch3' | 'sch4' | 'sch5'

// Map a dm+d controlled drug category code to a schedule
export function pepsCdSchedule(cat: string | null | undefined): PepsCdSchedule {
  switch (cat) {
    case '0001':
      return 'sch1'
    case '0002':
    case '0003':
      return 'sch2'
    case '0004':
    case '0005':
    case '0006':
    case '0007':
      return 'sch3'
    case '0008':
    case '0009':
      return 'sch4'
    case '0010':
      return 'sch5'
    default:
      return 'none'
  }
}

export const PEPS_CD_LABELS: Record<PepsCdSchedule, string> = {
  none: '',
  sch1: 'CD Schedule 1',
  sch2: 'CD Schedule 2',
  sch3: 'CD Schedule 3',
  sch4: 'CD Schedule 4',
  sch5: 'CD Schedule 5',
}

// Schedules that cannot be prescribed through PEPS (paper FP10PCD only)
export function pepsCdBlocked(cat: string | null | undefined): boolean {
  const s = pepsCdSchedule(cat)
  return s === 'sch1' || s === 'sch2' || s === 'sch3'
}

export interface PepsVerifyResult {
  status: 'verified' | 'altered' | 'unsigned'
  signed_at?: string | null
  prescriber_status?: PepsPrescriberStatus | null
}

// Where to check a prescriber's registration
export const PEPS_REGISTER_LINKS: Record<PepsPrescriberType, { body: string; url: string } | null> = {
  doctor: { body: 'GMC', url: 'https://www.gmc-uk.org/registration-and-licensing/the-medical-register' },
  dentist: { body: 'GDC', url: 'https://olr.gdc-uk.org/searchregister' },
  pharmacist_ip: { body: 'GPhC', url: 'https://www.pharmacyregulation.org/registers' },
  nurse_ip: { body: 'NMC', url: 'https://www.nmc.org.uk/registration/search-the-register/' },
  optometrist_ip: { body: 'GOC', url: 'https://str.optical.org/' },
  physiotherapist_ip: { body: 'HCPC', url: 'https://www.hcpc-uk.org/check-the-register/' },
  paramedic_ip: { body: 'HCPC', url: 'https://www.hcpc-uk.org/check-the-register/' },
  veterinarian: { body: 'RCVS', url: 'https://findavet.rcvs.org.uk/find-a-vet-surgeon/' },
  other: null,
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

// UK date formats for prescriptions, whatever the browser locale.
// Date-only values (YYYY-MM-DD) are formatted without a time zone shift.
const PEPS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function pepsDate(value: string | null | undefined): string {
  if (!value) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (m) return `${Number(m[3])} ${PEPS_MONTHS[Number(m[2]) - 1]} ${m[1]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })
}

export function pepsDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London',
  })
}

// dm+d search often returns many AMPs with the same name (one per supplier).
// Keep one row per name, preferring the VMP.
export function pepsDedupeDmd<T extends { name: string; dmd_type: string }>(rows: T[]): T[] {
  const byName = new Map<string, T>()
  for (const r of rows) {
    const key = r.name.trim().toLowerCase()
    const seen = byName.get(key)
    if (!seen || (seen.dmd_type !== 'vmp' && r.dmd_type === 'vmp')) byName.set(key, r)
  }
  return rows.filter((r) => byName.get(r.name.trim().toLowerCase()) === r)
}
