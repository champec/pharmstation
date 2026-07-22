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
  /** Which provider delivers this org's SMS ('smsworks' for everyone; 'nhs_notify' only for NHS-affiliated orgs). */
  messaging_provider?: 'smsworks' | 'nhs_notify'
  /** True only for NHS-affiliated orgs (NHS-funded, hospital, military, prison) — unlocks NHS Notify email/letter channels. */
  nhs_channels_enabled?: boolean
  organisation_type?: 'pharmacy' | 'carehome'
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

export type UserRole = 'owner' | 'manager' | 'pharmacist' | 'technician' | 'dispenser' | 'locum' | 'carehome_user'

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
  delivery_manage?: boolean
  delivery_drive?: boolean
  care_home_view?: boolean
  care_home_manage?: boolean
  care_home_medications?: boolean
  care_home_requests?: boolean
  care_home_mar_prepare?: boolean
  care_home_mar_administer?: boolean
  [key: string]: boolean | undefined
}

// --- Register Types ---

export type RegisterType = 'CD' | 'RP' | 'RETURNS' | 'PRIVATE_CD' | 'POM'
export type EntryType = 'normal' | 'correction' | 'balance_check'
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
  | 'balance_check'

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
  prescriber_registration: string | null
  prescription_date: string | null
  prescription_image_path: string | null
  witness_name: string | null
  witness_role: string | null
  authorised_by: string | null
  was_id_requested: boolean
  was_id_provided: boolean
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
  return_person_role: string | null
  return_received_by: string | null
  return_received_signature: string | null
  return_parent_entry_id: string | null
  disposal_date: string | null
  disposal_witness: string | null
  disposal_method: string | null
  disposal_pharmacist_signature: string | null
  witness_signature: string | null
  // Joined
  annotations?: EntryAnnotation[]
  entered_by_profile?: UserProfile
}

// --- Entry Annotation ---
// Append-only notes attached underneath a register entry (entries themselves
// are legally immutable). 'part_supply' flags an entry as a part supply;
// 'part_supply_closed' closes it (balance supplied later, or Rx expired etc.)

export type EntryAnnotationType =
  | 'note'
  | 'flag'
  | 'query'
  | 'resolution'
  | 'part_supply'
  | 'part_supply_closed'

export interface EntryAnnotation {
  id: string
  entry_id: string
  organisation_id: string
  annotation_text: string
  annotation_type: EntryAnnotationType
  created_by: string
  created_at: string
  created_by_profile?: UserProfile
}

// --- Subscribed Registers (pharmacies subscribe to specific drug registers) ---

export interface SubscribedRegister {
  id: string
  organisation_id: string
  drug_id: string
  drug_brand: string
  drug_form: string
  drug_strength: string
  drug_class: string
  drug_type: string
  created_at: string
  created_by: string | null
}

// --- Balance Check Types ---

export type BalanceCheckStatus = 'pending' | 'matched' | 'discrepancy' | 'adjusted' | 'pending_reconciliation'
export type BalanceCheckSessionStatus = 'in_progress' | 'completed' | 'cancelled'

export interface BalanceCheckSession {
  id: string
  organisation_id: string
  started_at: string
  completed_at: string | null
  status: BalanceCheckSessionStatus
  started_by: string
  completed_by: string | null
  notes: string | null
  total_registers: number
  checked_count: number
  discrepancy_count: number
  created_at: string
  // Joined
  started_by_profile?: UserProfile
  completed_by_profile?: UserProfile
}

export interface BalanceCheckItem {
  id: string
  session_id: string
  organisation_id: string
  drug_id: string
  ledger_id: string
  drug_brand: string
  drug_form: string
  drug_strength: string
  drug_class: string
  expected_balance: number
  actual_count: number | null
  status: BalanceCheckStatus
  adjustment_amount: number | null
  adjustment_reason: string | null
  notes: string | null
  checked_by: string | null
  checked_at: string | null
  register_entry_id: string | null
  created_at: string
  // Joined
  checked_by_profile?: UserProfile
}

// --- Known Contacts ---

export type ContactType = 'patient' | 'prescriber' | 'supplier'

export interface KnownContact {
  id: string
  organisation_id: string
  contact_type: ContactType
  full_name: string
  first_name: string | null
  last_name: string | null
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
    delivery_manage: true,
    delivery_drive: true,
    care_home_view: true,
    care_home_manage: true,
    care_home_medications: true,
    care_home_requests: true,
    care_home_mar_prepare: true,
    care_home_mar_administer: true,
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
    care_home_view: true,
    care_home_manage: true,
    care_home_medications: true,
    care_home_requests: true,
    care_home_mar_prepare: true,
    care_home_mar_administer: true,
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
    care_home_view: true,
    care_home_manage: true,
    care_home_medications: true,
    care_home_requests: true,
    care_home_mar_prepare: true,
    care_home_mar_administer: true,
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
    care_home_view: true,
    care_home_manage: false,
    care_home_medications: true,
    care_home_requests: true,
    care_home_mar_prepare: true,
    care_home_mar_administer: false,
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
    care_home_view: true,
    care_home_manage: false,
    care_home_medications: false,
    care_home_requests: true,
    care_home_mar_prepare: false,
    care_home_mar_administer: false,
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
    care_home_view: true,
    care_home_manage: false,
    care_home_medications: true,
    care_home_requests: true,
    care_home_mar_prepare: true,
    care_home_mar_administer: false,
  },
  carehome_user: {
    cd_register_read: false,
    cd_register_write: false,
    cd_register_correct: false,
    rp_log_sign: false,
    rp_log_view: false,
    patient_returns_write: false,
    sop_upload: false,
    handover_all: false,
    manage_users: false,
    approve_locums: false,
    view_audit: false,
    ai_scan_use: false,
    org_settings: false,
    billing: false,
    delivery_manage: false,
    delivery_drive: false,
    care_home_view: true,
    care_home_manage: false,
    care_home_medications: false,
    care_home_requests: true,
    care_home_mar_prepare: false,
    care_home_mar_administer: true,
  },
}

// --- Utility: resolve permissions with overrides ---

export function resolvePermissions(role: UserRole, overrides: Permissions = {}): Permissions {
  return {
    ...DEFAULT_ROLE_PERMISSIONS[role],
    ...overrides,
  }
}

// ============================================
// AI Models & Chat
// ============================================

// --- AI Provider ---

export type AIProvider = 'openrouter'

export type AIModelType = 'standard' | 'cheap' | 'ultra_cheap' | 'image_gen' | 'realtime'

export type AICapability = 'text' | 'image_input' | 'image_gen' | 'function_calling' | 'streaming' | 'audio'

export interface AIModel {
  id: string
  provider: AIProvider
  model_id: string
  display_name: string
  model_type: AIModelType
  capabilities: AICapability[]
  context_window: number | null
  max_output_tokens: number | null
  input_cost_per_1k: number | null
  output_cost_per_1k: number | null
  is_active: boolean
  is_default: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// --- AI Org Settings ---

export interface AIOrgSettings {
  id: string
  organisation_id: string
  standard_model_id: string | null
  cheap_model_id: string | null
  ultra_cheap_model_id: string | null
  image_gen_model_id: string | null
  scan_model_id: string | null
  monthly_token_limit: number | null
  tokens_used_this_month: number
  enable_ai_features: boolean
  created_at: string
  updated_at: string
}

// --- Chat ---

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error'

export interface ChatAttachment {
  type: 'image' | 'pdf' | 'file'
  url: string
  name: string
  size?: number
  mime_type?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: string // JSON string
}

export interface ChatConversation {
  id: string
  organisation_id: string
  user_id: string
  title: string
  model_id: string | null
  is_archived: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  conversation_id: string
  role: ChatRole
  content: string | null
  tool_calls: ToolCall[] | null
  tool_call_id: string | null
  tool_name: string | null
  attachments: ChatAttachment[]
  input_tokens: number | null
  output_tokens: number | null
  model_provider: string | null
  model_id_str: string | null
  status: MessageStatus
  error_message: string | null
  created_at: string
}

// --- Chat API Request/Response ---

export interface ChatRequest {
  conversation_id?: string          // existing conversation, or omit to create new
  organisation_id: string
  message: string
  attachments?: ChatAttachment[]
  model_id?: string                 // override model for this request (ps_ai_models UUID)
  model_type?: AIModelType          // or specify by type, resolved server-side
}

export interface ChatStreamEvent {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'tool_result' | 'done' | 'error' | 'conversation_created' | 'message_saved'
  // text_delta
  content?: string
  // tool_call
  tool_call_id?: string
  tool_name?: string
  tool_arguments?: string
  tool_result?: string
  // conversation_created
  conversation_id?: string
  // message_saved
  message_id?: string
  // done
  input_tokens?: number
  output_tokens?: number
  // error
  error?: string
}

// ============================================
// AI Scan — Image Capture & Processing
// ============================================

// --- Document Type ---

export type ScanDocumentType = 'prescription' | 'invoice' | 'unknown'
export type ScanConfidence = 0 | 1 | 2 | 3

export type ScanQueueStatus = 'uploading' | 'processing' | 'ready' | 'partially_approved' | 'fully_approved' | 'rejected' | 'error'
export type ScanItemStatus = 'pending' | 'approved' | 'edited' | 'rejected'

// --- Augmentation Notes (global & org-level AI context) ---

export type AugmentationScope = 'global' | 'organisation'
export type AugmentationCategory =
  | 'invoice_quirks'
  | 'prescription_notes'
  | 'supplier_patterns'
  | 'pharmacy_conventions'
  | 'general'

export interface AugmentationNote {
  id: string
  organisation_id: string | null  // NULL = global
  scope: AugmentationScope
  category: AugmentationCategory
  title: string
  content: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// --- AI Scan Queue ---

export interface ScanQueueItem {
  id: string
  organisation_id: string
  uploaded_by: string
  image_path: string
  image_url: string | null
  document_type: ScanDocumentType | null
  overall_confidence: ScanConfidence | null
  status: ScanQueueStatus
  raw_ai_response: Record<string, unknown> | null
  ai_notes: string | null
  model_used: string | null
  error_message: string | null
  // Invoice fields
  supplier_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  // Prescription fields
  patient_name: string | null
  patient_address: string | null
  prescriber_name: string | null
  prescriber_address: string | null
  prescriber_registration: string | null
  is_partial_supply: boolean
  handwritten_notes: string | null
  // Timestamps
  created_at: string
  processed_at: string | null
  approved_at: string | null
  approved_by: string | null
  // Joined
  items?: ScanDrugItem[]
  uploaded_by_profile?: UserProfile
  approved_by_profile?: UserProfile
}

// --- AI Scan Drug Items (individual drugs extracted from a scan) ---

export interface ScanDrugItem {
  id: string
  scan_id: string
  organisation_id: string
  // AI-extracted fields (raw from AI)
  drug_name_raw: string | null
  drug_class_raw: string | null
  drug_form_raw: string | null
  drug_strength_raw: string | null
  quantity: number | null
  // Reconciled against our drug database
  matched_drug_id: string | null
  matched_drug_brand: string | null
  matched_drug_form: string | null
  matched_drug_strength: string | null
  matched_drug_class: string | null
  // Confidence
  confidence: ScanConfidence | null
  confidence_notes: string | null
  // Status
  status: ScanItemStatus
  // User edits (if any)
  edited_drug_id: string | null
  edited_quantity: number | null
  // After approval — linked to actual register entry
  entry_id: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  // Joined
  matched_drug?: CDDrug
  entry?: RegisterEntry
}

// --- AI Scan Request/Response ---

export interface ScanRequest {
  organisation_id: string
  image_base64: string
  mime_type: string
  filename?: string
}

export interface ScanAIResponse {
  document_type: ScanDocumentType
  overall_confidence: ScanConfidence
  notes: string
  // Invoice fields
  supplier?: {
    name: string
    invoice_number: string
    date: string
  }
  // Prescription fields
  patient?: {
    name: string
    address: string
  }
  prescriber?: {
    name: string
    address: string
    registration: string
  }
  is_partial_supply?: boolean
  handwritten_notes?: string
  // Drugs
  drugs: ScanAIDrugResult[]
}

export interface ScanAIDrugResult {
  drug_name: string
  drug_class: string
  drug_form: string
  drug_strength: string
  quantity: number
  confidence: ScanConfidence
  confidence_notes: string
}

// ============================================
// Expansion Types — Patients
// ============================================

export interface Patient {
  id: string
  auth_user_id: string | null
  organisation_id: string
  first_name: string
  last_name: string
  dob: string | null
  nhs_number: string | null
  email: string | null
  phone: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  postcode: string | null
  created_at: string
  updated_at: string
}

export interface PatientAuthState {
  patient: Patient | null
  loading: boolean
  isLoggedIn: boolean
}

// ============================================
// Expansion Types — Services & Service Forms
// ============================================

export interface ServiceLibraryItem {
  id: string
  name: string
  description: string
  category: string
  is_active: boolean
  is_nhs_service: boolean
  nhs_service_type: string | null
  created_at: string
}

export interface Service {
  id: string
  org_id: string
  library_service_id: string | null
  name: string
  description: string
  is_active: boolean
  is_public: boolean
  is_nhs_service: boolean
  duration_minutes: number
  created_at: string
  /** Stripe payments: whether patients are charged for this service */
  is_chargeable?: boolean
  /** Price in pence (server-side source of truth for checkout) */
  price_pence?: number | null
  /** ISO currency code, defaults to gbp */
  currency?: string
}

// ============ Payments (Stripe) ============

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'canceled'

export type PaymentKind =
  | 'service'
  | 'delivery'
  | 'subscription'
  | 'credits'
  | 'locum'
  | 'platform_fee'
  | 'other'

export interface PsPayment {
  id: string
  org_id: string
  patient_id: string | null
  service_id: string | null
  appointment_id: string | null
  kind: PaymentKind
  description: string | null
  amount_pence: number
  currency: string
  status: PaymentStatus
  refunded_pence: number
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  payer_email: string | null
  metadata: Record<string, unknown>
  paid_at: string | null
  created_at: string
  updated_at: string
}

export interface ServiceForm {
  id: string
  service_id: string | null
  org_service_id: string | null
  name: string
  is_default: boolean
  version: number
  created_at: string
  fields?: ServiceFormField[]
}

export type FieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'textarea'
  | 'signature'
  | 'canvas'
  | 'heading'
  | 'info'
  | 'table'
  | 'prescribing'

export interface ServicePgdRegimen {
  id: string
  label: string
  drug_name: string
  dmd_code?: string | null
  dmd_type?: 'vmp' | 'amp' | null
  dose: string
  frequency: string
  duration: string
  quantity: number | null
  unit: string
  pack_query?: string
}

export interface ServicePrescriptionOrder {
  dmd_code: string | null
  dmd_type: 'vmp' | 'amp' | 'free_text'
  manual_entry: boolean
  drug_name: string
  dose: string
  frequency: string
  duration: string
  quantity: number | null
  unit: string
}

export interface ServiceSuppliedPack {
  appid: string
  pack_name: string
  apid: string | null
  vppid: string | null
  pack_quantity: number | null
  quantity_uom_code: string | null
  packs_supplied: number
  prescription_charge_code: string | null
  dispensing_fee_code: string | null
  reimbursement_info: string | null
}

export interface ServicePrescriptionValue {
  prescribing_basis: 'pgd' | 'independent_prescriber' | 'custom'
  pgd_regimen_id: string | null
  clinical_order: ServicePrescriptionOrder
  supplied_pack: ServiceSuppliedPack | null
}

export type ServicePrescribingValue = ServicePrescriptionValue[]

export interface ServiceFormField {
  id: string
  form_id: string
  label: string
  field_key: string
  field_type: FieldType
  options: string[] | Record<string, unknown> | null
  is_required: boolean
  display_order: number
}

// ============================================
// Expansion Types — Service Deliveries
// ============================================

export interface ServiceDelivery {
  id: string
  org_id: string
  service_id: string
  patient_id: string | null
  form_id: string | null
  form_data: Record<string, unknown>
  delivered_by: string | null
  notes: string
  status: 'draft' | 'completed'
  created_at: string
  completed_at: string | null
}

// ============================================
// Expansion Types — Appointments
// ============================================

export interface AppointmentSlot {
  id: string
  org_id: string
  service_id: string
  start_time: string
  end_time: string
  max_bookings: number
  booked_count: number
  is_recurring: boolean
  recurrence_rule: string | null
  is_active: boolean
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'

export interface Appointment {
  id: string
  slot_id: string | null
  org_id: string
  service_id: string | null
  patient_id: string
  form_id: string | null
  form_data: Record<string, unknown>
  status: AppointmentStatus
  notes: string | null
  booked_by_user_id: string | null
  created_at: string
  updated_at: string
  // Joined
  patient?: Patient
  service?: Service | null
  slot?: AppointmentSlot | null
  form?: ServiceForm | null
}

// ============================================
// Expansion Types — Logs
// ============================================

export type LogCategory = 'cleaning' | 'fridge' | 'cd' | 'visitor' | 'date_check' | 'custom'
export type LogScheduleType = 'daily' | 'custom_days' | 'sporadic'

export interface LogTemplate {
  id: string
  org_id: string | null
  title: string
  description: string
  category: LogCategory
  schedule_type: LogScheduleType
  required_days: number[]
  is_library: boolean
  version: number
  created_at: string
  fields?: LogField[]
}

export interface LogField {
  id: string
  template_id: string
  label: string
  field_key: string
  field_type: FieldType
  options: Record<string, unknown> | null
  is_required: boolean
  display_order: number
  column_width: string | null
}

export interface LogSubscription {
  id: string
  org_id: string
  template_id: string
  custom_title: string | null
  custom_fields: Record<string, unknown> | null
  is_active: boolean
  subscribed_at: string
  template?: LogTemplate
}

export interface LogEntry {
  id: string
  subscription_id: string
  org_id: string
  entry_date: string
  data: Record<string, unknown>
  entered_by_user_id: string
  created_at: string
  entered_by_profile?: UserProfile
}

// ============================================
// Expansion Types — Video Consultations
// ============================================

export type VideoConsultationStatus = 'scheduled' | 'active' | 'completed' | 'cancelled'

export interface VideoConsultation {
  id: string
  org_id: string
  patient_id: string | null
  patient_name: string
  patient_phone: string | null
  daily_room_name: string
  daily_room_url: string
  org_token: string
  patient_token: string
  patient_access_code: string
  status: VideoConsultationStatus
  appointment_id: string | null
  scheduled_for: string
  started_at: string | null
  ended_at: string | null
  created_at: string
  // Joined
  patient?: Patient
  appointment?: Appointment
}

// ============================================
// Expansion Types — Messaging (NHS Notify)
// ============================================

export type MessageChannel = 'sms' | 'letter' | 'email'
/** Which provider actually delivers a pharmacy's SMS. */
export type MessagingProvider = 'smsworks' | 'nhs_notify'
export type NotifyMessageStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'permanent-failure'
  | 'temporary-failure'
  | 'technical-failure'
export type BroadcastStatus = 'draft' | 'sending' | 'sent' | 'failed' | 'cancelled'

export interface NotifySettings {
  id: string
  org_id: string
  api_key: string
  sms_template_ids: Record<string, string>
  letter_template_ids: Record<string, string>
  is_active: boolean
  created_at: string
}

export interface NotifyMessage {
  id: string
  org_id: string
  patient_id: string | null
  recipient_phone: string | null
  recipient_email: string | null
  recipient_address: Record<string, string> | null
  channel: MessageChannel
  /** References a ps_sms_templates row when the message was rendered from a pharmacy template. */
  template_id: string | null
  personalisation: Record<string, unknown>
  body: string | null
  subject: string | null
  status: NotifyMessageStatus
  notify_message_id: string | null
  sent_at: string | null
  created_by_user_id: string
  created_at: string
  // Delivery lifecycle (set by webhooks / check_status)
  delivered_at?: string | null
  failed_at?: string | null
  completed_at?: string | null
  failure_reason?: string | null
  cost_in_pounds?: number | null
  updated_at?: string | null
  // What triggered the send: 'manual' | 'broadcast' | 'appointment' | 'video' | 'reminder' | 'urgent' | …
  feature?: string | null
  reference?: string | null
  broadcast_id?: string | null
  // Provider + SMS Works billing fields
  provider?: MessagingProvider
  credits?: number | null
  segments?: number | null
  sms_sender?: string | null
  reply_number?: string | null
  // Joined
  patient?: Patient
}

export interface Broadcast {
  id: string
  org_id: string
  name: string
  channel: MessageChannel
  template_id: string | null
  body: string | null
  subject: string | null
  personalisation_template: Record<string, unknown>
  recipient_filter: Record<string, unknown> | string
  status: BroadcastStatus
  total_count: number
  sent_count: number
  recipient_count: number | null
  failed_count: number | null
  created_at: string
  created_by_user_id: string
}

// ============================================
// Expansion Types — SMS Works (platform SMS provider)
// ============================================

/** 'alpha' = one-way branded sender (3–11 chars); 'number' = two-way reply number. */
export type SmsSenderType = 'alpha' | 'number'
export type SmsReplyNumberStatus = 'available' | 'assigned' | 'suspended' | 'released'

/** Per-pharmacy SMS Works configuration (ps_sms_settings). */
export interface SmsSettings {
  id: string
  org_id: string
  sender_type: SmsSenderType
  /** Alphanumeric sender ID (e.g. the pharmacy name) when sender_type='alpha'. */
  sender_id: string | null
  reply_enabled: boolean
  /** The virtual number assigned from the platform pool when reply_enabled. */
  reply_number: string | null
  /** Optional email to forward inbound replies to. */
  reply_forward_email: string | null
  /** Appended to every outbound SMS, e.g. "— Hollowtree Pharmacy". */
  signature: string | null
  is_active: boolean
  last_tested_at: string | null
  created_at: string
  updated_at: string
}

/** Pharmacy-authored SMS template with {{placeholder}} support (ps_sms_templates). */
export interface SmsTemplate {
  id: string
  org_id: string
  name: string
  /** 'appointment' | 'reminder' | 'video' | 'delivery' | 'collection' | 'custom' */
  category: string
  body: string
  description: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Platform pool of SMS Works virtual reply numbers (ps_sms_reply_numbers). */
export interface SmsReplyNumber {
  id: string
  phone_number: string
  org_id: string | null
  status: SmsReplyNumberStatus
  provider_ref: string | null
  monthly_rental_pence: number
  assigned_at: string | null
  released_at: string | null
  notes: string | null
  created_at: string
}

/** Inbound SMS reply routed to a pharmacy (ps_sms_inbound). */
export interface SmsInbound {
  id: string
  org_id: string
  reply_number: string | null
  from_number: string
  patient_id: string | null
  content: string
  provider_message_id: string | null
  /** The outbound ps_messages row this is a reply to (via echoed metadata). */
  outbound_message_id: string | null
  metadata: Record<string, unknown> | null
  is_read: boolean
  received_at: string
  // Joined
  patient?: Patient
}

/** Monthly per-org usage rollup for chargeback (ps_sms_billing_summary view). */
export interface SmsUsageSummary {
  org_id: string
  /** 'YYYY-MM' */
  period: string
  outbound_count: number
  inbound_count: number
  credits: number
  segments: number
  reply_enabled: boolean
  reply_number_rental_pence: number
  estimated_charge_pence: number
}

// ============================================
// Sticky Notes
// ============================================

/** 1=low (yellow), 2=medium (orange), 3=high (red), 4=urgent (purple) */
export type StickyPriority = 1 | 2 | 3 | 4

export interface StickyNote {
  id: string
  org_id: string
  author_id: string
  assigned_to: string | null
  content: string
  pos_x: number
  pos_y: number
  priority: StickyPriority
  target_date: string | null
  is_completed: boolean
  created_at: string
  updated_at: string
  // Joined
  author?: UserProfile
  assignee?: UserProfile
}

export interface NewStickyNote {
  org_id: string
  author_id: string
  content: string
  pos_x: number
  pos_y: number
  priority?: StickyPriority
  assigned_to?: string | null
  target_date?: string | null
}

// ============================================
// SOP Library
// ============================================

export type SOPStatus = 'draft' | 'published' | 'archived'
export type SOPContentType = 'rich_text' | 'pdf' | 'none'

export interface SOPDocument {
  id: string
  org_id: string
  title: string
  description: string | null
  version: number
  status: SOPStatus
  created_by: string | null
  updated_by: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  // Joined
  created_by_profile?: UserProfile
  updated_by_profile?: UserProfile
  nodes?: SOPNode[]
  assignment?: SOPAssignment | null
  my_completion?: SOPCompletion | null
}

export interface SOPNode {
  id: string
  document_id: string
  parent_id: string | null
  title: string
  content_type: SOPContentType
  rich_content: string | null  // HTML
  pdf_storage_path: string | null
  sort_order: number
  created_at: string
  updated_at: string
  // Client-side tree helpers
  children?: SOPNode[]
  depth?: number
}

// member_id = null means "all org members"
export interface SOPAssignment {
  id: string
  document_id: string
  org_id: string
  member_id: string | null
  assigned_by: string | null
  assigned_at: string
}

export interface SOPCompletion {
  id: string
  document_id: string
  document_version: number
  member_id: string
  org_id: string
  completed_at: string
}

// Rich view used in the progress page
export interface SOPMemberProgress {
  member: OrganisationMember
  completion: SOPCompletion | null
  is_current_version: boolean
}

// ============================================================
// Pharmacy Network (P2P Messaging)
// ============================================================

export type NetworkMessageLabel = 'prescription_query' | 'community_alert' | 'stock_query' | 'other'

export const NETWORK_LABEL_CONFIG: Record<NetworkMessageLabel, { label: string; icon: string; cssClass: string }> = {
  prescription_query: { label: 'Prescription Query', icon: '💊', cssClass: 'ps-badge ps-badge-blue' },
  community_alert:    { label: 'Community Alert',    icon: '⚠️', cssClass: 'ps-badge ps-badge-red' },
  stock_query:        { label: 'Stock Query',         icon: '📦', cssClass: 'ps-badge ps-badge-amber' },
  other:              { label: 'Other',               icon: '💬', cssClass: 'ps-badge' },
}

export interface NetworkMessage {
  id: string
  from_org_id: string
  to_org_id: string
  thread_id: string
  broadcast_id: string | null
  subject: string | null
  body: string
  label: NetworkMessageLabel
  is_read: boolean
  read_at: string | null
  request_sms_ping: boolean
  created_at: string
  // Joined
  from_org?: { id: string; name: string }
  to_org?:   { id: string; name: string }
}

export interface OrgPharmacyLink {
  id: string
  org_id: string
  pharmacy_id: number
  linked_at: string
  is_verified: boolean
  // Joined — fields from the pharmacies table
  pharmacy?: LinkedPharmacyInfo
}

export interface LinkedPharmacyInfo {
  id: number
  ods_code: string
  organisation_name: string
  address1: string | null
  address2: string | null
  city: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
}

export interface NetworkPharmacy {
  pharmacy_id: number
  ods_code: string
  organisation_name: string
  address1: string | null
  address2: string | null
  city: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  distance_km: number | null
  is_on_platform: boolean
  linked_org_id: string | null
  linked_org_name: string | null
}

export interface NetworkSettings {
  org_id: string
  network_enabled: boolean
  sms_pings_enabled: boolean
  updated_at: string
}

export interface NetworkSmsContact {
  id: string
  org_id: string
  label: string | null
  phone_number: string
  is_enabled: boolean
  pause_until: string | null
  notify_start: string   // "HH:MM"
  notify_end: string     // "HH:MM"
  created_at: string
  updated_at: string
}

// ── Drug Delivery System ──────────────────────────────────────────────

// Patient Medications (persistent drug list per patient)

export interface PatientMedication {
  id: string
  organisation_id: string
  patient_id: string
  drug_id: string
  drug_name: string
  drug_form: string | null
  drug_strength: string | null
  dose: string | null
  quantity: number | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

// Care home management

export type CareHomeLinkStatus = 'invited' | 'active' | 'suspended' | 'ended'
export type CareHomeResidentStatus = 'active' | 'hospital' | 'leave' | 'discharged' | 'deceased'
export type CareHomeMedicationRequestType = 'regular' | 'repeat' | 'acute' | 'query' | 'change'
export type CareHomeMedicationRequestStatus =
  | 'draft'
  | 'submitted'
  | 'acknowledged'
  | 'approved'
  | 'sent_to_gp'
  | 'outstanding'
  | 'received'
  | 'part_received'
  | 'refused'
  | 'ordered'
  | 'ready'
  | 'completed'
  | 'declined'
  | 'cancelled'
export type CareHomeMarCycleStatus = 'draft' | 'prepared' | 'published' | 'archived'

export interface CareHomeLink {
  id: string
  pharmacy_organisation_id: string
  care_home_organisation_id: string
  status: CareHomeLinkStatus
  service_name: string | null
  cycle_day: number | null
  default_cycle_length_days: number
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  pharmacy_organisation?: Pick<Organisation, 'id' | 'name' | 'address' | 'organisation_type'>
  care_home_organisation?: Pick<Organisation, 'id' | 'name' | 'address' | 'organisation_type'>
}

export interface CareHomeResident {
  id: string
  care_home_link_id: string
  patient_id: string
  unit_id: string | null
  room_number: string | null
  status: CareHomeResidentStatus
  admitted_on: string | null
  discharged_on: string | null
  gp_name: string | null
  gp_practice: string | null
  allergies: string | null
  special_instructions: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  patient?: Patient
  unit?: CareHomeUnit
  group_memberships?: CareHomeGroupMember[]
}

export type CareHomeGroupType = 'monthly' | 'acute'
export type CareHomeGroupState = 'idle' | 'preparing' | 'ready' | 'in_transit' | 'delivered'

export interface CareHomeUnit {
  id: string
  care_home_link_id: string
  name: string
  floor_name: string | null
  sort_order: number
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  // Group lifecycle
  group_type: CareHomeGroupType
  group_state: CareHomeGroupState
  cycle_day: number | null
  active_batch_id: string | null
  delivery_round_id: string | null
  state_changed_at: string | null
  // Joined helpers
  members?: CareHomeGroupMember[]
  active_batch?: CareHomeSupplyBatch | null
}

export interface CareHomeGroupMember {
  id: string
  group_id: string
  care_home_resident_id: string
  created_by: string | null
  created_at: string
  resident?: CareHomeResident
}

export interface CareHomeMedicationRequest {
  id: string
  care_home_link_id: string
  care_home_resident_id: string
  patient_medication_id: string | null
  request_type: CareHomeMedicationRequestType
  medicine_name: string
  quantity: number | null
  needed_by: string | null
  status: CareHomeMedicationRequestStatus
  request_notes: string | null
  pharmacy_response: string | null
  requested_by: string
  requested_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  completed_at: string | null
  updated_at: string
  gp_request_id: string | null
  request_source: 'care_home' | 'pharmacy_auto' | 'pharmacy_manual'
  prescription_outcome: 'pending' | 'received' | 'part_received' | 'refused' | 'not_required'
  quantity_received: number | null
  outcome_reason: string | null
  outcome_by: string | null
  outcome_at: string | null
  resident?: CareHomeResident
}

export type CareHomeGpRequestStatus = 'draft' | 'ready_to_send' | 'sent_to_gp' | 'partially_received' | 'received' | 'closed' | 'cancelled'

export interface CareHomeGpRequest {
  id: string
  care_home_link_id: string
  request_number: number
  title: string
  cycle_start: string | null
  cycle_end: string | null
  status: CareHomeGpRequestStatus
  surgery_name: string | null
  surgery_address: string | null
  surgery_contact: string | null
  notes: string | null
  prepared_by: string
  prepared_at: string
  sent_by: string | null
  sent_at: string | null
  closed_by: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  lines?: CareHomeMedicationRequest[]
}

export type CareHomeResidentNoteType = 'general' | 'clinical' | 'hospital' | 'incident' | 'medication' | 'communication'

export interface CareHomeResidentNote {
  id: string
  care_home_resident_id: string
  note_type: CareHomeResidentNoteType
  note_date: string
  note_text: string
  created_by: string
  created_at: string
}

export interface CareHomeMedicationEvent {
  id: string
  care_home_resident_id: string
  medication_schedule_id: string | null
  patient_medication_id: string | null
  event_type: 'started' | 'changed' | 'stopped' | 'completed' | 'restarted' | 'incident' | 'note'
  event_date: string
  summary: string
  reason: string | null
  details: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export interface CareHomeMarCycle {
  id: string
  care_home_resident_id: string
  period_start: string
  period_end: string
  status: CareHomeMarCycleStatus
  notes: string | null
  prepared_by: string | null
  prepared_at: string | null
  published_by: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  resident?: CareHomeResident
}

export type CareHomeMedicationScheduleType = 'regular' | 'repeat' | 'acute' | 'prn'
export type CareHomeMarEntryStatus = 'planned' | 'administered' | 'refused' | 'omitted' | 'not_available' | 'away' | 'self_administered'

export interface CareHomeMedicationSchedule {
  id: string
  care_home_resident_id: string
  patient_medication_id: string
  schedule_type: CareHomeMedicationScheduleType
  dose: string
  route: string | null
  instructions: string | null
  round_time: string | null
  administration_days: number[]
  start_date: string
  end_date: string | null
  is_active: boolean
  lifecycle_status: 'active' | 'stopped' | 'completed'
  stopped_at: string | null
  stopped_by: string | null
  stop_reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  patient_medication?: PatientMedication
}

export interface CareHomeMarEntry {
  id: string
  mar_cycle_id: string
  medication_schedule_id: string
  administration_date: string
  round_time: string | null
  status: CareHomeMarEntryStatus
  dose: string
  reason_code: string | null
  notes: string | null
  administered_by: string | null
  administered_at: string | null
  witness_by: string | null
  created_at: string
  updated_at: string
  medication_schedule?: CareHomeMedicationSchedule
}

export interface CareHomeAuditEvent {
  id: string
  care_home_link_id: string
  resident_id: string | null
  entity_type: string
  entity_id: string | null
  event_type: string
  summary: string
  details: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export type CareHomeSupplyScope = 'all' | 'regular' | 'acute'
export type CareHomeSupplyBatchStatus = 'draft' | 'packing' | 'ready_for_dispatch' | 'dispatched' | 'delivered' | 'reconciled' | 'cancelled'
export type CareHomeSupplyPackageStatus = 'open' | 'packed' | 'sealed' | 'sent' | 'received' | 'discrepancy'
export type CareHomeSupplyLineStatus = 'expected' | 'packed' | 'omitted' | 'sent' | 'received' | 'short' | 'over' | 'damaged' | 'returned'

export interface CareHomeSupplyBatch {
  id: string
  care_home_link_id: string
  batch_number: number
  title: string
  period_start: string
  period_end: string
  delivery_date: string | null
  supply_scope: CareHomeSupplyScope
  status: CareHomeSupplyBatchStatus
  delivery_round_id: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  dispatched_at: string | null
  delivered_at: string | null
  reconciled_at: string | null
  group_id: string | null
  group?: CareHomeUnit | null
  packages?: CareHomeSupplyPackage[]
}

export interface CareHomeSupplyPackage {
  id: string
  batch_id: string
  care_home_resident_id: string
  unit_id: string | null
  package_label: string
  package_status: CareHomeSupplyPackageStatus
  packed_by: string | null
  packed_at: string | null
  sealed_by: string | null
  sealed_at: string | null
  received_by: string | null
  received_at: string | null
  receipt_notes: string | null
  created_at: string
  updated_at: string
  delivery_round_patient_id: string | null
  resident?: CareHomeResident
  unit?: CareHomeUnit
  lines?: CareHomeSupplyLine[]
  batch?: CareHomeSupplyBatch
}

export interface CareHomeSupplyLine {
  id: string
  package_id: string
  medication_schedule_id: string | null
  patient_medication_id: string
  delivery_patient_medication_id: string | null
  supply_type: CareHomeMedicationScheduleType
  medicine_name: string
  form: string | null
  strength: string | null
  dose: string | null
  quantity_expected: number
  quantity_packed: number
  quantity_sent: number
  quantity_received: number | null
  line_status: CareHomeSupplyLineStatus
  omission_reason: string | null
  discrepancy_notes: string | null
  packed_by: string | null
  packed_at: string | null
  received_by: string | null
  received_at: string | null
  created_at: string
  updated_at: string
}

// Delivery Round Statuses

export type DeliveryRoundStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export type DeliveryPatientStatus =
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

// Delivery Round

export interface DeliveryRound {
  id: string
  organisation_id: string
  title: string | null
  status: DeliveryRoundStatus
  scheduled_date: string | null
  scheduled_time_start: string | null
  scheduled_time_end: string | null
  driver_id: string | null
  template_id: string | null
  care_home_batch_id?: string | null
  notes: string | null
  time_window: string | null
  created_by: string
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  // Joined data
  driver?: OrganisationMember
  patients?: DeliveryRoundPatient[]
}

// Delivery Round Patient

export interface DeliveryRoundPatient {
  id: string
  round_id: string
  patient_id: string
  organisation_id: string
  delivery_order: number
  status: DeliveryPatientStatus
  delivery_address_line_1: string | null
  delivery_address_line_2: string | null
  delivery_city: string | null
  delivery_postcode: string | null
  notes: string | null
  signature_data: string | null
  delivered_at: string | null
  failure_reason: string | null
  original_round_patient_id: string | null
  moved_to_round_patient_id: string | null
  created_at: string
  updated_at: string
  // Joined data
  patient?: Patient
  medications?: DeliveryPatientMedication[]
}

// Delivery Patient Medication

export interface DeliveryPatientMedication {
  id: string
  delivery_round_patient_id: string
  patient_medication_id: string
  quantity: number | null
  notes: string | null
  created_at: string
  // Joined data
  patient_medication?: PatientMedication
}

// Delivery Round Template

export interface DeliveryRoundTemplate {
  id: string
  organisation_id: string
  name: string
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  // Joined data
  patients?: DeliveryRoundTemplatePatient[]
}

export interface DeliveryRoundTemplatePatient {
  id: string
  template_id: string
  patient_id: string
  delivery_order: number
  delivery_address_line_1: string | null
  delivery_address_line_2: string | null
  delivery_city: string | null
  delivery_postcode: string | null
  notes: string | null
  include_all_active_meds: boolean
  created_at: string
  // Joined data
  patient?: Patient
  medications?: DeliveryRoundTemplateMedication[]
}

export interface DeliveryRoundTemplateMedication {
  id: string
  template_patient_id: string
  patient_medication_id: string
  default_quantity: number | null
  created_at: string
  // Joined data
  patient_medication?: PatientMedication
}

// Location Update (Driver GPS)

export interface DeliveryLocationUpdate {
  id: string
  round_id: string
  driver_id: string
  latitude: number
  longitude: number
  recorded_at: string
}

// BNF Drug Search Result (for drug picker)

export interface BnfDrugSearchResult {
  id: string
  drug_id: string
  name: string
  form: string | null
  brand_name: string | null
  manufacturer: string | null
  activeIngredients: string | null
  controlledDrugSchedule: string | null
  // Joined from bnf_drugs
  drug_name?: string
}

// ============================================
// Delivery Outcomes
// ============================================

export type OutcomeType = 'prescription' | 'referral' | 'advice' | 'no_treatment'

export interface OutcomeMedication {
  id: string
  outcome_id: string
  drug_id: string | null
  drug_name: string
  drug_form: string | null
  drug_strength: string | null
  dose: string | null
  quantity: number | null
  unit: string | null
  is_controlled_drug: boolean
  sort_order: number
  created_at: string
}

export interface DeliveryOutcome {
  id: string
  delivery_id: string
  org_id: string
  outcome_type: OutcomeType
  // Referral fields
  referral_to: string | null
  referral_reason: string | null
  referral_urgency: 'routine' | 'urgent' | 'emergency' | null
  // Advice / notes
  advice_given: string | null
  // Metadata
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined data
  medications?: OutcomeMedication[]
}

// --- NHS Integration ---
export * from './nhs'

// --- PEPS (Private Electronic Prescription Service) ---
export * from './peps'

// ============================================
// Locum Expansion Types
// ============================================

// --- Locum Profile ---

export interface LocumProfile {
  id: string
  user_id: string
  gphc_number: string | null
  gphc_expiry: string | null
  indemnity_provider: string | null
  indemnity_expiry: string | null
  smart_card_held: boolean
  nhs_email: string | null
  dbs_number: string | null
  dbs_expiry: string | null
  ni_number: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  postcode: string | null
  stripe_account_id: string | null
  stripe_onboarded: boolean
  onboarding_complete: boolean
  created_at: string
  updated_at: string
  // Joined
  user_profile?: UserProfile
}

// --- Locum Documents ---

export type LocumDocType = 'gov_id' | 'dbs' | 'insurance' | 'gphc_cert' | 'smart_card' | 'qualification' | 'other'

export interface LocumDocument {
  id: string
  locum_id: string
  doc_type: LocumDocType
  label: string | null
  file_url: string
  expiry_date: string | null
  uploaded_at: string
  is_current: boolean
}

// --- Locum Services ---

export interface LocumService {
  id: string
  locum_id: string
  service_library_id: string
  added_at: string
  // Joined
  service_library?: { id: string; name: string; category: string }
}

// --- Locum Shifts ---

export type LocumShiftStatus = 'open' | 'filled' | 'completed' | 'cancelled'
export type LocumShiftBookingMode = 'auto' | 'manual'
export type LocumShiftPaymentMode = 'platform' | 'external'

export interface LocumShift {
  id: string
  org_id: string
  created_by: string
  date: string
  start_time: string
  end_time: string
  rate_per_hour: number
  booking_mode: LocumShiftBookingMode
  payment_mode: LocumShiftPaymentMode
  status: LocumShiftStatus
  notes: string | null
  created_at: string
  updated_at: string
  // Joined
  organisation?: Pick<Organisation, 'id' | 'name' | 'address'>
  criteria?: LocumShiftCriteria
  booking?: LocumBooking // the current user's booking for this shift
}

// --- Locum Shift Criteria ---

export interface LocumShiftCriteria {
  id: string
  shift_id: string
  required_service_ids: string[] | null
  references_required: boolean
  sop_required: boolean
  notes: string | null
  created_at: string
}

// --- Locum Bookings ---

export type LocumBookingStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled' | 'no_show'

export interface LocumBooking {
  id: string
  shift_id: string
  locum_id: string
  status: LocumBookingStatus
  applied_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  cancellation_reason: string | null
  // Joined
  shift?: LocumShift
  locum?: LocumProfile
}

// --- Locum SOP Documents ---

export interface LocumSopDocument {
  id: string
  org_id: string
  title: string
  description: string | null
  file_url: string
  version: number
  is_required: boolean
  is_active: boolean
  uploaded_by: string
  created_at: string
  updated_at: string
}

// --- Locum SOP Signoffs ---

export interface LocumSopSignoff {
  id: string
  sop_id: string
  locum_id: string
  booking_id: string | null
  signed_at: string
  sop_version: number
}

// --- Locum Sign-Ins ---

export interface LocumSignIn {
  id: string
  booking_id: string
  locum_id: string
  org_id: string
  signed_in_at: string
  signed_out_at: string | null
  duration_minutes: number | null
  rp_entry_id: string | null
  created_at: string
}

// --- Locum Commerce ---

export type LocumPaymentWeekStatus = 'open' | 'closed' | 'invoiced'

export interface LocumPaymentWeek {
  id: string
  org_id: string
  locum_id: string
  week_start: string
  week_end: string
  status: LocumPaymentWeekStatus
  created_at: string
}

export type LocumInvoiceStatus = 'pending' | 'paid' | 'overdue' | 'disputed' | 'void'

export interface LocumInvoice {
  id: string
  payment_week_id: string
  org_id: string
  locum_id: string
  invoice_number: string
  week_start: string
  week_end: string
  issued_at: string
  due_date: string
  subtotal_pence: number
  platform_fee_pence: number
  total_pence: number
  status: LocumInvoiceStatus
  pdf_url: string | null
  created_at: string
  updated_at: string
  // Joined
  lines?: LocumInvoiceLine[]
  payment?: LocumPayment
}

export interface LocumInvoiceLine {
  id: string
  invoice_id: string
  booking_id: string
  shift_date: string
  start_time: string
  end_time: string
  duration_minutes: number
  rate_per_hour: number
  line_total_pence: number
  platform_fee_pence: number
  created_at: string
}

export type LocumPaymentStatus = 'pending' | 'processing' | 'settled' | 'failed' | 'disputed' | 'refunded'

export interface LocumPayment {
  id: string
  invoice_id: string
  org_id: string
  locum_id: string
  amount_pence: number
  platform_fee_pence: number
  stripe_payment_intent: string | null
  stripe_transfer_id: string | null
  status: LocumPaymentStatus
  initiated_at: string | null
  settled_at: string | null
  created_at: string
  updated_at: string
}

export interface LocumPaymentMandate {
  id: string
  org_id: string
  stripe_customer_id: string | null
  stripe_mandate_id: string | null
  stripe_payment_method: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// --- Locum Reviews & Reputation ---

export interface LocumReview {
  id: string
  org_id: string
  locum_id: string
  booking_id: string
  reviewed_by: string
  score: number
  punctuality: number | null
  professionalism: number | null
  notes: string | null
  created_at: string
}

export interface LocumPharmacyFeedback {
  id: string
  locum_id: string
  org_id: string
  booking_id: string
  score: number
  notes: string | null
  created_at: string
}

export interface LocumNote {
  id: string
  org_id: string
  locum_id: string
  created_by: string
  note: string
  created_at: string
  updated_at: string
  // Joined
  author?: Pick<UserProfile, 'id' | 'full_name'>
}

export interface LocumBlacklist {
  id: string
  org_id: string
  locum_id: string
  added_by: string
  reason: string | null
  created_at: string
}

// --- Locum Eligibility (computed client-side / query-side) ---

export type LocumEligibilityStatus = 'eligible' | 'sop_required' | 'ineligible' | 'clashes'

export interface LocumShiftEligibility {
  shift_id: string
  status: LocumEligibilityStatus
  missing_services: string[]
  sops_to_sign: LocumSopDocument[]
  clash: boolean
}

// ============================================
// Expansion Types — Staff Alert System
//
// Internal, staff-facing notifications (header bell / SMS / future
// mobile+desktop push) — distinct from patient-facing messaging (ps_messages
// / psNotify). New event types can be added without a schema change: they
// just need a key in ps_org_alert_settings.settings and (eventually) a DB
// trigger that calls ps_fanout_notification().
// ============================================

/** Extensible — new features add new string values here as they're wired up. */
export type AlertEventType =
  | 'appointment'
  | 'peps'
  | 'network_message'
  | 'system'
  | 'patient_message'
  | (string & {})

/** 'mobile' and 'desktop' are stored now so settings "fold in nicely" once those apps exist. */
export interface AlertChannelConfig {
  web: boolean
  sms: boolean
  mobile: boolean
  desktop: boolean
}

/** Org-wide routing: which channels are on for each event type. Manager-controlled. */
export interface OrgAlertSettings {
  org_id: string
  settings: Partial<Record<AlertEventType, AlertChannelConfig>>
  updated_at: string
}

/** Personal (global, per-user) opt-in — set under the user's own profile settings. */
export interface UserNotificationPreferences {
  user_id: string
  sms_enabled: boolean
  sms_phone: string | null
  mobile_enabled: boolean
  web_push_enabled: boolean
  updated_at: string
}

/** A single alert fed into the header bell (org-scoped). */
export interface StaffNotification {
  id: string
  org_id: string
  event_type: AlertEventType
  title: string
  body: string | null
  link: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type NotificationSmsStatus = 'not_applicable' | 'pending' | 'sent' | 'failed'

/** Per-recipient read + SMS dispatch state; joined to its parent notification. */
export interface NotificationReceipt {
  id: string
  notification_id: string
  user_id: string
  is_read: boolean
  read_at: string | null
  sms_status: NotificationSmsStatus
  sms_sent_at: string | null
  sms_error: string | null
  created_at: string
  // Joined
  notification?: StaffNotification
}

