import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeMedicationRequest, CareHomeMedicationRequestStatus, CareHomeMedicationRequestType } from '@pharmstation/types'

const OPEN_STATUSES: CareHomeMedicationRequestStatus[] = ['draft', 'submitted', 'acknowledged', 'approved', 'sent_to_gp', 'outstanding', 'received', 'part_received', 'refused', 'ordered', 'ready']

const statusClass: Record<CareHomeMedicationRequestStatus, string> = {
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

type StatusFilter = 'open' | 'all' | CareHomeMedicationRequestStatus

function residentName(request: CareHomeMedicationRequest) {
  const patient = request.resident?.patient
  return [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || 'Unnamed resident'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function CareHomeRequestsManagerPage() {
  const { linkId } = useParams<{ linkId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser, permissions } = useAuthStore()
  const {
    requests,
    gpRequests,
    residents,
    groups,
    selectedLinkId,
    loading,
    saving,
    error,
    selectLink,
    updateRequestStatus,
    createMedicationRequest,
    prepareGpRequest,
    clearError,
  } = useCareHomeStore()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [gpFormFilter, setGpFormFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [showGpRequestForm, setShowGpRequestForm] = useState(false)
  const [requestForm, setRequestForm] = useState({ residentId: '', requestType: 'repeat' as CareHomeMedicationRequestType, medicineName: '', quantity: '', neededBy: '', notes: '' })
  const [gpRequestForm, setGpRequestForm] = useState({ surgeryName: '', title: 'Repeat prescription request', cycleStart: today, cycleEnd: addDays(today, 27) })

  const isCareHome = organisation?.organisation_type === 'carehome'
  const canManage = !isCareHome && permissions?.care_home_manage === true
  const gpPractices = useMemo(() => Array.from(new Set(residents.map((resident) => resident.gp_practice).filter((practice): practice is string => Boolean(practice)))).sort(), [residents])

  useEffect(() => {
    if (linkId && linkId !== selectedLinkId) void selectLink(linkId)
  }, [linkId, selectedLinkId, selectLink])

  const residentGroup = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const resident of residents) {
      const names: string[] = []
      if (resident.unit_id) {
        const unit = groups.find((g) => g.id === resident.unit_id)
        if (unit) names.push(unit.name)
      }
      for (const membership of resident.group_memberships ?? []) {
        const group = groups.find((g) => g.id === membership.group_id)
        if (group && !names.includes(group.name)) names.push(group.name)
      }
      map.set(resident.id, names)
    }
    return map
  }, [residents, groups])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return requests.filter((request) => {
      if (statusFilter === 'open' && !OPEN_STATUSES.includes(request.status)) return false
      if (statusFilter !== 'open' && statusFilter !== 'all' && request.status !== statusFilter) return false
      if (typeFilter !== 'all' && request.request_type !== typeFilter) return false
      if (gpFormFilter === 'none' && request.gp_request_id !== null) return false
      if (gpFormFilter !== 'all' && gpFormFilter !== 'none' && request.gp_request_id !== gpFormFilter) return false
      if (groupFilter !== 'all') {
        const resident = residents.find((r) => r.id === request.care_home_resident_id)
        const inGroup = resident && (resident.unit_id === groupFilter || (resident.group_memberships ?? []).some((m) => m.group_id === groupFilter))
        if (!inGroup) return false
      }
      if (query && !residentName(request).toLowerCase().includes(query) && !request.medicine_name.toLowerCase().includes(query)) return false
      return true
    })
  }, [requests, statusFilter, groupFilter, typeFilter, gpFormFilter, search, residents])

  const advance = (request: CareHomeMedicationRequest) => {
    if (!activeUser?.id) return
    const next: Partial<Record<CareHomeMedicationRequestStatus, CareHomeMedicationRequestStatus>> = {
      submitted: 'acknowledged',
      acknowledged: 'approved',
      approved: 'ordered',
      ordered: 'ready',
      ready: 'completed',
    }
    const nextStatus = next[request.status]
    if (nextStatus) void updateRequestStatus(request.id, nextStatus, activeUser.id)
  }

  const nextActionLabel: Partial<Record<CareHomeMedicationRequestStatus, string>> = {
    submitted: 'Acknowledge',
    acknowledged: 'Approve',
    approved: 'Mark ordered',
    ordered: 'Mark ready',
    ready: 'Complete',
  }

  const handleCreateRequest = async (event: FormEvent) => {
    event.preventDefault()
    if (!linkId || !activeUser?.id || !requestForm.residentId || !requestForm.medicineName.trim()) return
    await createMedicationRequest({
      linkId,
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

  const handlePrepareGpRequest = async (event: FormEvent) => {
    event.preventDefault()
    if (!linkId) return
    const requestId = await prepareGpRequest(linkId, gpRequestForm.surgeryName, gpRequestForm.title, gpRequestForm.cycleStart, gpRequestForm.cycleEnd)
    setShowGpRequestForm(false)
    navigate(`/care-homes/${linkId}/prescriptions/${requestId}`)
  }

  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs">
          <a href="/care-homes" onClick={(e) => { e.preventDefault(); navigate('/care-homes') }}>Care homes</a>
          <span className="separator">/</span>
          <span>Requests manager</span>
        </div>
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">Central request management</p>
            <h1>Requests manager</h1>
            <p className="care-home-subtitle">Every patient medication request across all groups, filtered in one table.</p>
          </div>
          <div className="care-home-heading-actions care-home-no-print">
            <button className="ps-btn ps-btn-secondary" type="button" disabled={residents.length === 0} onClick={() => { setShowRequestForm((v) => !v); setShowGpRequestForm(false) }}>{showRequestForm ? 'Close' : 'New request'}</button>
            {canManage && <button className="ps-btn ps-btn-primary" type="button" onClick={() => { setShowGpRequestForm((v) => !v); setShowRequestForm(false) }}>{showGpRequestForm ? 'Close' : 'Prepare GP request'}</button>}
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error care-home-alert" role="alert">
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button>
        </div>
      )}

      {showRequestForm && (
        <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handleCreateRequest(event)}>
          <label>Patient<select className="ps-input" required value={requestForm.residentId} onChange={(e) => setRequestForm({ ...requestForm, residentId: e.target.value })}><option value="">Select patient</option>{residents.filter((r) => r.status === 'active').map((r) => <option key={r.id} value={r.id}>{[r.patient?.first_name, r.patient?.last_name].filter(Boolean).join(' ') || 'Unnamed resident'}</option>)}</select></label>
          <label>Type<select className="ps-input" value={requestForm.requestType} onChange={(e) => setRequestForm({ ...requestForm, requestType: e.target.value as CareHomeMedicationRequestType })}><option value="repeat">Repeat</option><option value="regular">Regular</option><option value="acute">Acute</option><option value="change">Medication change</option><option value="query">Query</option></select></label>
          <label className="care-home-form-span-2">Medicine<input className="ps-input" required placeholder="Start typing a medicine name" value={requestForm.medicineName} onChange={(e) => setRequestForm({ ...requestForm, medicineName: e.target.value })} /></label>
          <label>Quantity<input className="ps-input" type="number" min="1" value={requestForm.quantity} onChange={(e) => setRequestForm({ ...requestForm, quantity: e.target.value })} /></label>
          <label>Needed by<input className="ps-input" type="date" value={requestForm.neededBy} onChange={(e) => setRequestForm({ ...requestForm, neededBy: e.target.value })} /></label>
          <label className="care-home-form-span-2">Notes<textarea className="ps-input" rows={2} value={requestForm.notes} onChange={(e) => setRequestForm({ ...requestForm, notes: e.target.value })} /></label>
          <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Submitting...' : isCareHome ? 'Send to pharmacy' : 'Add request'}</button></div>
        </form>
      )}

      {showGpRequestForm && canManage && (
        <form className="care-home-request-form care-home-no-print" onSubmit={(event) => void handlePrepareGpRequest(event)}>
          <label>GP surgery<select className="ps-input" required value={gpRequestForm.surgeryName} onChange={(e) => setGpRequestForm({ ...gpRequestForm, surgeryName: e.target.value })}><option value="">Select surgery</option>{gpPractices.map((practice) => <option key={practice} value={practice}>{practice}</option>)}</select></label>
          <label>Request title<input className="ps-input" required value={gpRequestForm.title} onChange={(e) => setGpRequestForm({ ...gpRequestForm, title: e.target.value })} /></label>
          <label>Cycle start<input className="ps-input" type="date" required value={gpRequestForm.cycleStart} onChange={(e) => setGpRequestForm({ ...gpRequestForm, cycleStart: e.target.value, cycleEnd: addDays(e.target.value, 27) })} /></label>
          <label>Cycle end<input className="ps-input" type="date" required value={gpRequestForm.cycleEnd} onChange={(e) => setGpRequestForm({ ...gpRequestForm, cycleEnd: e.target.value })} /></label>
          {gpPractices.length === 0 && <p className="care-home-form-span-2 auth-error">Add each patient's GP practice before preparing a surgery request.</p>}
          <div className="care-home-form-actions care-home-form-span-2"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !gpRequestForm.surgeryName}>{saving ? 'Preparing...' : 'Prepare request list'}</button></div>
        </form>
      )}

      <div className="care-home-requests-filters care-home-no-print">
        <input className="ps-input" placeholder="Search patient or medicine" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="ps-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="open">Open statuses</option>
          <option value="all">All statuses</option>
          {OPEN_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
        </select>
        <select className="ps-input" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="all">All groups</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <select className="ps-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="regular">Regular</option>
          <option value="repeat">Repeat</option>
          <option value="acute">Acute</option>
          <option value="change">Change</option>
          <option value="query">Query</option>
        </select>
        <select className="ps-input" value={gpFormFilter} onChange={(e) => setGpFormFilter(e.target.value)}>
          <option value="all">Any GP form</option>
          <option value="none">Not on a GP form</option>
          {gpRequests.map((form) => <option key={form.id} value={form.id}>#{form.request_number} · {form.title}</option>)}
        </select>
        {gpFormFilter !== 'all' && gpFormFilter !== 'none' && (
          <button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" onClick={() => navigate(`/care-homes/${linkId}/prescriptions/${gpFormFilter}`)}>Open GP form</button>
        )}
        <span className="care-home-filter-count">{filtered.length} of {requests.length}</span>
      </div>

      {loading && requests.length === 0 ? (
        <div className="care-home-loading">Loading requests...</div>
      ) : filtered.length === 0 ? (
        <div className="care-home-inline-empty">No requests match these filters.</div>
      ) : (
        <div className="care-home-table-wrap">
          <table className="care-home-table">
            <thead>
              <tr><th>Patient</th><th>Group</th><th>Medicine</th><th>Type</th><th>Needed</th><th>Status</th><th>Outcome</th><th className="care-home-no-print">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((request) => (
                <tr key={request.id}>
                  <td>
                    <button className="care-home-link-btn" type="button" onClick={() => navigate(`/care-homes/${linkId}/residents/${request.care_home_resident_id}`)}>
                      <strong>{residentName(request)}</strong>
                    </button>
                    <small>{formatDate(request.requested_at)}</small>
                  </td>
                  <td>{(residentGroup.get(request.care_home_resident_id) ?? []).join(', ') || '—'}</td>
                  <td><strong>{request.medicine_name}</strong>{request.quantity ? <small> · qty {request.quantity}</small> : null}</td>
                  <td><span className="ps-badge ps-badge-muted">{request.request_type}</span></td>
                  <td>{formatDate(request.needed_by)}</td>
                  <td><span className={`ps-badge ${statusClass[request.status]}`}>{request.status.replaceAll('_', ' ')}</span></td>
                  <td>{request.gp_request_id ? <span className={`ps-badge ${request.prescription_outcome === 'pending' ? 'ps-badge-warning' : 'ps-badge-success'}`}>{request.prescription_outcome.replaceAll('_', ' ')}</span> : '—'}</td>
                  <td className="care-home-row-actions care-home-no-print">
                    {nextActionLabel[request.status] && (
                      <button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving} onClick={() => advance(request)}>
                        {nextActionLabel[request.status]}
                      </button>
                    )}
                    <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => navigate(`/care-homes/${linkId}/residents/${request.care_home_resident_id}`)}>
                      Open patient
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
