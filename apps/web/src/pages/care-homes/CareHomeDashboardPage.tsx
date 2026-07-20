import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type {
  CareHomeGroupState,
  CareHomeGroupType,
} from '@pharmstation/types'

type WorkspaceTab = 'groups' | 'residents' | 'history'

const groupStates: Array<{ state: CareHomeGroupState; label: string; hint: string }> = [
  { state: 'idle', label: 'Idle', hint: 'Click a group to start its next round' },
  { state: 'preparing', label: 'Preparing', hint: 'Bags being packed and checked' },
  { state: 'ready', label: 'Ready', hint: 'Awaiting driver collection' },
  { state: 'in_transit', label: 'In transit', hint: 'Out on a delivery run' },
  { state: 'delivered', label: 'Delivered', hint: 'Confirm to return to idle' },
]

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

export function CareHomeDashboardPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { organisation, activeUser, permissions } = useAuthStore()
  const {
    links,
    residents,
    requests,
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
    searchPatients,
    addResident,
    inviteCareHomeUser,
    clearError,
    groups,
    createGroup,
  } = useCareHomeStore()
  const [tab, setTab] = useState<WorkspaceTab>('groups')
  const [showResidentForm, setShowResidentForm] = useState(false)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [residentForm, setResidentForm] = useState({ patientQuery: '', patientId: '', unitId: '', roomNumber: '', gpName: '', gpPractice: '', allergies: '', specialInstructions: '' })
  const [inviteForm, setInviteForm] = useState({ fullName: '', email: '' })
  const [inviteSent, setInviteSent] = useState(false)
  const [groupForm, setGroupForm] = useState({ name: '', groupType: 'monthly' as CareHomeGroupType, cycleDay: '' })

  const organisationType = organisation?.organisation_type ?? 'pharmacy'
  const isCareHome = organisationType === 'carehome'
  const canManage = !isCareHome && permissions?.care_home_manage === true
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? null
  const openRequests = useMemo(
    () => requests.filter((request) => !['completed', 'cancelled', 'declined'].includes(request.status)),
    [requests],
  )

  useEffect(() => {
    if (organisation?.id) void fetchLinks(organisation.id, organisationType)
  }, [organisation?.id, organisationType, fetchLinks])

  useEffect(() => {
    const view = searchParams.get('view')
    if (view === 'requests') {
      if (selectedLinkId) navigate(`/care-homes/${selectedLinkId}/requests`, { replace: true })
      return
    }
    if (view && ['groups', 'residents', 'history'].includes(view)) {
      setTab(view as WorkspaceTab)
    } else {
      setTab('groups')
    }
  }, [searchParams, selectedLinkId, navigate])

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

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !inviteForm.fullName.trim() || !inviteForm.email.trim()) return
    await inviteCareHomeUser(selectedLinkId, inviteForm.email, inviteForm.fullName)
    setInviteForm({ fullName: '', email: '' })
    setInviteSent(true)
  }

  const handleCreateGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !groupForm.name.trim()) return
    await createGroup({
      linkId: selectedLinkId,
      name: groupForm.name.trim(),
      groupType: groupForm.groupType,
      cycleDay: groupForm.cycleDay ? Number(groupForm.cycleDay) : undefined,
    })
    setGroupForm({ name: '', groupType: 'monthly', cycleDay: '' })
    setShowGroupForm(false)
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
                ? 'Residents, medication requests and deliveries shared with your pharmacy.'
                : `Deliveries, resident requests and medicine supplies managed by ${organisation?.name}.`}
            </p>
          </div>
          {canManage && (
            <button className="ps-btn ps-btn-secondary care-home-no-print" type="button" onClick={() => navigate('/care-homes/manage')}>
              Manage care homes
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

      {loading && links.length === 0 ? (
        <div className="care-home-loading">Loading care-home workspace...</div>
      ) : links.length === 0 ? (
        <section className="care-home-empty">
          <p className="care-home-empty-mark" aria-hidden="true">CH</p>
          <h2>{isCareHome ? 'No pharmacy connection yet' : 'No care homes connected'}</h2>
          <p>{isCareHome ? 'Ask your pharmacy to connect this organization.' : 'Create the first care home to start resident and medication-cycle management.'}</p>
          {canManage && <button className="ps-btn ps-btn-primary" type="button" onClick={() => navigate('/care-homes/manage')}>Add care home</button>}
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
            <article><span>Cycle length</span><strong>{selectedLink?.default_cycle_length_days ?? 28}</strong><small>days per medication cycle</small></article>
          </div>

          <section className="care-home-workspace">
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

            {tab === 'groups' && (
              <div>
                <div className="care-home-section-heading">
                  <div><p>Delivery workflow</p><h2>Groups board</h2></div>
                  {canManage && <button className="ps-btn ps-btn-primary care-home-no-print" type="button" onClick={() => setShowGroupForm((visible) => !visible)}>{showGroupForm ? 'Close' : 'Add group'}</button>}
                </div>
                {showGroupForm && canManage && (
                  <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleCreateGroup(event)}>
                    <label>Group name<input className="ps-input" required placeholder="e.g. Group A — Willow wing" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></label>
                    <label>Type<select className="ps-input" value={groupForm.groupType} onChange={(event) => setGroupForm({ ...groupForm, groupType: event.target.value as CareHomeGroupType })}><option value="monthly">Monthly cycle</option><option value="acute">Acute (frequent deliveries)</option></select></label>
                    {groupForm.groupType === 'monthly' && <label>Cycle day<input className="ps-input" type="number" min="1" max="31" placeholder="e.g. 14" value={groupForm.cycleDay} onChange={(event) => setGroupForm({ ...groupForm, cycleDay: event.target.value })} /></label>}
                    <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create group'}</button></div>
                  </form>
                )}
                {groups.length === 0 && (
                  <div className="care-home-inline-empty care-home-no-print">No delivery groups yet. Create a monthly group for each delivery cycle, plus an acute group for daily deliveries.</div>
                )}
                <div className="care-home-kanban">
                    {groupStates.map(({ state, label, hint }) => {
                      const columnGroups = groups.filter((group) => group.group_state === state)
                      return (
                        <section key={state} className={`care-home-kanban-column care-home-kanban-${state}`}>
                          <header>
                            <h3>{label}</h3>
                            <span className="care-home-kanban-count">{columnGroups.length}</span>
                          </header>
                          <p className="care-home-kanban-hint">{hint}</p>
                          <div className="care-home-kanban-cards">
                            {columnGroups.length === 0 ? (
                              state === 'idle' && canManage ? (
                                <button type="button" className="care-home-kanban-add care-home-no-print" onClick={() => setShowGroupForm(true)}>+ Add group</button>
                              ) : (
                                <div className="care-home-kanban-empty">No groups</div>
                              )
                            ) : columnGroups.map((group) => {
                              const memberCount = residents.filter((resident) =>
                                resident.unit_id === group.id || (resident.group_memberships ?? []).some((membership) => membership.group_id === group.id),
                              ).length
                              const activeBatch = supplyBatches.find((batch) => batch.id === group.active_batch_id)
                              return (
                                <button
                                  key={group.id}
                                  type="button"
                                  className="care-home-group-card"
                                  onClick={() => navigate(`/care-homes/${selectedLinkId}/groups/${group.id}`)}
                                >
                                  <div className="care-home-group-card-top">
                                    <strong>{group.name}</strong>
                                    <span className={`ps-badge ${group.group_type === 'acute' ? 'ps-badge-danger' : 'ps-badge-muted'}`}>{group.group_type}</span>
                                  </div>
                                  <div className="care-home-group-card-meta">
                                    <span>{memberCount} patient{memberCount === 1 ? '' : 's'}</span>
                                    {group.group_type === 'monthly' && group.cycle_day && <span>Day {group.cycle_day}</span>}
                                  </div>
                                  {activeBatch && <small className="care-home-group-card-batch">Batch #{activeBatch.batch_number} · {activeBatch.status.replaceAll('_', ' ')}</small>}
                                  {group.delivery_round_id && <small className="care-home-group-card-batch">Delivery run linked</small>}
                                  {group.state_changed_at && <small className="care-home-group-card-time">Since {new Date(group.state_changed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>}
                                </button>
                              )
                            })}
                          </div>
                        </section>
                      )
                    })}
                </div>
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