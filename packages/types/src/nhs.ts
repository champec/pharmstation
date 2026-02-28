// ============================================================
// NHS Claim Types — Integrated NHS Expansion
// Author: Lead Architect
// Date: 26 February 2026
//
// These types cover:
//  - NHSBSA MYS claim submission payloads (all 7 services)
//  - NHS PDS FHIR patient demographics
//  - Claim submission tracking (ps_nhs_claim_submissions table)
// ============================================================

// ============================================================
// Enums
// ============================================================

export type NHSServiceType =
  | 'cpcs_emg_med'
  | 'cpcs_min_ill'
  | 'cpcs_emg_uec'
  | 'cpcs_min_ill_uec'
  | 'cpcs_ccs'        // Pharmacy First — Clinical Pathways
  | 'flu_vac'
  | 'covid_vac'
  | 'gp_covid_vac'
  | 'scs'
  | 'contraception'
  | 'cvd_hypertension'
  | 'nms'

export type NHSClaimStatus =
  | 'draft'
  | 'pending'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'updated'
  | 'deleted'

export type ConsultationMethod =
  | 'FACE_TO_FACE'
  | 'TELEPHONE'
  | 'VIDEO'
  | 'ONLINE_ASYNCHRONOUS'

export type ProfessionalRole =
  | 'PHARMACIST'
  | 'PHARMACY_TECHNICIAN'
  | 'INDEPENDENT_PRESCRIBER'

// Maps our internal service type to the NHSBSA CLAIM_TYPE_CODE string
export const NHS_CLAIM_TYPE_CODE: Record<NHSServiceType, string> = {
  cpcs_emg_med:    'EMG_MED',
  cpcs_min_ill:    'MIN_ILL',
  cpcs_emg_uec:    'EMG_MED_UEC',
  cpcs_min_ill_uec:'MIN_ILL_UEC',
  cpcs_ccs:        'CCS',
  flu_vac:         'FLU_VAC',
  covid_vac:       'COVID_VAC',
  gp_covid_vac:    'GP_COVID_VAC',
  scs:             'SCS',
  contraception:   'CONTRACEPTION',
  cvd_hypertension:'CVD',
  nms:             'NMS',
}

// ============================================================
// Database row types
// ============================================================

export interface NHSClaimSubmission {
  id: string
  org_id: string
  patient_id: string | null
  service_delivery_id: string | null
  service_type: NHSServiceType
  platform_deposit_id: string
  claim_year_month: string       // yyyy-MM
  status: NHSClaimStatus
  payload: Record<string, unknown>
  bsa_response: Record<string, unknown> | null
  submitted_at: string | null
  last_updated_at: string | null
  created_by: string | null
  created_at: string
}

export interface NHSSubmissionAttempt {
  id: string
  submission_id: string
  attempt_number: number
  http_method: 'POST' | 'PUT' | 'GET' | 'DELETE'
  endpoint_url: string
  request_payload: Record<string, unknown> | null
  response_status: number | null
  response_body: Record<string, unknown> | null
  error_message: string | null
  succeeded: boolean
  attempted_at: string
}

export interface NHSPatientPDSCache {
  nhs_number: string
  patient_id: string | null
  org_id: string
  pds_family_name: string | null
  pds_given_names: string[] | null
  pds_dob: string | null
  pds_gender: string | null
  pds_address_line1: string | null
  pds_address_postcode: string | null
  pds_gp_ods: string | null
  pds_restricted: boolean
  full_pds_response: Record<string, unknown> | null
  last_verified_at: string
  verified_by: string | null
}

// ============================================================
// NHS PDS FHIR Patient (Personal Demographics Service)
// Only the fields we need for claim submission
// ============================================================

export interface PDSPatient {
  nhsNumber: string          // from identifier[0].value
  familyName: string         // from name[0].family
  givenNames: string[]       // from name[0].given
  dateOfBirth: string        // from birthDate (yyyy-MM-dd)
  gender: 'male' | 'female' | 'other' | 'unknown'
  address?: {
    line: string[]
    city?: string
    postalCode?: string
  }
  gpPracticeOdsCode?: string // from generalPractitioner[0].identifier.value
  restrictedPatient: boolean // from meta.security (S flag)
}

// ============================================================
// NHSBSA Payload — Common fields (all services)
// ============================================================

export interface NHSBaseClaimPayload {
  PLATFORM_DEPOSIT_ID: string     // PSN-TEST-{orgId}-{ts} in staging
  CLAIMANT_ODS: string            // pharmacy ODS code
  CLAIM_YEAR_MONTH: string        // yyyy-MM
  PATIENT_NHSNO: string           // 10-digit NHS number or fallback code
  PATIENT_GPODS: string           // patient's GP practice ODS code
  ASSESSMENT_DATE: string         // yyyy-MM-dd
  CONSULTATION_METHOD: ConsultationMethod
  PROFESSIONAL_ROLE: ProfessionalRole
}

// NHS number fallback codes when NHS number unavailable
export const NHS_NUMBER_FALLBACK = {
  NON_REGISTERED_UK:   '1111111111',
  NON_UK_RESIDENT:     '2222222222',
  NO_CONSENT:          '3333333333',
  NOT_FOUND:           '4444444444',
} as const

// ============================================================
// CPCS Payload (Emergency Medicine / Minor Illness / UEC)
// ============================================================

export interface CPCSClaimPayload extends NHSBaseClaimPayload {
  CLAIM_TYPE_CODE: 'EMG_MED' | 'MIN_ILL' | 'EMG_MED_UEC' | 'MIN_ILL_UEC'
  REFERRAL_DATE?: string           // yyyy-MM-dd — from NHS 111 or GP
  REFERRER_ORG_ODS?: string
  REFERRER_ORG_TYPE?: string
  DISPOSITION_CODE?: string        // Dx code from NHS 111 CDSS
  CONSULTATION_OUTCOME: string
  URGENCY_OF_REFERRAL?: 'ROUTINE' | 'URGENT'
  REFERRED_TO_ROUTINE?: string
  REFERRED_TO_URGENT?: string
  REFERRED_ODS?: string
  ONWARD_REFERRAL_REASON?: string
  ONWARD_REFERRAL_DATE?: string
  DATE_RECORDED: string            // yyyy-MM-dd — date entered into system
  // Drug supply (optional)
  DRUG_CODE?: string
  DRUG_DESC?: string
  QUANTITY?: number
  MEDICATION_SUPPLY_TYPE?: string
}

// ============================================================
// Pharmacy First — Clinical Pathways (CCS) Payload
// ============================================================

// The 7 Pharmacy First — Clinical Pathways
export type CCSPresentingComplaint =
  | 'A_O_M'   // Acute Otitis Media — FACE_TO_FACE only
  | 'SHG'     // Shingles
  | 'I_I_B'   // Infected Insect Bites
  | 'SNT'     // Sinusitis
  | 'ITG'     // Impetigo
  | 'U_UTI'   // Uncomplicated UTI
  | 'A_S_T'   // Acute Sore Throat

export type CCSNoSupplyReason =
  | 'A'   // Does not meet PGD inclusion criteria
  | 'B'   // Excluded under terms of PGD
  | 'C'   // Does not consent
  | 'D'   // Shared decision: self-care preferred
  | 'E'   // Shared decision: delay and return if worsens
  | 'F'   // Other

export interface PharmacyFirstClaimPayload extends NHSBaseClaimPayload {
  CLAIM_TYPE_CODE: 'CCS'
  CCS_PRESENTING_COMPLAINT_OR_ISSUE: CCSPresentingComplaint
  PROFESSIONAL_IDENTIFIER: string  // GPhC / NMC number — mandatory for CCS
  CONSULTATION_OUTCOME: string
  // IMPORTANT: if CCS_PRESENTING_COMPLAINT_OR_ISSUE = 'A_O_M'
  // then CONSULTATION_METHOD MUST be 'FACE_TO_FACE'
  CCS_NO_SUPPLY_REASON?: CCSNoSupplyReason  // required if no supply made
  DATE_RECORDED: string
  // Drug supply if applicable
  DRUG_CODE?: string
  DRUG_DESC?: string
  QUANTITY?: number
  MEDICATION_SUPPLY_TYPE?: string
  URGENCY_OF_REFERRAL?: 'ROUTINE' | 'URGENT'
  REFERRED_TO_ROUTINE?: string
  REFERRED_TO_URGENT?: string
  REFERRED_ODS?: string
  ONWARD_REFERRAL_REASON?: string
  ONWARD_REFERRAL_DATE?: string
}

// ============================================================
// Flu Vaccination Payload
// ============================================================

export interface FluVacClaimPayload extends NHSBaseClaimPayload {
  CLAIM_TYPE_CODE: 'FLU_VAC'
  DOSE_NUMBER?: number
  VACCINATION_SITE_ODS?: string
  VACCINE_PRODUCT_CODE?: string
  BATCH_NUMBER?: string
  EXPIRY_DATE?: string             // yyyy-MM-dd
}

// ============================================================
// NMS Payload (New Medicines Service)
// ============================================================

export interface NMSProduct {
  PRODUCT_CODE: string
  PRODUCT_DESC: string
  PATIENT_USING_MEDICINE: boolean
  NOT_USING_MEDICINE_REASON?: string[]
}

export interface NMSClaimPayload extends NHSBaseClaimPayload {
  CLAIM_TYPE_CODE: 'NMS'
  PRESCRIPTION_DATE: string        // yyyy-MM-dd
  CONDITIONS: string[]             // NMS-eligible conditions
  NMS_PRODUCTS: NMSProduct[]
  CONSULTATION_OUTCOME: string
  FOLLOW_UP_DATE?: string
}

// ============================================================
// SCS Payload (Smoking Cessation Service)
// ============================================================

export interface SCSNRTProduct {
  PRODUCT_CODE: string
  PRODUCT_DESC: string
  QUANTITY: number
}

export interface SCSClaimPayload extends NHSBaseClaimPayload {
  CLAIM_TYPE_CODE: 'SCS'
  QUIT_DATE: string                // yyyy-MM-dd
  NUMBER_OF_CONSULTATIONS: number
  NUMBER_OF_SUPPORT_WEEKS: number
  NRT_PRODUCT: SCSNRTProduct[]
  FOUR_WEEKS_POST_QUIT?: boolean
  TWELVE_WEEKS_POST_QUIT?: boolean
  PREGNANCY_STATUS?: boolean
  E_CIGARETTES_USED?: boolean
}

// ============================================================
// Contraception Payload
// ============================================================

export interface ContraceptionProduct {
  PRODUCT_CODE: string
  PRODUCT_DESC: string
  SUPPLY_TYPE: 'OTC' | 'POM' | 'PGD'
}

export interface ContraceptionClaimPayload extends NHSBaseClaimPayload {
  CLAIM_TYPE_CODE: 'CONTRACEPTION'
  SERVICE_TYPE: 'INITIATION' | 'ONGOING_MONITORING' | 'EMERGENCY'
  CONTRACEPTION_METHOD: string[]
  PRODUCTS: ContraceptionProduct[]
  PROFESSIONAL_IDENTIFIER: string  // GPhC / NMC number
}

// ============================================================
// CVD / Hypertension Case-Finding Payload
// ============================================================

export interface BPReading {
  SYSTOLIC: number
  DIASTOLIC: number
  PULSE_RATE?: number
}

export interface ClinicTestDetails {
  READING_1: BPReading
  READING_2: BPReading
  READING_3?: BPReading
  RESULT_RATING: 'NORMAL' | 'ELEVATED' | 'HIGH' | 'VERY_HIGH'
}

export interface ABPMDetails {
  ABPM_DATE: string
  AVERAGE_SYSTOLIC: number
  AVERAGE_DIASTOLIC: number
  RESULT_RATING: 'NORMAL' | 'ELEVATED' | 'HIGH' | 'VERY_HIGH'
}

export interface CVDClaimPayload extends NHSBaseClaimPayload {
  CLAIM_TYPE_CODE: 'CVD'
  CLINIC_BP_PROVIDED: boolean
  CLINIC_TEST_DETAILS?: ClinicTestDetails
  ABPM_UNDERTAKEN: boolean
  ABPM_DETAILS?: ABPMDetails
  HEALTHY_LIVING_ADVICE: string[]
  URGENCY_OF_REFERRAL?: 'ROUTINE' | 'URGENT'
  REFERRED_ODS?: string
  ONWARD_REFERRAL_REASON?: string
}

// ============================================================
// Union of all payload types
// ============================================================

export type NHSClaimPayload =
  | CPCSClaimPayload
  | PharmacyFirstClaimPayload
  | FluVacClaimPayload
  | NMSClaimPayload
  | SCSClaimPayload
  | ContraceptionClaimPayload
  | CVDClaimPayload

// ============================================================
// NHS 111 Referral Types
// ============================================================

export type NHS111ReferralStatus =
  | 'received'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'expired'

export type NHS111EventType = 'referral' | 'discharge_details'

export type NHS111Urgency = 'routine' | 'urgent' | 'emergency'

export interface NHS111Referral {
  id: string
  org_id: string

  // Patient demographics
  patient_nhs_number: string | null
  patient_name: string | null
  patient_dob: string | null         // ISO date string
  patient_address: Record<string, unknown> | null
  patient_phone: string | null
  patient_gp_ods_code: string | null
  patient_gp_name: string | null

  // Case identifiers
  case_id: string | null             // unique dedup key
  case_ref: string | null

  // Event classification
  event_type: NHS111EventType

  // Clinical content
  disposition_code: string | null
  disposition_text: string | null
  presenting_complaint: string | null
  encounter_summary: string | null
  care_plan: string | null
  triage_questions: NHS111TriageQA[] | null

  // Source
  source_ods_code: string | null
  source_org_name: string | null

  // Urgency
  urgency: NHS111Urgency

  // Raw FHIR bundle
  raw_fhir_bundle: Record<string, unknown> | null

  // Workflow
  status: NHS111ReferralStatus
  received_at: string
  actioned_at: string | null
  actioned_by: string | null
  completed_at: string | null
  linked_delivery_id: string | null
  rejection_reason: string | null
  notes: string | null

  created_at: string
  updated_at: string
}

export interface NHS111TriageQA {
  question: string
  answer: string
}

// ============================================================
// FHIR STU3 types — minimal subset for 111 Adaptor output
// Used by the nhs111-receive Edge Function to parse the bundle
// ============================================================

export interface FhirBundle {
  resourceType: 'Bundle'
  type: 'message'
  meta?: { lastUpdated?: string }
  identifier?: { type?: { text?: string }; value?: string }
  entry: FhirBundleEntry[]
}

export interface FhirBundleEntry {
  fullUrl?: string
  resource: FhirResource
}

export type FhirResource =
  | FhirMessageHeader
  | FhirEncounter
  | FhirPatient
  | FhirCondition
  | FhirReferralRequest
  | FhirCarePlan
  | FhirComposition
  | FhirQuestionnaireResponse
  | FhirObservation
  | FhirOrganization
  | FhirAppointment
  | FhirGenericResource

export interface FhirResourceBase {
  resourceType: string
  id?: string
}

export interface FhirMessageHeader extends FhirResourceBase {
  resourceType: 'MessageHeader'
  event?: { system?: string; code?: string; display?: string }
  destination?: Array<{ endpoint?: string }>
  source?: { name?: string; endpoint?: string }
  reason?: { coding?: Array<{ system?: string; code?: string }> }
}

export interface FhirEncounter extends FhirResourceBase {
  resourceType: 'Encounter'
  status?: string
  type?: Array<{ text?: string }>
  subject?: FhirReference
  period?: { start?: string; end?: string }
  identifier?: Array<{ system?: string; value?: string }>
  location?: Array<{ location?: FhirReference; status?: string }>
  serviceProvider?: FhirReference
}

export interface FhirPatient extends FhirResourceBase {
  resourceType: 'Patient'
  identifier?: Array<{ system?: string; value?: string; extension?: unknown[] }>
  name?: Array<{ family?: string; given?: string[]; text?: string; use?: string }>
  birthDate?: string
  gender?: string
  address?: Array<{ line?: string[]; city?: string; postalCode?: string; use?: string }>
  telecom?: Array<{ system?: string; value?: string; use?: string }>
  generalPractitioner?: FhirReference[]
}

export interface FhirCondition extends FhirResourceBase {
  resourceType: 'Condition'
  code?: FhirCodeableConcept
  category?: Array<{ text?: string }>
  clinicalStatus?: string
  subject?: FhirReference
}

export interface FhirReferralRequest extends FhirResourceBase {
  resourceType: 'ReferralRequest'
  status?: string
  intent?: string
  priority?: string
  serviceRequested?: FhirCodeableConcept[]
  subject?: FhirReference
  description?: string
  reasonCode?: FhirCodeableConcept[]
}

export interface FhirCarePlan extends FhirResourceBase {
  resourceType: 'CarePlan'
  status?: string
  title?: string
  description?: string
  subject?: FhirReference
}

export interface FhirComposition extends FhirResourceBase {
  resourceType: 'Composition'
  status?: string
  title?: string
  section?: Array<{ title?: string; text?: { div?: string } }>
  subject?: FhirReference
}

export interface FhirQuestionnaireResponse extends FhirResourceBase {
  resourceType: 'QuestionnaireResponse'
  status?: string
  item?: FhirQuestionnaireItem[]
}

export interface FhirQuestionnaireItem {
  linkId?: string
  text?: string
  answer?: Array<{ valueString?: string; valueBoolean?: boolean; item?: FhirQuestionnaireItem[] }>
  item?: FhirQuestionnaireItem[]
}

export interface FhirObservation extends FhirResourceBase {
  resourceType: 'Observation'
  status?: string
  code?: FhirCodeableConcept
  valueString?: string
  subject?: FhirReference
}

export interface FhirOrganization extends FhirResourceBase {
  resourceType: 'Organization'
  identifier?: Array<{ system?: string; value?: string }>
  name?: string
  type?: FhirCodeableConcept[]
  telecom?: Array<{ system?: string; value?: string }>
  address?: Array<{ line?: string[]; city?: string; postalCode?: string }>
}

export interface FhirAppointment extends FhirResourceBase {
  resourceType: 'Appointment'
  status?: string
  reason?: FhirCodeableConcept[]
  description?: string
  comment?: string
}

export interface FhirGenericResource extends FhirResourceBase {
  [key: string]: unknown
}

export interface FhirReference {
  reference?: string
  display?: string
  resource?: FhirResource
}

export interface FhirCodeableConcept {
  coding?: Array<{ system?: string; code?: string; display?: string }>
  text?: string
}
