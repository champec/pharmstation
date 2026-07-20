import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore, useCareHomeStore, usePatientMedicationStore } from '@pharmstation/core'
import type {
  DeliveryRoundStatus,
  DeliveryPatientStatus,
  DeliveryRoundPatient,
  BnfDrugSearchResult,
} from '@pharmstation/types'
import { DeliveryRouteMap } from '../../components/maps/DeliveryRouteMap'

const ROUND_STATUS_BADGE: Record<DeliveryRoundStatus, { cls: string; label: string }> = {
  draft: { cls: 'ps-badge-muted', label: 'Draft' },
  scheduled: { cls: 'ps-badge-primary', label: 'Scheduled' },
  in_progress: { cls: 'ps-badge-blue', label: 'Out for delivery' },
  completed: { cls: 'ps-badge-success', label: 'Completed' },
  cancelled: { cls: 'ps-badge-danger', label: 'Cancelled' },
}

const PATIENT_STATUS_BADGE: Record<DeliveryPatientStatus, { cls: string; label: string }> = {
  pending: { cls: 'ps-badge-muted', label: 'Pending' },
  in_transit: { cls: 'ps-badge-blue', label: 'In transit' },
  arrived: { cls: 'ps-badge-warning', label: 'Arrived' },
  delivered: { cls: 'ps-badge-success', label: 'Delivered' },
  failed: { cls: 'ps-badge-danger', label: 'Failed' },
  skipped: { cls: 'ps-badge-warning', label: 'Skipped' },
  pending_redelivery: { cls: 'ps-badge-danger', label: 'Pending redelivery' },
  moved_to_round: { cls: 'ps-badge-blue', label: 'Moved' },
  returned: { cls: 'ps-badge-muted', label: 'Returned' },
  cancelled: { cls: 'ps-badge-danger', label: 'Cancelled' },
}

function patientName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed patient'
}

export function DeliveryRoundDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { organisation, membership } = useAuthStore()
  const {
    activeRound: round,
    loading,
    error,
    fetchRound,
    startRound,
    completeRound,
    cancelRound,
    saveAsTemplate,
    repeatRound,
    sendRoundNotifications,
    subscribeToRound,
    addMedicationToRoundPatient,
    removeMedicationFromRoundPatient,
    clearError,
  } = useDeliveryRoundStore()

  const [saving, setSaving] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const { groups, links, fetchLinks } = useCareHomeStore()
  const {
    medications: patientMeds,
    drugSearchResults,
    searching,
    fetchMedications,
    addMedication,
    searchDrugs,
    clearSearch,
  } = usePatientMedicationStore()

  // Meds manager modal state
  const [medsPatient, setMedsPatient] = useState<DeliveryRoundPatient | null>(null)
  const [showNewMedForm, setShowNewMedForm] = useState(false)
  const [medQuery, setMedQuery] = useState('')
  const [selectedDrug, setSelectedDrug] = useState<BnfDrugSearchResult | null>(null)
  const [newMedForm, setNewMedForm] = useState({ dose: '', quantity: '', addToDelivery: true, addToRecord: true })
  const [actionError, setActionError] = useState<string | null>(null)

  const careHomeGroup = round?.care_home_batch_id
    ? groups.find((g) => g.delivery_round_id === round.id || g.active_batch_id === round.care_home_batch_id) ?? null
    : null
  const careHomeLinkId = careHomeGroup?.care_home_link_id ?? null

  const load = useCallback(() => {
    if (id) fetchRound(id)
  }, [id, fetchRound])

  useEffect(() => {
    if (organisation?.id && links.length === 0) void fetchLinks(organisation.id, 'pharmacy')
  }, [organisation?.id, links.length, fetchLinks])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!id) return
    const unsub = subscribeToRound(id)
    return unsub
  }, [id, subscribeToRound])

  // Load the patient's permanent medicines whenever the meds modal opens
  useEffect(() => {
    if (medsPatient?.patient_id) void fetchMedications(medsPatient.patient_id)
  }, [medsPatient?.patient_id, fetchMedications])

  // Debounced drug search inside the meds modal
  useEffect(() => {
    if (!medQuery || medQuery.length < 2) { clearSearch(); return }
    const timer = setTimeout(() => { void searchDrugs(medQuery) }, 300)
    return () => clearTimeout(timer)
  }, [medQuery, searchDrugs, clearSearch])

  const handleStart = async () => {
    if (!id) return
    setSaving(true)
    try { await startRound(id) } catch {}
    setSaving(false)
  }

  const handleComplete = async () => {
    if (!id) return
    setSaving(true)
    try { await completeRound(id) } catch {}
    setSaving(false)
  }

  const handleCancel = async () => {
    if (!id || !confirm('Cancel this delivery?')) return
    setSaving(true)
    try { await cancelRound(id) } catch {}
    setSaving(false)
  }

  const handleSaveTemplate = async () => {
    if (!id || !organisation?.id || !membership?.user_id) return
    const name = prompt('Template name:')
    if (!name) return
    setSaving(true)
    try {
      await saveAsTemplate(id, name, organisation.id, membership.user_id)
      alert('Saved as template!')
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleRepeat = async () => {
    if (!id || !organisation?.id || !membership?.user_id) return
    setSaving(true)
    try {
      const newRound = await repeatRound(id, organisation.id, membership.user_id)
      navigate(`/deliveries/${newRound.id}`)
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleNotifyPatients = async () => {
    if (!id || !organisation?.id) return
    if (!confirm('Send SMS notifications to all patients in this delivery?')) return
    setNotifying(true)
    try {
      const result = await sendRoundNotifications(id, organisation.id)
      alert(`Notifications sent: ${result.sent} successful, ${result.failed} failed.`)
    } catch (e: any) {
      alert(`Failed to send notifications: ${e.message}`)
    }
    setNotifying(false)
  }

  const openMedsManager = (rp: DeliveryRoundPatient) => {
    setMedsPatient(rp)
    setShowNewMedForm(false)
    setMedQuery('')
    setSelectedDrug(null)
    setNewMedForm({ dose: '', quantity: '', addToDelivery: true, addToRecord: true })
    setActionError(null)
    clearSearch()
  }

  const closeMedsManager = () => {
    setMedsPatient(null)
    clearSearch()
  }

  // Keep the modal's patient in sync with refreshed round data
  const modalPatient = medsPatient
    ? round?.patients?.find((p) => p.id === medsPatient.id) ?? medsPatient
    : null

  const deliveryMedIds = new Set((modalPatient?.medications ?? []).map((m) => m.patient_medication_id))

  const handleAddExisting = async (patientMedicationId: string) => {
    if (!id || !modalPatient) return
    setActionError(null)
    try {
      await addMedicationToRoundPatient(id, modalPatient.id, patientMedicationId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to add medicine to this delivery')
    }
  }

  const handleRemoveDelivery = async (deliveryMedicationId: string) => {
    if (!id) return
    setActionError(null)
    try {
      await removeMedicationFromRoundPatient(id, deliveryMedicationId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to remove medicine')
    }
  }

  const handleAddNewMedicine = async (event: FormEvent) => {
    event.preventDefault()
    if (!id || !modalPatient || !selectedDrug || !organisation?.id) return
    setActionError(null)
    try {
      const med = await addMedication({
        organisation_id: organisation.id,
        patient_id: modalPatient.patient_id,
        drug_id: selectedDrug.id,
        drug_name: selectedDrug.name,
        drug_form: selectedDrug.form ?? undefined,
        drug_strength: selectedDrug.activeIngredients || undefined,
        dose: newMedForm.dose || undefined,
        quantity: newMedForm.quantity ? Number(newMedForm.quantity) : undefined,
      })
      if (newMedForm.addToDelivery) {
        await addMedicationToRoundPatient(id, modalPatient.id, med.id, newMedForm.quantity ? Number(newMedForm.quantity) : undefined)
      }
      // The medicine is already saved to the patient record via addMedication.
      // addToRecord simply controls whether we keep it after this delivery — we
      // always persist it, so the flag is informational for the pharmacist.
      await fetchMedications(modalPatient.patient_id)
      setShowNewMedForm(false)
      setMedQuery('')
      setSelectedDrug(null)
      setNewMedForm({ dose: '', quantity: '', addToDelivery: true, addToRecord: true })
      clearSearch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to add the medicine')
    }
  }

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const formatTime = (t: string | null) => t ? t.slice(0, 5) : ''
  const formatDatetime = (d: string | null) =>
    d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

  if (loading && !round) {
    return <div className="care-home-loading">Loading delivery…</div>
  }
  if (!round) {
    return (
      <div className="care-home-page">
        <div className="care-home-inline-empty">
          Delivery not found. <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => navigate('/deliveries')}>Back to deliveries</button>
        </div>
      </div>
    )
  }

  const patients = round.patients ?? []
  const delivered = patients.filter((p) => p.status === 'delivered').length
  const failed = patients.filter((p) => ['failed', 'pending_redelivery'].includes(p.status)).length
  const pending = patients.filter((p) => p.status === 'pending').length
  const editable = round.status === 'draft'

  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs">
          <a href="/deliveries" onClick={(e) => { e.preventDefault(); navigate('/deliveries') }}>Deliveries</a>
          <span className="separator">/</span>
          <span>{round.title || round.id.slice(0, 8)}</span>
        </div>
        <button className="ps-btn ps-btn-ghost ps-btn-sm care-home-back-btn care-home-no-print" type="button" onClick={() => navigate('/deliveries')}>
          ← Back to deliveries board
        </button>
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">Delivery{round.care_home_batch_id ? ' · care home' : ''}</p>
            <h1>{round.title || `Delivery ${round.id.slice(0, 8)}`}</h1>
            <p className="care-home-subtitle">
              {formatDate(round.scheduled_date)}
              {round.scheduled_time_start && ` · ${formatTime(round.scheduled_time_start)}`}
              {round.scheduled_time_end && `–${formatTime(round.scheduled_time_end)}`}
            </p>
          </div>
          <div className="care-home-group-state-block">
            <span className={`ps-badge ${ROUND_STATUS_BADGE[round.status]?.cls} care-home-group-state-badge`}>
              {ROUND_STATUS_BADGE[round.status]?.label}
            </span>
          </div>
        </div>
      </div>

      {(error || actionError) && (
        <div className="auth-error care-home-alert" role="alert">
          <span>{actionError ?? error}</span>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => { clearError(); setActionError(null) }}>Dismiss</button>
        </div>
      )}

      <div className="care-home-group-actions care-home-no-print">
        {round.status === 'draft' && (
          <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/deliveries/${round.id}/edit`)}>Edit delivery</button>
        )}
        {round.status === 'scheduled' && (
          <button className="ps-btn ps-btn-primary" type="button" onClick={handleStart} disabled={saving}>Start delivery</button>
        )}
        {round.status === 'in_progress' && (
          <button className="ps-btn ps-btn-primary" type="button" onClick={handleComplete} disabled={saving}>Complete delivery</button>
        )}
        {['scheduled', 'in_progress'].includes(round.status) && (
          <button className="ps-btn ps-btn-secondary" type="button" onClick={handleNotifyPatients} disabled={notifying}>
            {notifying ? 'Sending…' : '📱 Notify patients'}
          </button>
        )}
        {round.status === 'completed' && (
          <>
            <button className="ps-btn ps-btn-secondary" type="button" onClick={handleRepeat} disabled={saving}>Repeat delivery</button>
            <button className="ps-btn ps-btn-secondary" type="button" onClick={handleSaveTemplate} disabled={saving}>Save as template</button>
          </>
        )}
        {['draft', 'scheduled'].includes(round.status) && (
          <button className="ps-btn ps-btn-ghost" type="button" onClick={handleCancel} disabled={saving} style={{ color: 'var(--ps-red)' }}>Cancel delivery</button>
        )}
      </div>

      {round.care_home_batch_id && (
        <div className="care-home-delivery-link">
          <div>
            <strong>Care-home medicine delivery{careHomeGroup ? ` · ${careHomeGroup.name}` : ''}</strong>
            <span>
              {careHomeGroup
                ? `Linked to the "${careHomeGroup.name}" group — group state updates automatically as this delivery progresses.`
                : 'This route was generated from a packed care-home supply batch. Packing and receipt reconciliation are managed in Care Homes.'}
            </span>
          </div>
          {careHomeGroup && careHomeLinkId && (
            <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/care-homes/${careHomeLinkId}/groups/${careHomeGroup.id}`)}>View group</button>
          )}
          <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/care-homes/supplies/${round.care_home_batch_id}`)}>Open supply batch</button>
        </div>
      )}

      <div className="care-home-metrics">
        <article><span>Patients</span><strong>{patients.length}</strong><small>on this delivery</small></article>
        <article><span>Delivered</span><strong>{delivered}</strong><small>signed off</small></article>
        <article><span>Failed</span><strong>{failed}</strong><small>need redelivery</small></article>
        <article><span>Pending</span><strong>{pending}</strong><small>awaiting delivery</small></article>
      </div>

      {round.driver && (
        <p className="care-home-subtitle">🚗 Driver: {(round.driver as any).user_profile?.full_name}</p>
      )}
      {round.notes && (
        <p className="care-home-subtitle">📝 {round.notes}</p>
      )}

      {patients.length > 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', margin: 'var(--ps-space-md) 0' }}>
          <h3 style={{ marginBottom: 'var(--ps-space-sm)' }}>🗺️ Route map</h3>
          <DeliveryRouteMap
            patients={patients}
            roundId={round.id}
            driverId={round.driver_id}
            height={350}
            showDriverLocation={round.status === 'in_progress'}
          />
        </div>
      )}

      <div className="care-home-section-heading">
        <div><p>Stops on this delivery</p><h2>{patients.length} patient{patients.length === 1 ? '' : 's'}</h2></div>
      </div>

      {patients.length === 0 ? (
        <div className="care-home-inline-empty">
          No patients on this delivery yet.{editable ? ' Edit the delivery to add patients.' : ''}
        </div>
      ) : (
        <div className="care-home-kanban-cards" style={{ gridTemplateColumns: '1fr' }}>
          {patients
            .slice()
            .sort((a, b) => a.delivery_order - b.delivery_order)
            .map((rp) => {
              const meds = rp.medications ?? []
              return (
                <div key={rp.id} className="care-home-split-item" style={{ alignItems: 'flex-start' }}>
                  <span className="care-home-split-item-main">
                    <strong>#{rp.delivery_order} · {patientName((rp.patient as any)?.first_name, (rp.patient as any)?.last_name)}</strong>
                    <small>
                      {rp.delivery_address_line_1 || (rp.patient as any)?.address_line_1 || 'No address'}
                      {(rp.delivery_postcode || (rp.patient as any)?.postcode) ? `, ${rp.delivery_postcode || (rp.patient as any)?.postcode}` : ''}
                    </small>
                    <small>{meds.length} medicine{meds.length === 1 ? '' : 's'} on this delivery</small>
                    {meds.length > 0 && (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {meds.map((dm) => (
                          <span key={dm.id} className="ps-badge ps-badge-muted">
                            {(dm.patient_medication as any)?.drug_name ?? 'Unknown'}{dm.quantity ? ` ×${dm.quantity}` : ''}
                          </span>
                        ))}
                      </span>
                    )}
                    {rp.notes && <small>📝 {rp.notes}</small>}
                    {rp.failure_reason && <small style={{ color: 'var(--ps-red)' }}>⚠️ {rp.failure_reason}</small>}
                    {rp.delivered_at && <small style={{ color: 'var(--ps-green)' }}>✓ Delivered {formatDatetime(rp.delivered_at)}</small>}
                    {rp.signature_data && <small>✍️ Signature captured</small>}
                  </span>
                  <span className="care-home-split-item-actions" style={{ alignItems: 'center' }}>
                    <span className={`ps-badge ${PATIENT_STATUS_BADGE[rp.status]?.cls}`}>
                      {PATIENT_STATUS_BADGE[rp.status]?.label}
                    </span>
                    <button className="ps-btn ps-btn-secondary ps-btn-sm care-home-no-print" type="button" onClick={() => openMedsManager(rp)}>
                      Manage medicines
                    </button>
                  </span>
                </div>
              )
            })}
        </div>
      )}

      <div className="care-home-section-heading">
        <div><p>Timeline</p><h2>Delivery history</h2></div>
      </div>
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
        <div style={{ fontSize: 'var(--ps-font-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-xs)' }}>
          <div>📋 Created: {formatDatetime(round.created_at)}</div>
          {round.started_at && <div>🚀 Started: {formatDatetime(round.started_at)}</div>}
          {round.completed_at && <div>✅ Completed: {formatDatetime(round.completed_at)}</div>}
        </div>
      </div>

      {modalPatient && (
        <>
          <div className="modal-backdrop" onClick={closeMedsManager} />
          <div className="modal-container">
            <div className="modal-dialog" style={{ maxWidth: 760 }} role="dialog" aria-modal="true" aria-label="Manage medicines">
              <div className="modal-header">
                <h2>Medicines · {patientName((modalPatient.patient as any)?.first_name, (modalPatient.patient as any)?.last_name)}</h2>
                <button className="ps-btn ps-btn-ghost ps-btn-sm modal-close" type="button" onClick={closeMedsManager}>✕</button>
              </div>
              <div className="modal-body">
                <div className="care-home-group-actions care-home-no-print" style={{ marginTop: 0 }}>
                  <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/patients/${modalPatient.patient_id}`)}>Open patient record</button>
                  {editable && (
                    <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowNewMedForm((v) => !v)}>
                      {showNewMedForm ? 'Close' : 'Add new medicine'}
                    </button>
                  )}
                </div>

                {showNewMedForm && editable && (
                  <form className="care-home-request-form care-home-no-print" onSubmit={(e) => void handleAddNewMedicine(e)}>
                    <label className="care-home-form-span-2">Search dm+d medicines
                      <input className="ps-input" placeholder="Start typing a medicine name..." value={medQuery}
                        onChange={(e) => { setMedQuery(e.target.value); setSelectedDrug(null) }} />
                    </label>
                    {searching && <p className="care-home-form-help care-home-form-span-2">Searching...</p>}
                    {!selectedDrug && drugSearchResults.length > 0 && (
                      <ul className="care-home-drug-results care-home-form-span-2">
                        {drugSearchResults.slice(0, 8).map((drug) => (
                          <li key={drug.id}>
                            <button type="button" onClick={() => { setSelectedDrug(drug); clearSearch() }}>
                              <strong>{drug.name}</strong>
                              <small>{[drug.form, drug.activeIngredients].filter(Boolean).join(' · ')}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {selectedDrug && (
                      <p className="care-home-form-help care-home-form-span-2">Selected: <strong>{selectedDrug.name}</strong> <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => setSelectedDrug(null)}>Change</button></p>
                    )}
                    <label>Dose<input className="ps-input" placeholder="e.g. One tablet daily" value={newMedForm.dose} onChange={(e) => setNewMedForm({ ...newMedForm, dose: e.target.value })} /></label>
                    <label>Quantity<input className="ps-input" type="number" min="0" placeholder="28" value={newMedForm.quantity} onChange={(e) => setNewMedForm({ ...newMedForm, quantity: e.target.value })} /></label>
                    <label className="care-home-check-label"><input type="checkbox" checked={newMedForm.addToDelivery} onChange={(e) => setNewMedForm({ ...newMedForm, addToDelivery: e.target.checked })} />Add to this delivery</label>
                    <label className="care-home-check-label"><input type="checkbox" checked disabled />Save to permanent patient record</label>
                    <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={!selectedDrug}>Add medicine</button></div>
                  </form>
                )}

                <div className="care-home-split">
                  <section className="care-home-split-panel">
                    <div className="care-home-split-panel-header">
                      <div><p>Patient record (PMR)</p><h2>{patientMeds.length} on file</h2></div>
                    </div>
                    {patientMeds.length === 0 ? (
                      <div className="care-home-inline-empty">No medicines on this patient's record.</div>
                    ) : (
                      <ul className="care-home-split-list">
                        {patientMeds.map((med) => {
                          const inDelivery = deliveryMedIds.has(med.id)
                          return (
                            <li key={med.id} className={`care-home-split-item ${inDelivery ? 'in-bag' : ''}`}>
                              <span className="care-home-split-item-main">
                                <strong>{med.drug_name}</strong>
                                <small>{[med.drug_strength, med.drug_form].filter(Boolean).join(' · ') || '—'}</small>
                                <small>{med.dose ?? 'No dose recorded'} · qty {med.quantity ?? '—'}</small>
                              </span>
                              <span className="care-home-split-item-actions">
                                {inDelivery ? (
                                  <span className="ps-badge ps-badge-success">In delivery</span>
                                ) : editable ? (
                                  <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" onClick={() => void handleAddExisting(med.id)}>Add</button>
                                ) : null}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>

                  <section className="care-home-split-panel">
                    <div className="care-home-split-panel-header">
                      <div><p>On this delivery</p><h2>{(modalPatient.medications ?? []).length} medicine{(modalPatient.medications ?? []).length === 1 ? '' : 's'}</h2></div>
                    </div>
                    {(modalPatient.medications ?? []).length === 0 ? (
                      <div className="care-home-inline-empty">No medicines added to this delivery yet.</div>
                    ) : (
                      <ul className="care-home-split-list">
                        {(modalPatient.medications ?? []).map((dm) => (
                          <li key={dm.id} className="care-home-split-item">
                            <span className="care-home-split-item-main">
                              <strong>{(dm.patient_medication as any)?.drug_name ?? 'Unknown medicine'}</strong>
                              <small>{[(dm.patient_medication as any)?.drug_strength, (dm.patient_medication as any)?.drug_form].filter(Boolean).join(' · ') || '—'}</small>
                              <small>Quantity {dm.quantity ?? '—'}{dm.notes ? ` · ${dm.notes}` : ''}</small>
                            </span>
                            <span className="care-home-split-item-actions">
                              {editable && (
                                <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => void handleRemoveDelivery(dm.id)}>Remove</button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
              <div className="modal-footer">
                <button className="ps-btn ps-btn-secondary" type="button" onClick={closeMedsManager}>Done</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
