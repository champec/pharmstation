import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type {
  CareHomeMedicationRequestStatus,
  CareHomeMedicationRequestType,
} from '@pharmstation/types'

type WorkspaceTab = 'overview' | 'residents' | 'units' | 'supplies' | 'requests' | 'mar' | 'history'

const requestStatusClass: Record<CareHomeMedicationRequestStatus, string> = {
  draft: 'ps-badge-muted',
  submitted: 'ps-badge-warning',
  acknowledged: 'ps-badge-blue',
  approved: 'ps-badge-primary',
  sent_to_gp: 'ps-badge-blue',
  outstanding: 'ps-badge-warning',
  received: 'ps-badge-success',
  part_received: 'ps-badge-warning',
  refused: 'ps-badge-danger',
  ordered: 'ps-badge-primary',
  ready: 'ps-badge-success',
  completed: 'ps-badge-success',
  declined: 'ps-badge-danger',
  cancelled: 'ps-badge-muted',
}

function patientName(firstName?: string, lastName?: string) {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Unnamed resident'
}

function formatDate(value: string | null) {
  if (!value) return 'Not set'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function CareHomeDashboardPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { organisation, activeUser, permissions } = useAuthStore()
  const {
    links,
    residents,
    requests,
    gpRequests,
    marCycles,
    history,
    patientSearchResults,
    units,
    supplyBatches,
    selectedLinkId,
    loading,
    saving,
    error,
    fetchLinks,
    selectLink,
    createCareHome,
    createMedicationRequest,
    searchPatients,
    addResident,
    prepareMarCycle,
    publishMarCycle,
    inviteCareHomeUser,
    createUnit,
    assignResidentUnit,
    createSupplyBatch,
    prepareGpRequest,
    clearError,
  } = useCareHomeStore()
  const [tab, setTab] = useState<WorkspaceTab>('overview')
  const [showCreateHome, setShowCreateHome] = useState(false)
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [showResidentForm, setShowResidentForm] = useState(false)
  const [showMarForm, setShowMarForm] = useState(false)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [showUnitForm, setShowUnitForm] = useState(false)
  const [showBatchForm, setShowBatchForm] = useState(false)
  const [showGpRequestForm, setShowGpRequestForm] = useState(false)
  const [homeForm, setHomeForm] = useState({ name: '', postcode: '', contactName: '', contactEmail: '', contactPhone: '' })
  const [requestForm, setRequestForm] = useState({ residentId: '', requestType: 'repeat' as CareHomeMedicationRequestType, medicineName: '', quantity: '', neededBy: '', notes: '' })
  const [residentForm, setResidentForm] = useState({ patientQuery: '', patientId: '', unitId: '', roomNumber: '', gpName: '', gpPractice: '', allergies: '', specialInstructions: '' })
  const today = new Date().toISOString().slice(0, 10)
  const [marForm, setMarForm] = useState({ residentId: '', periodStart: today, periodEnd: addDays(today, 27) })
  const [inviteForm, setInviteForm] = useState({ fullName: '', email: '' })
  const [inviteSent, setInviteSent] = useState(false)
  const [unitForm, setUnitForm] = useState({ name: '', floorName: '' })
  const [batchForm, setBatchForm] = useState({ title: '', periodStart: today, periodEnd: addDays(today, 27), deliveryDate: '', supplyScope: 'all' as 'all' | 'regular' | 'acute' })
  const [gpRequestForm, setGpRequestForm] = useState({ surgeryName: '', title: 'Repeat prescription request', cycleStart: today, cycleEnd: addDays(today, 27) })

  const organisationType = organisation?.organisation_type ?? 'pharmacy'
  const isCareHome = organisationType === 'carehome'
  const canManage = !isCareHome && permissions?.care_home_manage === true
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? null
  const selectedHomeName = selectedLink?.care_home_organisation?.name ?? (isCareHome ? organisation?.name : 'Care home')
  const openRequests = useMemo(
    () => requests.filter((request) => !['completed', 'cancelled', 'declined'].includes(request.status)),
    [requests],
  )
  const publishedCharts = useMemo(
    () => marCycles.filter((cycle) => cycle.status === 'published'),
    [marCycles],
  )
  const gpPractices = useMemo(() => Array.from(new Set(residents.map((resident) => resident.gp_practice).filter((practice): practice is string => Boolean(practice)))).sort(), [residents])

  useEffect(() => {
    if (organisation?.id) void fetchLinks(organisation.id, organisationType)
  }, [organisation?.id, organisationType, fetchLinks])

  useEffect(() => {
    const view = searchParams.get('view')
    if (view && ['overview', 'residents', 'units', 'supplies', 'requests', 'mar', 'history'].includes(view)) {
      setTab(view as WorkspaceTab)
    }
  }, [searchParams])

  const changeTab = (nextTab: WorkspaceTab) => {
    setTab(nextTab)
    setSearchParams(nextTab === 'overview' ? {} : { view: nextTab })
  }

  const handleCreateHome = async (event: FormEvent) => {
    event.preventDefault()
    if (!organisation?.id || !homeForm.name.trim()) return
    const linkId = await createCareHome({
      pharmacyOrganisationId: organisation.id,
      name: homeForm.name.trim(),
      address: homeForm.postcode.trim() ? { postcode: homeForm.postcode.trim() } : {},
      contactName: homeForm.contactName,
      contactEmail: homeForm.contactEmail,
      contactPhone: homeForm.contactPhone,
    })
    await fetchLinks(organisation.id, 'pharmacy')
    await selectLink(linkId)
    setHomeForm({ name: '', postcode: '', contactName: '', contactEmail: '', contactPhone: '' })
    setShowCreateHome(false)
  }

  const handleCreateRequest = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !activeUser?.id || !requestForm.residentId || !requestForm.medicineName.trim()) return
    await createMedicationRequest({
      linkId: selectedLinkId,
      residentId: requestForm.residentId,
      requestType: requestForm.requestType,
      medicineName: requestForm.medicineName,
      quantity: requestForm.quantity ? Number(requestForm.quantity) : undefined,
      neededBy: requestForm.neededBy || undefined,
      notes: requestForm.notes || undefined,
      requestedBy: activeUser.id,
      requestSource: isCareHome ? 'care_home' : 'pharmacy_manual',
    })
    setRequestForm({ residentId: '', requestType: 'repeat', medicineName: '', quantity: '', neededBy: '', notes: '' })
    setShowRequestForm(false)
  }

  const handleAddResident = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !activeUser?.id || !residentForm.patientId) return
    await addResident({
      linkId: selectedLinkId,
      patientId: residentForm.patientId,
      unitId: residentForm.unitId || undefined,
      roomNumber: residentForm.roomNumber,
      gpName: residentForm.gpName,
      gpPractice: residentForm.gpPractice,
      allergies: residentForm.allergies,
      specialInstructions: residentForm.specialInstructions,
      createdBy: activeUser.id,
    })
    setResidentForm({ patientQuery: '', patientId: '', unitId: '', roomNumber: '', gpName: '', gpPractice: '', allergies: '', specialInstructions: '' })
    setShowResidentForm(false)
  }

  const handlePrepareMar = async (event: FormEvent) => {
    event.preventDefault()
    if (!marForm.residentId || !selectedLinkId) return
    const cycleId = await prepareMarCycle(marForm.residentId, marForm.periodStart, marForm.periodEnd)
    setShowMarForm(false)
    navigate(`/care-homes/${selectedLinkId}/mar/${cycleId}`)
  }

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !inviteForm.fullName.trim() || !inviteForm.email.trim()) return
    await inviteCareHomeUser(selectedLinkId, inviteForm.email, inviteForm.fullName)
    setInviteForm({ fullName: '', email: '' })
    setInviteSent(true)
  }

  const handleCreateUnit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !unitForm.name.trim()) return
    await createUnit(selectedLinkId, unitForm.name, unitForm.floorName)
    setUnitForm({ name: '', floorName: '' })
    setShowUnitForm(false)
  }

  const handleCreateBatch = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !batchForm.title.trim()) return
    const batchId = await createSupplyBatch({
      linkId: selectedLinkId,
      title: batchForm.title,
      periodStart: batchForm.periodStart,
      periodEnd: batchForm.periodEnd,
      deliveryDate: batchForm.deliveryDate || undefined,
      supplyScope: batchForm.supplyScope,
    })
    setShowBatchForm(false)
    navigate(`/care-homes/${selectedLinkId}/supplies/${batchId}`)
  }

  const handlePrepareGpRequest = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId) return
    const requestId = await prepareGpRequest(selectedLinkId, gpRequestForm.surgeryName, gpRequestForm.title, gpRequestForm.cycleStart, gpRequestForm.cycleEnd)
    setShowGpRequestForm(false)
    navigate(`/care-homes/${selectedLinkId}/prescriptions/${requestId}`)
  }

  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(event) => { event.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Care homes</span>
        </div>
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">{isCareHome ? 'Care home workspace' : 'Pharmacy service desk'}</p>
            <h1>{isCareHome ? organisation?.name : 'Care home management'}</h1>
            <p className="care-home-subtitle">
              {isCareHome
                ? 'Residents, medication requests and digital MAR charts shared with your pharmacy.'
                : `Medication cycles, resident requests and MAR charts managed by ${organisation?.name}.`}
            </p>
          </div>
          {canManage && (
            <button className="ps-btn ps-btn-primary care-home-no-print" type="button" onClick={() => setShowCreateHome((visible) => !visible)}>
              {showCreateHome ? 'Close' : 'Add care home'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="auth-error care-home-alert" role="alert">
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button>
        </div>
      )}

      {showCreateHome && canManage && (
        <form className="care-home-form-band care-home-no-print" onSubmit={(event) => void handleCreateHome(event)}>
          <div className="care-home-form-heading">
            <h2>Connect a new care home</h2>
            <p>This creates the care-home organization. Staff logins can then be managed through its organization membership.</p>
          </div>
          <div className="care-home-form-grid">
            <label>Care home name<input className="ps-input" required value={homeForm.name} onChange={(event) => setHomeForm({ ...homeForm, name: event.target.value })} /></label>
            <label>Postcode<input className="ps-input" value={homeForm.postcode} onChange={(event) => setHomeForm({ ...homeForm, postcode: event.target.value })} /></label>
            <label>Primary contact<input className="ps-input" value={homeForm.contactName} onChange={(event) => setHomeForm({ ...homeForm, contactName: event.target.value })} /></label>
            <label>Email<input className="ps-input" type="email" value={homeForm.contactEmail} onChange={(event) => setHomeForm({ ...homeForm, contactEmail: event.target.value })} /></label>
            <label>Telephone<input className="ps-input" value={homeForm.contactPhone} onChange={(event) => setHomeForm({ ...homeForm, contactPhone: event.target.value })} /></label>
          </div>
          <div className="care-home-form-actions">
            <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowCreateHome(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create care home'}</button>
          </div>
        </form>
      )}

      {loading && links.length === 0 ? (
        <div className="care-home-loading">Loading care-home workspace...</div>
      ) : links.length === 0 ? (
        <section className="care-home-empty">
          <p className="care-home-empty-mark" aria-hidden="true">CH</p>
          <h2>{isCareHome ? 'No pharmacy connection yet' : 'No care homes connected'}</h2>
          <p>{isCareHome ? 'Ask your pharmacy to connect this organization.' : 'Create the first care home to start resident and medication-cycle management.'}</p>
          {canManage && <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowCreateHome(true)}>Add care home</button>}
        </section>
      ) : (
        <>
          <div className="care-home-context-bar care-home-no-print">
            <label htmlFor="care-home-selector">Care home</label>
            <select id="care-home-selector" className="ps-input" value={selectedLinkId ?? ''} onChange={(event) => void selectLink(event.target.value)}>
              {links.map((link) => <option key={link.id} value={link.id}>{link.care_home_organisation?.name ?? 'Care home'}</option>)}
            </select>
            <span className={`ps-badge ${selectedLink?.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{selectedLink?.status}</span>
            <span className="care-home-context-contact">{selectedLink?.contact_name || selectedLink?.contact_email || 'No primary contact set'}</span>
            {canManage && <button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" onClick={() => { setShowInviteForm((visible) => !visible); setInviteSent(false) }}>{showInviteForm ? 'Close invite' : 'Invite care-home user'}</button>}
          </div>

          {showInviteForm && canManage && <form className="care-home-invite-form care-home-no-print" onSubmit={(event) => void handleInvite(event)}><div><strong>Invite care-home staff</strong><span>The first invite becomes the organization login administrator. Each invite also receives the carehome_user role.</span></div><label>Full name<input className="ps-input" required value={inviteForm.fullName} onChange={(event) => setInviteForm({ ...inviteForm, fullName: event.target.value })} /></label><label>Email<input className="ps-input" type="email" required value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} /></label><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Sending...' : 'Send invitation'}</button>{inviteSent && <p role="status">Invitation sent. The user can set a password from their email and use the organization and user login screens.</p>}</form>}

          <div className="care-home-metrics">
            <article><span>Residents</span><strong>{residents.filter((resident) => resident.status === 'active').length}</strong><small>{residents.length} total records</small></article>
            <article><span>Open requests</span><strong>{openRequests.length}</strong><small>{openRequests.filter((request) => request.status === 'submitted').length} awaiting review</small></article>
            <article><span>Published MAR</span><strong>{publishedCharts.length}</strong><small>{marCycles.length} chart cycles</small></article>
            <article><span>Cycle length</span><strong>{selectedLink?.default_cycle_length_days ?? 28}</strong><small>days per medication cycle</small></article>
          </div>

          <div className="care-home-tabs care-home-no-print" role="tablist" aria-label="Care home workspace">
            {(['overview', 'residents', 'units', 'supplies', 'requests', 'mar', 'history'] as WorkspaceTab[]).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => changeTab(item)}>
                {item === 'mar' ? 'MAR charts' : item[0].toUpperCase() + item.slice(1)}
                {item === 'requests' && openRequests.length > 0 && <span>{openRequests.length}</span>}
                {item === 'supplies' && supplyBatches.filter((batch) => !['reconciled', 'cancelled'].includes(batch.status)).length > 0 && <span>{supplyBatches.filter((batch) => !['reconciled', 'cancelled'].includes(batch.status)).length}</span>}
              </button>
            ))}
          </div>

          <section className="care-home-workspace">
            {tab === 'overview' && (
              <div className="care-home-overview-grid">
                <div>
                  <div className="care-home-section-heading"><div><p>Current workload</p><h2>{selectedHomeName}</h2></div></div>
                  <div className="care-home-task-list">
                    <button type="button" onClick={() => changeTab('requests')}><strong>{openRequests.length} medication requests</strong><span>Review regular, repeat and acute items</span></button>
                    <button type="button" onClick={() => changeTab('supplies')}><strong>{supplyBatches.filter((batch) => !['reconciled', 'cancelled'].includes(batch.status)).length} open supply batches</strong><span>Pack, dispatch and reconcile medicines</span></button>
                    <button type="button" onClick={() => changeTab('mar')}><strong>{marCycles.filter((cycle) => cycle.status === 'draft').length} draft MAR charts</strong><span>Prepare, publish or print the next cycle</span></button>
                    <button type="button" onClick={() => changeTab('residents')}><strong>{residents.filter((resident) => resident.status !== 'active').length} resident exceptions</strong><span>Hospital, leave and discharged residents</span></button>
                  </div>
                </div>
                <aside className="care-home-service-details">
                  <p>Service details</p>
                  <dl>
                    <div><dt>Pharmacy</dt><dd>{selectedLink?.pharmacy_organisation?.name ?? 'Not available'}</dd></div>
                    <div><dt>Contact</dt><dd>{selectedLink?.contact_name ?? 'Not set'}</dd></div>
                    <div><dt>Email</dt><dd>{selectedLink?.contact_email ?? 'Not set'}</dd></div>
                    <div><dt>Telephone</dt><dd>{selectedLink?.contact_phone ?? 'Not set'}</dd></div>
                    <div><dt>Cycle day</dt><dd>{selectedLink?.cycle_day ?? 'Not set'}</dd></div>
                  </dl>
                </aside>
              </div>
            )}

            {tab === 'residents' && (
              <div>
                <div className="care-home-section-heading"><div><p>Resident register</p><h2>{residents.length} residents</h2></div>{canManage && <button className="ps-btn ps-btn-primary care-home-no-print" type="button" onClick={() => setShowResidentForm((visible) => !visible)}>{showResidentForm ? 'Close' : 'Add resident'}</button>}</div>
                {showResidentForm && canManage && (
                  <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleAddResident(event)}>
                    <label className="care-home-form-span-2">Find PMR patient<input className="ps-input" placeholder="Name or NHS number" value={residentForm.patientQuery} onChange={(event) => { const patientQuery = event.target.value; setResidentForm({ ...residentForm, patientQuery, patientId: '' }); if (organisation?.id) void searchPatients(organisation.id, patientQuery) }} /></label>
                    {patientSearchResults.length > 0 && <div className="care-home-patient-results care-home-form-span-2">{patientSearchResults.map((patient) => <button key={patient.id} type="button" className={residentForm.patientId === patient.id ? 'selected' : ''} onClick={() => setResidentForm({ ...residentForm, patientId: patient.id, patientQuery: patientName(patient.first_name, patient.last_name) })}><strong>{patientName(patient.first_name, patient.last_name)}</strong><span>{patient.nhs_number || 'No NHS number'} · {patient.dob ? formatDate(patient.dob) : 'DOB not set'}</span></button>)}</div>}
                    <label>Unit<select className="ps-input" value={residentForm.unitId} onChange={(event) => setResidentForm({ ...residentForm, unitId: event.target.value })}><option value="">Unassigned</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.floor_name ? ` · ${unit.floor_name}` : ''}</option>)}</select></label>
                    <label>Room<input className="ps-input" value={residentForm.roomNumber} onChange={(event) => setResidentForm({ ...residentForm, roomNumber: event.target.value })} /></label>
                    <label>GP name<input className="ps-input" value={residentForm.gpName} onChange={(event) => setResidentForm({ ...residentForm, gpName: event.target.value })} /></label>
                    <label className="care-home-form-span-2">GP practice<input className="ps-input" value={residentForm.gpPractice} onChange={(event) => setResidentForm({ ...residentForm, gpPractice: event.target.value })} /></label>
                    <label>Allergies<textarea className="ps-input" rows={2} value={residentForm.allergies} onChange={(event) => setResidentForm({ ...residentForm, allergies: event.target.value })} /></label>
                    <label>Special instructions<textarea className="ps-input" rows={2} value={residentForm.specialInstructions} onChange={(event) => setResidentForm({ ...residentForm, specialInstructions: event.target.value })} /></label>
                    <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={!residentForm.patientId || saving}>{saving ? 'Adding...' : 'Add resident'}</button></div>
                  </form>
                )}
                {residents.length === 0 ? <div className="care-home-inline-empty">No residents have been linked to this care home yet.</div> : (
                  <div className="care-home-table-wrap"><table className="care-home-table care-home-clickable-table"><thead><tr><th>Resident</th><th>Room</th><th>NHS number</th><th>GP practice</th><th>Status</th></tr></thead><tbody>{residents.map((resident) => <tr key={resident.id} tabIndex={0} onClick={() => navigate(`/care-homes/${selectedLinkId}/residents/${resident.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/care-homes/${selectedLinkId}/residents/${resident.id}`) }}><td><strong>{patientName(resident.patient?.first_name, resident.patient?.last_name)}</strong><small>{resident.patient?.dob ? `Born ${formatDate(resident.patient.dob)}` : 'Date of birth not set'}</small></td><td>{resident.room_number ?? '-'}</td><td>{resident.patient?.nhs_number ?? '-'}</td><td>{resident.gp_practice ?? '-'}</td><td><span className={`ps-badge ${resident.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{resident.status}</span></td></tr>)}</tbody></table></div>
                )}
              </div>
            )}

            {tab === 'units' && (
              <div>
                <div className="care-home-section-heading"><div><p>Home layout</p><h2>Units, floors and rooms</h2></div><button className="ps-btn ps-btn-primary care-home-no-print" type="button" onClick={() => setShowUnitForm((visible) => !visible)}>{showUnitForm ? 'Close' : 'Add unit'}</button></div>
                {showUnitForm && <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleCreateUnit(event)}><label>Unit name<input className="ps-input" required placeholder="e.g. Willow Unit" value={unitForm.name} onChange={(event) => setUnitForm({ ...unitForm, name: event.target.value })} /></label><label>Floor<input className="ps-input" placeholder="e.g. Ground floor" value={unitForm.floorName} onChange={(event) => setUnitForm({ ...unitForm, floorName: event.target.value })} /></label><div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create unit'}</button></div></form>}
                {units.length === 0 ? <div className="care-home-inline-empty">No units have been configured. Residents can still be managed by room number.</div> : <div className="care-home-unit-grid">{units.map((unit) => <article key={unit.id}><div><p>{unit.floor_name || 'Floor not set'}</p><h3>{unit.name}</h3></div><strong>{residents.filter((resident) => resident.unit_id === unit.id).length}</strong><span>residents</span></article>)}</div>}
                <div className="care-home-section-heading care-home-subsection-heading"><div><p>Resident locations</p><h2>Assign units</h2></div></div>
                {residents.length === 0 ? <div className="care-home-inline-empty">Add residents before assigning units.</div> : <div className="care-home-table-wrap"><table className="care-home-table"><thead><tr><th>Resident</th><th>Unit</th><th>Room</th></tr></thead><tbody>{residents.map((resident) => <tr key={resident.id}><td><strong>{patientName(resident.patient?.first_name, resident.patient?.last_name)}</strong></td><td><select className="ps-input" value={resident.unit_id ?? ''} onChange={(event) => void assignResidentUnit(resident.id, event.target.value || null)} disabled={saving}><option value="">Unassigned</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.floor_name ? ` · ${unit.floor_name}` : ''}</option>)}</select></td><td>{resident.room_number ?? '-'}</td></tr>)}</tbody></table></div>}
              </div>
            )}

            {tab === 'supplies' && (
              <div>
                <div className="care-home-section-heading"><div><p>Medicine supply</p><h2>Packing and reconciliation batches</h2></div>{canManage && <button className="ps-btn ps-btn-primary care-home-no-print" type="button" onClick={() => setShowBatchForm((visible) => !visible)}>{showBatchForm ? 'Close' : 'Create supply batch'}</button>}</div>
                {showBatchForm && canManage && <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleCreateBatch(event)}><label className="care-home-form-span-2">Batch title<input className="ps-input" required placeholder="e.g. August 28-day cycle" value={batchForm.title} onChange={(event) => setBatchForm({ ...batchForm, title: event.target.value })} /></label><label>Supply type<select className="ps-input" value={batchForm.supplyScope} onChange={(event) => setBatchForm({ ...batchForm, supplyScope: event.target.value as 'all' | 'regular' | 'acute' })}><option value="all">All regular and acute medicines</option><option value="regular">Regular, repeat and PRN only</option><option value="acute">Acute only</option></select></label><label>Delivery date<input className="ps-input" type="date" value={batchForm.deliveryDate} onChange={(event) => setBatchForm({ ...batchForm, deliveryDate: event.target.value })} /></label><label>Supply period start<input className="ps-input" type="date" required value={batchForm.periodStart} onChange={(event) => setBatchForm({ ...batchForm, periodStart: event.target.value })} /></label><label>Supply period end<input className="ps-input" type="date" required value={batchForm.periodEnd} onChange={(event) => setBatchForm({ ...batchForm, periodEnd: event.target.value })} /></label><div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Creating snapshot...' : 'Create from resident medicines'}</button></div></form>}
                {supplyBatches.length === 0 ? <div className="care-home-inline-empty">No supply batches yet. A batch snapshots the medicines residents should receive before anything is packed.</div> : <div className="care-home-batch-list">{supplyBatches.map((batch) => <button key={batch.id} type="button" onClick={() => navigate(`/care-homes/${selectedLinkId}/supplies/${batch.id}`)}><span className={`ps-badge ${batch.status === 'reconciled' ? 'ps-badge-success' : ['delivered', 'dispatched'].includes(batch.status) ? 'ps-badge-blue' : batch.status === 'cancelled' ? 'ps-badge-muted' : 'ps-badge-warning'}`}>{batch.status.replaceAll('_', ' ')}</span><div><strong>#{batch.batch_number} · {batch.title}</strong><small>{batch.supply_scope} · {formatDate(batch.period_start)} to {formatDate(batch.period_end)} · Delivery {formatDate(batch.delivery_date)}</small></div><span className="care-home-batch-open">Open</span></button>)}</div>}
              </div>
            )}

            {tab === 'requests' && (
              <div>
                <div className="care-home-section-heading"><div><p>Prescription journey</p><h2>From medicine request to MAR</h2></div><div className="care-home-heading-actions care-home-no-print"><button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowRequestForm((visible) => !visible)} disabled={residents.length === 0}>{showRequestForm ? 'Close' : isCareHome ? 'Request a medicine' : 'Add manual request'}</button>{canManage && <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowGpRequestForm((visible) => !visible)}>{showGpRequestForm ? 'Close' : 'Prepare GP request'}</button>}</div></div>
                <div className="care-home-journey-steps">
                  <article className={requests.some((request) => request.gp_request_id === null && ['submitted', 'acknowledged', 'approved'].includes(request.status)) ? 'attention' : ''}><span>1</span><strong>Due or requested</strong><small>Regular medicines are added automatically; care-home requests appear here.</small></article>
                  <article className={gpRequests.some((request) => ['draft', 'ready_to_send'].includes(request.status)) ? 'attention' : ''}><span>2</span><strong>Request GP</strong><small>Review the list, print/save the form, then mark it sent.</small></article>
                  <article className={gpRequests.some((request) => ['sent_to_gp', 'partially_received'].includes(request.status)) ? 'attention' : ''}><span>3</span><strong>Prescription response</strong><small>Mark every medicine received, part received, or refused.</small></article>
                  <article className={gpRequests.some((request) => request.status === 'received') ? 'ready' : ''}><span>4</span><strong>Dispense and deliver</strong><small>Create a supply batch, pack it, then use Delivery Rounds.</small></article>
                  <article><span>5</span><strong>Issue MAR</strong><small>Publish the digital or printable administration chart.</small></article>
                </div>
                {showGpRequestForm && canManage && <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handlePrepareGpRequest(event)}><label>GP surgery<select className="ps-input" required value={gpRequestForm.surgeryName} onChange={(event) => setGpRequestForm({ ...gpRequestForm, surgeryName: event.target.value })}><option value="">Select surgery</option>{gpPractices.map((practice) => <option key={practice} value={practice}>{practice}</option>)}</select></label><label>Request title<input className="ps-input" required value={gpRequestForm.title} onChange={(event) => setGpRequestForm({ ...gpRequestForm, title: event.target.value })} /></label><label>Cycle start<input className="ps-input" type="date" required value={gpRequestForm.cycleStart} onChange={(event) => setGpRequestForm({ ...gpRequestForm, cycleStart: event.target.value, cycleEnd: addDays(event.target.value, 27) })} /></label><label>Cycle end<input className="ps-input" type="date" required value={gpRequestForm.cycleEnd} onChange={(event) => setGpRequestForm({ ...gpRequestForm, cycleEnd: event.target.value })} /></label><p className="care-home-form-span-2 care-home-form-help">Only residents registered with the selected surgery are included. Active regular, repeat and PRN medicines are added automatically; acute medicines appear only when requested.</p>{gpPractices.length === 0 && <p className="care-home-form-span-2 auth-error">Add each resident’s GP practice before preparing a surgery request.</p>}<div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !gpRequestForm.surgeryName}>{saving ? 'Preparing...' : 'Prepare request list'}</button></div></form>}
                {showRequestForm && (
                  <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleCreateRequest(event)}>
                    <label>Resident<select className="ps-input" required value={requestForm.residentId} onChange={(event) => setRequestForm({ ...requestForm, residentId: event.target.value })}><option value="">Select resident</option>{residents.filter((resident) => resident.status === 'active').map((resident) => <option key={resident.id} value={resident.id}>{patientName(resident.patient?.first_name, resident.patient?.last_name)}</option>)}</select></label>
                    <label>Request type<select className="ps-input" value={requestForm.requestType} onChange={(event) => setRequestForm({ ...requestForm, requestType: event.target.value as CareHomeMedicationRequestType })}><option value="repeat">Repeat</option><option value="regular">Regular</option><option value="acute">Acute</option><option value="change">Medication change</option><option value="query">Query</option></select></label>
                    <label className="care-home-form-span-2">Medicine<input className="ps-input" required placeholder="Start typing a medicine name" value={requestForm.medicineName} onChange={(event) => setRequestForm({ ...requestForm, medicineName: event.target.value })} /></label>
                    <label>Quantity<input className="ps-input" type="number" min="1" value={requestForm.quantity} onChange={(event) => setRequestForm({ ...requestForm, quantity: event.target.value })} /></label>
                    <label>Needed by<input className="ps-input" type="date" value={requestForm.neededBy} onChange={(event) => setRequestForm({ ...requestForm, neededBy: event.target.value })} /></label>
                    <label className="care-home-form-span-2">Notes<textarea className="ps-input" rows={3} value={requestForm.notes} onChange={(event) => setRequestForm({ ...requestForm, notes: event.target.value })} /></label>
                    <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Submitting...' : isCareHome ? 'Send to pharmacy' : 'Add request'}</button></div>
                  </form>
                )}
                <div className="care-home-section-heading care-home-subsection-heading"><div><p>Incoming</p><h2>Waiting to be put on a GP request</h2></div></div>
                {requests.filter((request) => request.gp_request_id === null && !['cancelled', 'declined', 'completed'].includes(request.status)).length === 0 ? <div className="care-home-inline-empty">No unprocessed medicine requests.</div> : <div className="care-home-request-list">{requests.filter((request) => request.gp_request_id === null && !['cancelled', 'declined', 'completed'].includes(request.status)).map((request) => <article key={request.id}><div className="care-home-request-main"><div><span className={`ps-badge ${requestStatusClass[request.status]}`}>{request.status.replaceAll('_', ' ')}</span><span className="care-home-request-type">{request.request_source === 'care_home' ? 'Care home requested' : 'Pharmacy added'} · {request.request_type}</span></div><h3>{request.medicine_name}</h3><p>{patientName(request.resident?.patient?.first_name, request.resident?.patient?.last_name)}{request.quantity ? ` · Quantity ${request.quantity}` : ''}{request.needed_by ? ` · Needed ${formatDate(request.needed_by)}` : ''}</p>{request.request_notes && <small>{request.request_notes}</small>}</div></article>)}</div>}
                <div className="care-home-section-heading care-home-subsection-heading"><div><p>GP requests</p><h2>Prepared and sent forms</h2></div></div>
                {gpRequests.length === 0 ? <div className="care-home-inline-empty">No GP request forms have been prepared.</div> : <div className="care-home-gp-request-list">{gpRequests.map((request) => { const pending = (request.lines ?? []).filter((line) => line.prescription_outcome === 'pending').length; return <button key={request.id} type="button" onClick={() => navigate(`/care-homes/${selectedLinkId}/prescriptions/${request.id}`)}><span className={`ps-badge ${request.status === 'received' ? 'ps-badge-success' : request.status === 'partially_received' ? 'ps-badge-warning' : request.status === 'sent_to_gp' ? 'ps-badge-blue' : 'ps-badge-muted'}`}>{request.status.replaceAll('_', ' ')}</span><div><strong>GP request #{request.request_number} · {request.title}</strong><small>{(request.lines ?? []).length} medicines · {pending} outstanding{request.sent_at ? ` · Sent ${new Date(request.sent_at).toLocaleDateString('en-GB')}` : ' · Not yet sent'}</small></div><span>Open</span></button> })}</div>}
              </div>
            )}

            {tab === 'mar' && (
              <div className="care-home-mar-print-area">
                <div className="care-home-section-heading"><div><p>Medication administration records</p><h2>{selectedHomeName}</h2></div><div className="care-home-heading-actions care-home-no-print">{canManage && <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowMarForm((visible) => !visible)}>{showMarForm ? 'Close' : 'Prepare MAR cycle'}</button>}<button className="ps-btn ps-btn-secondary" type="button" onClick={() => window.print()}>Print MAR list</button></div></div>
                {showMarForm && canManage && <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handlePrepareMar(event)}><label>Resident<select className="ps-input" required value={marForm.residentId} onChange={(event) => setMarForm({ ...marForm, residentId: event.target.value })}><option value="">Select resident</option>{residents.filter((resident) => resident.status === 'active').map((resident) => <option key={resident.id} value={resident.id}>{patientName(resident.patient?.first_name, resident.patient?.last_name)}</option>)}</select></label><label>Cycle start<input className="ps-input" type="date" required value={marForm.periodStart} onChange={(event) => setMarForm({ ...marForm, periodStart: event.target.value, periodEnd: addDays(event.target.value, (selectedLink?.default_cycle_length_days ?? 28) - 1) })} /></label><label>Cycle end<input className="ps-input" type="date" required value={marForm.periodEnd} onChange={(event) => setMarForm({ ...marForm, periodEnd: event.target.value })} /></label><div className="care-home-form-actions"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !marForm.residentId}>{saving ? 'Preparing...' : 'Generate chart'}</button></div></form>}
                <div className="care-home-print-meta"><span>Prepared for {selectedHomeName}</span><span>Printed {new Date().toLocaleDateString('en-GB')}</span></div>
                {marCycles.length === 0 ? <div className="care-home-inline-empty">No MAR cycles have been prepared.</div> : <div className="care-home-table-wrap"><table className="care-home-table care-home-mar-table"><thead><tr><th>Resident</th><th>Cycle</th><th>Status</th><th>Prepared</th><th>Published</th><th className="care-home-no-print">Actions</th></tr></thead><tbody>{marCycles.map((cycle) => <tr key={cycle.id}><td><strong>{patientName(cycle.resident?.patient?.first_name, cycle.resident?.patient?.last_name)}</strong><small>Room {cycle.resident?.room_number ?? '-'}</small></td><td>{formatDate(cycle.period_start)} to {formatDate(cycle.period_end)}</td><td><span className={`ps-badge ${cycle.status === 'published' ? 'ps-badge-success' : cycle.status === 'draft' ? 'ps-badge-muted' : 'ps-badge-blue'}`}>{cycle.status}</span></td><td>{cycle.prepared_at ? new Date(cycle.prepared_at).toLocaleDateString('en-GB') : '-'}</td><td>{cycle.published_at ? new Date(cycle.published_at).toLocaleDateString('en-GB') : '-'}</td><td className="care-home-row-actions care-home-no-print"><button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" onClick={() => navigate(`/care-homes/${selectedLinkId}/mar/${cycle.id}`)}>Open</button>{canManage && cycle.status === 'prepared' && activeUser?.id && <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" onClick={() => void publishMarCycle(cycle.id, activeUser.id)}>Publish</button>}</td></tr>)}</tbody></table></div>}
              </div>
            )}

            {tab === 'history' && (
              <div><div className="care-home-section-heading"><div><p>Audit history</p><h2>Recent activity</h2></div></div>{history.length === 0 ? <div className="care-home-inline-empty">No care-home activity has been recorded yet.</div> : <ol className="care-home-history">{history.map((event) => <li key={event.id}><span>{new Date(event.created_at).toLocaleString('en-GB')}</span><div><strong>{event.summary}</strong><small>{event.entity_type} · {event.event_type}</small></div></li>)}</ol>}</div>
            )}
          </section>
        </>
      )}
    </div>
  )
}