import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, usePepsStore } from '@pharmstation/core'
import type { PepsEvent } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'
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
  const { organisation, activeUser } = useAuthStore()
  const {
    activePrescription: rx, activeItems, activeEvents, loading, error,
    fetchPrescription, dispense, release, transfer, downloadFromSpine, searchPharmacies,
  } = usePepsStore()

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showDispense, setShowDispense] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [controlledDispenseAck, setControlledDispenseAck] = useState(false)
  const [controlledDispenseEvidence, setControlledDispenseEvidence] = useState<File | null>(null)
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
  const canPrintDocument = !!orgId && rx.assigned_org_id === orgId && (rx.status === 'held' || rx.status === 'dispensed')
  const controlledDrugDeclared = activeEvents.some(
    (ev) => ev.event_type === 'created' && Boolean((ev.metadata as Record<string, unknown> | null)?.controlled_drug_declared),
  )
  const totalIssues = rx.repeats + 1

  const formatEventLabel = (ev: PepsEvent): string => {
    const metadata = (ev.metadata as Record<string, unknown> | null) ?? {}
    if (ev.event_type === 'downloaded' && metadata.document_print) {
      const mode = String(metadata.print_mode ?? '').toUpperCase()
      return mode === 'COPY' ? 'Document printed (COPY)' : 'Document printed (ORIGINAL)'
    }
    if (ev.event_type === 'downloaded' && metadata.controlled_drug_evidence) {
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
    if (controlledDrugDeclared && !controlledDispenseAck) {
      setActionError('You must acknowledge the controlled-drug legal statement before dispensing.')
      return
    }

    setShowDispense(false)
    await run(async () => {
      if (controlledDrugDeclared) {
        if (!controlledDispenseEvidence) {
          throw new Error('Attach a scan/photo of the physical controlled-drug prescription before dispensing.')
        }
          if (controlledDispenseEvidence.size > 2 * 1024 * 1024) {
            throw new Error('Evidence file is too large. Please attach an image/PDF smaller than 2MB.')
          }
          const safeName = controlledDispenseEvidence.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const evidencePath = `peps/${rx.id}/controlled-drug/${Date.now()}-${safeName}`
          const { error: uploadError } = await getUserClient()
            .storage
            .from('scan-images')
            .upload(evidencePath, controlledDispenseEvidence, { upsert: false })
          if (uploadError) throw new Error(`Could not upload evidence: ${uploadError.message}`)
        const { data: auth } = await getUserClient().auth.getUser()
        await getUserClient().from('ps_peps_events').insert({
          prescription_id: rx.id,
          event_type: 'downloaded',
          from_org_id: organisation?.id ?? null,
          to_org_id: organisation?.id ?? null,
          actor_user_id: auth.user?.id ?? activeUser?.id ?? null,
          metadata: {
            controlled_drug_evidence: true,
            attachment_name: controlledDispenseEvidence.name,
            attachment_type: controlledDispenseEvidence.type,
            attachment_size: controlledDispenseEvidence.size,
              attachment_storage_bucket: 'scan-images',
              attachment_storage_path: evidencePath,
            legal_acknowledged: true,
            recorded_at: new Date().toISOString(),
          },
        })
      }
      await dispense(rx.id)
    })
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
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
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
          <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)', padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ marginTop: 0 }}>Actions</h3>
            {canPrintDocument && (
              <button className="ps-btn ps-btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy}
                onClick={openPrintPage}>
                🖨 Open A4 print page
              </button>
            )}
            {downloadable && !heldByMe && (
              <button className="ps-btn ps-btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy}
                onClick={handleDownloadAndPrint}>
                📥 Download and print original
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
            {canPrintDocument && (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 8, marginBottom: 0 }}>
                Prints are audited in PEPS. If an original already exists or the script is dispensed, the print is marked COPY.
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
        {controlledDrugDeclared && (
          <>
            <div className="ps-alert ps-alert-warning" style={{ marginBottom: 'var(--ps-space-md)' }}>
              Controlled-drug declaration detected. Ensure the physical compliant paper is retained and sent legally. Receiving pharmacies can only print copies.
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--ps-space-sm)' }}>
              <label>Attach scan/photo of physical prescription *</label>
              <input
                className="ps-input"
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setControlledDispenseEvidence(e.target.files?.[0] ?? null)}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)' }}>
              <input type="checkbox" checked={controlledDispenseAck} onChange={(e) => setControlledDispenseAck(e.target.checked)} />
              I confirm legal handling obligations for this controlled-drug paper prescription.
            </label>
          </>
        )}
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowDispense(false)}>Cancel</button>
          <button className="ps-btn ps-btn-primary" disabled={busy}
            onClick={handleDispense}>
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
