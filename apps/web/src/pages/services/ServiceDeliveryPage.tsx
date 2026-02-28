import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useServiceStore, useNHSStore, useOutcomeStore } from '@pharmstation/core'
import type { GPSearchResult } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Patient, ServiceForm, ServiceFormField } from '@pharmstation/types'
import { MedicationPrescriber, createEmptyMedication, type PrescribedMedication } from '../../components/outcomes/MedicationPrescriber'

/* ---- Human-readable labels for NHS field option codes ---- */
const NHS_OPTION_LABELS: Record<string, string> = {
  // Consultation methods
  FACE_TO_FACE: 'Face to Face',
  TELEPHONE: 'Telephone',
  VIDEO: 'Video',
  // Professional roles
  PHARMACIST: 'Pharmacist',
  PHARMACY_TECHNICIAN: 'Pharmacy Technician',
  ACCREDITED_CHECKING_TECHNICIAN: 'Accredited Checking Technician',
  // CCS / Pharmacy First — Clinical Pathways presenting complaints
  A_O_M: 'Acute Otitis Media (Ear Infection)',
  SHG: 'Shingles',
  I_I_B: 'Infected Insect Bite',
  SNT: 'Sinusitis',
  ITG: 'Impetigo',
  U_UTI: 'Uncomplicated UTI',
  A_S_T: 'Acute Sore Throat',
  // CCS no-supply reasons
  A: 'A – Referred to GP',
  B: 'B – Referred to A&E / 999',
  C: 'C – Patient declined treatment',
  D: 'D – Medicine not available',
  E: 'E – Not appropriate to supply',
  F: 'F – Other',
  // Outcomes
  ADVICE_ONLY: 'Advice Only',
  MEDICINE_SUPPLIED: 'Medicine Supplied',
  REFERRAL_TO_GP: 'Referral to GP',
  REFERRAL_TO_ED: 'Referral to A&E',
  OTHER: 'Other',
  // Referral sources
  NHS_111: 'NHS 111',
  GP: 'GP',
  WALK_IN: 'Walk-in',
  '999': '999',
  A_AND_E: 'A&E',
  // Injection sites
  LEFT_DELTOID: 'Left Deltoid',
  RIGHT_DELTOID: 'Right Deltoid',
  LEFT_THIGH: 'Left Thigh',
  RIGHT_THIGH: 'Right Thigh',
  // Eligibility groups
  OVER_65: 'Over 65',
  CLINICAL_RISK: 'Clinical Risk Group',
  IMMUNOSUPPRESSED: 'Immunosuppressed',
  HEALTHCARE_WORKER: 'Healthcare Worker',
  SOCIAL_CARE: 'Social Care Worker',
  CARER: 'Carer',
  PREGNANT: 'Pregnant',
  // COVID dose numbers
  '1': '1st Dose',
  '2': '2nd Dose',
  BOOSTER: 'Booster',
  SEASONAL: 'Seasonal',
  // Smoking cessation
  QUIT: 'Quit',
  NOT_QUIT: 'Not Quit',
  LOST_TO_FOLLOW_UP: 'Lost to Follow-up',
  // Contraception service types
  INITIATION: 'Initiation',
  ONGOING_MONITORING: 'Ongoing Monitoring',
  EMERGENCY: 'Emergency',
}

/** Returns a human-readable label for an option code, falling back to title-case of the code itself */
function optionLabel(code: string): string {
  return NHS_OPTION_LABELS[code] ?? code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ---- Patient search helpers ---- */

interface PatientOption {
  id: string
  first_name: string
  last_name: string
  nhs_number: string | null
  dob: string | null
  phone: string | null
}

export function ServiceDeliveryPage() {
  const { serviceId } = useParams<{ serviceId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const {
    activeService,
    activeForms,
    error,
    fetchServiceDetail,
    fetchFormFields,
    activeFields,
    createDelivery,
    clearError,
  } = useServiceStore()

  /* ---- Steps: patient → form → review ---- */
  const [step, setStep] = useState<'patient' | 'form' | 'review'>('patient')

  /* ---- Patient state ---- */
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<PatientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null)
  const [skipPatient, setSkipPatient] = useState(false)

  /* ---- PDS lookup state (for NHS services) ---- */
  const [nhsNumberInput, setNhsNumberInput] = useState('')
  const [pdsLoading, setPdsLoading] = useState(false)
  const [pdsError, setPdsError] = useState<string | null>(null)
  const [pdsResult, setPdsResult] = useState<any>(null)
  const { lookupPDS, searchGP, lookupGPByOds } = useNHSStore()

  /* ---- GP search state ---- */
  const [gpSearchQuery, setGpSearchQuery] = useState('')
  const [gpResults, setGpResults] = useState<GPSearchResult[]>([])
  const [gpSearching, setGpSearching] = useState(false)
  const [gpSearched, setGpSearched] = useState(false)
  const [selectedGP, setSelectedGP] = useState<GPSearchResult | null>(null)
  const gpDropdownRef = useRef<HTMLDivElement>(null)

  const isNhsService = activeService?.is_nhs_service === true

  /* ---- Form state ---- */
  const [selectedForm, setSelectedForm] = useState<ServiceForm | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [notes, setNotes] = useState('')

  /* ---- Medications state (shown when form outcome = MEDICINE_SUPPLIED) ---- */
  const [medications, setMedications] = useState<PrescribedMedication[]>([])
  const [showMedModal, setShowMedModal] = useState(false)
  const { saveOutcome } = useOutcomeStore()

  /* ---- Submission ---- */
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  // Load service detail
  const load = useCallback(() => {
    if (serviceId) fetchServiceDetail(serviceId)
  }, [serviceId, fetchServiceDetail])

  useEffect(() => { load() }, [load])

  // Auto-select default form when forms load
  useEffect(() => {
    if (activeForms.length > 0 && !selectedForm) {
      const defaultForm = activeForms.find((f) => f.is_default) || activeForms[0]
      setSelectedForm(defaultForm)
    }
  }, [activeForms, selectedForm])

  // Load fields when form is selected
  useEffect(() => {
    if (selectedForm) {
      fetchFormFields(selectedForm.id)
    }
  }, [selectedForm, fetchFormFields])

  /* ---- Patient search ---- */
  const searchPatients = useCallback(async (query: string) => {
    if (!organisation?.id || query.trim().length < 2) {
      setPatientResults([])
      return
    }
    setSearching(true)
    try {
      const { data } = await getUserClient()
        .from('ps_patients')
        .select('id, first_name, last_name, nhs_number, dob, phone')
        .eq('organisation_id', organisation.id)
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,nhs_number.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10)
      setPatientResults((data as PatientOption[]) || [])
    } catch {
      setPatientResults([])
    }
    setSearching(false)
  }, [organisation?.id])

  useEffect(() => {
    const timer = setTimeout(() => searchPatients(patientSearch), 300)
    return () => clearTimeout(timer)
  }, [patientSearch, searchPatients])

  /* ---- Auto-populate form fields from PDS/patient/user ---- */
  const autoPopulateFields = useCallback((opts: {
    nhsNumber?: string | null
    gpOdsCode?: string | null
    gpName?: string | null
  }) => {
    setFormData((prev) => {
      const next = { ...prev }
      // Patient NHS number
      if (opts.nhsNumber) next['PATIENT_NHSNO'] = opts.nhsNumber
      // GP ODS code from PDS or manual
      if (opts.gpOdsCode) next['GP_ODS_CODE'] = opts.gpOdsCode
      // GPhC number from the logged-in pharmacist's profile
      if (activeUser?.gphc_number) {
        next['GPHC_NUMBER'] = activeUser.gphc_number
        next['PROFESSIONAL_IDENTIFIER'] = activeUser.gphc_number
      }
      // Professional role defaults to PHARMACIST
      if (!next['PROFESSIONAL_ROLE']) next['PROFESSIONAL_ROLE'] = 'PHARMACIST'
      // Assessment date defaults to today
      if (!next['ASSESSMENT_DATE']) next['ASSESSMENT_DATE'] = new Date().toISOString().split('T')[0]
      return next
    })
    // If GP ODS came from PDS, look up the name for display
    if (opts.gpOdsCode && !opts.gpName) {
      lookupGPByOds(opts.gpOdsCode).then((gp) => {
        if (gp) setSelectedGP(gp)
      })
    }
    if (opts.gpOdsCode && opts.gpName) {
      setSelectedGP({ odsCode: opts.gpOdsCode, name: opts.gpName, address: '', city: '', postcode: '', status: 'active' })
    }
  }, [activeUser, lookupGPByOds])

  /* ---- PDS NHS Number Lookup ---- */
  const handlePDSLookup = useCallback(async () => {
    const cleaned = nhsNumberInput.replace(/\s/g, '')
    if (cleaned.length !== 10 || !/^\d{10}$/.test(cleaned)) {
      setPdsError('NHS number must be exactly 10 digits')
      return
    }
    if (!organisation?.id) {
      setPdsError('No organisation context')
      return
    }
    setPdsLoading(true)
    setPdsError(null)
    setPdsResult(null)
    try {
      const result = await lookupPDS(organisation.id, cleaned)
      if (result) {
        setPdsResult(result)
        // Auto-fill as selected patient
        setSelectedPatient({
          id: '', // PDS-only, no local record yet
          first_name: result.givenNames?.[0] || '',
          last_name: result.familyName || '',
          nhs_number: result.nhsNumber || cleaned,
          dob: result.dateOfBirth || null,
          phone: null,
        })
        setSkipPatient(false)
        // Auto-populate form fields from PDS result
        autoPopulateFields({
          nhsNumber: result.nhsNumber || cleaned,
          gpOdsCode: result.gpPracticeOdsCode || null,
        })
      } else {
        setPdsError('No patient found for this NHS number')
      }
    } catch (e: any) {
      setPdsError(e.message || 'PDS lookup failed')
    }
    setPdsLoading(false)
  }, [nhsNumberInput, lookupPDS, organisation?.id, autoPopulateFields])

  /* ---- Form data handling ---- */
  const setFieldValue = (fieldKey: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldKey]: value }))
  }

  /* ---- GP search debounce ---- */
  useEffect(() => {
    if (gpSearchQuery.trim().length < 2) {
      setGpResults([])
      setGpSearched(false)
      return
    }
    const timer = setTimeout(async () => {
      setGpSearching(true)
      const results = await searchGP(gpSearchQuery.trim())
      setGpResults(results)
      setGpSearching(false)
      setGpSearched(true)
    }, 400)
    return () => clearTimeout(timer)
  }, [gpSearchQuery, searchGP])

  /* ---- Close GP dropdown on outside click ---- */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gpDropdownRef.current && !gpDropdownRef.current.contains(e.target as Node)) {
        setGpResults([])
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /* ---- Validation ---- */
  const requiredFieldsMissing = useMemo(() => {
    return activeFields
      .filter((f) => f.is_required)
      .filter((f) => {
        const val = formData[f.field_key]
        return val === undefined || val === null || val === ''
      })
  }, [activeFields, formData])

  /* ---- Derive whether medicine was supplied from form data ---- */
  const medicineSupplied =
    formData.OUTCOME === 'MEDICINE_SUPPLIED' || formData.MEDICINE_SUPPLIED === true

  const canSubmit = (selectedPatient || skipPatient) && requiredFieldsMissing.length === 0

  /* ---- Submit ---- */
  const handleSubmit = async () => {
    if (!organisation?.id || !serviceId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const delivery = await createDelivery({
        org_id: organisation.id,
        service_id: serviceId,
        patient_id: selectedPatient?.id || undefined,
        form_id: selectedForm?.id || undefined,
        form_data: formData,
        delivered_by: activeUser?.id || undefined,
        notes,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })

      // Derive outcome_type from form data OUTCOME field
      const outcomeField = formData.OUTCOME as string | undefined
      let outcomeType: 'prescription' | 'referral' | 'advice' | 'no_treatment' = 'advice'
      if (outcomeField === 'MEDICINE_SUPPLIED' || formData.MEDICINE_SUPPLIED === true) {
        outcomeType = 'prescription'
      } else if (outcomeField === 'REFERRAL_TO_GP' || outcomeField === 'REFERRAL_TO_ED') {
        outcomeType = 'referral'
      } else if (outcomeField === 'ADVICE_ONLY') {
        outcomeType = 'advice'
      } else if (outcomeField === 'OTHER') {
        outcomeType = 'advice'
      }

      // Save delivery outcome with medications if any
      const filteredMeds = medications.filter((m) => m.drug_name.trim())
      await saveOutcome({
        delivery_id: delivery.id,
        org_id: organisation.id,
        outcome_type: outcomeType,
        created_by: activeUser?.id || null,
        medications: filteredMeds.length > 0
          ? filteredMeds.map((m, i) => ({
              drug_id: m.drug?.id || null,
              drug_name: m.drug_name,
              drug_form: m.drug_form,
              drug_strength: m.drug_strength,
              dose: m.dose || null,
              quantity: m.quantity,
              unit: m.unit || null,
              is_controlled_drug: m.is_controlled_drug,
              sort_order: i,
            }))
          : undefined,
      })

      setCompleted(true)
    } catch (e: any) {
      setSubmitError(e.message)
    }
    setSubmitting(false)
  }

  /* ---- Completion screen ---- */
  if (completed) {
    return (
      <div>
        <div className="page-header">
          <h1>✅ Service Delivered</h1>
        </div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: 'var(--ps-space-md)' }}>🎉</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>
            {activeService?.name} — Complete
          </h2>
          {selectedPatient && (
            <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
              Patient: {selectedPatient.first_name} {selectedPatient.last_name}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'center' }}>
            <button className="ps-btn ps-btn-primary" onClick={() => {
              // Reset for another delivery of the same service
              setStep('patient')
              setSelectedPatient(null)
              setSkipPatient(false)
              setFormData({})
              setNotes('')
              setCompleted(false)
              setPatientSearch('')
              setPdsResult(null)
              setNhsNumberInput('')
              setSelectedGP(null)
              setGpSearchQuery('')
              setMedications([])
            }}>
              Deliver Again
            </button>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services')}>
              Back to Services
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <a href={`/services/${serviceId}`} onClick={(e) => { e.preventDefault(); navigate(`/services/${serviceId}`) }}>{activeService?.name || 'Service'}</a>
          <span className="separator">/</span>
          <span>Deliver</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>🩺 Deliver: {activeService?.name || 'Loading…'}</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate(-1 as any)}>
            ← Cancel
          </button>
        </div>
      </div>

      {(error || submitError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error || submitError}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { clearError(); setSubmitError(null) }} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Step indicators */}
      <div style={{
        display: 'flex',
        gap: 'var(--ps-space-md)',
        marginBottom: 'var(--ps-space-lg)',
      }}>
        {(['patient', 'form', 'review'] as const).map((s, i) => {
          const stepOrder = ['patient', 'form', 'review'] as const
          const currentIdx = stepOrder.indexOf(step)
          const sIdx = stepOrder.indexOf(s)
          const isActive = step === s
          const isCompleted = sIdx < currentIdx
          return (
            <div
              key={s}
              style={{
                flex: 1,
                padding: 'var(--ps-space-sm) var(--ps-space-md)',
                borderRadius: 'var(--ps-radius-md)',
                background: isActive ? 'var(--ps-deep-blue)' : isCompleted ? 'var(--ps-success)' : 'var(--ps-off-white)',
                color: isActive || isCompleted ? 'var(--ps-white)' : 'var(--ps-slate)',
                textAlign: 'center',
                fontSize: 'var(--ps-font-sm)',
                fontWeight: 600,
                cursor: isCompleted || isActive ? 'pointer' : 'default',
                transition: 'all var(--ps-transition-fast)',
              }}
              onClick={() => {
                if (s === 'patient') setStep('patient')
                if (s === 'form' && (selectedPatient || skipPatient)) setStep('form')
                if (s === 'review' && (selectedPatient || skipPatient)) setStep('review')
              }}
            >
              {i + 1}. {s === 'patient' ? 'Patient' : s === 'form' ? 'Fill Form' : 'Review & Complete'}
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
            <label>Search by name, NHS number, or phone</label>
            <input
              className="ps-input"
              placeholder="Start typing…"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              autoFocus
            />
          </div>

          {/* Search results */}
          {searching && <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Searching…</p>}

          {patientResults.length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-md)' }}>
              {patientResults.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    setSelectedPatient(p)
                    setSkipPatient(false)
                    setPatientSearch('')
                    setPatientResults([])
                    // Auto-populate form fields from local patient
                    if (isNhsService) {
                      autoPopulateFields({ nhsNumber: p.nhs_number })
                    }
                  }}
                  style={{
                    padding: 'var(--ps-space-sm) var(--ps-space-md)',
                    borderBottom: '1px solid var(--ps-off-white)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'background var(--ps-transition-fast)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  <div>
                    <strong>{p.first_name} {p.last_name}</strong>
                    {p.nhs_number && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>NHS: {p.nhs_number}</span>}
                  </div>
                  {p.phone && <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>{p.phone}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Selected patient */}
          {selectedPatient && (
            <div style={{
              padding: 'var(--ps-space-md)',
              background: 'rgba(4,176,255,0.06)',
              borderRadius: 'var(--ps-radius-md)',
              border: '1px solid var(--ps-electric-cyan)',
              marginBottom: 'var(--ps-space-md)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <strong>✓ {selectedPatient.first_name} {selectedPatient.last_name}</strong>
                  {selectedPatient.nhs_number && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>NHS: {selectedPatient.nhs_number}</span>}
                  {selectedPatient.dob && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>DOB: {selectedPatient.dob}</span>}
                </div>
                <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { setSelectedPatient(null); setPdsResult(null); setSelectedGP(null) }}>Change</button>
              </div>
              {/* PDS result details */}
              {pdsResult && (
                <div style={{ marginTop: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', display: 'flex', flexWrap: 'wrap', gap: 'var(--ps-space-md)' }}>
                  {pdsResult.gender && <span>Gender: {pdsResult.gender}</span>}
                  {pdsResult.address?.postalCode && <span>Postcode: {pdsResult.address.postalCode}</span>}
                  {pdsResult.gpPracticeOdsCode && (
                    <span>
                      GP: {selectedGP ? `${selectedGP.name} (${pdsResult.gpPracticeOdsCode})` : pdsResult.gpPracticeOdsCode}
                    </span>
                  )}
                  <span style={{ color: 'var(--ps-success)' }}>✓ Verified via PDS</span>
                </div>
              )}
            </div>
          )}

          {/* PDS NHS Number Lookup — only shown for NHS services */}
          {isNhsService && !selectedPatient && (
            <div style={{
              padding: 'var(--ps-space-md)',
              background: '#f0f4ff',
              borderRadius: 'var(--ps-radius-md)',
              border: '1px solid #005eb8',
              marginBottom: 'var(--ps-space-md)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-sm)' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 99,
                  fontSize: '0.7rem', fontWeight: 700, background: '#005eb8', color: '#fff',
                }}>
                  NHS
                </span>
                <strong style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-midnight)' }}>
                  PDS Patient Lookup
                </strong>
              </div>
              <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-sm)' }}>
                Look up patient details from the NHS Personal Demographics Service using their NHS number. Required for NHS claim submissions.
              </p>
              {/* Sandbox test NHS numbers */}
              <details style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-sm)' }}>
                <summary style={{ cursor: 'pointer', color: '#005eb8', fontWeight: 500 }}>🧪 Sandbox test NHS numbers</summary>
                <div style={{ marginTop: 'var(--ps-space-xs)', display: 'flex', flexWrap: 'wrap', gap: 'var(--ps-space-xs)' }}>
                  {[
                    { nhs: '9000000009', label: 'Standard patient' },
                    { nhs: '9000000025', label: 'Restricted / sensitive' },
                    { nhs: '9000000033', label: 'Minimal data' },
                  ].map((t) => (
                    <button
                      key={t.nhs}
                      className="ps-btn ps-btn-ghost ps-btn-sm"
                      style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid #005eb8', borderRadius: 4 }}
                      onClick={() => { setNhsNumberInput(t.nhs); setPdsError(null) }}
                      title={t.label}
                    >
                      {t.nhs} <span style={{ color: 'var(--ps-slate)', fontWeight: 400 }}>({t.label})</span>
                    </button>
                  ))}
                </div>
              </details>
              <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'flex-start' }}>
                <input
                  className="ps-input"
                  placeholder="Enter 10-digit NHS number…"
                  value={nhsNumberInput}
                  onChange={(e) => {
                    setNhsNumberInput(e.target.value.replace(/[^\d\s]/g, ''))
                    setPdsError(null)
                  }}
                  maxLength={12}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePDSLookup() }}
                />
                <button
                  className="ps-btn ps-btn-primary ps-btn-sm"
                  onClick={handlePDSLookup}
                  disabled={pdsLoading || nhsNumberInput.replace(/\s/g, '').length < 10}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {pdsLoading ? 'Looking up…' : '🔍 PDS Lookup'}
                </button>
              </div>
              {pdsError && (
                <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-error)', marginTop: 'var(--ps-space-xs)' }}>
                  ⚠️ {pdsError}
                </div>
              )}
            </div>
          )}

          {/* Skip patient option — hidden for NHS services */}
          {!isNhsService && (
          <div style={{ borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)', marginTop: 'var(--ps-space-md)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
              <input
                type="checkbox"
                checked={skipPatient}
                onChange={(e) => {
                  setSkipPatient(e.target.checked)
                  if (e.target.checked) setSelectedPatient(null)
                }}
              />
              Continue without a patient record (walk-in / anonymous)
            </label>
          </div>
          )}
          {isNhsService && !selectedPatient && (
            <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-warning)', marginTop: 'var(--ps-space-sm)' }}>
              ⚠️ A patient with an NHS number is required for NHS service claims.
            </div>
          )}

          {/* Next button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--ps-space-lg)' }}>
            <button
              className="ps-btn ps-btn-primary"
              disabled={!selectedPatient && !skipPatient}
              onClick={() => setStep('form')}
            >
              Next: Fill Form →
            </button>
          </div>
        </div>
      )}

      {/* ===== STEP 2: Fill Form ===== */}
      {step === 'form' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-lg)' }}>
            <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
              📝 {selectedForm?.name || 'Service Form'}
            </h2>
            {activeForms.length > 1 && (
              <select
                className="ps-input"
                style={{ width: 'auto' }}
                value={selectedForm?.id || ''}
                onChange={(e) => {
                  const f = activeForms.find((fm) => fm.id === e.target.value)
                  if (f) {
                    setSelectedForm(f)
                    setFormData({})
                  }
                }}
              >
                {activeForms.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
          </div>

          {activeFields.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--ps-space-xl)', color: 'var(--ps-slate)' }}>
              <p>No form fields defined for this service. You can continue without filling in fields, or go to the Form Builder to add them.</p>
            </div>
          ) : (
            <div>
              {/* Auto-populated fields banner */}
              {isNhsService && (selectedPatient || pdsResult) && (
                <div style={{
                  padding: 'var(--ps-space-sm) var(--ps-space-md)',
                  background: 'rgba(4,176,255,0.06)',
                  border: '1px solid var(--ps-electric-cyan)',
                  borderRadius: 'var(--ps-radius-md)',
                  marginBottom: 'var(--ps-space-md)',
                  fontSize: 'var(--ps-font-xs)',
                  color: 'var(--ps-slate)',
                }}>
                  ℹ️ Some fields have been auto-populated from the PDS lookup and your profile. You can still edit them if needed.
                </div>
              )}

              {activeFields.map((field) => {
                // GP ODS Code — render searchable dropdown instead of text input
                if (field.field_key === 'GP_ODS_CODE') {
                  return (
                    <div key={field.id} className="form-group" ref={gpDropdownRef} style={{ position: 'relative' }}>
                      <label>
                        {field.label}
                        {field.is_required && <span style={{ color: 'var(--ps-error)', marginLeft: 4 }}>*</span>}
                      </label>

                      {selectedGP ? (
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: 'var(--ps-space-sm) var(--ps-space-md)',
                          background: 'rgba(4,176,255,0.06)', border: '1px solid var(--ps-electric-cyan)',
                          borderRadius: 'var(--ps-radius-md)',
                        }}>
                          <div>
                            <strong>{selectedGP.name}</strong>
                            <span style={{ marginLeft: 8, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>
                              ODS: {selectedGP.odsCode}
                            </span>
                            {selectedGP.postcode && (
                              <span style={{ marginLeft: 8, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>
                                ({selectedGP.postcode})
                              </span>
                            )}
                          </div>
                          <button
                            className="ps-btn ps-btn-ghost ps-btn-sm"
                            onClick={() => {
                              setSelectedGP(null)
                              setFieldValue('GP_ODS_CODE', '')
                              setGpSearchQuery('')
                            }}
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <div style={{ position: 'relative' }}>
                          <input
                            className="ps-input"
                            placeholder="Search GP name, postcode, or ODS code…"
                            value={gpSearchQuery}
                            onChange={(e) => setGpSearchQuery(e.target.value)}
                          />
                          {gpSearching && (
                            <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
                              Searching…
                            </div>
                          )}
                          {/* Helpful hint when input is empty */}
                          {!gpSearchQuery && (
                            <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-mist)', marginTop: 4 }}>
                              Try: "Mayfield", "Mayfield WV1", "Mayf Wolverhampton", or ODS code "M92040"
                            </div>
                          )}
                          {/* No results message */}
                          {gpSearchQuery.trim().length >= 2 && !gpSearching && gpSearched && gpResults.length === 0 && (
                            <div style={{
                              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                              background: 'white', border: '1px solid var(--ps-cloud-blue)',
                              borderRadius: 'var(--ps-radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              padding: 'var(--ps-space-sm) var(--ps-space-md)',
                              fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)',
                            }}>
                              No GP practices found for "{gpSearchQuery}". Try name + postcode (e.g. "Mayfield WV1") or an ODS code.
                            </div>
                          )}
                          {gpResults.length > 0 && (
                            <div style={{
                              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                              background: 'white', border: '1px solid var(--ps-cloud-blue)',
                              borderRadius: 'var(--ps-radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              maxHeight: 240, overflowY: 'auto',
                            }}>
                              {gpResults.map((gp) => (
                                <div
                                  key={gp.odsCode}
                                  onClick={() => {
                                    setSelectedGP(gp)
                                    setFieldValue('GP_ODS_CODE', gp.odsCode)
                                    setGpSearchQuery('')
                                    setGpResults([])
                                  }}
                                  style={{
                                    padding: 'var(--ps-space-sm) var(--ps-space-md)',
                                    cursor: 'pointer', borderBottom: '1px solid var(--ps-off-white)',
                                    transition: 'background var(--ps-transition-fast)',
                                  }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                                >
                                  <div style={{ fontWeight: 500 }}>{gp.name}</div>
                                  <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
                                    ODS: {gp.odsCode} · {[gp.address, gp.city, gp.postcode].filter(Boolean).join(', ')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                }

                // Auto-populated read-only hint for certain fields
                const isAutoPopulated = isNhsService && ['PATIENT_NHSNO', 'GPHC_NUMBER', 'PROFESSIONAL_IDENTIFIER', 'PROFESSIONAL_ROLE', 'ASSESSMENT_DATE'].includes(field.field_key) && !!formData[field.field_key]

                return (
                  <div key={field.id} style={{ position: 'relative' }}>
                    <DynamicField
                      field={field}
                      value={formData[field.field_key]}
                      onChange={(val) => setFieldValue(field.field_key, val)}
                    />
                    {isAutoPopulated && (
                      <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-electric-cyan)', marginTop: -8, marginBottom: 8 }}>
                        ✓ Auto-populated
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Medications — shown when outcome indicates medicine supplied */}
          {medicineSupplied && (
            <div style={{ marginTop: 'var(--ps-space-lg)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
                <label style={{ fontWeight: 600, color: 'var(--ps-midnight)' }}>
                  💊 Medications Supplied
                  {medications.filter(m => m.drug_name.trim()).length > 0 && (
                    <span style={{ fontWeight: 400, color: 'var(--ps-slate)', marginLeft: 8 }}>
                      ({medications.filter(m => m.drug_name.trim()).length} item{medications.filter(m => m.drug_name.trim()).length !== 1 ? 's' : ''})
                    </span>
                  )}
                </label>
                <button
                  type="button"
                  className="ps-btn ps-btn-primary ps-btn-sm"
                  onClick={() => {
                    if (medications.length === 0) setMedications([createEmptyMedication()])
                    setShowMedModal(true)
                  }}
                >
                  {medications.filter(m => m.drug_name.trim()).length > 0 ? '✏️ Edit Medications' : '+ Add Medications'}
                </button>
              </div>

              {/* Inline summary of added meds */}
              {medications.filter(m => m.drug_name.trim()).length > 0 && (
                <div style={{ background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                  {medications.filter(m => m.drug_name.trim()).map((m, i) => (
                    <div key={m.localId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--ps-space-xs) 0', borderBottom: i < medications.filter(x => x.drug_name.trim()).length - 1 ? '1px solid var(--ps-white)' : 'none', fontSize: 'var(--ps-font-sm)' }}>
                      <span style={{ fontWeight: 500, color: 'var(--ps-midnight)' }}>
                        {m.drug_name}
                        {m.is_controlled_drug && <span style={{ marginLeft: 6, color: '#92400e', fontWeight: 700, fontSize: '0.7rem', background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>CD</span>}
                      </span>
                      <span style={{ color: 'var(--ps-slate)' }}>
                        {m.dose && `${m.dose}`}
                        {(m.quantity ?? 0) > 0 && ` · Qty: ${m.quantity}${m.unit ? ` ${m.unit}` : ''}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="form-group" style={{ marginTop: 'var(--ps-space-lg)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
            <label>Notes (optional)</label>
            <textarea
              className="ps-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes about this service delivery…"
              rows={3}
            />
          </div>

          {/* Required fields warning */}
          {requiredFieldsMissing.length > 0 && (
            <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-error)', marginBottom: 'var(--ps-space-md)' }}>
              Missing required fields: {requiredFieldsMissing.map((f) => f.label).join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('patient')}>
              ← Back
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => setStep('review')}>
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {/* ===== Medication Modal ===== */}
      {showMedModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--ps-space-lg)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowMedModal(false) }}
        >
          <div
            style={{
              background: 'var(--ps-white)',
              borderRadius: 'var(--ps-radius-lg)',
              padding: 'var(--ps-space-xl)',
              width: '100%',
              maxWidth: '720px',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-lg)' }}>
              <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
                💊 Medications Supplied
              </h2>
              <button
                type="button"
                className="ps-btn ps-btn-ghost"
                onClick={() => setShowMedModal(false)}
                style={{ fontSize: '18px', padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            <MedicationPrescriber
              value={medications}
              onChange={setMedications}
              label="Medications"
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
              <button className="ps-btn ps-btn-secondary" onClick={() => setShowMedModal(false)}>
                Cancel
              </button>
              <button className="ps-btn ps-btn-primary" onClick={() => setShowMedModal(false)}>
                ✓ Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== STEP 3: Review & Complete ===== */}
      {step === 'review' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-lg)' }}>
            ✅ Review & Complete
          </h2>

          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-lg)' }}>
            <strong>Service:</strong>
            <span>{activeService?.name}</span>

            <strong>Patient:</strong>
            <span>{selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Walk-in (no record)'}</span>

            {selectedPatient?.nhs_number && (
              <>
                <strong>NHS Number:</strong>
                <span>{selectedPatient.nhs_number}</span>
              </>
            )}

            {selectedGP && (
              <>
                <strong>GP Practice:</strong>
                <span>{selectedGP.name} ({selectedGP.odsCode})</span>
              </>
            )}

            <strong>Form:</strong>
            <span>{selectedForm?.name || 'None'}</span>

            <strong>Staff:</strong>
            <span>{activeUser?.full_name || activeUser?.email || 'Unknown'}</span>
          </div>

          {/* Form data summary */}
          {activeFields.length > 0 && Object.keys(formData).length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Form Responses</h3>
              <div style={{ background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-md)' }}>
                {activeFields.map((field) => {
                  const val = formData[field.field_key]
                  if (val === undefined || val === null || val === '') return null
                  // Show GP name alongside ODS code in review
                  const displayVal = field.field_key === 'GP_ODS_CODE' && selectedGP
                    ? `${selectedGP.name} (${selectedGP.odsCode})`
                    : formatValue(field, val)
                  return (
                    <div key={field.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--ps-space-xs) 0', borderBottom: '1px solid var(--ps-white)' }}>
                      <span style={{ fontWeight: 500 }}>{field.label}</span>
                      <span style={{ color: 'var(--ps-slate)' }}>{displayVal}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {notes && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, marginBottom: 'var(--ps-space-xs)' }}>Notes</h3>
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>{notes}</p>
            </div>
          )}

          {/* Medications summary */}
          {medications.filter(m => m.drug_name.trim()).length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>💊 Medications Supplied</h3>
              <div style={{ background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-md)' }}>
                {medications.filter(m => m.drug_name.trim()).map((m, i) => (
                  <div key={m.localId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--ps-space-xs) 0', borderBottom: '1px solid var(--ps-white)', fontSize: 'var(--ps-font-sm)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--ps-midnight)' }}>
                      {i + 1}. {m.drug_name}
                      {m.is_controlled_drug && <span style={{ marginLeft: 6, color: '#92400e', fontWeight: 700, fontSize: '0.7rem', background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>CD</span>}
                    </span>
                    <span style={{ color: 'var(--ps-slate)' }}>
                      {m.dose && `${m.dose}`}
                      {(m.quantity ?? 0) > 0 && ` · Qty: ${m.quantity}${m.unit ? ` ${m.unit}` : ''}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {requiredFieldsMissing.length > 0 && (
            <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-error)', marginBottom: 'var(--ps-space-md)', padding: 'var(--ps-space-sm) var(--ps-space-md)', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--ps-radius-md)' }}>
              ⚠️ Missing required fields: {requiredFieldsMissing.map((f) => f.label).join(', ')} — go back to fill them in.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('form')}>
              ← Back to Form
            </button>
            <button
              className="ps-btn ps-btn-success"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              style={{ fontSize: 'var(--ps-font-md)', padding: 'var(--ps-space-sm) var(--ps-space-xl)' }}
            >
              {submitting ? 'Saving…' : '✓ Complete Service Delivery'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ==== Dynamic Form Field Renderer ==== */

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: ServiceFormField
  value: unknown
  onChange: (val: unknown) => void
}) {
  // options can be stored as a plain JSON array ["A","B"] or an object { values: ["A","B"] }
  const optionValues: string[] = Array.isArray(field.options)
    ? field.options
    : Array.isArray((field.options as any)?.values)
      ? (field.options as any).values
      : []

  return (
    <div className="form-group">
      <label>
        {field.label}
        {field.is_required && <span style={{ color: 'var(--ps-error)', marginLeft: 4 }}>*</span>}
      </label>

      {field.field_type === 'text' && (
        <input
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.label}
        />
      )}

      {field.field_type === 'number' && (
        <input
          className="ps-input"
          type="number"
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
          placeholder={field.label}
        />
      )}

      {field.field_type === 'boolean' && (
        <div style={{ display: 'flex', gap: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name={field.field_key}
              checked={value === true}
              onChange={() => onChange(true)}
            />
            Yes
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name={field.field_key}
              checked={value === false}
              onChange={() => onChange(false)}
            />
            No
          </label>
        </div>
      )}

      {field.field_type === 'select' && (
        <select
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {optionValues.map((v) => (
            <option key={v} value={v}>{optionLabel(v)}</option>
          ))}
        </select>
      )}

      {field.field_type === 'multiselect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {optionValues.map((v) => {
            const selected = Array.isArray(value) ? value : []
            return (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(v)}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...selected, v])
                    else onChange(selected.filter((s: string) => s !== v))
                  }}
                />
                {optionLabel(v)}
              </label>
            )
          })}
        </div>
      )}

      {field.field_type === 'date' && (
        <input
          className="ps-input"
          type="date"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.field_type === 'textarea' && (
        <textarea
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.label}
          rows={3}
        />
      )}

      {field.field_type === 'signature' && (
        <div style={{
          border: '2px dashed var(--ps-cloud-blue)',
          borderRadius: 'var(--ps-radius-md)',
          padding: 'var(--ps-space-lg)',
          textAlign: 'center',
          color: 'var(--ps-mist)',
          fontSize: 'var(--ps-font-sm)',
          cursor: 'pointer',
        }}
          onClick={() => {
            const name = window.prompt('Type name for signature:')
            if (name) onChange(name)
          }}
        >
          {value ? (
            <span style={{ color: 'var(--ps-midnight)', fontStyle: 'italic', fontSize: 'var(--ps-font-lg)' }}>
              {value as string}
            </span>
          ) : (
            'Click to sign'
          )}
        </div>
      )}
    </div>
  )
}

/* ==== Value formatter for review ==== */

function formatValue(field: ServiceFormField, val: unknown): string {
  if (field.field_type === 'boolean') return val ? 'Yes' : 'No'
  if (field.field_type === 'select' && typeof val === 'string') return optionLabel(val)
  if (Array.isArray(val)) return val.map((v) => optionLabel(String(v))).join(', ')
  return String(val)
}
