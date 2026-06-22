import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, usePepsStore } from '@pharmstation/core'
import type { PepsEvent } from '@pharmstation/types'
import { Autocomplete } from '../../components/forms/Autocomplete'
import { Modal } from '../../components/Modal'

const EVENT_LABELS: Record<PepsEvent['event_type'], string> = {
  created: 'Created',
  sent_to_spine: 'Sent to spine',
  directed: 'Directed to pharmacy',
  downloaded: 'Downloaded',
  released: 'Released to spine',
  transferred: 'Transferred',
  dispensed: 'Dispensed',
  cancelled: 'Cancelled',
}

export function PEPSPrescriptionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    activePrescription: rx, activeItems, activeEvents, loading, error,
    fetchPrescription, dispense, release, transfer, downloadFromSpine, searchPharmacies,
  } = usePepsStore()

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showDispense, setShowDispense] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [pharmacyText, setPharmacyText] = useState('')
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(() => { if (id) fetchPrescription(id) }, [id, fetchPrescription])
  useEffect(() => { load() }, [load])

  if (loading && !rx) return <div style={{ padding: 'var(--ps-space-lg)' }}>Loading…</div>
  if (!rx) {
    return (
      <div style={{ padding: 'var(--ps-space-lg)' }}>
        <p>{error ?? 'Prescription not found, or you do not have access to it.'}</p>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/peps')}>← Back to queue</button>
      </div>
    )
  }

  const orgId = organisation?.id
  const heldByMe = rx.status === 'held' && rx.assigned_org_id === orgId
  const downloadable = rx.status === 'available' && (rx.assigned_org_id === null || rx.assigned_org_id === orgId)
  const totalIssues = rx.repeats + 1

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null)
    setBusy(true)
    try {
      await fn()
      await fetchPrescription(rx.id)
    } catch (e: any) {
      setActionError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/peps" onClick={(e) => { e.preventDefault(); navigate('/peps') }}>PEPS</a>
          <span className="separator">/</span>
          <span>{rx.prescription_ref}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>℞ {rx.prescription_ref}</h1>
          <span className={`ps-badge ${rx.status === 'held' ? 'ps-badge-success' : ''}`}>{rx.status.toUpperCase()}</span>
        </div>
      </div>

      {actionError && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{actionError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--ps-space-md)', alignItems: 'start' }}>
        {/* Prescription document */}
        <div className="ps-card">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', textTransform: 'uppercase' }}>
                {rx.prescription_type === 'vet' ? 'Veterinary' : 'Private'} prescription
              </div>
              <strong style={{ fontSize: 'var(--ps-font-lg)' }}>{rx.patient_snapshot?.full_name ?? '—'}</strong>
              {rx.patient_snapshot?.nhs_number && <div style={{ color: 'var(--ps-slate)' }}>NHS {rx.patient_snapshot.nhs_number}</div>}
              {rx.patient_snapshot?.dob && <div style={{ color: 'var(--ps-slate)' }}>DOB {rx.patient_snapshot.dob}</div>}
              {rx.prescription_type === 'vet' && rx.animal_name && (
                <div>Animal: {rx.animal_name}{rx.animal_owner ? ` (owner: ${rx.animal_owner})` : ''}</div>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: 'var(--ps-font-sm)' }}>
              <div>{rx.prescription_date}</div>
              {rx.repeats > 0 && <div>{rx.repeats_dispensed}/{totalIssues} issued</div>}
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)', margin: 'var(--ps-space-md) 0' }} />
          <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {activeItems.map((it) => (
              <li key={it.id} style={{ marginBottom: 10 }}>
                <strong>{it.drug_name}</strong> — {it.quantity}
                {it.dosage && <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>{it.dosage}</div>}
                {it.dmd_code && <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-mist)' }}>dm+d {it.dmd_type?.toUpperCase()} {it.dmd_code}</div>}
              </li>
            ))}
          </ol>

          {rx.cascade_wording && (
            <p style={{ fontSize: 'var(--ps-font-xs)', fontStyle: 'italic', color: 'var(--ps-slate)' }}>{rx.cascade_wording}</p>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)', margin: 'var(--ps-space-md) 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 'var(--ps-font-sm)' }}>
              <div><strong>{rx.prescriber_snapshot?.full_name}</strong></div>
              <div style={{ color: 'var(--ps-slate)' }}>{rx.prescriber_snapshot?.registration_body} {rx.prescriber_snapshot?.registration_number}</div>
              {rx.prescribing_org_snapshot?.name && <div style={{ color: 'var(--ps-slate)' }}>{rx.prescribing_org_snapshot.name}</div>}
            </div>
            {rx.signature_data && <img src={rx.signature_data} alt="signature" style={{ height: 56, maxWidth: 200, objectFit: 'contain' }} />}
          </div>
        </div>

        {/* Actions + history */}
        <div>
          <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)' }}>
            <h3 style={{ marginTop: 0 }}>Actions</h3>
            {downloadable && !heldByMe && (
              <button className="ps-btn ps-btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy}
                onClick={() => orgId && run(() => downloadFromSpine(orgId, [rx.id]))}>
                📥 Download to my pharmacy
              </button>
            )}
            {heldByMe && (
              <>
                <button className="ps-btn ps-btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy}
                  onClick={() => setShowDispense(true)}>
                  ✓ Dispense
                </button>
                <button className="ps-btn ps-btn-secondary" style={{ width: '100%', marginBottom: 8 }} disabled={busy}
                  onClick={() => run(() => release(rx.id))}>
                  ↩ Release to spine
                </button>
                <button className="ps-btn ps-btn-secondary" style={{ width: '100%' }} disabled={busy}
                  onClick={() => setShowTransfer(true)}>
                  → Transfer to another pharmacy
                </button>
              </>
            )}
            {!downloadable && !heldByMe && (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', margin: 0 }}>
                {rx.status === 'dispensed'
                  ? 'This prescription has been dispensed.'
                  : rx.status === 'available'
                    ? 'This prescription is on the spine but directed to another pharmacy.'
                    : 'No actions available for your pharmacy.'}
              </p>
            )}
          </div>

          <div className="ps-card">
            <h3 style={{ marginTop: 0 }}>History</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {activeEvents.map((ev) => (
                <li key={ev.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--ps-off-white)', fontSize: 'var(--ps-font-sm)' }}>
                  <strong>{EVENT_LABELS[ev.event_type] ?? ev.event_type}</strong>
                  <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>
                    {new Date(ev.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
              {activeEvents.length === 0 && <li style={{ color: 'var(--ps-slate)' }}>No history.</li>}
            </ul>
          </div>
        </div>
      </div>

      {/* Dispense confirmation */}
      <Modal isOpen={showDispense} onClose={() => setShowDispense(false)} title="Dispense prescription">
        <p>
          You are about to dispense <strong>{rx.prescription_ref}</strong>
          {rx.repeats > 0 && ` (issue ${rx.repeats_dispensed + 1} of ${totalIssues})`}.
        </p>
        <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          This decision cannot be reversed. A private prescription must be legally retained once dispensed.
        </div>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowDispense(false)}>Cancel</button>
          <button className="ps-btn ps-btn-primary" disabled={busy}
            onClick={() => { setShowDispense(false); run(() => dispense(rx.id)) }}>
            Confirm dispense
          </button>
        </div>
      </Modal>

      {/* Transfer */}
      <Modal isOpen={showTransfer} onClose={() => setShowTransfer(false)} title="Transfer to another pharmacy">
        <p style={{ marginTop: 0, color: 'var(--ps-slate)' }}>
          The prescription leaves your queue and is directed to the chosen pharmacy. They must download it to take possession.
        </p>
        <div className="form-group">
          <label>Pharmacy</label>
          <Autocomplete<{ id: string; name: string; ods_code: string | null }>
            value={pharmacyText}
            onChange={(t) => { setPharmacyText(t); setTarget(null) }}
            onSearch={searchPharmacies}
            onSelect={(ph) => { setTarget(ph); setPharmacyText(ph.name) }}
            getKey={(ph) => ph.id}
            getLabel={(ph) => ph.name}
            getDetail={(ph) => ph.ods_code ? `ODS ${ph.ods_code}` : null}
            placeholder="Search pharmacies by name or ODS…"
          />
        </div>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowTransfer(false)}>Cancel</button>
          <button className="ps-btn ps-btn-primary" disabled={busy || !target}
            onClick={() => { const t = target!; setShowTransfer(false); run(() => transfer(rx.id, t.id)) }}>
            Transfer
          </button>
        </div>
      </Modal>
    </div>
  )
}
