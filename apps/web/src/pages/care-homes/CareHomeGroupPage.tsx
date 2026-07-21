import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeGroupState } from '@pharmstation/types'

const stateBadge: Record<CareHomeGroupState, string> = {
  idle: 'ps-badge-muted',
  preparing: 'ps-badge-warning',
  ready: 'ps-badge-primary',
  in_transit: 'ps-badge-blue',
  delivered: 'ps-badge-success',
}

const stateLabel: Record<CareHomeGroupState, string> = {
  idle: 'Idle',
  preparing: 'Preparing',
  ready: 'Ready for collection',
  in_transit: 'In transit',
  delivered: 'Delivered',
}

function residentName(first?: string, last?: string) {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed resident'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function CareHomeGroupPage() {
  const { linkId, groupId } = useParams<{ linkId: string; groupId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser, permissions } = useAuthStore()
  const {
    groups,
    activeGroup,
    residents,
    requests,
    supplyBatches,
    loading,
    saving,
    error,
    selectLink,
    fetchGroup,
    startGroupPreparation,
    markGroupReady,
    returnGroupToIdle,
    addResidentToGroup,
    removeResidentFromGroup,
    clearError,
  } = useCareHomeStore()

  const today = new Date().toISOString().slice(0, 10)
  const [showPrepForm, setShowPrepForm] = useState(false)
  const [prepForm, setPrepForm] = useState({ title: '', periodStart: today, periodEnd: addDays(today, 27), deliveryDate: '', supplyScope: 'all' as 'all' | 'regular' | 'acute' })
  const [showPatientsModal, setShowPatientsModal] = useState(false)
  const [residentToAdd, setResidentToAdd] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const isCareHome = organisation?.organisation_type === 'carehome'
  const canManage = !isCareHome && permissions?.care_home_manage === true

  useEffect(() => {
    if (linkId) void selectLink(linkId)
  }, [linkId, selectLink])

  useEffect(() => {
    if (groupId) void fetchGroup(groupId)
  }, [groupId, fetchGroup])

  const group = useMemo(
    () => activeGroup?.id === groupId ? activeGroup : groups.find((g) => g.id === groupId) ?? null,
    [activeGroup, groups, groupId],
  )

  const memberIds = useMemo(
    () => new Set((group?.members ?? []).map((m) => m.care_home_resident_id)),
    [group],
  )

  const members = useMemo(() => {
    if (!group) return []
    const fromMembership = (group.members ?? [])
      .map((m) => residents.find((r) => r.id === m.care_home_resident_id) ?? m.resident)
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
    // also include residents whose legacy unit_id points at this group
    const legacy = residents.filter((r) => r.unit_id === group.id && !fromMembership.some((m) => m.id === r.id))
    return [...fromMembership, ...legacy]
  }, [group, residents])

  const availableResidents = useMemo(
    () => residents.filter((r) => r.status === 'active' && !memberIds.has(r.id) && r.unit_id !== groupId),
    [residents, memberIds, groupId],
  )

  const activeBatch = useMemo(
    () => (activeGroup && activeGroup.id === groupId ? activeGroup.active_batch : null) ?? supplyBatches.find((b) => b.id === group?.active_batch_id) ?? null,
    [activeGroup, groupId, supplyBatches, group],
  )

  const bags = useMemo(() => activeBatch?.packages ?? [], [activeBatch])

  const pastBatches = useMemo(
    () =>
      supplyBatches
        .filter((b) => b.group_id === groupId && b.id !== activeBatch?.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [supplyBatches, groupId, activeBatch],
  )

  const openRequestCount = useMemo(
    () => requests.filter((r) => memberIds.has(r.care_home_resident_id) && !['completed', 'cancelled', 'declined'].includes(r.status)).length,
    [requests, memberIds],
  )

  if (!group && !loading) {
    return (
      <div className="care-home-page">
        <div className="care-home-inline-empty">Group not found. <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => navigate('/care-homes')}>Back to care homes</button></div>
      </div>
    )
  }

  const handleStartPrep = async (event: FormEvent) => {
    event.preventDefault()
    if (!groupId) return
    setActionError(null)
    try {
      await startGroupPreparation(groupId, {
        title: prepForm.title.trim() || `${group?.name ?? 'Group'} supply`,
        periodStart: prepForm.periodStart,
        periodEnd: prepForm.periodEnd,
        deliveryDate: prepForm.deliveryDate || undefined,
        supplyScope: prepForm.supplyScope,
      })
      setShowPrepForm(false)
      void fetchGroup(groupId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to start preparation')
    }
  }

  const handleMarkReady = async () => {
    if (!groupId) return
    setActionError(null)
    try {
      await markGroupReady(groupId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to mark group ready')
    }
  }

  const handleReturnToIdle = async () => {
    if (!groupId) return
    await returnGroupToIdle(groupId)
  }

  const handleAddResident = async (event: FormEvent) => {
    event.preventDefault()
    if (!groupId || !residentToAdd || !activeUser?.id) return
    await addResidentToGroup(groupId, residentToAdd, activeUser.id)
    setResidentToAdd('')
  }

  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs">
          <a href="/care-homes" onClick={(e) => { e.preventDefault(); navigate('/care-homes') }}>Care homes</a>
          <span className="separator">/</span>
          <span>{group?.name ?? 'Group'}</span>
        </div>
        <button className="ps-btn ps-btn-secondary ps-btn-sm care-home-back-btn care-home-no-print" type="button" onClick={() => navigate('/care-homes')}>
          ← Back to groups board
        </button>
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">Delivery group · {group?.group_type}</p>
            <h1>{group?.name}</h1>
            <p className="care-home-subtitle">
              {group?.group_type === 'acute'
                ? 'Acute group — delivered almost every day.'
                : `Monthly delivery group${group?.cycle_day ? ` · cycle day ${group.cycle_day}` : ''}.`}
            </p>
          </div>
          {group && (
            <div className="care-home-group-state-block">
              <span className={`ps-badge ${stateBadge[group.group_state]} care-home-group-state-badge`}>{stateLabel[group.group_state]}</span>
              {group.state_changed_at && <small>since {formatDate(group.state_changed_at)}</small>}
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

      {group && (
        <>
          <div className="care-home-metrics">
            <article><span>Patients</span><strong>{members.length}</strong><small>in this group</small></article>
            <article><span>Open requests</span><strong>{openRequestCount}</strong><small>across group patients</small></article>
            <article><span>Active batch</span><strong>{activeBatch ? `#${activeBatch.batch_number}` : '—'}</strong><small>{activeBatch ? activeBatch.status.replaceAll('_', ' ') : 'no batch in progress'}</small></article>
            <article><span>Delivery run</span><strong>{group.delivery_round_id ? 'Linked' : '—'}</strong><small>{group.delivery_round_id ? 'tracked in Deliveries' : 'created when marked ready'}</small></article>
          </div>

          {canManage && (
            <div className="care-home-group-actions">
              {group.group_state === 'idle' && (
                <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowPrepForm((v) => !v)}>
                  {showPrepForm ? 'Close' : 'Start a new round'}
                </button>
              )}
              {group.group_state === 'preparing' && (
                <button className="ps-btn ps-btn-primary" type="button" onClick={() => void handleMarkReady()} disabled={saving}>
                  {saving ? 'Generating run...' : 'Mark ready & create delivery run'}
                </button>
              )}
              {group.group_state === 'ready' && group.delivery_round_id && (
                <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/deliveries/${group.delivery_round_id}`)}>
                  Open delivery run
                </button>
              )}
              {(group.group_state === 'in_transit' || group.group_state === 'delivered') && group.delivery_round_id && (
                <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/deliveries/${group.delivery_round_id}`)}>
                  Track delivery run
                </button>
              )}
              {group.group_state === 'delivered' && (
                <button className="ps-btn ps-btn-primary" type="button" onClick={() => void handleReturnToIdle()} disabled={saving}>
                  {saving ? 'Updating...' : 'Confirm & return to idle'}
                </button>
              )}
              <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowPatientsModal(true)}>
                Manage patients ({members.length})
              </button>
              <button className="ps-btn ps-btn-ghost" type="button" onClick={() => navigate(`/care-homes/manage/${linkId}`)}>
                Group settings
              </button>
            </div>
          )}

          {showPrepForm && canManage && group.group_state === 'idle' && (
            <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleStartPrep(event)}>
              <label className="care-home-form-span-2">Round title<input className="ps-input" placeholder={`${group.name} supply`} value={prepForm.title} onChange={(e) => setPrepForm({ ...prepForm, title: e.target.value })} /></label>
              <label>Supply type<select className="ps-input" value={prepForm.supplyScope} onChange={(e) => setPrepForm({ ...prepForm, supplyScope: e.target.value as 'all' | 'regular' | 'acute' })}><option value="all">All medicines</option><option value="regular">Regular, repeat and PRN only</option><option value="acute">Acute only</option></select></label>
              <label>Delivery date<input className="ps-input" type="date" value={prepForm.deliveryDate} onChange={(e) => setPrepForm({ ...prepForm, deliveryDate: e.target.value })} /></label>
              <label>Period start<input className="ps-input" type="date" required value={prepForm.periodStart} onChange={(e) => setPrepForm({ ...prepForm, periodStart: e.target.value, periodEnd: addDays(e.target.value, 27) })} /></label>
              <label>Period end<input className="ps-input" type="date" required value={prepForm.periodEnd} onChange={(e) => setPrepForm({ ...prepForm, periodEnd: e.target.value })} /></label>
              <p className="care-home-form-span-2 care-home-form-help">This creates a bag for every patient in the group, filled with their current medicines for the period.</p>
              <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create round & start preparing'}</button></div>
            </form>
          )}

          {group.group_state === 'idle' && !showPrepForm && (
            <div className="care-home-inline-empty">
              No active round for this group.{canManage ? ' Start a new round to create a bag for each patient.' : ''}
            </div>
          )}

          {activeBatch && group.group_state !== 'idle' && (
            <>
              <div className="care-home-section-heading">
                <div><p>Current round · {formatDate(activeBatch.period_start)} to {formatDate(activeBatch.period_end)}</p><h2>{bags.length} bag{bags.length === 1 ? '' : 's'}</h2></div>
              </div>
              {bags.length === 0 ? (
                <div className="care-home-inline-empty">No bags in this round yet. Bags are created from the patients in the group when the round starts.</div>
              ) : (
                <div className="care-home-table-wrap">
                  <table className="care-home-table care-home-clickable-table">
                    <thead><tr><th>Bag</th><th>Room</th><th>Medicines</th><th>Packed</th><th>Status</th></tr></thead>
                    <tbody>
                      {bags.map((bag) => {
                        const lines = bag.lines ?? []
                        const packed = lines.filter((line) => line.line_status !== 'expected' && line.line_status !== 'omitted').length
                        return (
                          <tr key={bag.id} tabIndex={0}
                            onClick={() => navigate(`/care-homes/${linkId}/groups/${groupId}/bags/${bag.id}`)}
                            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/care-homes/${linkId}/groups/${groupId}/bags/${bag.id}`) }}>
                            <td><strong>{residentName(bag.resident?.patient?.first_name, bag.resident?.patient?.last_name)}</strong><small>{bag.resident?.patient?.nhs_number ?? 'No NHS number'}</small></td>
                            <td>{bag.resident?.room_number ?? '—'}</td>
                            <td>{lines.length}</td>
                            <td>{packed}/{lines.length}</td>
                            <td><span className={`ps-badge ${bag.package_status === 'received' ? 'ps-badge-success' : bag.package_status === 'discrepancy' ? 'ps-badge-danger' : bag.package_status === 'open' ? 'ps-badge-warning' : 'ps-badge-blue'}`}>{bag.package_status.replaceAll('_', ' ')}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {pastBatches.length > 0 && (
            <>
              <div className="care-home-section-heading">
                <div><p>Round history</p><h2>{pastBatches.length} previous round{pastBatches.length === 1 ? '' : 's'}</h2></div>
              </div>
              <div className="care-home-table-wrap">
                <table className="care-home-table care-home-clickable-table">
                  <thead><tr><th>Period</th><th>Delivery date</th><th>Status</th></tr></thead>
                  <tbody>
                    {pastBatches.map((pastBatch) => (
                      <tr key={pastBatch.id} tabIndex={0}
                        onClick={() => navigate(`/care-homes/${linkId}/supplies/${pastBatch.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/care-homes/${linkId}/supplies/${pastBatch.id}`) }}>
                        <td><strong>{formatDate(pastBatch.period_start)} to {formatDate(pastBatch.period_end)}</strong></td>
                        <td>{formatDate(pastBatch.delivery_date)}</td>
                        <td><span className={`ps-badge ${pastBatch.status === 'reconciled' ? 'ps-badge-success' : pastBatch.status === 'cancelled' ? 'ps-badge-muted' : 'ps-badge-blue'}`}>{pastBatch.status.replaceAll('_', ' ')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {showPatientsModal && (
            <>
              <div className="modal-backdrop" onClick={() => setShowPatientsModal(false)} />
              <div className="modal-container">
                <div className="modal-dialog" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label={`Patients in ${group.name}`}>
                  <div className="modal-header">
                    <h2>Patients in {group.name}</h2>
                    <button className="ps-btn ps-btn-ghost ps-btn-sm modal-close" type="button" onClick={() => setShowPatientsModal(false)}>✕</button>
                  </div>
                  <div className="modal-body">
                    {canManage && (
                      <form className="care-home-modal-add-row" onSubmit={(event) => void handleAddResident(event)}>
                        <select className="ps-input" value={residentToAdd} onChange={(e) => setResidentToAdd(e.target.value)}>
                          <option value="">Add a patient to this group...</option>
                          {availableResidents.map((r) => <option key={r.id} value={r.id}>{residentName(r.patient?.first_name, r.patient?.last_name)}{r.room_number ? ` · Room ${r.room_number}` : ''}</option>)}
                        </select>
                        <button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !residentToAdd}>Add</button>
                      </form>
                    )}
                    {members.length === 0 ? (
                      <div className="care-home-inline-empty">No patients in this group yet.</div>
                    ) : (
                      <ul className="care-home-modal-member-list">
                        {members.map((resident) => (
                          <li key={resident.id}>
                            <button className="care-home-modal-member-name" type="button" onClick={() => navigate(`/care-homes/${linkId}/residents/${resident.id}`)}>
                              <strong>{residentName(resident.patient?.first_name, resident.patient?.last_name)}</strong>
                              <small>{resident.room_number ? `Room ${resident.room_number}` : 'No room'} · {resident.patient?.nhs_number ?? 'No NHS number'}</small>
                            </button>
                            <span className={`ps-badge ${resident.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{resident.status}</span>
                            {canManage && (
                              <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" disabled={saving} onClick={() => void removeResidentFromGroup(group.id, resident.id)}>Remove</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="modal-footer">
                    <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowPatientsModal(false)}>Done</button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
