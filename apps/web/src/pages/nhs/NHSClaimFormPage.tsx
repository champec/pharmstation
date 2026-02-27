import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore, useNHSStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type {
  NHSServiceType,
  ConsultationMethod,
  ProfessionalRole,
  CCSPresentingComplaint,
  CCSNoSupplyReason,
} from '@pharmstation/types'

// ============================================================
// Field definitions per service type
// ============================================================

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'select' | 'date' | 'number' | 'boolean' | 'textarea'
  required: boolean
  options?: string[]
  placeholder?: string
  helpText?: string
  condition?: (data: Record<string, unknown>) => boolean
}

const CONSULTATION_METHODS: ConsultationMethod[] = ['FACE_TO_FACE', 'TELEPHONE', 'VIDEO', 'ONLINE_ASYNCHRONOUS']
const PROFESSIONAL_ROLES: ProfessionalRole[] = ['PHARMACIST', 'PHARMACY_TECHNICIAN', 'INDEPENDENT_PRESCRIBER']

const CCS_COMPLAINTS: { value: CCSPresentingComplaint; label: string }[] = [
  { value: 'A_O_M', label: 'Acute Otitis Media' },
  { value: 'SHG', label: 'Shingles' },
  { value: 'I_I_B', label: 'Infected Insect Bites' },
  { value: 'SNT', label: 'Sinusitis' },
  { value: 'ITG', label: 'Impetigo' },
  { value: 'U_UTI', label: 'Uncomplicated UTI' },
  { value: 'A_S_T', label: 'Acute Sore Throat' },
]

const CCS_NO_SUPPLY_REASONS: { value: CCSNoSupplyReason; label: string }[] = [
  { value: 'A', label: 'Does not meet PGD inclusion criteria' },
  { value: 'B', label: 'Excluded under terms of PGD' },
  { value: 'C', label: 'Does not consent' },
  { value: 'D', label: 'Shared decision: self-care preferred' },
  { value: 'E', label: 'Shared decision: delay and return if worsens' },
  { value: 'F', label: 'Other' },
]

const CONSULTATION_OUTCOMES = [
  'ADVICE_GIVEN',
  'MEDICINE_SUPPLIED',
  'REFERRED_TO_GP',
  'REFERRED_TO_A_AND_E',
  'REFERRED_TO_OTHER',
  'NO_ACTION_REQUIRED',
]

const URGENCY_OPTIONS = ['ROUTINE', 'URGENT']

// ============================================================
// Common fields (all services share these)
// ============================================================

function getCommonFields(): FieldDef[] {
  return [
    { key: 'PATIENT_NHSNO', label: 'NHS Number', type: 'text', required: true, placeholder: '10-digit NHS number' },
    { key: 'PATIENT_GPODS', label: "Patient's GP ODS Code", type: 'text', required: true, placeholder: 'e.g. A12345' },
    { key: 'ASSESSMENT_DATE', label: 'Assessment Date', type: 'date', required: true },
    { key: 'CONSULTATION_METHOD', label: 'Consultation Method', type: 'select', required: true, options: CONSULTATION_METHODS },
    { key: 'PROFESSIONAL_ROLE', label: 'Professional Role', type: 'select', required: true, options: PROFESSIONAL_ROLES },
  ]
}

// ============================================================
// Service-specific fields
// ============================================================

function getCPCSFields(): FieldDef[] {
  return [
    { key: 'REFERRAL_DATE', label: 'Referral Date', type: 'date', required: false },
    { key: 'REFERRER_ORG_ODS', label: 'Referrer Organisation ODS', type: 'text', required: false, placeholder: 'NHS 111 / GP ODS' },
    { key: 'DISPOSITION_CODE', label: 'Disposition Code', type: 'text', required: false, placeholder: 'Dx code from NHS 111' },
    { key: 'CONSULTATION_OUTCOME', label: 'Consultation Outcome', type: 'select', required: true, options: CONSULTATION_OUTCOMES },
    { key: 'URGENCY_OF_REFERRAL', label: 'Urgency of Onward Referral', type: 'select', required: false, options: URGENCY_OPTIONS },
    { key: 'REFERRED_ODS', label: 'Referred-to ODS Code', type: 'text', required: false },
    { key: 'ONWARD_REFERRAL_REASON', label: 'Onward Referral Reason', type: 'textarea', required: false },
    { key: 'DATE_RECORDED', label: 'Date Recorded', type: 'date', required: true },
    { key: 'DRUG_CODE', label: 'Drug SNOMED/DM+D Code', type: 'text', required: false, placeholder: 'Optional — if medicine supplied' },
    { key: 'DRUG_DESC', label: 'Drug Description', type: 'text', required: false },
    { key: 'QUANTITY', label: 'Quantity Supplied', type: 'number', required: false },
  ]
}

function getPharmacyFirstFields(): FieldDef[] {
  return [
    { key: 'CCS_PRESENTING_COMPLAINT_OR_ISSUE', label: 'Presenting Complaint', type: 'select', required: true, options: CCS_COMPLAINTS.map((c) => c.value), helpText: 'The 7 Pharmacy First clinical pathways. Acute Otitis Media requires face-to-face consultation.' },
    { key: 'PROFESSIONAL_IDENTIFIER', label: 'GPhC / NMC Number', type: 'text', required: true, placeholder: 'e.g. 2012345' },
    { key: 'CONSULTATION_OUTCOME', label: 'Consultation Outcome', type: 'select', required: true, options: CONSULTATION_OUTCOMES },
    { key: 'CCS_NO_SUPPLY_REASON', label: 'No Supply Reason', type: 'select', required: false, options: CCS_NO_SUPPLY_REASONS.map((r) => r.value), helpText: 'Required if no medicine was supplied' },
    { key: 'DATE_RECORDED', label: 'Date Recorded', type: 'date', required: true },
    { key: 'DRUG_CODE', label: 'Drug SNOMED/DM+D Code', type: 'text', required: false },
    { key: 'DRUG_DESC', label: 'Drug Description', type: 'text', required: false },
    { key: 'QUANTITY', label: 'Quantity Supplied', type: 'number', required: false },
    { key: 'URGENCY_OF_REFERRAL', label: 'Urgency of Onward Referral', type: 'select', required: false, options: URGENCY_OPTIONS },
    { key: 'REFERRED_ODS', label: 'Referred-to ODS Code', type: 'text', required: false },
    { key: 'ONWARD_REFERRAL_REASON', label: 'Onward Referral Reason', type: 'textarea', required: false },
  ]
}

function getFluFields(): FieldDef[] {
  return [
    { key: 'DOSE_NUMBER', label: 'Dose Number', type: 'number', required: false, placeholder: 'e.g. 1' },
    { key: 'VACCINE_PRODUCT_CODE', label: 'Vaccine Product Code', type: 'text', required: false },
    { key: 'BATCH_NUMBER', label: 'Batch Number', type: 'text', required: true },
    { key: 'EXPIRY_DATE', label: 'Vaccine Expiry Date', type: 'date', required: true },
  ]
}

function getNMSFields(): FieldDef[] {
  return [
    { key: 'PRESCRIPTION_DATE', label: 'Prescription Date', type: 'date', required: true },
    { key: 'CONDITIONS', label: 'NMS-Eligible Conditions', type: 'text', required: true, placeholder: 'Comma-separated conditions' },
    { key: 'NMS_PRODUCT_CODE', label: 'Product Code', type: 'text', required: true, placeholder: 'DM+D or SNOMED code' },
    { key: 'NMS_PRODUCT_DESC', label: 'Product Description', type: 'text', required: true },
    { key: 'PATIENT_USING_MEDICINE', label: 'Patient Using Medicine?', type: 'boolean', required: true },
    { key: 'NOT_USING_REASON', label: 'Reason Not Using', type: 'textarea', required: false, condition: (d) => d.PATIENT_USING_MEDICINE === false },
    { key: 'CONSULTATION_OUTCOME', label: 'Consultation Outcome', type: 'select', required: true, options: CONSULTATION_OUTCOMES },
    { key: 'FOLLOW_UP_DATE', label: 'Follow-Up Date', type: 'date', required: false },
  ]
}

// ============================================================
// Build all fields for a given service type
// ============================================================

function getFieldsForServiceType(serviceType: NHSServiceType): FieldDef[] {
  const common = getCommonFields()
  switch (serviceType) {
    case 'cpcs_emg_med':
    case 'cpcs_min_ill':
    case 'cpcs_emg_uec':
    case 'cpcs_min_ill_uec':
      return [...common, ...getCPCSFields()]
    case 'cpcs_ccs':
      return [...common, ...getPharmacyFirstFields()]
    case 'flu_vac':
    case 'covid_vac':
    case 'gp_covid_vac':
      return [...common, ...getFluFields()]
    case 'nms':
      return [...common, ...getNMSFields()]
    default:
      return common
  }
}

// ============================================================
// Claim type code mapping
// ============================================================

const CLAIM_TYPE_CODES: Record<string, string> = {
  cpcs_emg_med: 'EMG_MED',
  cpcs_min_ill: 'MIN_ILL',
  cpcs_emg_uec: 'EMG_MED_UEC',
  cpcs_min_ill_uec: 'MIN_ILL_UEC',
  cpcs_ccs: 'CCS',
  flu_vac: 'FLU_VAC',
  covid_vac: 'COVID_VAC',
  gp_covid_vac: 'GP_COVID_VAC',
  nms: 'NMS',
  scs: 'SCS',
  contraception: 'CONTRACEPTION',
  cvd_hypertension: 'CVD',
}

// ============================================================
// Service labels
// ============================================================

const SERVICE_TYPE_LABELS: Record<string, string> = {
  cpcs_emg_med:     'CPCS — Emergency Medicine Supply',
  cpcs_min_ill:     'CPCS — Minor Illness',
  cpcs_emg_uec:     'CPCS — Emergency Medicine Supply (UEC)',
  cpcs_min_ill_uec: 'CPCS — Minor Illness (UEC)',
  cpcs_ccs:         'Pharmacy First',
  flu_vac:          'NHS Flu Vaccination',
  covid_vac:        'COVID-19 Vaccination',
  gp_covid_vac:     'COVID-19 Vaccination (GP Referral)',
  nms:              'New Medicines Service',
  scs:              'Smoking Cessation Service',
  cvd_hypertension: 'Hypertension Case-Finding',
  contraception:    'NHS Contraception Service',
}

// ============================================================
// Patient search helper
// ============================================================

interface PatientOption {
  id: string
  first_name: string
  last_name: string
  nhs_number: string | null
  dob: string | null
}

// ============================================================
// Main component
// ============================================================

export function NHSClaimFormPage() {
  const { serviceType: serviceTypeParam } = useParams<{ serviceType: string }>()
  const [searchParams] = useSearchParams()
  const serviceId = searchParams.get('serviceId')
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const { settings, fetchSettings, createClaim, submitting, error, clearError } = useNHSStore()

  const serviceType = serviceTypeParam as NHSServiceType
  const fields = useMemo(() => getFieldsForServiceType(serviceType), [serviceType])

  // ── Steps ─────────────────────────────────────────────
  const [step, setStep] = useState<'patient' | 'form' | 'review'>('patient')

  // ── Patient ───────────────────────────────────────────
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<PatientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null)
  const [skipPatient, setSkipPatient] = useState(false)

  // ── Form data ─────────────────────────────────────────
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [notes, setNotes] = useState('')

  // ── Result ────────────────────────────────────────────
  const [completed, setCompleted] = useState(false)
  const [resultClaimId, setResultClaimId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Fetch NHS settings
  useEffect(() => {
    if (organisation?.id) fetchSettings(organisation.id)
  }, [organisation?.id, fetchSettings])

  // Pre-populate from patient
  useEffect(() => {
    if (selectedPatient) {
      setFormData((prev) => ({
        ...prev,
        PATIENT_NHSNO: selectedPatient.nhs_number || prev.PATIENT_NHSNO || '',
      }))
    }
  }, [selectedPatient])

  // Pre-populate assessment date & date recorded to today
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    setFormData((prev) => ({
      ASSESSMENT_DATE: today,
      DATE_RECORDED: today,
      ...prev,
    }))
  }, [])

  // ── Patient search ────────────────────────────────────
  const searchPatients = useCallback(async (query: string) => {
    if (!organisation?.id || query.trim().length < 2) { setPatientResults([]); return }
    setSearching(true)
    try {
      const { data } = await getUserClient()
        .from('ps_patients')
        .select('id, first_name, last_name, nhs_number, dob')
        .eq('organisation_id', organisation.id)
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,nhs_number.ilike.%${query}%`)
        .limit(10)
      setPatientResults((data as PatientOption[]) || [])
    } catch { setPatientResults([]) }
    setSearching(false)
  }, [organisation?.id])

  useEffect(() => {
    const t = setTimeout(() => searchPatients(patientSearch), 300)
    return () => clearTimeout(t)
  }, [patientSearch, searchPatients])

  // ── Field helpers ─────────────────────────────────────
  const setField = (key: string, value: unknown) => setFormData((prev) => ({ ...prev, [key]: value }))

  const visibleFields = useMemo(() => {
    return fields.filter((f) => !f.condition || f.condition(formData))
  }, [fields, formData])

  const missingRequired = useMemo(() => {
    return visibleFields.filter((f) => f.required).filter((f) => {
      const v = formData[f.key]
      return v === undefined || v === null || v === ''
    })
  }, [visibleFields, formData])

  // ── Validation warnings ───────────────────────────────
  const warnings = useMemo(() => {
    const w: string[] = []
    if (!settings.odsCode) w.push('No ODS code configured — go to Settings → NHS to set it.')
    // Pharmacy First: AOM requires face-to-face
    if (serviceType === 'cpcs_ccs' && formData.CCS_PRESENTING_COMPLAINT_OR_ISSUE === 'A_O_M' && formData.CONSULTATION_METHOD !== 'FACE_TO_FACE') {
      w.push('Acute Otitis Media (AOM) requires a face-to-face consultation.')
    }
    // NHS number validation (basic: 10 digits)
    const nhs = formData.PATIENT_NHSNO as string
    if (nhs && !/^\d{10}$/.test(nhs)) {
      w.push('NHS number must be exactly 10 digits.')
    }
    return w
  }, [settings.odsCode, serviceType, formData])

  const canSubmit = (selectedPatient || skipPatient) && missingRequired.length === 0 && warnings.length === 0

  // ── Build payload ─────────────────────────────────────
  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      ...formData,
      CLAIMANT_ODS: settings.odsCode ?? '',
      CLAIM_TYPE_CODE: CLAIM_TYPE_CODES[serviceType] ?? serviceType.toUpperCase(),
    }

    // Auto-populate GPhC number for CCS if available
    if (serviceType === 'cpcs_ccs' && !payload.PROFESSIONAL_IDENTIFIER && activeUser?.gphc_number) {
      payload.PROFESSIONAL_IDENTIFIER = activeUser.gphc_number
    }

    // Ensure CLAIM_YEAR_MONTH from ASSESSMENT_DATE
    if (payload.ASSESSMENT_DATE) {
      const d = payload.ASSESSMENT_DATE as string
      payload.CLAIM_YEAR_MONTH = d.substring(0, 7) // yyyy-MM
    }

    // NMS: structure product array
    if (serviceType === 'nms' && payload.NMS_PRODUCT_CODE) {
      payload.NMS_PRODUCTS = [{
        PRODUCT_CODE: payload.NMS_PRODUCT_CODE,
        PRODUCT_DESC: payload.NMS_PRODUCT_DESC || '',
        PATIENT_USING_MEDICINE: payload.PATIENT_USING_MEDICINE ?? true,
        NOT_USING_MEDICINE_REASON: payload.NOT_USING_REASON ? [payload.NOT_USING_REASON] : undefined,
      }]
      // NMS conditions from comma-separated string
      if (typeof payload.CONDITIONS === 'string') {
        payload.CONDITIONS = (payload.CONDITIONS as string).split(',').map((s: string) => s.trim()).filter(Boolean)
      }
    }

    return payload
  }

  // ── Submit ────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!organisation?.id) return
    setSubmitError(null)
    try {
      const payload = buildPayload()
      const claimYearMonth = (payload.CLAIM_YEAR_MONTH as string) || new Date().toISOString().substring(0, 7)

      // First create a service delivery record
      const deliveryRow = {
        org_id: organisation.id,
        service_id: serviceId || null,
        patient_id: selectedPatient?.id || null,
        delivered_by: activeUser?.id || null,
        form_data: payload,
        notes,
        status: 'completed',
        completed_at: new Date().toISOString(),
      }
      const { data: delivery, error: delError } = await getUserClient()
        .from('ps_service_deliveries')
        .insert(deliveryRow)
        .select()
        .single()
      if (delError) throw delError

      // Then create the NHS claim submission
      const claim = await createClaim({
        orgId: organisation.id,
        serviceType,
        patientId: selectedPatient?.id,
        serviceDeliveryId: delivery?.id,
        payload,
        claimYearMonth,
        createdBy: activeUser?.id,
      })

      setResultClaimId(claim.id)
      setCompleted(true)
    } catch (e: any) {
      setSubmitError(e.message)
    }
  }

  // ── Completion screen ─────────────────────────────────
  if (completed) {
    return (
      <div>
        <div className="page-header"><h1>✅ NHS Claim Created</h1></div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: 'var(--ps-space-md)' }}>🏥</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>
            {SERVICE_TYPE_LABELS[serviceType] ?? serviceType} — Claim Saved
          </h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
            Your claim has been saved with status <strong>Pending</strong>. It will be submitted to NHSBSA once
            your pharmacy is accredited and connected.
          </p>
          {selectedPatient && (
            <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
              Patient: {selectedPatient.first_name} {selectedPatient.last_name}
              {selectedPatient.nhs_number && ` — NHS: ${selectedPatient.nhs_number}`}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'center' }}>
            {resultClaimId && (
              <button className="ps-btn ps-btn-primary" onClick={() => navigate(`/nhs/claims/${resultClaimId}`)}>
                View Claim
              </button>
            )}
            <button className="ps-btn ps-btn-secondary" onClick={() => {
              setStep('patient')
              setSelectedPatient(null)
              setSkipPatient(false)
              setFormData({})
              setNotes('')
              setCompleted(false)
              setResultClaimId(null)
            }}>
              + Another Claim
            </button>
            <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/nhs')}>
              Back to NHS Hub
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/nhs" onClick={(e) => { e.preventDefault(); navigate('/nhs') }}>NHS Services</a>
          <span className="separator">/</span>
          <span>New Claim</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>🏥 {SERVICE_TYPE_LABELS[serviceType] ?? serviceType}</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/nhs')}>← Cancel</button>
        </div>
      </div>

      {/* Errors */}
      {(error || submitError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error || submitError}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { clearError(); setSubmitError(null) }} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Step indicators */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
        {(['patient', 'form', 'review'] as const).map((s, i) => {
          const isComplete = s === 'patient' && (selectedPatient || skipPatient)
            || s === 'form' && step === 'review'
          return (
            <div
              key={s}
              style={{
                flex: 1, padding: 'var(--ps-space-sm) var(--ps-space-md)', borderRadius: 'var(--ps-radius-md)',
                background: step === s ? 'var(--ps-deep-blue)' : isComplete ? 'var(--ps-success)' : 'var(--ps-off-white)',
                color: step === s || isComplete ? 'var(--ps-white)' : 'var(--ps-slate)',
                textAlign: 'center', fontSize: 'var(--ps-font-sm)', fontWeight: 600, cursor: 'pointer',
              }}
              onClick={() => {
                if (s === 'patient') setStep('patient')
                if (s === 'form' && (selectedPatient || skipPatient)) setStep('form')
                if (s === 'review' && (selectedPatient || skipPatient)) setStep('review')
              }}
            >
              {i + 1}. {s === 'patient' ? 'Patient' : s === 'form' ? 'Clinical Form' : 'Review & Save'}
            </div>
          )
        })}
      </div>

      {/* ===== STEP 1: Patient ===== */}
      {step === 'patient' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            👤 Select Patient
          </h2>

          <div className="form-group">
            <label>Search by name or NHS number</label>
            <input
              className="ps-input"
              placeholder="Start typing…"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              autoFocus
            />
          </div>

          {searching && <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Searching…</p>}

          {patientResults.length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-md)' }}>
              {patientResults.map((p) => (
                <div
                  key={p.id}
                  onClick={() => { setSelectedPatient(p); setSkipPatient(false); setPatientSearch(''); setPatientResults([]) }}
                  style={{
                    padding: 'var(--ps-space-sm) var(--ps-space-md)', borderBottom: '1px solid var(--ps-off-white)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  <div>
                    <strong>{p.first_name} {p.last_name}</strong>
                    {p.nhs_number && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>NHS: {p.nhs_number}</span>}
                  </div>
                  {p.dob && <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>DOB: {p.dob}</span>}
                </div>
              ))}
            </div>
          )}

          {selectedPatient && (
            <div style={{
              padding: 'var(--ps-space-md)', background: 'rgba(4,176,255,0.06)', borderRadius: 'var(--ps-radius-md)',
              border: '1px solid var(--ps-electric-cyan)', marginBottom: 'var(--ps-space-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <strong>✓ {selectedPatient.first_name} {selectedPatient.last_name}</strong>
                {selectedPatient.nhs_number && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>NHS: {selectedPatient.nhs_number}</span>}
                {selectedPatient.dob && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>DOB: {selectedPatient.dob}</span>}
              </div>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setSelectedPatient(null)}>Change</button>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)', marginTop: 'var(--ps-space-md)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
              <input type="checkbox" checked={skipPatient} onChange={(e) => { setSkipPatient(e.target.checked); if (e.target.checked) setSelectedPatient(null) }} />
              Continue without a patient record (walk-in)
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-primary" disabled={!selectedPatient && !skipPatient} onClick={() => setStep('form')}>
              Next: Clinical Form →
            </button>
          </div>
        </div>
      )}

      {/* ===== STEP 2: Clinical Form ===== */}
      {step === 'form' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-lg)' }}>
            📝 {SERVICE_TYPE_LABELS[serviceType] ?? 'Clinical Form'}
          </h2>

          {/* Claim month info */}
          <div style={{
            padding: 'var(--ps-space-sm) var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)',
            background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-sm)', fontSize: '0.85rem', color: 'var(--ps-slate)',
          }}>
            🏥 ODS: <strong>{settings.odsCode || '—'}</strong> &nbsp;|&nbsp; 
            Environment: <strong>{settings.bsaEnvironment}</strong> &nbsp;|&nbsp;
            Claim Type: <strong>{CLAIM_TYPE_CODES[serviceType] ?? serviceType}</strong>
          </div>

          {visibleFields.map((field) => (
            <ClaimField
              key={field.key}
              field={field}
              value={formData[field.key]}
              onChange={(val) => setField(field.key, val)}
            />
          ))}

          {/* Notes */}
          <div className="form-group" style={{ marginTop: 'var(--ps-space-lg)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
            <label>Notes (optional)</label>
            <textarea className="ps-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional clinical notes…" rows={3} />
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-md)' }}>
              {warnings.map((w, i) => (
                <div key={i} style={{ fontSize: '0.85rem', color: 'var(--ps-error)', padding: 'var(--ps-space-xs) 0' }}>
                  ⚠️ {w}
                </div>
              ))}
            </div>
          )}

          {missingRequired.length > 0 && (
            <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-error)', marginBottom: 'var(--ps-space-md)' }}>
              Missing required: {missingRequired.map((f) => f.label).join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('patient')}>← Back</button>
            <button className="ps-btn ps-btn-primary" onClick={() => setStep('review')}>Next: Review →</button>
          </div>
        </div>
      )}

      {/* ===== STEP 3: Review & Save ===== */}
      {step === 'review' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-lg)' }}>
            ✅ Review & Save Claim
          </h2>

          {/* Summary grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-lg)' }}>
            <strong>Service:</strong><span>{SERVICE_TYPE_LABELS[serviceType]}</span>
            <strong>Claim Type:</strong><span><code>{CLAIM_TYPE_CODES[serviceType]}</code></span>
            <strong>Patient:</strong><span>{selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Walk-in'}</span>
            <strong>ODS Code:</strong><span>{settings.odsCode || '—'}</span>
            <strong>Staff:</strong><span>{activeUser?.full_name || activeUser?.email || '—'}</span>
            <strong>Environment:</strong><span>{settings.bsaEnvironment}</span>
          </div>

          {/* Form data review */}
          <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
            <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Clinical Data</h3>
            <div style={{ background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-md)' }}>
              {visibleFields.map((field) => {
                const val = formData[field.key]
                if (val === undefined || val === null || val === '') return null
                return (
                  <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--ps-space-xs) 0', borderBottom: '1px solid var(--ps-white)' }}>
                    <span style={{ fontWeight: 500 }}>{field.label}</span>
                    <span style={{ color: 'var(--ps-slate)' }}>
                      {field.key === 'CCS_PRESENTING_COMPLAINT_OR_ISSUE'
                        ? CCS_COMPLAINTS.find((c) => c.value === val)?.label ?? String(val)
                        : field.key === 'CCS_NO_SUPPLY_REASON'
                        ? CCS_NO_SUPPLY_REASONS.find((r) => r.value === val)?.label ?? String(val)
                        : typeof val === 'boolean' ? (val ? 'Yes' : 'No')
                        : String(val)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {notes && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, marginBottom: 'var(--ps-space-xs)' }}>Notes</h3>
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>{notes}</p>
            </div>
          )}

          {/* Submission note */}
          <div style={{
            padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)',
            background: '#eff6ff', borderRadius: 'var(--ps-radius-md)', border: '1px solid #93c5fd',
          }}>
            <strong style={{ color: '#1d4ed8' }}>ℹ️ Note:</strong>{' '}
            <span style={{ color: '#1e40af', fontSize: '0.9rem' }}>
              This claim will be saved with status <strong>Pending</strong>. Actual submission to NHSBSA will occur
              once your pharmacy is accredited and the connection is live. The clinical data is securely stored and
              ready for submission.
            </span>
          </div>

          {warnings.length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-md)' }}>
              {warnings.map((w, i) => (
                <div key={i} style={{ fontSize: '0.85rem', color: 'var(--ps-error)', padding: 'var(--ps-space-xs) 0' }}>⚠️ {w}</div>
              ))}
            </div>
          )}

          {missingRequired.length > 0 && (
            <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-error)', marginBottom: 'var(--ps-space-md)', padding: 'var(--ps-space-sm) var(--ps-space-md)', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--ps-radius-md)' }}>
              ⚠️ Missing required: {missingRequired.map((f) => f.label).join(', ')} — go back to fill them in.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('form')}>← Back to Form</button>
            <button
              className="ps-btn ps-btn-success"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              style={{ fontSize: 'var(--ps-font-md)', padding: 'var(--ps-space-sm) var(--ps-space-xl)' }}
            >
              {submitting ? 'Saving…' : '✓ Save NHS Claim'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Reusable claim field component
// ============================================================

function ClaimField({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  // Map CCS complaint codes to human labels for the select
  const getOptionLabel = (key: string, opt: string): string => {
    if (key === 'CCS_PRESENTING_COMPLAINT_OR_ISSUE') {
      return CCS_COMPLAINTS.find((c) => c.value === opt)?.label ?? opt
    }
    if (key === 'CCS_NO_SUPPLY_REASON') {
      return CCS_NO_SUPPLY_REASONS.find((r) => r.value === opt)?.label ?? opt
    }
    return opt.replace(/_/g, ' ')
  }

  return (
    <div className="form-group">
      <label>
        {field.label}
        {field.required && <span style={{ color: 'var(--ps-error)', marginLeft: 4 }}>*</span>}
      </label>

      {field.helpText && (
        <p style={{ margin: '0 0 var(--ps-space-xs)', fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
          {field.helpText}
        </p>
      )}

      {field.type === 'text' && (
        <input
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? field.label}
        />
      )}

      {field.type === 'date' && (
        <input
          className="ps-input"
          type="date"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === 'number' && (
        <input
          className="ps-input"
          type="number"
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
          placeholder={field.placeholder ?? field.label}
        />
      )}

      {field.type === 'select' && field.options && (
        <select
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{getOptionLabel(field.key, opt)}</option>
          ))}
        </select>
      )}

      {field.type === 'boolean' && (
        <div style={{ display: 'flex', gap: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="radio" name={field.key} checked={value === true} onChange={() => onChange(true)} /> Yes
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="radio" name={field.key} checked={value === false} onChange={() => onChange(false)} /> No
          </label>
        </div>
      )}

      {field.type === 'textarea' && (
        <textarea
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? field.label}
          rows={3}
        />
      )}
    </div>
  )
}
