// ============================================
// PharmStation Type Definitions
// ============================================

// --- Organisation ---

export interface Organisation {
  id: string
  auth_user_id: string | null
  name: string
  gphc_premises_number: string | null
  address: OrganisationAddress
  geo_radius_meters: number
  settings: Record<string, unknown>
  subscription_tier: 'base' | 'professional' | 'enterprise'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OrganisationAddress {
  line_1?: string
  line_2?: string
  city?: string
  county?: string
  postcode?: string
  country?: string
}

// --- User ---

export type UserRole = 'owner' | 'manager' | 'pharmacist' | 'technician' | 'dispenser' | 'locum'

export interface UserProfile {
  id: string
  full_name: string
  email: string | null
  gphc_number: string | null
  phone: string | null
  default_role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

// --- Organisation Members ---

export type MemberStatus = 'active' | 'suspended' | 'revoked' | 'pending'

export interface OrganisationMember {
  id: string
  organisation_id: string
  user_id: string
  role: UserRole
  permissions: Permissions
  status: MemberStatus
  is_locum: boolean
  approved_by: string | null
  approved_at: string | null
  created_at: string
  last_active_at: string | null
  // Joined
  user_profile?: UserProfile
}

// --- Permissions ---

export interface Permissions {
  cd_register_read?: boolean
  cd_register_write?: boolean
  cd_register_correct?: boolean
  rp_log_sign?: boolean
  rp_log_view?: boolean
  patient_returns_write?: boolean
  sop_upload?: boolean
  handover_all?: boolean
  manage_users?: boolean
  approve_locums?: boolean
  view_audit?: boolean
  ai_scan_use?: boolean
  org_settings?: boolean
  billing?: boolean
  [key: string]: boolean | undefined
}

// --- Register Types ---

export type RegisterType = 'CD' | 'RP' | 'RETURNS' | 'PRIVATE_CD' | 'POM'
export type EntryType = 'normal' | 'correction'
export type EntrySource = 'manual' | 'ai_scan'

export type TransactionType =
  | 'receipt'
  | 'supply'
  | 'return_to_supplier'
  | 'patient_return'
  | 'disposal'
  | 'correction'
  | 'transfer_in'
  | 'transfer_out'

// --- Register Ledger ---

export interface RegisterLedger {
  id: string
  organisation_id: string
  register_type: RegisterType
  drug_id: string | null
  drug_name: string | null
  drug_form: string | null
  drug_strength: string | null
  drug_class: string | null
  current_balance: number
  entry_count: number
  lock_version: number
  is_active: boolean
  created_at: string
  created_by: string | null
}

// --- Register Entry ---

export interface RegisterEntry {
  id: string
  ledger_id: string
  organisation_id: string
  entry_number: number
  register_type: RegisterType
  entry_type: EntryType
  date_of_transaction: string
  notes: string | null
  source: EntrySource
  corrects_entry_id: string | null
  correction_reason: string | null
  scan_image_path: string | null
  entered_by: string
  session_id: string | null
  entered_at: string
  previous_entry_id: string | null
  ledger_lock_version: number
  // CD fields
  quantity_received: number | null
  quantity_deducted: number | null
  running_balance: number | null
  previous_balance: number | null
  transaction_type: TransactionType | null
  supplier_name: string | null
  invoice_number: string | null
  patient_name: string | null
  patient_address: string | null
  prescriber_name: string | null
  prescriber_address: string | null
  prescription_date: string | null
  prescription_image_path: string | null
  witness_name: string | null
  witness_role: string | null
  authorised_by: string | null
  // RP fields
  pharmacist_name: string | null
  gphc_number: string | null
  rp_signed_in_at: string | null
  rp_signed_out_at: string | null
  // Returns fields
  return_patient_name: string | null
  return_drug_name: string | null
  return_drug_form: string | null
  return_drug_strength: string | null
  return_quantity: number | null
  return_reason: string | null
  return_received_by: string | null
  disposal_date: string | null
  disposal_witness: string | null
  disposal_method: string | null
  // Joined
  annotations?: EntryAnnotation[]
  entered_by_profile?: UserProfile
}

// --- Entry Annotation ---

export interface EntryAnnotation {
  id: string
  entry_id: string
  organisation_id: string
  annotation_text: string
  annotation_type: 'note' | 'flag' | 'query' | 'resolution'
  created_by: string
  created_at: string
  created_by_profile?: UserProfile
}

// --- Known Contacts ---

export type ContactType = 'patient' | 'prescriber'

export interface KnownContact {
  id: string
  organisation_id: string
  contact_type: ContactType
  full_name: string
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  postcode: string | null
  gmc_number: string | null
  gphc_number: string | null
  prescriber_type: string | null
  nhs_number: string | null
  date_of_birth: string | null
  usage_count: number
  last_used_at: string
  created_at: string
}

// --- Active Session ---

export interface ActiveSession {
  id: string
  organisation_id: string
  user_id: string
  terminal_id: string
  terminal_name: string | null
  platform: 'web' | 'desktop' | 'mobile'
  started_at: string
  last_activity_at: string
  ended_at: string | null
  is_active: boolean
  geo_verified: boolean
  twofa_verified: boolean
}

// --- CD Drug (from existing cdr_drugs_unique table) ---

export interface CDDrug {
  id: string
  drug_brand: string
  drug_type: string
  drug_form: string
  drug_strength: string
  drug_class: string
  units: string | null
  is_generic: boolean
  box_image: string | null
  pill_image: string | null
  created_at: string
}

// --- Audit Log ---

export interface AuditLogEntry {
  id: string
  organisation_id: string
  table_name: string
  record_id: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  performed_by: string | null
  session_id: string | null
  performed_at: string
  ip_address: string | null
}

// --- Default Role Permissions ---

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permissions> = {
  owner: {
    cd_register_read: true,
    cd_register_write: false, // Owner defaults to read-only on CD, can self-enable
    cd_register_correct: false,
    rp_log_sign: true,
    rp_log_view: true,
    patient_returns_write: false,
    sop_upload: true,
    handover_all: true,
    manage_users: true,
    approve_locums: true,
    view_audit: true,
    ai_scan_use: true,
    org_settings: true,
    billing: true,
  },
  manager: {
    cd_register_read: true,
    cd_register_write: false,
    cd_register_correct: false,
    rp_log_sign: false,
    rp_log_view: true,
    patient_returns_write: false,
    sop_upload: true,
    handover_all: true,
    manage_users: true,
    approve_locums: true,
    view_audit: true,
    ai_scan_use: true,
    org_settings: false,
    billing: false,
  },
  pharmacist: {
    cd_register_read: true,
    cd_register_write: true,
    cd_register_correct: true,
    rp_log_sign: true,
    rp_log_view: true,
    patient_returns_write: true,
    sop_upload: false,
    handover_all: true,
    manage_users: false,
    approve_locums: false,
    view_audit: false,
    ai_scan_use: true,
    org_settings: false,
    billing: false,
  },
  technician: {
    cd_register_read: true,
    cd_register_write: true,
    cd_register_correct: false,
    rp_log_sign: false,
    rp_log_view: true,
    patient_returns_write: true,
    sop_upload: false,
    handover_all: true,
    manage_users: false,
    approve_locums: false,
    view_audit: false,
    ai_scan_use: true,
    org_settings: false,
    billing: false,
  },
  dispenser: {
    cd_register_read: false,
    cd_register_write: false,
    cd_register_correct: false,
    rp_log_sign: false,
    rp_log_view: true,
    patient_returns_write: false,
    sop_upload: false,
    handover_all: true,
    manage_users: false,
    approve_locums: false,
    view_audit: false,
    ai_scan_use: false,
    org_settings: false,
    billing: false,
  },
  locum: {
    cd_register_read: true,
    cd_register_write: true,
    cd_register_correct: true,
    rp_log_sign: true,
    rp_log_view: true,
    patient_returns_write: true,
    sop_upload: false,
    handover_all: true,
    manage_users: false,
    approve_locums: false,
    view_audit: false,
    ai_scan_use: true,
    org_settings: false,
    billing: false,
  },
}

// --- Utility: resolve permissions with overrides ---

export function resolvePermissions(role: UserRole, overrides: Permissions = {}): Permissions {
  return {
    ...DEFAULT_ROLE_PERMISSIONS[role],
    ...overrides,
  }
}
