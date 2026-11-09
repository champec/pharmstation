import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, usePepsStore } from '@pharmstation/core'
import { pepsCdSchedule, PEPS_CD_LABELS, type PepsEvent, type PepsVerifyResult } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'
import { Autocomplete } from '../../components/forms/Autocomplete'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/ui'

const EVENT_LABELS: Record<PepsEvent['event_type'], string> = {
  created: 'Created',
  sent_to_spine: 'Sent to spine',
  directed: 'Directed to pharmacy',
  downloaded: 'Downloaded',
  claimed: 'Claimed from spine',
  released: 'Released to spine',
  transferred: 'Transferred',
  dispensed: 'Dispensed',
  cancelled: 'Cancelled',
  printed: 'Document printed',
  cd_evidence_attached: 'Controlled drug evidence attached',
}

export function PEPSPrescriptionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    activePrescription: rx, activeItems, activeEvents, loading, error,
    fetchPrescription, dispense, cancel, release, transfer, downloadFromSpine, searchPharmacies, verifyPrescription,
  } = usePepsStore()

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showDispense, setShowDispense] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [verify, setVerify] = useState<PepsVerifyResult | null>(null)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [supplyNote, setSupplyNote] = useState('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [pharmacyText, setPharmacyText] = useState('')
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(() => { if (id) fetchPrescription(id) }, [id, fetchPrescription])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    setVerify(null)
    if (!id || rx?.id !== id) return
    verifyPrescription(id).then(setVerify).catch(() => setVerify(null))
  }, [id, rx?.id, rx?.status, verifyPrescription])
  useEffect(() => {
    getUserClient().auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null))
  }, [])

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
  const expired = !!rx.expires_at && new Date(rx.expires_at).getTime() < Date.now()
  const heldByMe = rx.status === 'held' && rx.assigned_org_id === orgId && !expired
  const iWroteIt = !!myUserId && rx.written_by === myUserId
  const canCancel = iWroteIt && (rx.status === 'available' || rx.status === 'held')
  // Only prescriptions sent to this pharmacy can be downloaded here. Open-spine ones are claimed from the queue.
  const downloadable = rx.status === 'available' && !!orgId && rx.assigned_org_id === orgId && !expired
  const canPrintDocument = !!orgId && rx.assigned_org_id === orgId && (rx.status === 'held' || rx.status === 'dispensed')
  const cdItems = activeItems.filter((it) => pepsCdSchedule(it.cd_category) !== 'none')
  const altered = verify?.status === 'altered'
  const prescriberBlocked = verify?.prescriber_status === 'suspended' || verify?.prescriber_status === 'revoked'
  const totalIssues = rx.repeats + 1

  const formatEventLabel = (ev: PepsEvent): string => {
    const metadata = (ev.metadata as Record<string, unknown> | null) ?? {}
    if (ev.event_type === 'printed' || (ev.event_type === 'downloaded' && metadata.document_print)) {
      const mode = String(metadata.print_mode ?? '').toUpperCase()
      return mode === 'COPY' ? 'Document printed (COPY)' : 'Document printed (ORIGINAL)'
    }
    if (ev.event_type === 'cd_evidence_attached' || (ev.event_type === 'downloaded' && metadata.controlled_drug_evidence)) {
      return 'Controlled drug evidence attached'
    }
    return EVENT_LABELS[ev.event_type] ?? ev.event_type
  }

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

  const openPrintPage = () => {
    window.open(`/peps/${rx.id}/print`, '_blank', 'noopener,noreferrer')
  }

  const handleDownloadAndPrint = async () => {
    if (!orgId) return
    setActionError(null)
    setBusy(true)
    try {
      await downloadFromSpine(orgId, [rx.id])
      await fetchPrescription(rx.id)
      openPrintPage()
    } catch (e: any) {
      setActionError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDispense = async () => {
    if (!showDispense) return
    setShowDispense(false)
    await run(async () => {
      await dispense(
        rx.id,
        activeItems.map((it) => ({
          item: it.drug_name,
          quantity: it.quantity,
          ...(it.cd_category && it.cd_category !== '0000' ? { cd_category: it.cd_category } : {}),
          ...(supplyNote.trim() ? { note: supplyNote.trim() } : {}),
        })),
      )
      setSupplyNote('')
    })
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'PEPS', to: '/peps' }, { label: rx.prescription_ref }]}
        title={rx.prescription_ref}
        subtitle={rx.expires_at && rx.status !== 'cancelled'
          ? <span style={{ color: expired ? 'var(--ps-error)' : undefined }}>
              {expired ? 'Expired' : 'Valid until'} {new Date(rx.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          : undefined}
        actions={
          <span className={`ps-badge ${rx.status === 'held' && !expired ? 'ps-badge-success' : ''}`}>
            {expired && rx.status !== 'dispensed' && rx.status !== 'cancelled' ? 'Expired' : rx.status[0].toUpperCase() + rx.status.slice(1)}
          </span>
        }
      />

      {rx.status === 'cancelled' && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          Cancelled by the prescriber{rx.cancelled_at ? ` on ${new Date(rx.cancelled_at).toLocaleDateString('en-GB')}` : ''}
          {rx.cancel_reason ? `: ${rx.cancel_reason}` : ''}. Do not dispense.
        </div>
      )}

      {altered && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          This prescription has been changed since the prescriber signed it. Do not dispense it. Contact the prescriber.
        </div>
      )}
      {prescriberBlocked && rx.status !== 'dispensed' && rx.status !== 'cancelled' && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          The prescriber's PharmStation account is {verify?.prescriber_status}. Do not dispense this prescription; contact the prescriber or the patient.
        </div>
      )}

      {actionError && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{actionError}</div>}

      <div className="ps-split" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--ps-space-md)', alignItems: 'start' }}>
        {/* Prescription document */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', textTransform: 'uppercase' }}>
                {rx.prescription_type === 'vet' ? 'Veterinary' : 'Private'} prescription
              </div>
              <strong style={{ fontSize: 'var(--ps-font-lg)' }}>{rx.patient_snapshot?.full_name ?? '—'}</strong>
              {rx.patient_snapshot?.nhs_number && <div style={{ color: 'var(--ps-slate)' }}>NHS {rx.patient_snapshot.nhs_number}</div>}
              {rx.patient_snapshot?.dob && <div style={{ color: 'var(--ps-slate)' }}>DOB {rx.patient_snapshot.dob}</div>}
              {rx.patient_snapshot?.address && <div style={{ color: 'var(--ps-slate)' }}>{rx.patient_snapshot.address}</div>}
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
                {pepsCdSchedule(it.cd_category) !== 'none' && (
                  <span className="ps-badge" style={{ marginLeft: 6 }}>{PEPS_CD_LABELS[pepsCdSchedule(it.cd_category)]}</span>
                )}
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
              {rx.prescriber_snapshot?.address && <div style={{ color: 'var(--ps-slate)' }}>{rx.prescriber_snapshot.address}</div>}
            </div>
            {rx.signature_data && <img src={rx.signature_data} alt="signature" style={{ height: 56, maxWidth: 200, objectFit: 'contain' }} />}
          </div>
          {verify && (
            <div style={{ marginTop: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)' }}>
              {verify.status === 'verified' && (
                <span className="ps-badge ps-badge-success">
                  ✓ Electronically signed{verify.signed_at ? ` ${new Date(verify.signed_at).toLocaleString('en-GB')}` : ''} · unchanged since signing
                </span>
              )}
              {verify.status === 'altered' && <span className="ps-badge ps-badge-danger">Changed since signing</span>}
              {verify.status === 'unsigned' && <span className="ps-badge">Not sealed (written before PIN signing)</span>}
            </div>
          )}
        </div>

        {/* Actions + history */}
        <div>
          <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)', padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ marginTop: 0 }}>Actions</h3>
            {canPrintDocument && (
              <button className="ps-btn ps-btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy}
                onClick={openPrintPage}>
                Open A4 print page
              </button>
            )}
            {downloadable && !heldByMe && (
              <button className="ps-btn ps-btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy}
                onClick={handleDownloadAndPrint}>
                Download and print
              </button>
            )}
            {heldByMe && (
              <>
                <button className="ps-btn ps-btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy || altered || prescriberBlocked}
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
            {canCancel && (
              <button className="ps-btn ps-btn-secondary" style={{ width: '100%', marginTop: 8, marginBottom: 8 }} disabled={busy}
                onClick={() => setShowCancel(true)}>
                ✕ Cancel prescription
              </button>
            )}
            {!downloadable && !heldByMe && !canCancel && (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', margin: 0 }}>
                {rx.status === 'dispensed'
                  ? 'This prescription has been dispensed.'
                  : rx.status === 'cancelled'
                    ? 'This prescription was cancelled.'
                    : expired
                      ? 'This prescription has expired and can no longer be dispensed.'
                      : rx.status === 'available'
                        ? 'This prescription is waiting to be collected.'
                        : 'No actions available for your pharmacy.'}
              </p>
            )}
            {canPrintDocument && (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 8, marginBottom: 0 }}>
                Prints are audited and always marked COPY. The electronic prescription in PEPS is the original.
              </p>
            )}
          </div>

          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ marginTop: 0 }}>History</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {activeEvents.map((ev) => (
                <li key={ev.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--ps-off-white)', fontSize: 'var(--ps-font-sm)' }}>
                  <strong>{formatEventLabel(ev)}</strong>
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
        <div className="form-group" style={{ marginBottom: 'var(--ps-space-sm)' }}>
          <label>Batch / supply note (optional)</label>
          <input className="ps-input" value={supplyNote} onChange={(e) => setSupplyNote(e.target.value)} placeholder="e.g. batch AB123, exp 03/2028" />
        </div>
        {cdItems.length > 0 && (
          <div className="ps-alert ps-alert-warning" style={{ marginBottom: 'var(--ps-space-md)' }}>
            Contains a controlled drug ({cdItems.map((it) => `${it.drug_name}: ${PEPS_CD_LABELS[pepsCdSchedule(it.cd_category)]}`).join('; ')}).
            Check the prescription is still in date and record the batch in the supply note.
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowDispense(false)}>Cancel</button>
          <button className="ps-btn ps-btn-primary" disabled={busy || altered || prescriberBlocked}
            onClick={handleDispense}>
            Confirm dispense
          </button>
        </div>
      </Modal>

      {/* Cancel (prescriber) */}
      <Modal isOpen={showCancel} onClose={() => setShowCancel(false)} title="Cancel prescription">
        <p style={{ marginTop: 0 }}>
          Cancelling stops <strong>{rx.prescription_ref}</strong> being dispensed anywhere.
          {rx.assigned_org_id ? ' The pharmacy holding it will be told.' : ''}
        </p>
        <div className="form-group">
          <label>Reason *</label>
          <input className="ps-input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. wrong dose, patient no longer needs it" />
        </div>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowCancel(false)}>Keep it</button>
          <button className="ps-btn ps-btn-primary" disabled={busy || cancelReason.trim().length < 3}
            onClick={() => { const r = cancelReason.trim(); setShowCancel(false); setCancelReason(''); run(() => cancel(rx.id, r)) }}>
            Cancel prescription
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
