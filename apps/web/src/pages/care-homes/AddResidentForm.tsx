import { useState, type FormEvent } from 'react'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import { chDate } from './careHomeLabels'

interface AddResidentFormProps {
  linkId: string
  /** Pre-select a group for the new resident (e.g. when adding from a group). */
  defaultGroupId?: string
  onDone: () => void
}

const emptyDetails = { unitId: '', roomNumber: '', gpName: '', gpPractice: '', allergies: '', specialInstructions: '' }
const emptyPatient = { firstName: '', lastName: '', dob: '', nhsNumber: '' }

function patientName(first?: string, last?: string) {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed patient'
}

/**
 * Adds a resident to a care home. The resident is either an existing patient
 * from the pharmacy's patient records, or a new patient created here.
 */
export function AddResidentForm({ linkId, defaultGroupId, onDone }: AddResidentFormProps) {
  const { organisation, activeUser } = useAuthStore()
  const { units, residents, patientSearchResults, saving, searchPatients, addResident, addNewResident, addResidentToGroup } = useCareHomeStore()
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [patientId, setPatientId] = useState('')
  const [patient, setPatient] = useState(emptyPatient)
  const [details, setDetails] = useState({ ...emptyDetails, unitId: defaultGroupId ?? '' })
  const [formError, setFormError] = useState<string | null>(null)

  const alreadyResident = new Set(residents.map((resident) => resident.patient_id))
  const canSubmit = mode === 'existing' ? Boolean(patientId) : Boolean(patient.firstName.trim() && patient.lastName.trim())

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeUser?.id || !organisation?.id || !canSubmit) return
    setFormError(null)
    const input = {
      linkId,
      roomNumber: details.roomNumber,
      gpName: details.gpName,
      gpPractice: details.gpPractice,
      allergies: details.allergies,
      specialInstructions: details.specialInstructions,
      createdBy: activeUser.id,
    }
    try {
      if (mode === 'existing') {
        await addResident({ ...input, patientId })
      } else {
        await addNewResident({ organisationId: organisation.id, ...patient }, input)
      }
      if (details.unitId) {
        const added = useCareHomeStore.getState().residents.at(-1)
        if (added) await addResidentToGroup(details.unitId, added.id, activeUser.id)
        await useCareHomeStore.getState().selectLink(linkId)
      }
      onDone()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add the resident.'
      setFormError(/duplicate|unique/i.test(message) ? 'This patient is already a resident of this care home.' : message)
    }
  }

  return (
    <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleSubmit(event)}>
      <div className="care-home-form-span-2 care-home-segmented" role="tablist" aria-label="Resident source">
        <button type="button" role="tab" aria-selected={mode === 'existing'} className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Existing patient</button>
        <button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>New patient</button>
      </div>

      {mode === 'existing' ? (
        <>
          <label className="care-home-form-span-2">
            Find patient *
            <input
              className="ps-input"
              placeholder="Name or NHS number"
              value={query}
              onChange={(event) => {
                const value = event.target.value
                setQuery(value)
                setPatientId('')
                if (organisation?.id) void searchPatients(organisation.id, value)
              }}
            />
            <small className="care-home-help">Search your pharmacy's patient records. Not there? Choose "New patient".</small>
          </label>
          {patientSearchResults.length > 0 && !patientId && (
            <div className="care-home-patient-results care-home-form-span-2">
              {patientSearchResults.map((result) => {
                const taken = alreadyResident.has(result.id)
                return (
                  <button
                    key={result.id}
                    type="button"
                    disabled={taken}
                    onClick={() => { setPatientId(result.id); setQuery(patientName(result.first_name, result.last_name)) }}
                  >
                    <strong>{patientName(result.first_name, result.last_name)}</strong>
                    <span>{taken ? 'Already a resident here' : `${result.nhs_number || 'No NHS number'} · ${result.dob ? `Born ${chDate(result.dob)}` : 'Date of birth not set'}`}</span>
                  </button>
                )
              })}
            </div>
          )}
          {query.trim().length >= 2 && patientSearchResults.length === 0 && !patientId && (
            <p className="care-home-help care-home-form-span-2">No patients match "{query.trim()}". <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { setMode('new'); const [first, ...rest] = query.trim().split(' '); setPatient({ ...emptyPatient, firstName: first ?? '', lastName: rest.join(' ') }) }}>Add as new patient</button></p>
          )}
        </>
      ) : (
        <>
          <label>First name *<input className="ps-input" required value={patient.firstName} onChange={(event) => setPatient({ ...patient, firstName: event.target.value })} /></label>
          <label>Last name *<input className="ps-input" required value={patient.lastName} onChange={(event) => setPatient({ ...patient, lastName: event.target.value })} /></label>
          <label>Date of birth<input className="ps-input" type="date" value={patient.dob} onChange={(event) => setPatient({ ...patient, dob: event.target.value })} /></label>
          <label>NHS number<input className="ps-input" inputMode="numeric" value={patient.nhsNumber} onChange={(event) => setPatient({ ...patient, nhsNumber: event.target.value })} /></label>
        </>
      )}

      <label>Group<select className="ps-input" value={details.unitId} onChange={(event) => setDetails({ ...details, unitId: event.target.value })}><option value="">No group yet</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.floor_name ? ` · ${unit.floor_name}` : ''}</option>)}</select></label>
      <label>Room<input className="ps-input" value={details.roomNumber} onChange={(event) => setDetails({ ...details, roomNumber: event.target.value })} /></label>
      <label>GP name<input className="ps-input" value={details.gpName} onChange={(event) => setDetails({ ...details, gpName: event.target.value })} /></label>
      <label>GP practice<input className="ps-input" value={details.gpPractice} onChange={(event) => setDetails({ ...details, gpPractice: event.target.value })} /></label>
      <label>Allergies<textarea className="ps-input" rows={2} value={details.allergies} onChange={(event) => setDetails({ ...details, allergies: event.target.value })} /></label>
      <label>Special instructions<textarea className="ps-input" rows={2} value={details.specialInstructions} onChange={(event) => setDetails({ ...details, specialInstructions: event.target.value })} /></label>

      {formError && <p className="auth-error care-home-form-span-2" role="alert">{formError}</p>}
      <div className="care-home-form-actions care-home-form-span-2">
        <button className="ps-btn ps-btn-ghost" type="button" onClick={onDone}>Cancel</button>
        <button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !canSubmit}>{saving ? 'Adding...' : 'Add resident'}</button>
      </div>
      {!canSubmit && <small className="care-home-help care-home-form-span-2">{mode === 'existing' ? 'Pick a patient from the search results to continue.' : 'Enter a first and last name to continue.'}</small>}
    </form>
  )
}
