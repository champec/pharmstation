import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, ClipboardList, Users } from 'lucide-react'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeGroupState, CareHomeGroupType } from '@pharmstation/types'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { AddResidentForm } from './AddResidentForm'
import { chDate, chLabel, chRange } from './careHomeLabels'

type WorkspaceTab = 'groups' | 'residents' | 'mar' | 'history'
const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'groups', label: 'Groups board' },
  { id: 'residents', label: 'Residents' },
  { id: 'mar', label: 'MAR charts' },
  { id: 'history', label: 'Activity' },
]

const groupStates: Array<{ state: CareHomeGroupState; label: string; hint: string }> = [
  { state: 'idle', label: 'Idle', hint: 'Open a group to start its next round' },
  { state: 'preparing', label: 'Preparing', hint: 'Bags being packed and checked' },
  { state: 'ready', label: 'Ready', hint: 'Awaiting driver collection' },
  { state: 'in_transit', label: 'In transit', hint: 'Out on a delivery run' },
  { state: 'delivered', label: 'Delivered', hint: 'Confirm to return to idle' },
]

function patientName(firstName?: string, lastName?: string) {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Unnamed resident'
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
    history,
    marCycles,
    supplyBatches,
    selectedLinkId,
    loading,
    saving,
    error,
    fetchLinks,
    selectLink,
    inviteCareHomeUser,
    prepareMarCycle,
    publishMarCycle,
    clearError,
    groups,
    createGroup,
  } = useCareHomeStore()
  const [showResidentForm, setShowResidentForm] = useState(false)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [showMarForm, setShowMarForm] = useState(false)
  const [inviteForm, setInviteForm] = useState({ fullName: '', email: '' })
  const [inviteSent, setInviteSent] = useState(false)
  const [groupForm, setGroupForm] = useState({ name: '', groupType: 'monthly' as CareHomeGroupType, cycleDay: '' })
  const today = new Date().toISOString().slice(0, 10)
  const [marForm, setMarForm] = useState({ residentId: '', periodStart: today, periodEnd: addDays(today, 27) })
  const [residentFilter, setResidentFilter] = useState('')

  const organisationType = organisation?.organisation_type ?? 'pharmacy'
  const isCareHome = organisationType === 'carehome'
  const canManage = !isCareHome && permissions?.care_home_manage === true
  const canPrepareMar = !isCareHome && permissions?.care_home_mar_prepare === true
  const canInvite = canManage
  const requestedLink = searchParams.get('link')
  const viewParam = searchParams.get('view')
  const tab: WorkspaceTab = TABS.some((item) => item.id === viewParam) ? (viewParam as WorkspaceTab) : 'groups'
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? null
  const openRequests = useMemo(
    () => requests.filter((request) => !['completed', 'cancelled', 'declined'].includes(request.status)),
    [requests],
  )
  const visibleCycles = useMemo(
    () => (isCareHome ? marCycles.filter((cycle) => cycle.status === 'published' || cycle.status === 'archived') : marCycles),
    [marCycles, isCareHome],
  )
  const filteredResidents = useMemo(() => {
    const q = residentFilter.trim().toLowerCase()
    if (!q) return residents
    return residents.filter((resident) =>
      patientName(resident.patient?.first_name, resident.patient?.last_name).toLowerCase().includes(q)
      || (resident.room_number ?? '').toLowerCase().includes(q)
      || (resident.patient?.nhs_number ?? '').includes(q))
  }, [residents, residentFilter])

  useEffect(() => {
    if (organisation?.id) void fetchLinks(organisation.id, organisationType)
  }, [organisation?.id, organisationType, fetchLinks])

  // A deep link (?link=) picks the care home, e.g. from a care home profile.
  useEffect(() => {
    if (requestedLink && links.some((link) => link.id === requestedLink) && requestedLink !== selectedLinkId) {
      void selectLink(requestedLink)
    }
  }, [requestedLink, links, selectedLinkId, selectLink])

  // Older links used ?view=requests; that view is its own page now.
  useEffect(() => {
    if (viewParam === 'requests' && selectedLinkId) navigate(`/care-homes/${selectedLinkId}/requests`, { replace: true })
  }, [viewParam, selectedLinkId, navigate])

  const setTab = (next: WorkspaceTab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'groups') params.delete('view')
    else params.set('view', next)
    setSearchParams(params, { replace: true })
  }

  const changeLink = (linkId: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('link', linkId)
    setSearchParams(params, { replace: true })
    void selectLink(linkId)
  }

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !inviteForm.fullName.trim() || !inviteForm.email.trim()) return
    try {
      await inviteCareHomeUser(selectedLinkId, inviteForm.email, inviteForm.fullName)
      setInviteForm({ fullName: '', email: '' })
      setInviteSent(true)
    } catch {
      // error shown by the store
    }
  }

  const handleCreateGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !groupForm.name.trim()) return
    try {
      await createGroup({
        linkId: selectedLinkId,
        name: groupForm.name.trim(),
        groupType: groupForm.groupType,
        cycleDay: groupForm.cycleDay ? Number(groupForm.cycleDay) : undefined,
      })
      setGroupForm({ name: '', groupType: 'monthly', cycleDay: '' })
      setShowGroupForm(false)
    } catch {
      // error shown by the store
    }
  }

  const handlePrepareMar = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedLinkId || !marForm.residentId) return
    try {
      const cycleId = await prepareMarCycle(marForm.residentId, marForm.periodStart, marForm.periodEnd)
      setShowMarForm(false)
      navigate(`/care-homes/${selectedLinkId}/mar/${cycleId}`)
    } catch {
      // error shown by the store
    }
  }

  return (
    <div className="care-home-page">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Care homes' }]}
        eyebrow={isCareHome ? 'Care home workspace' : 'Care homes'}
        title={isCareHome ? organisation?.name ?? 'Care home' : 'Care home management'}
        subtitle={isCareHome
          ? 'Residents, medication requests, MAR charts and deliveries shared with your pharmacy.'
          : 'Delivery groups, residents, requests and MAR charts for the care homes you supply.'}
        actions={<>
          {selectedLinkId && (
            <button className="ps-btn ps-btn-secondary care-home-no-print" type="button" onClick={() => navigate(`/care-homes/${selectedLinkId}/requests`)}>
              <ClipboardList size={16} strokeWidth={1.75} aria-hidden="true" /> Requests{openRequests.length ? ` (${openRequests.length})` : ''}
            </button>
          )}
          {canManage && (
            <button className="ps-btn ps-btn-secondary care-home-no-print" type="button" onClick={() => navigate(selectedLinkId ? `/care-homes/manage/${selectedLinkId}` : '/care-homes/manage')}>
              Care home profile
            </button>
          )}
        </>}
      />

      {error && (
        <div className="auth-error care-home-alert" role="alert">
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button>
        </div>
      )}

      {loading && links.length === 0 ? (
        <div className="care-home-loading">Loading care homes...</div>
      ) : links.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={isCareHome ? 'No pharmacy connection yet' : 'No care homes yet'}
          actions={canManage ? <button className="ps-btn ps-btn-primary" type="button" onClick={() => navigate('/care-homes/manage')}>Add care home</button> : undefined}
        >
          {isCareHome
            ? 'When your pharmacy connects your care home, your residents and requests will appear here.'
            : canManage
              ? 'Add the first care home you supply to start managing residents, groups and deliveries.'
              : 'Ask a pharmacy manager to add the care homes you supply.'}
        </EmptyState>
      ) : (
        <>
          <div className="care-home-context-bar care-home-no-print">
            <label htmlFor="care-home-selector">Care home</label>
            <select id="care-home-selector" className="ps-input" value={selectedLinkId ?? ''} onChange={(event) => changeLink(event.target.value)}>
              {links.map((link) => <option key={link.id} value={link.id}>{(isCareHome ? link.pharmacy_organisation?.name : link.care_home_organisation?.name) ?? 'Care home'}</option>)}
            </select>
            <span className={`ps-badge ${selectedLink?.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{chLabel('linkStatus', selectedLink?.status)}</span>
            <span className="care-home-context-contact">{selectedLink?.contact_name || selectedLink?.contact_email || 'No main contact set'}</span>
            {canInvite && <button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" onClick={() => { setShowInviteForm((visible) => !visible); setInviteSent(false) }}>{showInviteForm ? 'Close invite' : 'Invite care home staff'}</button>}
          </div>

          {showInviteForm && canInvite && (
            <form className="care-home-invite-form care-home-no-print" onSubmit={(event) => void handleInvite(event)}>
              <div><strong>Invite care home staff</strong><span>The first person you invite becomes the care home's login administrator. Everyone invited can see residents, send requests and record MAR charts.</span></div>
              <label>Full name *<input className="ps-input" required value={inviteForm.fullName} onChange={(event) => setInviteForm({ ...inviteForm, fullName: event.target.value })} /></label>
              <label>Email *<input className="ps-input" type="email" required value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} /></label>
              <button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Sending...' : 'Send invitation'}</button>
              {inviteSent && <p role="status">Invitation sent. They set a password from the email, then sign in with the care home login.</p>}
            </form>
          )}

          <div className="stats-grid care-home-no-print">
            <div className="stat-card"><div className="stat-card-label">Residents</div><div className="stat-card-value">{residents.filter((resident) => resident.status === 'active').length}</div><div className="stat-card-sub">{residents.length} in total</div></div>
            <div className={`stat-card${openRequests.some((request) => request.status === 'submitted') ? ' stat-card-accent' : ''}`}><div className="stat-card-label">Open requests</div><div className="stat-card-value">{openRequests.length}</div><div className="stat-card-sub">{openRequests.filter((request) => request.status === 'submitted').length} waiting for the pharmacy</div></div>
            <div className="stat-card"><div className="stat-card-label">Delivery groups</div><div className="stat-card-value">{groups.length}</div><div className="stat-card-sub">{groups.filter((group) => group.group_state !== 'idle').length} in progress</div></div>
            <div className="stat-card"><div className="stat-card-label">Cycle length</div><div className="stat-card-value">{selectedLink?.default_cycle_length_days ?? 28}</div><div className="stat-card-sub">days per medication cycle</div></div>
          </div>

          <div className="ps-tabs care-home-workspace-tabs care-home-no-print" role="tablist" aria-label="Care home views">
            {TABS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`ps-tab${tab === item.id ? ' active' : ''}`} onClick={() => setTab(item.id)}>
                {item.label}
                {loading ? '' : item.id === 'residents' ? ` (${residents.length})` : item.id === 'mar' ? ` (${visibleCycles.length})` : ''}
              </button>
            ))}
          </div>

          <section className="care-home-workspace">
            {tab === 'residents' && (
              <div>
                <div className="care-home-section-heading">
                  <div><p>Resident register</p><h2>{residents.length} resident{residents.length === 1 ? '' : 's'}</h2></div>
                  {canManage && !showResidentForm && <button className="ps-btn ps-btn-primary care-home-no-print" type="button" onClick={() => setShowResidentForm(true)}>+ Add resident</button>}
                </div>
                {showResidentForm && canManage && selectedLinkId && <AddResidentForm linkId={selectedLinkId} onDone={() => setShowResidentForm(false)} />}
                {residents.length > 5 && <input className="ps-input care-home-no-print" placeholder="Search by name, room or NHS number" value={residentFilter} onChange={(event) => setResidentFilter(event.target.value)} />}
                {residents.length === 0 ? (
                  <EmptyState
                    bare
                    icon={Users}
                    title="No residents yet"
                    actions={canManage && !showResidentForm ? <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowResidentForm(true)}>Add resident</button> : undefined}
                  >
                    {canManage ? 'Add residents from your patient records, or create a new patient.' : 'Residents appear here once the pharmacy adds them.'}
                  </EmptyState>
                ) : filteredResidents.length === 0 ? (
                  <div className="care-home-inline-empty">No residents match "{residentFilter}". <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => setResidentFilter('')}>Clear search</button></div>
                ) : (
                  <div className="care-home-table-wrap">
                    <table className="care-home-table care-home-clickable-table">
                      <thead><tr><th>Resident</th><th>Room</th><th>NHS number</th><th>GP practice</th><th>Status</th></tr></thead>
                      <tbody>
                        {filteredResidents.map((resident) => (
                          <tr key={resident.id} tabIndex={0} onClick={() => navigate(`/care-homes/${selectedLinkId}/residents/${resident.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/care-homes/${selectedLinkId}/residents/${resident.id}`) }}>
                            <td><strong>{patientName(resident.patient?.first_name, resident.patient?.last_name)}</strong><small>{resident.patient?.dob ? `Born ${chDate(resident.patient.dob)}` : 'Date of birth not recorded'}</small></td>
                            <td>{resident.room_number ?? 'Not recorded'}</td>
                            <td>{resident.patient?.nhs_number ?? 'Not recorded'}</td>
                            <td>{resident.gp_practice ?? 'Not recorded'}</td>
                            <td><span className={`ps-badge ${resident.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{chLabel('residentStatus', resident.status)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === 'groups' && (
              <div>
                <div className="care-home-section-heading">
                  <div><p>Delivery workflow</p><h2>Groups board</h2></div>
                  {canManage && <button className="ps-btn ps-btn-primary care-home-no-print" type="button" onClick={() => setShowGroupForm((visible) => !visible)}>{showGroupForm ? 'Close' : '+ Add group'}</button>}
                </div>
                {showGroupForm && canManage && (
                  <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleCreateGroup(event)}>
                    <label>Group name *<input className="ps-input" required placeholder="e.g. Group A, Willow wing" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></label>
                    <label>Type<select className="ps-input" value={groupForm.groupType} onChange={(event) => setGroupForm({ ...groupForm, groupType: event.target.value as CareHomeGroupType })}><option value="monthly">Monthly cycle</option><option value="acute">Acute (frequent deliveries)</option></select></label>
                    {groupForm.groupType === 'monthly' && <label>Cycle day<input className="ps-input" type="number" min="1" max="31" placeholder="e.g. 14" value={groupForm.cycleDay} onChange={(event) => setGroupForm({ ...groupForm, cycleDay: event.target.value })} /><small className="care-home-help">Day of the month this group's supplies are due.</small></label>}
                    <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create group'}</button></div>
                  </form>
                )}
                {groups.length === 0 && (
                  <div className="care-home-inline-empty care-home-no-print">No delivery groups yet. {canManage ? 'Create a monthly group for each delivery cycle, plus an acute group for urgent deliveries.' : 'The pharmacy sets up delivery groups.'}</div>
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
                              <button key={group.id} type="button" className="care-home-group-card" onClick={() => navigate(`/care-homes/${selectedLinkId}/groups/${group.id}`)}>
                                <div className="care-home-group-card-top">
                                  <strong>{group.name}</strong>
                                  <span className={`ps-badge ${group.group_type === 'acute' ? 'ps-badge-warning' : 'ps-badge-muted'}`}>{chLabel('groupType', group.group_type)}</span>
                                </div>
                                <div className="care-home-group-card-meta">
                                  <span>{memberCount} resident{memberCount === 1 ? '' : 's'}</span>
                                  {group.group_type === 'monthly' && group.cycle_day && <span>Day {group.cycle_day}</span>}
                                </div>
                                {activeBatch && <small className="care-home-group-card-batch">Round #{activeBatch.batch_number} · {chLabel('batchStatus', activeBatch.status)}</small>}
                                {group.delivery_round_id && <small className="care-home-group-card-batch">Delivery run linked</small>}
                                {group.state_changed_at && <small className="care-home-group-card-time">Since {chDate(group.state_changed_at)}</small>}
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

            {tab === 'mar' && (
              <div>
                <div className="care-home-section-heading">
                  <div><p>Medication administration records</p><h2>MAR charts</h2></div>
                  {canPrepareMar && <button className="ps-btn ps-btn-primary care-home-no-print" type="button" disabled={residents.length === 0} onClick={() => setShowMarForm((visible) => !visible)}>{showMarForm ? 'Close' : '+ Prepare MAR chart'}</button>}
                </div>
                {canPrepareMar && residents.length === 0 && <small className="care-home-help">Add a resident first to prepare a MAR chart.</small>}
                {showMarForm && canPrepareMar && (
                  <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handlePrepareMar(event)}>
                    <label className="care-home-form-span-2">Resident *<select className="ps-input" required value={marForm.residentId} onChange={(event) => setMarForm({ ...marForm, residentId: event.target.value })}><option value="">Select resident</option>{residents.filter((resident) => resident.status === 'active').map((resident) => <option key={resident.id} value={resident.id}>{patientName(resident.patient?.first_name, resident.patient?.last_name)}{resident.room_number ? ` · Room ${resident.room_number}` : ''}</option>)}</select><small className="care-home-help">The chart is built from the resident's active medicine rounds.</small></label>
                    <label>Start date *<input className="ps-input" type="date" required value={marForm.periodStart} onChange={(event) => setMarForm({ ...marForm, periodStart: event.target.value, periodEnd: addDays(event.target.value, (selectedLink?.default_cycle_length_days ?? 28) - 1) })} /></label>
                    <label>End date *<input className="ps-input" type="date" required min={marForm.periodStart} value={marForm.periodEnd} onChange={(event) => setMarForm({ ...marForm, periodEnd: event.target.value })} /></label>
                    <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !marForm.residentId}>{saving ? 'Preparing...' : 'Prepare chart'}</button></div>
                  </form>
                )}
                {visibleCycles.length === 0 ? (
                  <div className="care-home-inline-empty">{isCareHome ? 'No MAR charts have been shared by the pharmacy yet.' : 'No MAR charts yet. Prepare one for a resident, then publish it so the care home can record doses.'}</div>
                ) : (
                  <div className="care-home-table-wrap">
                    <table className="care-home-table care-home-clickable-table">
                      <thead><tr><th>Resident</th><th>Period</th><th>Status</th><th className="care-home-no-print">Actions</th></tr></thead>
                      <tbody>
                        {visibleCycles.map((cycle) => (
                          <tr key={cycle.id}>
                            <td><strong>{patientName(cycle.resident?.patient?.first_name, cycle.resident?.patient?.last_name)}</strong><small>{cycle.resident?.room_number ? `Room ${cycle.resident.room_number}` : 'Room not recorded'}</small></td>
                            <td>{chRange(cycle.period_start, cycle.period_end)}</td>
                            <td><span className={`ps-badge ${cycle.status === 'published' ? 'ps-badge-success' : cycle.status === 'archived' ? 'ps-badge-muted' : 'ps-badge-warning'}`}>{chLabel('marCycleStatus', cycle.status)}</span></td>
                            <td className="care-home-row-actions care-home-no-print">
                              <button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" onClick={() => navigate(`/care-homes/${selectedLinkId}/mar/${cycle.id}`)}>Open</button>
                              {canPrepareMar && activeUser?.id && (cycle.status === 'prepared' || cycle.status === 'draft') && (
                                <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving} onClick={() => void publishMarCycle(cycle.id, activeUser.id)}>Publish to care home</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === 'history' && (
              <div>
                <div className="care-home-section-heading"><div><p>Audit history</p><h2>Recent activity</h2></div></div>
                {history.length === 0 ? <div className="care-home-inline-empty">No activity has been recorded for this care home yet.</div> : (
                  <ol className="care-home-history">
                    {history.map((event) => (
                      <li key={event.id}>
                        <span>{new Date(event.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        <div><strong>{event.summary}</strong><small>{chLabel('entityType', event.entity_type)} · {chLabel('eventType', event.event_type)}</small></div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
