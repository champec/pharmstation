import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeMedicationRequest } from '@pharmstation/types'

function residentName(line: CareHomeMedicationRequest) {
  return [line.resident?.patient?.first_name, line.resident?.patient?.last_name].filter(Boolean).join(' ') || 'Resident'
}

function PrescriptionLine({ line, saving, editable, sent, onSave }: {
  line: CareHomeMedicationRequest
  saving: boolean
  editable: boolean
  sent: boolean
  onSave: (outcome: 'received' | 'part_received' | 'refused' | 'not_required', quantity?: number, reason?: string) => void
}) {
  const [quantity, setQuantity] = useState(String(line.quantity_received ?? line.quantity ?? ''))
  const [reason, setReason] = useState(line.outcome_reason ?? '')
  return (
    <article className="care-home-prescription-line">
      <div><strong>{line.medicine_name}</strong><span>{residentName(line)} · {line.request_type} · Requested {line.quantity ?? 'quantity not set'}</span>{line.request_notes && <small>{line.request_notes}</small>}</div>
      <span className={`ps-badge ${line.prescription_outcome === 'received' ? 'ps-badge-success' : line.prescription_outcome === 'pending' ? 'ps-badge-warning' : 'ps-badge-danger'}`}>{line.prescription_outcome.replaceAll('_', ' ')}</span>
      {editable ? <div className="care-home-prescription-actions care-home-no-print"><label>Received<input className="ps-input" type="number" min="0" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Reason / GP response<input className="ps-input" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving || !quantity} onClick={() => onSave('received', Number(quantity), reason)}>Received</button><button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" disabled={saving || !reason.trim()} onClick={() => onSave('part_received', Number(quantity || 0), reason)}>Part received</button><button className="ps-btn ps-btn-secondary ps-btn-sm" type="button" disabled={saving || !reason.trim()} onClick={() => onSave('refused', 0, reason)}>GP refused</button></div> : <div className="care-home-supply-result care-home-no-print"><small>{line.outcome_reason || (sent ? 'Waiting for pharmacy reconciliation' : 'Request not yet sent')}</small></div>}
    </article>
  )
}

export function CareHomePrescriptionRequestPage() {
  const navigate = useNavigate()
  const { linkId, requestId } = useParams<{ linkId: string; requestId: string }>()
  const { organisation, permissions } = useAuthStore()
  const { activeGpRequest: request, loading, saving, error, fetchGpRequest, markGpRequestSent, reconcilePrescriptionLine, clearError } = useCareHomeStore()
  const canManage = organisation?.organisation_type !== 'carehome' && permissions?.care_home_manage === true

  useEffect(() => {
    if (requestId) void fetchGpRequest(requestId)
  }, [requestId, fetchGpRequest])

  if (loading && !request) return <div className="care-home-loading">Loading GP request...</div>
  if (!request || request.id !== requestId) return <div className="care-home-inline-empty">GP request not found.</div>

  const lines = request.lines ?? []
  const outstanding = lines.filter((line) => line.prescription_outcome === 'pending').length
  const received = lines.filter((line) => ['received', 'part_received'].includes(line.prescription_outcome)).length
  const refused = lines.filter((line) => line.prescription_outcome === 'refused').length

  return (
    <div className="care-home-page care-home-prescription-page">
      <div className="page-header care-home-page-header care-home-no-print">
        <div className="breadcrumbs"><a href="/care-homes?view=requests" onClick={(event) => { event.preventDefault(); navigate('/care-homes?view=requests') }}>Prescription journey</a><span className="separator">/</span><span>GP request #{request.request_number}</span></div>
        <div className="care-home-title-row"><div><p className="care-home-eyebrow">Stage {request.status === 'received' ? '4 of 5' : request.sent_at ? '3 of 5' : '2 of 5'}</p><h1>{request.title}</h1><p className="care-home-subtitle">{lines.length} medicines · {outstanding} outstanding · {received} received · {refused} refused</p></div><div className="care-home-heading-actions"><button className="ps-btn ps-btn-secondary" type="button" onClick={() => window.print()}>Print / save PDF</button>{canManage && !request.sent_at && <button className="ps-btn ps-btn-primary" type="button" disabled={saving} onClick={() => void markGpRequestSent(request.id)}>Mark sent to surgery</button>}{request.status === 'received' && <button className="ps-btn ps-btn-primary" type="button" onClick={() => navigate('/care-homes?view=supplies')}>Continue to dispensing</button>}</div></div>
      </div>

      {error && <div className="auth-error care-home-alert care-home-no-print" role="alert"><span>{error}</span><button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button></div>}

      <div className="care-home-journey-status care-home-no-print"><span className="done">1. Medicines selected</span><span className={request.sent_at ? 'done' : 'current'}>2. Sent to GP</span><span className={request.sent_at && outstanding > 0 ? 'current' : request.status === 'received' ? 'done' : ''}>3. Prescription received</span><span className={request.status === 'received' ? 'current' : ''}>4. Dispense and deliver</span><span>5. Issue MAR</span></div>

      <section className="care-home-prescription-document">
        <header><div><strong>PharmStation</strong><span>Care-home repeat prescription request</span></div><div><strong>Request #{request.request_number}</strong><span>Prepared {new Date(request.prepared_at).toLocaleDateString('en-GB')}</span></div></header>
        <div className="care-home-prescription-addresses"><div><small>To</small><strong>{request.surgery_name || 'Resident GP surgery'}</strong><span>{request.surgery_address || 'Please route each resident request to their recorded GP practice.'}</span></div><div><small>Request period</small><strong>{request.cycle_start || '-'} to {request.cycle_end || '-'}</strong><span>{request.surgery_contact || ''}</span></div></div>
        <p>Please issue the following medicines for the named care-home residents. Contact the pharmacy if any item has been stopped, changed, refused, or is not due.</p>
        <table><thead><tr><th>Resident</th><th>NHS number</th><th>GP practice</th><th>Medicine</th><th>Type</th><th>Quantity</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td>{residentName(line)}</td><td>{line.resident?.patient?.nhs_number || '-'}</td><td>{line.resident?.gp_practice || '-'}</td><td>{line.medicine_name}</td><td>{line.request_type}</td><td>{line.quantity ?? '-'}</td></tr>)}</tbody></table>
        <footer><span>Pharmacy signature: ____________________</span><span>Date sent: ____________________</span><span>Surgery notes: __________________________________________</span></footer>
      </section>

      <section className="care-home-prescription-reconcile care-home-no-print">
        <div className="care-home-section-heading"><div><p>Stage 3</p><h2>Check the prescription received</h2></div></div>
        {!request.sent_at && <div className="care-home-inline-empty">Print or save the request form, send it to the surgery, then select “Mark sent to surgery”.</div>}
        {lines.map((line) => <PrescriptionLine key={line.id} line={line} saving={saving} editable={canManage && Boolean(request.sent_at)} sent={Boolean(request.sent_at)} onSave={(outcome, quantity, reason) => void reconcilePrescriptionLine(line.id, outcome, quantity, reason)} />)}
      </section>
    </div>
  )
}