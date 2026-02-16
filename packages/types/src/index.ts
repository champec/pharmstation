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

// ============================================
// AI Models & Chat
// ============================================

// --- AI Provider ---

export type AIProvider = 'openai' | 'anthropic' | 'google'

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
