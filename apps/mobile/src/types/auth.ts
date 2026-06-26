// ============================================
// Auth + permission types for PharmStation mobile.
//
// NOTE: This is a deliberately small, vendored mirror of the relevant parts
// of `@pharmstation/types` (web). The mobile app is an isolated install (it is
// excluded from the pnpm workspace) so we don't symlink the shared package
// here. Keep these definitions in sync with packages/types/src/index.ts.
// When mobile matures we can extract a platform-agnostic shared package.
// ============================================

export type UserRole =
  | 'owner'
  | 'manager'
  | 'pharmacist'
  | 'technician'
  | 'dispenser'
  | 'locum'

export type MemberStatus = 'active' | 'suspended' | 'revoked' | 'pending'

export interface OrganisationAddress {
  line_1?: string
  line_2?: string
  city?: string
  county?: string
  postcode?: string
  country?: string
}

export interface Organisation {
  id: string
  auth_user_id: string | null
  name: string
  gphc_premises_number: string | null
  address: OrganisationAddress
  subscription_tier: 'base' | 'professional' | 'enterprise'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  email: string | null
  gphc_number: string | null
  phone: string | null
  default_role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

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
  delivery_manage?: boolean
  delivery_drive?: boolean
  [key: string]: boolean | undefined
}

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
}

// --- Default role -> permission map (mirror of web) ---

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permissions> = {
  owner: {
    cd_register_read: true,
    cd_register_write: false,
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
    delivery_manage: true,
    delivery_drive: true,
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
    delivery_manage: true,
    delivery_drive: true,
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
    delivery_manage: true,
    delivery_drive: false,
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
    delivery_manage: false,
    delivery_drive: true,
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
    delivery_manage: false,
    delivery_drive: true,
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
    delivery_manage: false,
    delivery_drive: false,
  },
}

export function resolvePermissions(
  role: UserRole,
  overrides: Permissions = {},
): Permissions {
  return {
    ...DEFAULT_ROLE_PERMISSIONS[role],
    ...overrides,
  }
}
