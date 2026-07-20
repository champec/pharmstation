import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore, usePatientMedicationStore } from '@pharmstation/core'
import type { BnfDrugSearchResult, CareHomeMedicationSchedule, CareHomeSupplyLine, PatientMedication } from '@pharmstation/types'

function residentName(first?: string, last?: string) {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed resident'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const lineBadge = (status: CareHomeSupplyLine['line_status']) => {
  if (status === 'received') return 'ps-badge-success'
  if (['short', 'over', 'damaged', 'returned', 'omitted'].includes(status)) return 'ps-badge-danger'
  if (status === 'expected') return 'ps-badge-warning'
  return 'ps-badge-blue'
}

interface LeftItem {
  key: string
  med: PatientMedication
  schedule: CareHomeMedicationSchedule | null
  section: 'repeat' | 'acute'
}

export function CareHomeBagPage() {
  const { linkId, groupId, bagId } = useParams<{ linkId: string; groupId: string; bagId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser, permissions } = useAuthStore()
  const {
    activeBag,
    groups,
    residents,
    residentMedications,
    medicationSchedules,
    selectedLinkId,
    loading,
    saving,
    error,
    selectLink,
    fetchBag,
    packBagLine,
    receiveBagLine,
    addBagLine,
    updateBagLine,
    removeBagLine,
    addMedicationSchedule,
    fetchResidentMedicationWorkspace,
    prepareMarCycle,
    clearError,
  } = useCareHomeStore()
  const { drugSearchResults, searching, searchDrugs, addMedication, updateMedication, clearSearch } = usePatientMedicationStore()

  // bag line controls
  const [packQty, setPackQty] = useState<Record<string, string>>({})
  const [omitting, setOmitting] = useState<string | null>(null)
  const [omissionReason, setOmissionReason] = useState('')
  const [editingLine, setEditingLine] = useState<string | null>(null)
  const [editLineForm, setEditLineForm] = useState({ quantity: '', dose: '' })

  // left panel controls
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [editingMed, setEditingMed] = useState<string | null>(null)
  const [editMedForm, setEditMedForm] = useState({ dose: '', quantity: '' })

  // new medicine modal
  const [showNewMedModal, setShowNewMedModal] = useState(false)
  const [medicineQuery, setMedicineQuery] = useState('')
  const [selectedDrug, setSelectedDrug] = useState<BnfDrugSearchResult | null>(null)
  const [newMedForm, setNewMedForm] = useState({ dose: '', quantity: '', scheduleType: 'repeat' as 'repeat' | 'acute', addToBag: true })
  const [actionError, setActionError] = useState<string | null>(null)

  const isCareHome = organisation?.organisation_type === 'carehome'
  const canManage = !isCareHome && permissions?.care_home_manage === true
  const canReceive = isCareHome || canManage

  useEffect(() => {
    if (linkId && linkId !== selectedLinkId) void selectLink(linkId)
  }, [linkId, selectedLinkId, selectLink])

  useEffect(() => {
    if (bagId) void fetchBag(bagId)
  }, [bagId, fetchBag])

  const bag = activeBag?.id === bagId ? activeBag : null
  const batch = bag?.batch ?? null
  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId])
  const lines = useMemo(() => bag?.lines ?? [], [bag])
  const packedCount = lines.filter((line) => !['expected', 'omitted'].includes(line.line_status)).length

  const residentId = bag?.care_home_resident_id ?? null
  const residentLoaded = useMemo(
    () => Boolean(residentId && residents.some((r) => r.id === residentId)),
    [residentId, residents],
  )

  useEffect(() => {
    if (residentId && residentLoaded) void fetchResidentMedicationWorkspace(residentId)
  }, [residentId, residentLoaded, fetchResidentMedicationWorkspace])

  const bagEditable = canManage && bag?.package_status === 'open'

  // ---- Left panel: patient's medicine list, split repeat vs acute ----
  const leftItems = useMemo<LeftItem[]>(() => {
    const items: LeftItem[] = []
    const scheduledMedIds = new Set<string>()
    for (const schedule of medicationSchedules) {
      if (schedule.lifecycle_status !== 'active') continue
      const med = schedule.patient_medication ?? residentMedications.find((m) => m.id === schedule.patient_medication_id)
      if (!med) continue
      scheduledMedIds.add(med.id)
      items.push({
        key: `schedule:${schedule.id}`,
        med,
        schedule,
        section: schedule.schedule_type === 'acute' ? 'acute' : 'repeat',
      })
    }
    for (const med of residentMedications) {
      if (scheduledMedIds.has(med.id)) continue
      items.push({ key: `med:${med.id}`, med, schedule: null, section: 'repeat' })
    }
    return items
  }, [medicationSchedules, residentMedications])

  const linesMedIds = useMemo(() => new Set(lines.map((l) => l.patient_medication_id)), [lines])
  const isInBag = (item: LeftItem) => linesMedIds.has(item.med.id)

  const selectedItems = leftItems.filter((item) => selected[item.key] && !isInBag(item))
  const repeatItems = leftItems.filter((i) => i.section === 'repeat')
  const acuteItems = leftItems.filter((i) => i.section === 'acute')

  // ---- Right panel: bag contents, split repeat vs acute ----
  const repeatLines = lines.filter((l) => l.supply_type !== 'acute')
  const acuteLines = lines.filter((l) => l.supply_type === 'acute')

  const handleAddSelected = async () => {
    if (!bag) return
    setActionError(null)
    try {
      for (const item of selectedItems) {
        await addBagLine(bag.id, {
          patientMedicationId: item.med.id,
          medicationScheduleId: item.schedule?.id ?? null,
          supplyType: item.schedule?.schedule_type ?? 'repeat',
          medicineName: item.med.drug_name,
          form: item.med.drug_form ?? null,
          strength: item.med.drug_strength ?? null,
          dose: item.schedule?.dose ?? item.med.dose ?? null,
          quantityExpected: item.med.quantity ?? 28,
        })
      }
      setSelected({})
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to add medicines to the bag')
    }
  }

  const handleSaveMedEdit = async (item: LeftItem) => {
    setActionError(null)
    try {
      await updateMedication(item.med.id, {
        dose: editMedForm.dose.trim() || null,
        quantity: editMedForm.quantity ? Number(editMedForm.quantity) : null,
      } as Partial<PatientMedication>)
      setEditingMed(null)
      if (residentId) await fetchResidentMedicationWorkspace(residentId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update the medicine')
    }
  }

  const handleSaveLineEdit = async (line: CareHomeSupplyLine) => {
    setActionError(null)
    await updateBagLine(line.id, {
      quantity_expected: editLineForm.quantity ? Number(editLineForm.quantity) : line.quantity_expected,
      dose: editLineForm.dose.trim() || null,
    })
    setEditingLine(null)
  }

  const handleAddNewMedicine = async (event: FormEvent) => {
    event.preventDefault()
    if (!bag?.resident?.patient || !selectedDrug || !residentId || !activeUser?.id) return
    setActionError(null)
    try {
      const med = await addMedication({
        organisation_id: bag.resident.patient.organisation_id,
        patient_id: bag.resident.patient_id,
        drug_id: selectedDrug.id,
        drug_name: selectedDrug.name,
        drug_form: selectedDrug.form ?? undefined,
        drug_strength: selectedDrug.activeIngredients || undefined,
        dose: newMedForm.dose || undefined,
        quantity: newMedForm.quantity ? Number(newMedForm.quantity) : undefined,
      })
      await addMedicationSchedule({
        residentId,
        patientMedicationId: med.id,
        scheduleType: newMedForm.scheduleType,
        dose: newMedForm.dose || 'As directed',
        administrationDays: [1, 2, 3, 4, 5, 6, 7],
        startDate: new Date().toISOString().slice(0, 10),
        createdBy: activeUser.id,
      })
      if (newMedForm.addToBag && bagEditable) {
        await addBagLine(bag.id, {
          patientMedicationId: med.id,
          supplyType: newMedForm.scheduleType,
          medicineName: med.drug_name,
          form: med.drug_form ?? null,
          strength: med.drug_strength ?? null,
          dose: newMedForm.dose || null,
          quantityExpected: newMedForm.quantity ? Number(newMedForm.quantity) : 28,
        })
      }
      await fetchResidentMedicationWorkspace(residentId)
      setShowNewMedModal(false)
      setMedicineQuery('')
      setSelectedDrug(null)
      setNewMedForm({ dose: '', quantity: '', scheduleType: 'repeat', addToBag: true })
      clearSearch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to add the medicine')
    }
  }

  const handlePrepareMar = async () => {
    if (!bag || !batch || !linkId) return
    const cycleId = await prepareMarCycle(bag.care_home_resident_id, batch.period_start, batch.period_end)
    navigate(`/care-homes/${linkId}/mar/${cycleId}`)
  }

  if (!bag && !loading) {
    return (
      <div className="care-home-page">
        <div className="care-home-inline-empty">Bag not found. <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => navigate(`/care-homes/${linkId}/groups/${groupId}`)}>Back to group</button></div>
      </div>
    )
  }

  const renderLeftItem = (item: LeftItem) => {
    const inBag = isInBag(item)
    const editing = editingMed === item.key
    return (
      <li key={item.key} className={`care-home-split-item ${inBag ? 'in-bag' : ''}`}>
        <label className="care-home-split-check">
          <input
            type="checkbox"
            disabled={inBag || !bagEditable}
            checked={inBag || Boolean(selected[item.key])}
            onChange={(e) => setSelected({ ...selected, [item.key]: e.target.checked })}
          />
          <span className="care-home-split-item-main">
            <strong>{item.med.drug_name}</strong>
            <small>
              {[item.med.drug_strength, item.med.drug_form].filter(Boolean).join(' · ') || '—'}
              {item.schedule ? ` · ${item.schedule.schedule_type}` : ' · no round set up'}
            </small>
            <small>{item.schedule?.dose ?? item.med.dose ?? 'No dose recorded'} · qty {item.med.quantity ?? '—'}</small>
          </span>
        </label>
        <span className="care-home-split-item-actions">
          {inBag && <span className="ps-badge ps-badge-success">In bag</span>}
          {canManage && !editing && (
            <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button"
              onClick={() => { setEditingMed(item.key); setEditMedForm({ dose: item.med.dose ?? '', quantity: item.med.quantity != null ? String(item.med.quantity) : '' }) }}>
              Edit
            </button>
          )}
        </span>
        {editing && (
          <span className="care-home-split-edit-row">
            <input className="ps-input" placeholder="Dose" value={editMedForm.dose} onChange={(e) => setEditMedForm({ ...editMedForm, dose: e.target.value })} />
            <input className="ps-input care-home-qty-input" type="number" min="0" placeholder="Qty" value={editMedForm.quantity} onChange={(e) => setEditMedForm({ ...editMedForm, quantity: e.target.value })} />
            <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving} onClick={() => void handleSaveMedEdit(item)}>Save</button>
            <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => setEditingMed(null)}>Cancel</button>
          </span>
        )}
      </li>
    )
  }

  const renderLine = (line: CareHomeSupplyLine) => {
    const editing = editingLine === line.id
    return (
      <li key={line.id} className="care-home-split-item">
        <span className="care-home-split-item-main">
          <strong>{line.medicine_name}</strong>
          <small>{[line.strength, line.form].filter(Boolean).join(' · ') || line.supply_type}</small>
          <small>{line.dose ?? 'No dose'} · expected {line.quantity_expected} · packed {line.quantity_packed}</small>
          {line.omission_reason && <small>Omitted: {line.omission_reason}</small>}
        </span>
        <span className="care-home-split-item-actions">
          <span className={`ps-badge ${lineBadge(line.line_status)}`}>{line.line_status}</span>
          {canManage && line.line_status === 'expected' && omitting !== line.id && !editing && (
            <>
              <input
                className="ps-input care-home-qty-input"
                type="number"
                min="0"
                value={packQty[line.id] ?? String(line.quantity_expected)}
                onChange={(e) => setPackQty({ ...packQty, [line.id]: e.target.value })}
              />
              <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving}
                onClick={() => void packBagLine(line.id, Number(packQty[line.id] ?? line.quantity_expected))}>
                Pack
              </button>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => { setOmitting(line.id); setOmissionReason('') }}>Omit</button>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button"
                onClick={() => { setEditingLine(line.id); setEditLineForm({ quantity: String(line.quantity_expected), dose: line.dose ?? '' }) }}>
                Edit
              </button>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" disabled={saving} onClick={() => void removeBagLine(line.id)}>Remove</button>
            </>
          )}
          {canManage && omitting === line.id && (
            <>
              <input className="ps-input" placeholder="Reason" value={omissionReason} onChange={(e) => setOmissionReason(e.target.value)} />
              <button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" disabled={saving || !omissionReason.trim()}
                onClick={() => { void packBagLine(line.id, 0, omissionReason); setOmitting(null) }}>
                Confirm omit
              </button>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => setOmitting(null)}>Cancel</button>
            </>
          )}
          {canReceive && line.line_status === 'sent' && (
            <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving}
              onClick={() => void receiveBagLine(line.id, line.quantity_sent)}>
              Mark received
            </button>
          )}
        </span>
        {editing && (
          <span className="care-home-split-edit-row">
            <input className="ps-input" placeholder="Dose" value={editLineForm.dose} onChange={(e) => setEditLineForm({ ...editLineForm, dose: e.target.value })} />
            <input className="ps-input care-home-qty-input" type="number" min="0" placeholder="Qty" value={editLineForm.quantity} onChange={(e) => setEditLineForm({ ...editLineForm, quantity: e.target.value })} />
            <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving} onClick={() => void handleSaveLineEdit(line)}>Save</button>
            <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => setEditingLine(null)}>Cancel</button>
          </span>
        )}
      </li>
    )
  }

  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs">
          <a href="/care-homes" onClick={(e) => { e.preventDefault(); navigate('/care-homes') }}>Care homes</a>
          <span className="separator">/</span>
          <a href={`/care-homes/${linkId}/groups/${groupId}`} onClick={(e) => { e.preventDefault(); navigate(`/care-homes/${linkId}/groups/${groupId}`) }}>{group?.name ?? 'Group'}</a>
          <span className="separator">/</span>
          <span>Bag</span>
        </div>
        <button className="ps-btn ps-btn-secondary ps-btn-sm care-home-back-btn care-home-no-print" type="button" onClick={() => navigate(`/care-homes/${linkId}/groups/${groupId}`)}>
          ← Back to {group?.name ?? 'round'}
        </button>
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">Patient bag{batch ? ` · ${formatDate(batch.period_start)} to ${formatDate(batch.period_end)}` : ''}</p>
            <h1>{residentName(bag?.resident?.patient?.first_name, bag?.resident?.patient?.last_name)}</h1>
            <p className="care-home-subtitle">
              {bag?.package_label}{bag?.resident?.room_number ? ` · Room ${bag.resident.room_number}` : ''} · {packedCount}/{lines.length} medicines packed
            </p>
          </div>
          {bag && (
            <div className="care-home-group-state-block">
              <span className={`ps-badge ${bag.package_status === 'received' ? 'ps-badge-success' : bag.package_status === 'discrepancy' ? 'ps-badge-danger' : bag.package_status === 'open' ? 'ps-badge-warning' : 'ps-badge-blue'} care-home-group-state-badge`}>{bag.package_status.replaceAll('_', ' ')}</span>
            </div>
          )}
        </div>
      </div>

      {(error || actionError) && (
        <div className="auth-error care-home-alert" role="alert">
          <span>{actionError ?? error}</span>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => { clearError(); setActionError(null) }}>Dismiss</button>
        </div>
      )}

      {bag && (
        <>
          <div className="care-home-group-actions care-home-no-print">
            <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/care-homes/${linkId}/residents/${bag.care_home_resident_id}`)}>Open patient record</button>
            {canManage && (
              <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowNewMedModal(true)}>Add new medicine</button>
            )}
            {canManage && batch && (
              <button className="ps-btn ps-btn-primary" type="button" disabled={saving} onClick={() => void handlePrepareMar()}>
                {saving ? 'Working...' : 'Prepare MAR chart from this bag'}
              </button>
            )}
          </div>

          <div className="care-home-split">
            <section className="care-home-split-panel">
              <div className="care-home-split-panel-header">
                <div><p>Patient medicines</p><h2>{leftItems.length} on file</h2></div>
                {bagEditable && (
                  <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving || selectedItems.length === 0} onClick={() => void handleAddSelected()}>
                    Add selected to bag{selectedItems.length > 0 ? ` (${selectedItems.length})` : ''}
                  </button>
                )}
              </div>
              <h3 className="care-home-split-divider">Repeat & regular</h3>
              {repeatItems.length === 0 ? (
                <div className="care-home-inline-empty">No repeat medicines on file.</div>
              ) : (
                <ul className="care-home-split-list">{repeatItems.map(renderLeftItem)}</ul>
              )}
              <h3 className="care-home-split-divider">Acute</h3>
              {acuteItems.length === 0 ? (
                <div className="care-home-inline-empty">No acute medicines on file.</div>
              ) : (
                <ul className="care-home-split-list">{acuteItems.map(renderLeftItem)}</ul>
              )}
            </section>

            <section className="care-home-split-panel">
              <div className="care-home-split-panel-header">
                <div><p>In this bag</p><h2>{lines.length} medicine{lines.length === 1 ? '' : 's'}</h2></div>
              </div>
              <h3 className="care-home-split-divider">Repeat & regular</h3>
              {repeatLines.length === 0 ? (
                <div className="care-home-inline-empty">No repeat medicines in the bag.</div>
              ) : (
                <ul className="care-home-split-list">{repeatLines.map(renderLine)}</ul>
              )}
              <h3 className="care-home-split-divider">Acute</h3>
              {acuteLines.length === 0 ? (
                <div className="care-home-inline-empty">No acute medicines in the bag.</div>
              ) : (
                <ul className="care-home-split-list">{acuteLines.map(renderLine)}</ul>
              )}
            </section>
          </div>

          {showNewMedModal && (
            <>
              <div className="modal-backdrop" onClick={() => setShowNewMedModal(false)} />
              <div className="modal-container">
                <div className="modal-dialog" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Add new medicine">
                  <div className="modal-header">
                    <h2>Add new medicine</h2>
                    <button className="ps-btn ps-btn-ghost ps-btn-sm modal-close" type="button" onClick={() => setShowNewMedModal(false)}>✕</button>
                  </div>
                  <form onSubmit={(event) => void handleAddNewMedicine(event)}>
                    <div className="modal-body care-home-new-med-form">
                      <label>Search dm+d medicines
                        <input className="ps-input" placeholder="Start typing a medicine name..." value={medicineQuery}
                          onChange={(e) => { setMedicineQuery(e.target.value); setSelectedDrug(null); void searchDrugs(e.target.value) }} />
                      </label>
                      {searching && <p className="care-home-form-help">Searching...</p>}
                      {!selectedDrug && drugSearchResults.length > 0 && (
                        <ul className="care-home-drug-results">
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
                        <p className="care-home-form-help">Selected: <strong>{selectedDrug.name}</strong> <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => setSelectedDrug(null)}>Change</button></p>
                      )}
                      <div className="care-home-new-med-grid">
                        <label>Type
                          <select className="ps-input" value={newMedForm.scheduleType} onChange={(e) => setNewMedForm({ ...newMedForm, scheduleType: e.target.value as 'repeat' | 'acute' })}>
                            <option value="repeat">Repeat / regular</option>
                            <option value="acute">Acute</option>
                          </select>
                        </label>
                        <label>Dose<input className="ps-input" placeholder="e.g. One tablet twice a day" value={newMedForm.dose} onChange={(e) => setNewMedForm({ ...newMedForm, dose: e.target.value })} /></label>
                        <label>Quantity<input className="ps-input" type="number" min="0" placeholder="28" value={newMedForm.quantity} onChange={(e) => setNewMedForm({ ...newMedForm, quantity: e.target.value })} /></label>
                      </div>
                      {bagEditable && (
                        <label className="care-home-check-label">
                          <input type="checkbox" checked={newMedForm.addToBag} onChange={(e) => setNewMedForm({ ...newMedForm, addToBag: e.target.checked })} />
                          Also add to this bag
                        </label>
                      )}
                    </div>
                    <div className="modal-footer">
                      <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowNewMedModal(false)}>Cancel</button>
                      <button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !selectedDrug}>{saving ? 'Adding...' : 'Add medicine'}</button>
                    </div>
                  </form>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
