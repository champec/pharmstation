import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore, usePatientMedicationStore, useAppointmentStore } from '@pharmstation/core'
import type { Patient, PatientMedication, DeliveryRoundStatus, BnfDrugSearchResult } from '@pharmstation/types'
import { resolvePermissions } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

interface RoundPatientEntry {
  patient: Patient
  medications: { med: PatientMedication; selected: boolean; quantity: number }[]
  addressOverride: { line1: string; line2: string; city: string; postcode: string }
  notes: string
}

export function NewDeliveryRoundPage() {
  const navigate = useNavigate()
  const { organisation, membership } = useAuthStore()
  const { createRound, addPatientToRound, assignDriver, fetchAvailableDrivers, availableDrivers } = useDeliveryRoundStore()
  const { searchPatients, patients: searchedPatients, createPatient } = useAppointmentStore()
  const { fetchMedications, searchDrugs, drugSearchResults, addMedication, removeMedication, clearSearch } = usePatientMedicationStore()

  // Multi-step: 1=patients, 2=review, 3=schedule
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1 — Patient selection
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatients, setSelectedPatients] = useState<RoundPatientEntry[]>([])
  const [loadingMeds, setLoadingMeds] = useState(false)

  // Add New Patient modal
  const [showAddPatientModal, setShowAddPatientModal] = useState(false)
  const [newPatient, setNewPatient] = useState({ first_name: '', last_name: '', phone: '', email: '', dob: '', nhs_number: '', address_line_1: '', address_line_2: '', city: '', postcode: '' })
  const [addingPatient, setAddingPatient] = useState(false)
  const [addPatientError, setAddPatientError] = useState<string | null>(null)

  // Configure Medications modal
  const [showConfigMedsModal, setShowConfigMedsModal] = useState(false)
  const [configMedsPatientId, setConfigMedsPatientId] = useState<string | null>(null)
  const [configMedsPatientName, setConfigMedsPatientName] = useState('')
  const [configMedsLoading, setConfigMedsLoading] = useState(false)

  // Add drug sub-state within Configure Meds modal
  const [showAddDrug, setShowAddDrug] = useState(false)
  const [drugSearch, setDrugSearch] = useState('')
  const [selectedDrug, setSelectedDrug] = useState<BnfDrugSearchResult | null>(null)
  const [medDose, setMedDose] = useState('')
  const [medQuantity, setMedQuantity] = useState(1)
  const [medNotes, setMedNotes] = useState('')
  const [addingMed, setAddingMed] = useState(false)
  const [addMedError, setAddMedError] = useState<string | null>(null)

  // Step 3 — Schedule
  const [title, setTitle] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [driverId, setDriverId] = useState('')
  const [roundNotes, setRoundNotes] = useState('')

  useEffect(() => {
    if (organisation?.id) fetchAvailableDrivers(organisation.id)
  }, [organisation?.id, fetchAvailableDrivers])

  // Debounced patient search
  const handlePatientSearch = useCallback(async () => {
    if (!organisation?.id || patientSearch.length < 2) return
    await searchPatients(organisation.id, patientSearch)
  }, [organisation?.id, patientSearch, searchPatients])

  useEffect(() => {
    const timer = setTimeout(handlePatientSearch, 300)
    return () => clearTimeout(timer)
  }, [handlePatientSearch])

  // Debounced drug search for Configure Meds modal
  useEffect(() => {
    if (!drugSearch || drugSearch.length < 2) { clearSearch(); return }
    const timer = setTimeout(() => { searchDrugs(drugSearch) }, 300)
    return () => clearTimeout(timer)
  }, [drugSearch, searchDrugs, clearSearch])

  // ---- Patient actions ----

  const addPatient = async (patient: Patient) => {
    if (selectedPatients.find((sp) => sp.patient.id === patient.id)) return
    setLoadingMeds(true)
    await fetchMedications(patient.id)
    const patMeds = usePatientMedicationStore.getState().medications
    const entry: RoundPatientEntry = {
      patient,
      medications: patMeds.filter((m) => m.is_active).map((m) => ({
        med: m, selected: true, quantity: m.quantity ?? 1,
      })),
      addressOverride: { line1: '', line2: '', city: '', postcode: '' },
      notes: '',
    }
    setSelectedPatients((prev) => [...prev, entry])
    setPatientSearch('')
    setLoadingMeds(false)
  }

  const removePatient = (patientId: string) => {
    setSelectedPatients((prev) => prev.filter((sp) => sp.patient.id !== patientId))
  }

  // ---- Add New Patient modal ----

  const openAddPatientModal = () => {
    const parts = patientSearch.trim().split(/\s+/)
    setNewPatient({
      first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '',
      phone: '', email: '', dob: '', nhs_number: '',
      address_line_1: '', address_line_2: '', city: '', postcode: '',
    })
    setAddPatientError(null)
    setShowAddPatientModal(true)
  }

  const handleCreatePatient = async () => {
    if (!organisation?.id) return
    if (!newPatient.first_name.trim() || !newPatient.last_name.trim()) {
      setAddPatientError('First name and last name are required.')
      return
    }
    setAddingPatient(true)
    setAddPatientError(null)
    try {
      const created = await createPatient({
        organisation_id: organisation.id,
        first_name: newPatient.first_name.trim(),
        last_name: newPatient.last_name.trim(),
        phone: newPatient.phone.trim() || null,
        email: newPatient.email.trim() || null,
        dob: newPatient.dob || null,
        nhs_number: newPatient.nhs_number.trim() || null,
        address_line_1: newPatient.address_line_1.trim() || null,
        address_line_2: newPatient.address_line_2.trim() || null,
        city: newPatient.city.trim() || null,
        postcode: newPatient.postcode.trim() || null,
      })
      setShowAddPatientModal(false)
      setPatientSearch('')
      await addPatient(created)
    } catch (e: any) {
      setAddPatientError(e.message)
    }
    setAddingPatient(false)
  }

  // ---- Configure Medications modal ----

  const openConfigMeds = async (patientId: string, patientName: string) => {
    setConfigMedsPatientId(patientId)
    setConfigMedsPatientName(patientName)
    setShowAddDrug(false)
    setDrugSearch('')
    setSelectedDrug(null)
    setMedDose('')
    setMedQuantity(1)
    setMedNotes('')
    setAddMedError(null)
    clearSearch()
    setConfigMedsLoading(true)
    setShowConfigMedsModal(true)
    await fetchMedications(patientId)
    setConfigMedsLoading(false)
  }

  const getConfigMedsList = (): PatientMedication[] => {
    return usePatientMedicationStore.getState().medications
  }

  const handleAddMedication = async () => {
    if (!organisation?.id || !configMedsPatientId || !selectedDrug) return
    setAddingMed(true)
    setAddMedError(null)
    try {
      const newMed = await addMedication({
        organisation_id: organisation.id,
        patient_id: configMedsPatientId,
        drug_id: selectedDrug.id,
        drug_name: selectedDrug.name,
        drug_form: selectedDrug.form ?? undefined,
        drug_strength: undefined,
        dose: medDose.trim() || undefined,
        quantity: medQuantity,
        notes: medNotes.trim() || undefined,
      })
      // Also add to the round entry, auto-selected
      setSelectedPatients((prev) =>
        prev.map((sp) =>
          sp.patient.id === configMedsPatientId
            ? { ...sp, medications: [...sp.medications, { med: newMed, selected: true, quantity: newMed.quantity ?? 1 }] }
            : sp
        )
      )
      // Reset add-drug sub-form but stay in the configure modal
      setShowAddDrug(false)
      setSelectedDrug(null)
      setDrugSearch('')
      setMedDose('')
      setMedQuantity(1)
      setMedNotes('')
      clearSearch()
    } catch (e: any) {
      setAddMedError(e.message)
    }
    setAddingMed(false)
  }

  const handleRemoveMedFromPatient = async (medId: string) => {
    if (!configMedsPatientId) return
    try {
      await removeMedication(medId)
      setSelectedPatients((prev) =>
        prev.map((sp) =>
          sp.patient.id === configMedsPatientId
            ? { ...sp, medications: sp.medications.filter((m) => m.med.id !== medId) }
            : sp
        )
      )
    } catch {}
  }

  const closeConfigMeds = () => {
    setShowConfigMedsModal(false)
    setConfigMedsPatientId(null)
  }

  // ---- Round medication toggles ----

  const toggleMed = (patientId: string, medId: string) => {
    setSelectedPatients((prev) =>
      prev.map((sp) =>
        sp.patient.id === patientId
          ? { ...sp, medications: sp.medications.map((m) => m.med.id === medId ? { ...m, selected: !m.selected } : m) }
          : sp
      )
    )
  }

  const updateMedQuantity = (patientId: string, medId: string, qty: number) => {
    setSelectedPatients((prev) =>
      prev.map((sp) =>
        sp.patient.id === patientId
          ? { ...sp, medications: sp.medications.map((m) => m.med.id === medId ? { ...m, quantity: qty } : m) }
          : sp
      )
    )
  }

  // ---- Drivers ----

  const drivers = availableDrivers.filter((d) => {
    const perms = resolvePermissions(d.role, d.permissions)
    return perms.delivery_drive
  })

  // ---- Create round ----

  const handleCreate = async () => {
    if (!organisation?.id || !membership?.user_id) return
    setSaving(true)
    setError(null)
    try {
      const round = await createRound({
        organisation_id: organisation.id,
        title: title.trim() || null,
        status: (scheduledDate ? 'scheduled' : 'draft') as DeliveryRoundStatus,
        scheduled_date: scheduledDate || null,
        scheduled_time_start: timeStart || null,
        scheduled_time_end: timeEnd || null,
        notes: roundNotes.trim() || null,
        created_by: membership.user_id,
      })

      for (let i = 0; i < selectedPatients.length; i++) {
        const sp = selectedPatients[i]
        const selectedMeds = sp.medications
          .filter((m) => m.selected)
          .map((m) => ({ patient_medication_id: m.med.id, quantity: m.quantity }))
        const addr = sp.addressOverride
        await addPatientToRound(
          round.id, organisation.id, sp.patient.id, i + 1, selectedMeds,
          addr.line1 || addr.line2 || addr.city || addr.postcode
            ? { line1: addr.line1, line2: addr.line2, city: addr.city, postcode: addr.postcode }
            : undefined,
          sp.notes || undefined,
        )
      }

      if (driverId) await assignDriver(round.id, driverId)
      navigate(`/delivery-rounds/${round.id}`)
    } catch (e: any) {
      setError(e.message)
    }
    setSaving(false)
  }

  // Current configure-meds list (refreshes each render when modal is open)
  const configMedsList = showConfigMedsModal ? getConfigMedsList() : []

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/delivery-rounds" onClick={(e) => { e.preventDefault(); navigate('/delivery-rounds') }}>Delivery Rounds</a>
          <span className="separator">/</span>
          <span>New Round</span>
        </div>
        <h1>📦 New Delivery Round</h1>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
        {[{ n: 1, label: 'Select Patients' }, { n: 2, label: 'Review' }, { n: 3, label: 'Schedule & Create' }].map(({ n, label }) => (
          <div
            key={n}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: n < step ? 'pointer' : 'default' }}
            onClick={() => n < step && setStep(n)}
          >
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: step >= n ? 'var(--ps-primary)' : 'var(--ps-off-white)',
              color: step >= n ? '#fff' : 'var(--ps-slate)', fontWeight: 600, fontSize: 'var(--ps-font-sm)',
            }}>
              {step > n ? '✓' : n}
            </div>
            <span style={{ fontSize: 'var(--ps-font-sm)', color: step >= n ? 'var(--ps-midnight)' : 'var(--ps-slate)', fontWeight: step === n ? 600 : 400 }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ========== Step 1 — Select Patients ========== */}
      {step === 1 && (
        <div>
          <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
            <h3 style={{ marginBottom: 'var(--ps-space-sm)' }}>Search & Add Patients</h3>
            <input
              className="ps-input"
              placeholder="Search patients by name, NHS number, phone…"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              style={{ maxWidth: 500, marginBottom: 'var(--ps-space-sm)' }}
            />
            {loadingMeds && <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Loading medications…</div>}

            {patientSearch.length >= 2 && (
              <div style={{ border: '1px solid var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', maxHeight: 240, overflowY: 'auto' }}>
                {searchedPatients
                  .filter((p) => !selectedPatients.find((sp) => sp.patient.id === p.id))
                  .map((p) => (
                    <div
                      key={p.id}
                      style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--ps-off-white)' }}
                      onClick={() => addPatient(p)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                    >
                      <div>
                        <span style={{ fontWeight: 500 }}>{p.first_name} {p.last_name}</span>
                        <span style={{ color: 'var(--ps-slate)', marginLeft: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
                          {p.postcode || ''} {p.phone ? `· ${p.phone}` : ''}
                        </span>
                      </div>
                      <span style={{ color: 'var(--ps-primary)', fontSize: 'var(--ps-font-sm)' }}>+ Add</span>
                    </div>
                  ))}
                {/* Add New Patient — always at bottom */}
                <div
                  style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--ps-off-white)', background: 'var(--ps-off-white)' }}
                  onClick={openAddPatientModal}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#e8eaed' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--ps-primary)' }}>
                    ＋ Add new patient
                    {patientSearch.trim() && <span style={{ color: 'var(--ps-slate)', marginLeft: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)', fontWeight: 400 }}>"{patientSearch.trim()}"</span>}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Selected patients */}
          {selectedPatients.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
              {selectedPatients.map((sp, idx) => {
                const medCount = sp.medications.filter((m) => m.selected).length
                return (
                  <div key={sp.patient.id} className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
                        <span style={{ fontWeight: 600 }}>#{idx + 1} {sp.patient.first_name} {sp.patient.last_name}</span>
                        <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                          {sp.patient.address_line_1} {sp.patient.postcode}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)' }}>
                        <span className={`ps-badge ${medCount > 0 ? 'ps-badge-blue' : 'ps-badge-amber'}`} style={{ fontSize: 'var(--ps-font-xs)' }}>
                          {medCount} med{medCount !== 1 ? 's' : ''}
                        </span>
                        {/* ⚙️ Configure Meds gear button */}
                        <button
                          className="ps-btn ps-btn-ghost ps-btn-sm"
                          title="Configure medications for this patient"
                          onClick={() => openConfigMeds(sp.patient.id, `${sp.patient.first_name} ${sp.patient.last_name}`)}
                          style={{ fontSize: '18px', padding: '4px 8px', lineHeight: 1 }}
                        >
                          ⚙️
                        </button>
                        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => removePatient(sp.patient.id)} style={{ color: 'var(--ps-red)' }}>
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Quick medication summary */}
                    {sp.medications.length > 0 ? (
                      <div style={{ marginTop: 'var(--ps-space-xs)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {sp.medications.filter((m) => m.selected).map((m) => (
                          <span key={m.med.id} style={{ background: 'var(--ps-off-white)', padding: '2px 8px', borderRadius: 'var(--ps-radius-sm)', fontSize: 'var(--ps-font-xs)' }}>
                            {m.med.drug_name} ×{m.quantity}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ marginTop: 'var(--ps-space-xs)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                        No medications configured — click ⚙️ to add
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-primary" onClick={() => setStep(2)} disabled={selectedPatients.length === 0}>
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {/* ========== Step 2 — Review ========== */}
      {step === 2 && (
        <div>
          <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
            <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>Review — {selectedPatients.length} patient{selectedPatients.length !== 1 ? 's' : ''}</h3>
            {selectedPatients.map((sp, idx) => (
              <div key={sp.patient.id} style={{ padding: 'var(--ps-space-sm) 0', borderBottom: idx < selectedPatients.length - 1 ? '1px solid var(--ps-off-white)' : 'none' }}>
                <div style={{ fontWeight: 600 }}>#{idx + 1} {sp.patient.first_name} {sp.patient.last_name}</div>
                <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                  {sp.patient.address_line_1}{sp.patient.postcode ? `, ${sp.patient.postcode}` : ''}
                </div>
                <div style={{ fontSize: 'var(--ps-font-sm)', marginTop: 4 }}>
                  {sp.medications.filter((m) => m.selected).length} medication{sp.medications.filter((m) => m.selected).length !== 1 ? 's' : ''}:
                  {sp.medications.filter((m) => m.selected).map((m) => (
                    <span key={m.med.id} style={{ marginLeft: 'var(--ps-space-xs)', background: 'var(--ps-off-white)', padding: '2px 8px', borderRadius: 'var(--ps-radius-sm)', fontSize: 'var(--ps-font-xs)' }}>
                      {m.med.drug_name} ×{m.quantity}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button className="ps-btn ps-btn-primary" onClick={() => setStep(3)}>Next: Schedule →</button>
          </div>
        </div>
      )}

      {/* ========== Step 3 — Schedule & Create ========== */}
      {step === 3 && (
        <div>
          <div className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
            <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>Schedule & Assign</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
              <div className="form-group">
                <label>Round Title</label>
                <input className="ps-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning Round" />
              </div>
              <div className="form-group">
                <label>Assign Driver</label>
                <select className="ps-input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">— Select Driver —</option>
                  {drivers.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.user_profile?.full_name} ({d.role})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Delivery Date</label>
                <input className="ps-input" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Time From</label>
                  <input className="ps-input" type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Time To</label>
                  <input className="ps-input" type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 'var(--ps-space-sm)' }}>
              <label>Notes</label>
              <textarea className="ps-input" rows={3} value={roundNotes} onChange={(e) => setRoundNotes(e.target.value)} placeholder="Any notes for this round..." />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep(2)}>← Back</button>
            <button className="ps-btn ps-btn-primary" onClick={handleCreate} disabled={saving}>
              {saving ? 'Creating…' : 'Create Delivery Round'}
            </button>
          </div>
        </div>
      )}

      {/* ========== Add New Patient Modal ========== */}
      <Modal isOpen={showAddPatientModal} onClose={() => setShowAddPatientModal(false)} title="Add New Patient" width="520px">
        <div>
          {addPatientError && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-sm)' }}>{addPatientError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-sm)' }}>
            <div className="form-group">
              <label>First Name *</label>
              <input className="ps-input" value={newPatient.first_name} onChange={(e) => setNewPatient({ ...newPatient, first_name: e.target.value })} autoFocus />
            </div>
            <div className="form-group">
              <label>Last Name *</label>
              <input className="ps-input" value={newPatient.last_name} onChange={(e) => setNewPatient({ ...newPatient, last_name: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-sm)' }}>
            <div className="form-group">
              <label>Phone</label>
              <input className="ps-input" type="tel" value={newPatient.phone} onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="ps-input" type="email" value={newPatient.email} onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-sm)' }}>
            <div className="form-group">
              <label>Date of Birth</label>
              <input className="ps-input" type="date" value={newPatient.dob} onChange={(e) => setNewPatient({ ...newPatient, dob: e.target.value })} />
            </div>
            <div className="form-group">
              <label>NHS Number</label>
              <input className="ps-input" value={newPatient.nhs_number} onChange={(e) => setNewPatient({ ...newPatient, nhs_number: e.target.value })} placeholder="000 000 0000" />
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 'var(--ps-space-sm)' }}>
            <label>Address Line 1</label>
            <input className="ps-input" value={newPatient.address_line_1} onChange={(e) => setNewPatient({ ...newPatient, address_line_1: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginTop: 'var(--ps-space-sm)' }}>
            <label>Address Line 2</label>
            <input className="ps-input" value={newPatient.address_line_2} onChange={(e) => setNewPatient({ ...newPatient, address_line_2: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-sm)' }}>
            <div className="form-group">
              <label>City</label>
              <input className="ps-input" value={newPatient.city} onChange={(e) => setNewPatient({ ...newPatient, city: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Postcode</label>
              <input className="ps-input" value={newPatient.postcode} onChange={(e) => setNewPatient({ ...newPatient, postcode: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-md)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowAddPatientModal(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleCreatePatient} disabled={addingPatient || !newPatient.first_name.trim() || !newPatient.last_name.trim()}>
              {addingPatient ? 'Adding…' : 'Add Patient'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ========== Configure Medications Modal ========== */}
      <Modal isOpen={showConfigMedsModal} onClose={closeConfigMeds} title={`⚙️ Configure Medications — ${configMedsPatientName}`} width="640px">
        <div>
          {configMedsLoading ? (
            <div style={{ textAlign: 'center', padding: 'var(--ps-space-lg)', color: 'var(--ps-slate)' }}>Loading medications…</div>
          ) : (
            <>
              {/* Existing medications list */}
              <div style={{ marginBottom: 'var(--ps-space-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--ps-space-sm)' }}>
                  <h4 style={{ margin: 0 }}>Patient Medications</h4>
                  {!showAddDrug && (
                    <button
                      className="ps-btn ps-btn-primary ps-btn-sm"
                      onClick={() => { setShowAddDrug(true); setSelectedDrug(null); setDrugSearch(''); setMedDose(''); setMedQuantity(1); setMedNotes(''); setAddMedError(null); clearSearch() }}
                    >
                      ＋ Add Drug
                    </button>
                  )}
                </div>

                {configMedsList.length === 0 && !showAddDrug && (
                  <div style={{ padding: 'var(--ps-space-lg)', textAlign: 'center', color: 'var(--ps-slate)', background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)' }}>
                    No medications on file for this patient. Click <strong>＋ Add Drug</strong> to get started.
                  </div>
                )}

                {configMedsList.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-xs)' }}>
                    {configMedsList.map((med) => {
                      const roundEntry = selectedPatients.find((sp) => sp.patient.id === configMedsPatientId)
                      const roundMed = roundEntry?.medications.find((m) => m.med.id === med.id)
                      const isSelected = roundMed?.selected ?? false

                      return (
                        <div
                          key={med.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)',
                            padding: 'var(--ps-space-sm) var(--ps-space-md)',
                            background: isSelected ? '#f0f7ff' : 'var(--ps-off-white)',
                            borderRadius: 'var(--ps-radius-md)',
                            border: isSelected ? '1px solid var(--ps-primary)' : '1px solid transparent',
                          }}
                        >
                          {/* Checkbox to include in this round */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              if (!configMedsPatientId) return
                              if (roundMed) {
                                toggleMed(configMedsPatientId, med.id)
                              } else {
                                // Not yet in round entry — add it
                                setSelectedPatients((prev) =>
                                  prev.map((sp) =>
                                    sp.patient.id === configMedsPatientId
                                      ? { ...sp, medications: [...sp.medications, { med, selected: true, quantity: med.quantity ?? 1 }] }
                                      : sp
                                  )
                                )
                              }
                            }}
                            title="Include in this delivery round"
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500, fontSize: 'var(--ps-font-sm)' }}>
                              {med.drug_name}
                              {med.drug_form && <span style={{ color: 'var(--ps-slate)', fontWeight: 400 }}> ({med.drug_form})</span>}
                            </div>
                            <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
                              {med.dose && <span>Dose: {med.dose}</span>}
                              {med.quantity != null && <span>{med.dose ? ' · ' : ''}Qty: {med.quantity}</span>}
                              {med.notes && <span>{(med.dose || med.quantity != null) ? ' · ' : ''}{med.notes}</span>}
                            </div>
                          </div>
                          {isSelected && (
                            <input
                              className="ps-input"
                              type="number"
                              min={1}
                              value={roundMed?.quantity ?? med.quantity ?? 1}
                              onChange={(e) => { if (configMedsPatientId) updateMedQuantity(configMedsPatientId, med.id, parseInt(e.target.value) || 1) }}
                              style={{ width: 70, textAlign: 'center' }}
                              title="Quantity for this round"
                            />
                          )}
                          <span className={`ps-badge ${med.is_active ? 'ps-badge-green' : 'ps-badge-slate'}`} style={{ fontSize: 'var(--ps-font-xs)' }}>
                            {med.is_active ? 'Active' : 'Inactive'}
                          </span>
                          <button
                            className="ps-btn ps-btn-ghost ps-btn-sm"
                            onClick={() => handleRemoveMedFromPatient(med.id)}
                            style={{ color: 'var(--ps-red)', fontSize: 'var(--ps-font-sm)', padding: '2px 6px' }}
                            title="Remove medication"
                          >
                            🗑️
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Add Drug sub-section */}
              {showAddDrug && (
                <div style={{ borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
                  <h4 style={{ margin: '0 0 var(--ps-space-sm) 0' }}>Search & Add New Drug</h4>
                  {addMedError && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-sm)' }}>{addMedError}</div>}

                  {!selectedDrug ? (
                    <div>
                      <div className="form-group">
                        <input
                          className="ps-input"
                          placeholder="Start typing a drug name…"
                          value={drugSearch}
                          onChange={(e) => setDrugSearch(e.target.value)}
                          autoFocus
                        />
                      </div>
                      {drugSearch.length >= 2 && (
                        <div style={{ border: '1px solid var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', maxHeight: 200, overflowY: 'auto', marginTop: 'var(--ps-space-xs)' }}>
                          {drugSearchResults.length === 0 && (
                            <div style={{ padding: 'var(--ps-space-md)', textAlign: 'center', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                              No drugs found matching "{drugSearch}"
                            </div>
                          )}
                          {drugSearchResults.map((drug) => (
                            <div
                              key={drug.id}
                              style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', cursor: 'pointer', borderBottom: '1px solid var(--ps-off-white)' }}
                              onClick={() => { setSelectedDrug(drug); setDrugSearch('') }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                            >
                              <div style={{ fontWeight: 500, fontSize: 'var(--ps-font-sm)' }}>{drug.name}</div>
                              <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
                                {drug.form && <span>{drug.form}</span>}
                                {drug.manufacturer && <span> · {drug.manufacturer}</span>}
                                {drug.controlledDrugSchedule && (
                                  <span style={{ marginLeft: 'var(--ps-space-xs)', color: 'var(--ps-red)', fontWeight: 600 }}>CD {drug.controlledDrugSchedule}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setShowAddDrug(false)} style={{ marginTop: 'var(--ps-space-sm)' }}>Cancel</button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ background: 'var(--ps-off-white)', padding: 'var(--ps-space-sm) var(--ps-space-md)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 'var(--ps-font-sm)' }}>{selectedDrug.name}</div>
                          <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
                            {selectedDrug.form}{selectedDrug.manufacturer && ` · ${selectedDrug.manufacturer}`}
                            {selectedDrug.controlledDrugSchedule && (
                              <span style={{ marginLeft: 'var(--ps-space-xs)', color: 'var(--ps-red)', fontWeight: 600 }}>CD {selectedDrug.controlledDrugSchedule}</span>
                            )}
                          </div>
                        </div>
                        <button className="ps-btn ps-btn-ghost ps-btn-sm" style={{ color: 'var(--ps-primary)', fontSize: 'var(--ps-font-sm)' }} onClick={() => setSelectedDrug(null)}>Change</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-sm)' }}>
                        <div className="form-group">
                          <label>Dose / Directions</label>
                          <input className="ps-input" placeholder="e.g. 1 tablet twice daily" value={medDose} onChange={(e) => setMedDose(e.target.value)} />
                        </div>
                        <div className="form-group">
                          <label>Quantity</label>
                          <input className="ps-input" type="number" min={1} value={medQuantity} onChange={(e) => setMedQuantity(parseInt(e.target.value) || 1)} />
                        </div>
                      </div>
                      <div className="form-group" style={{ marginTop: 'var(--ps-space-sm)' }}>
                        <label>Notes</label>
                        <textarea className="ps-input" rows={2} value={medNotes} onChange={(e) => setMedNotes(e.target.value)} placeholder="Optional notes…" />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-sm)' }}>
                        <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => setShowAddDrug(false)}>Cancel</button>
                        <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={handleAddMedication} disabled={addingMed}>
                          {addingMed ? 'Adding…' : 'Add to Patient'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Done button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--ps-space-md)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
                <button className="ps-btn ps-btn-primary" onClick={closeConfigMeds}>Done</button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
