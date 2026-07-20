import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore, usePatientMedicationStore, useAppointmentStore } from '@pharmstation/core'
import type { Patient, PatientMedication } from '@pharmstation/types'
import { resolvePermissions } from '@pharmstation/types'

export function EditDeliveryRoundPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    activeRound: round,
    loading,
    fetchRound,
    updateRound,
    addPatientToRound,
    removePatientFromRound,
    assignDriver,
    fetchAvailableDrivers,
    availableDrivers,
    clearError,
  } = useDeliveryRoundStore()
  const { searchPatients, patients: searchedPatients } = useAppointmentStore()
  const { medications, fetchMedications } = usePatientMedicationStore()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [driverId, setDriverId] = useState('')
  const [notes, setNotes] = useState('')
  const [patientSearch, setPatientSearch] = useState('')

  const load = useCallback(() => {
    if (id) fetchRound(id)
    if (organisation?.id) fetchAvailableDrivers(organisation.id)
  }, [id, organisation?.id, fetchRound, fetchAvailableDrivers])

  useEffect(() => { load() }, [load])

  // Populate form when round loads
  useEffect(() => {
    if (round) {
      setTitle(round.title || '')
      setScheduledDate(round.scheduled_date || '')
      setTimeStart(round.scheduled_time_start || '')
      setTimeEnd(round.scheduled_time_end || '')
      setDriverId(round.driver_id || '')
      setNotes(round.notes || '')
    }
  }, [round])

  const drivers = availableDrivers.filter((d) => {
    const perms = resolvePermissions(d.role, d.permissions)
    return perms.delivery_drive
  })

  const handlePatientSearch = useCallback(async () => {
    if (!organisation?.id || patientSearch.length < 2) return
    await searchPatients(organisation.id, patientSearch)
  }, [organisation?.id, patientSearch, searchPatients])

  useEffect(() => {
    const timer = setTimeout(handlePatientSearch, 300)
    return () => clearTimeout(timer)
  }, [handlePatientSearch])

  const handleAddPatient = async (patient: Patient) => {
    if (!id || !organisation?.id) return
    // Check if already in round
    if (round?.patients?.find((rp) => rp.patient_id === patient.id)) return
    setSaving(true)
    try {
      await fetchMedications(patient.id)
      const patMeds = usePatientMedicationStore.getState().medications
      const activeMeds = patMeds
        .filter((m) => m.is_active)
        .map((m) => ({ patient_medication_id: m.id, quantity: m.quantity ?? 1 }))
      const nextOrder = (round?.patients?.length ?? 0) + 1
      await addPatientToRound(id, organisation.id, patient.id, nextOrder, activeMeds)
      setPatientSearch('')
    } catch (e: any) {
      setError(e.message)
    }
    setSaving(false)
  }

  const handleRemovePatient = async (rpId: string) => {
    if (!confirm('Remove this patient from the round?')) return
    setSaving(true)
    try { await removePatientFromRound(rpId) } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  const handleSave = async () => {
    if (!id) return
    setSaving(true)
    setError(null)
    try {
      await updateRound(id, {
        title: title.trim() || null,
        scheduled_date: scheduledDate || null,
        scheduled_time_start: timeStart || null,
        scheduled_time_end: timeEnd || null,
        notes: notes.trim() || null,
      } as any)
      if (driverId !== (round?.driver_id || '')) {
        await assignDriver(id, driverId || null)
      }
      navigate(`/deliveries/${id}`)
    } catch (e: any) {
      setError(e.message)
    }
    setSaving(false)
  }

  if (loading && !round) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading…</div>
  }
  if (!round || !['draft', 'scheduled'].includes(round.status)) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Cannot edit this round</div>
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/deliveries" onClick={(e) => { e.preventDefault(); navigate('/deliveries') }}>Deliveries</a>
          <span className="separator">/</span>
          <a href={`/deliveries/${id}`} onClick={(e) => { e.preventDefault(); navigate(`/deliveries/${id}`) }}>{round.title || round.id.slice(0, 8)}</a>
          <span className="separator">/</span>
          <span>Edit</span>
        </div>
        <h1>✏️ Edit Delivery Round</h1>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      {/* Round details */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>Round Details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
          <div className="form-group">
            <label>Title</label>
            <input className="ps-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning Round" />
          </div>
          <div className="form-group">
            <label>Assign Driver</label>
            <select className="ps-input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">— Select Driver —</option>
              {drivers.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.user_profile?.full_name} ({d.role})
                </option>
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
          <textarea className="ps-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Patients */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ marginBottom: 'var(--ps-space-sm)' }}>Patients ({round.patients?.length ?? 0})</h3>

        <input
          className="ps-input"
          placeholder="Search to add patient..."
          value={patientSearch}
          onChange={(e) => setPatientSearch(e.target.value)}
          style={{ maxWidth: 400, marginBottom: 'var(--ps-space-sm)' }}
        />

        {patientSearch.length >= 2 && searchedPatients.length > 0 && (
          <div style={{ border: '1px solid var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', maxHeight: 160, overflowY: 'auto', marginBottom: 'var(--ps-space-sm)' }}>
            {searchedPatients
              .filter((p) => !round.patients?.find((rp) => rp.patient_id === p.id))
              .map((p) => (
                <div
                  key={p.id}
                  style={{ padding: '6px var(--ps-space-md)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                  onClick={() => handleAddPatient(p)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  <span>{p.first_name} {p.last_name} — {p.postcode}</span>
                  <span style={{ color: 'var(--ps-primary)', fontSize: 'var(--ps-font-sm)' }}>+ Add</span>
                </div>
              ))}
          </div>
        )}

        {round.patients && round.patients.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {round.patients
              .sort((a, b) => a.delivery_order - b.delivery_order)
              .map((rp) => (
                <div key={rp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--ps-off-white)' }}>
                  <div>
                    <span style={{ fontWeight: 500 }}>#{rp.delivery_order} {(rp.patient as any)?.first_name} {(rp.patient as any)?.last_name}</span>
                    <span style={{ color: 'var(--ps-slate)', marginLeft: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
                      {rp.medications?.length ?? 0} med{(rp.medications?.length ?? 0) !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => handleRemovePatient(rp.id)} style={{ color: 'var(--ps-red)' }}>Remove</button>
                </div>
              ))}
          </div>
        ) : (
          <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>No patients added yet.</div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/deliveries/${id}`)}>Cancel</button>
        <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
