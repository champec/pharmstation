import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore, usePatientMedicationStore } from '@pharmstation/core'
import type { BnfDrugSearchResult, CareHomeMedicationScheduleType, CareHomeResidentNoteType } from '@pharmstation/types'

const weekdays = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]

function fullName(firstName?: string, lastName?: string) {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Resident'
}

export function CareHomeResidentPage() {
  const navigate = useNavigate()
  const { linkId, residentId } = useParams<{ linkId: string; residentId: string }>()
  const { organisation, activeUser, permissions } = useAuthStore()
  const {
    residents,
    residentMedications,
    medicationSchedules,
    residentSupplyPackages,
    residentNotes,
    medicationEvents,
    loading,
    saving,
    error,
    fetchLinks,
    selectLink,
    fetchResidentMedicationWorkspace,
    addMedicationSchedule,
    updateResidentStatus,
    updateResidentDetails,
    units,
    addResidentNote,
    stopMedicationSchedule,
    clearError,
  } = useCareHomeStore()
  const { drugSearchResults, searching, searchDrugs, addMedication, clearSearch } = usePatientMedicationStore()
  const [showMedicineForm, setShowMedicineForm] = useState(false)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [medicineQuery, setMedicineQuery] = useState('')
  const [selectedDrug, setSelectedDrug] = useState<BnfDrugSearchResult | null>(null)
  const [medicineForm, setMedicineForm] = useState({ dose: '', quantity: '', notes: '' })
  const [scheduleForm, setScheduleForm] = useState({ medicationId: '', scheduleType: 'regular' as CareHomeMedicationScheduleType, dose: '', route: 'Oral', instructions: '', roundTime: '08:00', days: [1, 2, 3, 4, 5, 6, 7], startDate: new Date().toISOString().slice(0, 10), endDate: '' })
  const [noteForm, setNoteForm] = useState({ noteType: 'general' as CareHomeResidentNoteType, noteDate: new Date().toISOString().slice(0, 10), noteText: '' })
  const [profileForm, setProfileForm] = useState({ unitId: '', roomNumber: '', gpName: '', gpPractice: '', allergies: '', specialInstructions: '' })

  const resident = residents.find((item) => item.id === residentId)
  const canEditMedicines = permissions?.care_home_medications === true
  const activeSchedules = medicationSchedules.filter((schedule) => schedule.lifecycle_status === 'active')
  const historicSchedules = medicationSchedules.filter((schedule) => schedule.lifecycle_status !== 'active')

  useEffect(() => {
    const load = async () => {
      if (!organisation?.id || !linkId || !residentId) return
      if (!residents.some((item) => item.care_home_link_id === linkId)) {
        await fetchLinks(organisation.id, organisation.organisation_type ?? 'pharmacy')
        await selectLink(linkId)
      }
      await fetchResidentMedicationWorkspace(residentId)
    }
    void load()
  }, [organisation?.id, organisation?.organisation_type, linkId, residentId, fetchLinks, selectLink, fetchResidentMedicationWorkspace])

  const handleMedicineSearch = (query: string) => {
    setMedicineQuery(query)
    setSelectedDrug(null)
    void searchDrugs(query)
  }

  const handleAddMedicine = async (event: FormEvent) => {
    event.preventDefault()
    if (!resident?.patient || !selectedDrug) return
    await addMedication({
      organisation_id: resident.patient.organisation_id,
      patient_id: resident.patient_id,
      drug_id: selectedDrug.id,
      drug_name: selectedDrug.name,
      drug_form: selectedDrug.form ?? undefined,
      drug_strength: selectedDrug.activeIngredients || undefined,
      dose: medicineForm.dose || undefined,
      quantity: medicineForm.quantity ? Number(medicineForm.quantity) : undefined,
      notes: medicineForm.notes || undefined,
    })
    await fetchResidentMedicationWorkspace(resident.id)
    setMedicineQuery('')
    setSelectedDrug(null)
    setMedicineForm({ dose: '', quantity: '', notes: '' })
    clearSearch()
    setShowMedicineForm(false)
  }

  const handleAddSchedule = async (event: FormEvent) => {
    event.preventDefault()
    if (!residentId || !activeUser?.id || !scheduleForm.medicationId) return
    await addMedicationSchedule({
      residentId,
      patientMedicationId: scheduleForm.medicationId,
      scheduleType: scheduleForm.scheduleType,
      dose: scheduleForm.dose,
      route: scheduleForm.route,
      instructions: scheduleForm.instructions,
      roundTime: scheduleForm.roundTime,
      administrationDays: scheduleForm.days,
      startDate: scheduleForm.startDate,
      endDate: scheduleForm.endDate || undefined,
      createdBy: activeUser.id,
    })
    setScheduleForm({ medicationId: '', scheduleType: 'regular', dose: '', route: 'Oral', instructions: '', roundTime: '08:00', days: [1, 2, 3, 4, 5, 6, 7], startDate: new Date().toISOString().slice(0, 10), endDate: '' })
    setShowScheduleForm(false)
  }

  const handleAddNote = async (event: FormEvent) => {
    event.preventDefault()
    if (!residentId || !activeUser?.id || !noteForm.noteText.trim()) return
    await addResidentNote(residentId, noteForm.noteType, noteForm.noteDate, noteForm.noteText, activeUser.id)
    setNoteForm({ noteType: 'general', noteDate: new Date().toISOString().slice(0, 10), noteText: '' })
    setShowNoteForm(false)
  }

  const handleStopSchedule = async (scheduleId: string, completed: boolean) => {
    const reason = window.prompt(completed ? 'Why was this course completed?' : 'Why was this medicine stopped?')
    if (!reason?.trim()) return
    await stopMedicationSchedule(scheduleId, reason, completed)
  }

  const openProfileForm = () => {
    setProfileForm({ unitId: resident?.unit_id ?? '', roomNumber: resident?.room_number ?? '', gpName: resident?.gp_name ?? '', gpPractice: resident?.gp_practice ?? '', allergies: resident?.allergies ?? '', specialInstructions: resident?.special_instructions ?? '' })
    setShowProfileForm(true)
  }

  const handleUpdateProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!residentId) return
    await updateResidentDetails(residentId, { unit_id: profileForm.unitId || null, room_number: profileForm.roomNumber, gp_name: profileForm.gpName, gp_practice: profileForm.gpPractice, allergies: profileForm.allergies, special_instructions: profileForm.specialInstructions })
    setShowProfileForm(false)
  }

  if (!resident && loading) return <div className="care-home-loading">Loading resident medication record...</div>
  if (!resident) return <div className="care-home-inline-empty">Resident record not found.</div>

  return (
    <div className="care-home-page care-home-resident-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs"><a href="/care-homes?view=residents" onClick={(event) => { event.preventDefault(); navigate('/care-homes?view=residents') }}>Care homes</a><span className="separator">/</span><span>{fullName(resident.patient?.first_name, resident.patient?.last_name)}</span></div>
        <div className="care-home-title-row">
          <div><p className="care-home-eyebrow">Resident medication record</p><h1>{fullName(resident.patient?.first_name, resident.patient?.last_name)}</h1><p className="care-home-subtitle">{resident.unit?.name ? `${resident.unit.name} · ` : ''}Room {resident.room_number ?? 'not set'} · NHS {resident.patient?.nhs_number ?? 'not recorded'} · {resident.status}</p></div>
          <div className="care-home-heading-actions"><button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate('/care-homes?view=residents')}>Back to residents</button><button className="ps-btn ps-btn-primary" type="button" onClick={openProfileForm}>Edit profile</button></div>
        </div>
      </div>

      {error && <div className="auth-error care-home-alert" role="alert"><span>{error}</span><button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button></div>}

      <div className="care-home-resident-summary">
        <dl><div><dt>Resident status</dt><dd><select className="ps-input" value={resident.status} disabled={saving} onChange={(event) => void updateResidentStatus(resident.id, event.target.value as typeof resident.status)}><option value="active">Active</option><option value="hospital">In hospital</option><option value="leave">On leave</option><option value="discharged">Discharged</option><option value="deceased">Deceased</option></select><small>Only active residents are included in automatic repeat requests.</small></dd></div><div><dt>Allergies</dt><dd>{resident.allergies || 'None recorded'}</dd></div><div><dt>GP</dt><dd>{resident.gp_name || 'Not set'}{resident.gp_practice ? `, ${resident.gp_practice}` : ''}</dd></div><div><dt>Special instructions</dt><dd>{resident.special_instructions || 'None recorded'}</dd></div></dl>
      </div>
      {showProfileForm && <form className="care-home-request-form" onSubmit={(event) => void handleUpdateProfile(event)}><label>Unit<select className="ps-input" value={profileForm.unitId} onChange={(event) => setProfileForm({ ...profileForm, unitId: event.target.value })}><option value="">Unassigned</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.floor_name ? ` · ${unit.floor_name}` : ''}</option>)}</select></label><label>Room<input className="ps-input" value={profileForm.roomNumber} onChange={(event) => setProfileForm({ ...profileForm, roomNumber: event.target.value })} /></label><label>GP name<input className="ps-input" value={profileForm.gpName} onChange={(event) => setProfileForm({ ...profileForm, gpName: event.target.value })} /></label><label>GP practice<input className="ps-input" required value={profileForm.gpPractice} onChange={(event) => setProfileForm({ ...profileForm, gpPractice: event.target.value })} /></label><label>Allergies<textarea className="ps-input" rows={2} value={profileForm.allergies} onChange={(event) => setProfileForm({ ...profileForm, allergies: event.target.value })} /></label><label>Special instructions<textarea className="ps-input" rows={2} value={profileForm.specialInstructions} onChange={(event) => setProfileForm({ ...profileForm, specialInstructions: event.target.value })} /></label><div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowProfileForm(false)}>Cancel</button><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>Save profile</button></div></form>}

      <section className="care-home-clinical-section">
        <div className="care-home-section-heading"><div><p>Resident record</p><h2>Dated notes and incidents</h2></div><button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowNoteForm((visible) => !visible)}>{showNoteForm ? 'Close' : 'Add note'}</button></div>
        {showNoteForm && <form className="care-home-request-form" onSubmit={(event) => void handleAddNote(event)}><label>Type<select className="ps-input" value={noteForm.noteType} onChange={(event) => setNoteForm({ ...noteForm, noteType: event.target.value as CareHomeResidentNoteType })}><option value="general">General</option><option value="clinical">Clinical</option><option value="hospital">Hospital / leave</option><option value="incident">Incident</option><option value="medication">Medication</option><option value="communication">Communication</option></select></label><label>Date<input className="ps-input" type="date" required value={noteForm.noteDate} onChange={(event) => setNoteForm({ ...noteForm, noteDate: event.target.value })} /></label><label className="care-home-form-span-2">Note<textarea className="ps-input" rows={3} required value={noteForm.noteText} onChange={(event) => setNoteForm({ ...noteForm, noteText: event.target.value })} /></label><div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>Save dated note</button></div></form>}
        {residentNotes.length === 0 ? <div className="care-home-inline-empty">No dated notes have been added.</div> : <ol className="care-home-resident-timeline">{residentNotes.map((note) => <li key={note.id}><time>{new Date(`${note.note_date}T00:00:00`).toLocaleDateString('en-GB')}</time><div><span className={`ps-badge ${note.note_type === 'incident' ? 'ps-badge-danger' : note.note_type === 'hospital' ? 'ps-badge-warning' : 'ps-badge-blue'}`}>{note.note_type}</span><p>{note.note_text}</p></div></li>)}</ol>}
      </section>

      <section className="care-home-clinical-section">
        <div className="care-home-section-heading"><div><p>PMR medicines</p><h2>Regular, repeat and acute medicines</h2></div>{canEditMedicines && <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowMedicineForm((visible) => !visible)}>{showMedicineForm ? 'Close' : 'Add medicine'}</button>}</div>
        {showMedicineForm && canEditMedicines && <form className="care-home-request-form" onSubmit={(event) => void handleAddMedicine(event)}><label className="care-home-form-span-2">Search dm+d medicines<input className="ps-input" value={medicineQuery} placeholder="Medicine, strength or form" onChange={(event) => handleMedicineSearch(event.target.value)} /></label>{searching && <p>Searching medicines...</p>}{drugSearchResults.length > 0 && <div className="care-home-patient-results care-home-form-span-2">{drugSearchResults.map((drug) => <button key={drug.id} type="button" className={selectedDrug?.id === drug.id ? 'selected' : ''} onClick={() => { setSelectedDrug(drug); setMedicineQuery(drug.name) }}><strong>{drug.name}</strong><span>{[drug.form, drug.brand_name, drug.manufacturer].filter(Boolean).join(' · ')}</span></button>)}</div>}<label>Default dose<input className="ps-input" value={medicineForm.dose} onChange={(event) => setMedicineForm({ ...medicineForm, dose: event.target.value })} /></label><label>Quantity<input className="ps-input" type="number" min="1" value={medicineForm.quantity} onChange={(event) => setMedicineForm({ ...medicineForm, quantity: event.target.value })} /></label><label className="care-home-form-span-2">Notes<textarea className="ps-input" rows={2} value={medicineForm.notes} onChange={(event) => setMedicineForm({ ...medicineForm, notes: event.target.value })} /></label><div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={!selectedDrug}>Add to PMR medicines</button></div></form>}
        {residentMedications.length === 0 ? <div className="care-home-inline-empty">No active PMR medicines. Add a medicine before configuring rounds.</div> : <div className="care-home-medication-list">{residentMedications.map((medicine) => <article key={medicine.id}><div><strong>{medicine.drug_name}</strong><span>{[medicine.drug_strength, medicine.drug_form].filter(Boolean).join(' · ') || 'Form and strength not recorded'}</span></div><div><span>{medicine.dose || 'Dose not set'}</span><small>{medicine.quantity ? `Quantity ${medicine.quantity}` : ''}</small></div></article>)}</div>}
      </section>

      <section className="care-home-clinical-section">
        <div className="care-home-section-heading"><div><p>Administration rounds</p><h2>Reusable times and doses</h2></div>{canEditMedicines && <button className="ps-btn ps-btn-primary" type="button" disabled={residentMedications.length === 0} onClick={() => setShowScheduleForm((visible) => !visible)}>{showScheduleForm ? 'Close' : 'Add round'}</button>}</div>
        {showScheduleForm && canEditMedicines && <form className="care-home-request-form" onSubmit={(event) => void handleAddSchedule(event)}><label>Medicine<select className="ps-input" required value={scheduleForm.medicationId} onChange={(event) => { const medicationId = event.target.value; const medicine = residentMedications.find((item) => item.id === medicationId); setScheduleForm({ ...scheduleForm, medicationId, dose: medicine?.dose || scheduleForm.dose }) }}><option value="">Select medicine</option>{residentMedications.map((medicine) => <option key={medicine.id} value={medicine.id}>{medicine.drug_name}</option>)}</select></label><label>Type<select className="ps-input" value={scheduleForm.scheduleType} onChange={(event) => setScheduleForm({ ...scheduleForm, scheduleType: event.target.value as CareHomeMedicationScheduleType })}><option value="regular">Regular</option><option value="repeat">Repeat</option><option value="acute">Acute</option><option value="prn">PRN / when required</option></select></label><label>Dose<input className="ps-input" required value={scheduleForm.dose} onChange={(event) => setScheduleForm({ ...scheduleForm, dose: event.target.value })} /></label><label>Route<input className="ps-input" value={scheduleForm.route} onChange={(event) => setScheduleForm({ ...scheduleForm, route: event.target.value })} /></label>{scheduleForm.scheduleType !== 'prn' && <label>Round time<input className="ps-input" type="time" required value={scheduleForm.roundTime} onChange={(event) => setScheduleForm({ ...scheduleForm, roundTime: event.target.value })} /></label>}<label>Start date<input className="ps-input" type="date" required value={scheduleForm.startDate} onChange={(event) => setScheduleForm({ ...scheduleForm, startDate: event.target.value })} /></label><label>End date<input className="ps-input" type="date" value={scheduleForm.endDate} onChange={(event) => setScheduleForm({ ...scheduleForm, endDate: event.target.value })} /></label><fieldset className="care-home-weekdays care-home-form-span-2"><legend>Administration days</legend>{weekdays.map((day) => <label key={day.value}><input type="checkbox" checked={scheduleForm.days.includes(day.value)} onChange={() => setScheduleForm({ ...scheduleForm, days: scheduleForm.days.includes(day.value) ? scheduleForm.days.filter((value) => value !== day.value) : [...scheduleForm.days, day.value].sort() })} />{day.label}</label>)}</fieldset><label className="care-home-form-span-2">Instructions<textarea className="ps-input" rows={2} value={scheduleForm.instructions} onChange={(event) => setScheduleForm({ ...scheduleForm, instructions: event.target.value })} /></label><div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving || scheduleForm.days.length === 0}>{saving ? 'Saving...' : 'Save round'}</button></div></form>}
        {activeSchedules.length === 0 ? <div className="care-home-inline-empty">No active administration rounds configured.</div> : <div className="care-home-table-wrap"><table className="care-home-table"><thead><tr><th>Time</th><th>Medicine</th><th>Dose</th><th>Type</th><th>Days</th><th>Dates</th><th>Actions</th></tr></thead><tbody>{activeSchedules.map((schedule) => <tr key={schedule.id}><td>{schedule.round_time?.slice(0, 5) ?? 'PRN'}</td><td><strong>{schedule.patient_medication?.drug_name}</strong><small>{schedule.instructions}</small></td><td>{schedule.dose}<small>{schedule.route}</small></td><td><span className={`ps-badge ${schedule.schedule_type === 'acute' ? 'ps-badge-danger' : 'ps-badge-blue'}`}>{schedule.schedule_type}</span></td><td>{schedule.administration_days.map((day) => weekdays.find((item) => item.value === day)?.label).join(', ')}</td><td>{schedule.start_date}{schedule.end_date ? ` to ${schedule.end_date}` : ' onwards'}</td><td className="care-home-row-actions">{canEditMedicines && <><button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" onClick={() => void handleStopSchedule(schedule.id, false)}>Stop</button>{schedule.schedule_type === 'acute' && <button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" onClick={() => void handleStopSchedule(schedule.id, true)}>Course complete</button>}</>}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="care-home-clinical-section">
        <div className="care-home-section-heading"><div><p>Permanent history</p><h2>Stopped medicines and past acute courses</h2></div></div>
        {historicSchedules.length === 0 && medicationEvents.length === 0 ? <div className="care-home-inline-empty">No stopped or completed medicines are recorded.</div> : <><div className="care-home-table-wrap"><table className="care-home-table"><thead><tr><th>Medicine</th><th>Type</th><th>Outcome</th><th>Dates</th><th>Reason</th></tr></thead><tbody>{historicSchedules.map((schedule) => <tr key={schedule.id}><td><strong>{schedule.patient_medication?.drug_name}</strong></td><td>{schedule.schedule_type}</td><td><span className={`ps-badge ${schedule.lifecycle_status === 'stopped' ? 'ps-badge-danger' : 'ps-badge-success'}`}>{schedule.lifecycle_status}</span></td><td>{schedule.start_date} to {schedule.end_date || schedule.stopped_at?.slice(0, 10)}</td><td>{schedule.stop_reason}</td></tr>)}</tbody></table></div><ol className="care-home-medication-events">{medicationEvents.map((event) => <li key={event.id}><time>{new Date(`${event.event_date}T00:00:00`).toLocaleDateString('en-GB')}</time><div><strong>{event.summary}</strong>{event.reason && <span>{event.reason}</span>}</div></li>)}</ol></>}
      </section>

      <section className="care-home-clinical-section">
        <div className="care-home-section-heading"><div><p>Supply history</p><h2>Packed, delivered and received medicines</h2></div></div>
        {residentSupplyPackages.length === 0 ? <div className="care-home-inline-empty">No medicine packages have been created for this resident.</div> : <div className="care-home-resident-supply-history">{residentSupplyPackages.map((carePackage) => <article key={carePackage.id}><header><div><strong>Batch #{carePackage.batch?.batch_number} · {carePackage.batch?.title}</strong><span>{carePackage.batch?.period_start} to {carePackage.batch?.period_end}</span></div><span className={`ps-badge ${carePackage.package_status === 'received' ? 'ps-badge-success' : carePackage.package_status === 'discrepancy' ? 'ps-badge-danger' : 'ps-badge-blue'}`}>{carePackage.package_status}</span></header><div className="care-home-table-wrap"><table className="care-home-table"><thead><tr><th>Medicine</th><th>Type</th><th>Expected</th><th>Packed</th><th>Sent</th><th>Received</th><th>Outcome</th></tr></thead><tbody>{(carePackage.lines ?? []).map((line) => <tr key={line.id}><td><strong>{line.medicine_name}</strong><small>{[line.strength, line.form].filter(Boolean).join(' · ')}</small></td><td><span className={`ps-badge ${line.supply_type === 'acute' ? 'ps-badge-danger' : 'ps-badge-blue'}`}>{line.supply_type}</span></td><td>{line.quantity_expected}</td><td>{line.quantity_packed}</td><td>{line.quantity_sent}</td><td>{line.quantity_received ?? '-'}</td><td>{line.omission_reason || line.discrepancy_notes || line.line_status}</td></tr>)}</tbody></table></div></article>)}</div>}
      </section>
    </div>
  )
}