import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useNHS111Store } from '@pharmstation/core'
import type { NHS111ReferralStatus, NHS111Urgency, NHS111Referral } from '@pharmstation/types'

// ============================================================
// Status & urgency helpers (shared with queue page)
// ============================================================

const STATUS_LABELS: Record<NHS111ReferralStatus, { label: string; cls: string }> = {
  received:    { label: 'New',         cls: 'ps-badge ps-badge-amber' },
  accepted:    { label: 'Accepted',    cls: 'ps-badge ps-badge-cyan' },
  in_progress: { label: 'In Progress', cls: 'ps-badge ps-badge-blue' },
  completed:   { label: 'Completed',   cls: 'ps-badge ps-badge-green' },
  rejected:    { label: 'Rejected',    cls: 'ps-badge ps-badge-red' },
  expired:     { label: 'Expired',     cls: 'ps-badge' },
}

const URGENCY_LABELS: Record<NHS111Urgency, { label: string; cls: string; icon: string }> = {
  emergency: { label: 'Emergency', cls: 'ps-badge ps-badge-red',   icon: '🚨' },
  urgent:    { label: 'Urgent',    cls: 'ps-badge ps-badge-amber', icon: '⚡' },
  routine:   { label: 'Routine',   cls: 'ps-badge ps-badge-green', icon: '📋' },
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const fmtDob = (iso: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

// ============================================================
// Component
// ============================================================

export function ReferralDetailPage() {
  const navigate = useNavigate()
  const { referralId } = useParams<{ referralId: string }>()
  const { activeUser } = useAuthStore()
  const {
    activeReferral: referral,
    loading,
    error,
    fetchReferral,
    acceptReferral,
    startConsultation,
    completeReferral,
    rejectReferral,
    addNote,
    clearError,
  } = useNHS111Store()

  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [completeModalOpen, setCompleteModalOpen] = useState(false)
  const [completeNotes, setCompleteNotes] = useState('')
  const [noteText, setNoteText] = useState('')
  const [showRawBundle, setShowRawBundle] = useState(false)

  useEffect(() => {
    if (referralId) fetchReferral(referralId)
  }, [referralId, fetchReferral])

  const userId = activeUser?.id ?? ''

  const handleAccept = useCallback(async () => {
    if (!referralId) return
    await acceptReferral(referralId, userId)
  }, [referralId, userId, acceptReferral])

  const handleStart = useCallback(async () => {
    if (!referralId) return
    await startConsultation(referralId, userId)
  }, [referralId, userId, startConsultation])

  const handleComplete = useCallback(async () => {
    if (!referralId) return
    await completeReferral(referralId, userId, { notes: completeNotes || undefined })
    setCompleteModalOpen(false)
    setCompleteNotes('')
  }, [referralId, userId, completeNotes, completeReferral])

  const handleReject = useCallback(async () => {
    if (!referralId || !rejectReason.trim()) return
    await rejectReferral(referralId, userId, rejectReason.trim())
    setRejectModalOpen(false)
    setRejectReason('')
  }, [referralId, userId, rejectReason, rejectReferral])

  const handleAddNote = useCallback(async () => {
    if (!referralId || !noteText.trim()) return
    const existingNotes = referral?.notes ?? ''
    const ts = new Date().toLocaleString('en-GB')
    const updated = existingNotes
      ? `${existingNotes}\n\n[${ts}] ${noteText.trim()}`
      : `[${ts}] ${noteText.trim()}`
    await addNote(referralId, updated)
    setNoteText('')
  }, [referralId, noteText, referral?.notes, addNote])

  if (loading && !referral) {
    return (
      <div style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
        Loading referral…
      </div>
    )
  }

  if (!referral) {
    return (
      <div style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
        <h2>Referral not found</h2>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services/111-referrals')}>
          ← Back to Queue
        </button>
      </div>
    )
  }

  const status = STATUS_LABELS[referral.status] ?? STATUS_LABELS.received
  const urgency = URGENCY_LABELS[referral.urgency] ?? URGENCY_LABELS.routine
  const address = referral.patient_address as { line?: string[]; city?: string; postalCode?: string } | null

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services/111-referrals" onClick={(e) => { e.preventDefault(); navigate('/services/111-referrals') }}>111 Referrals</a>
          <span className="separator">/</span>
          <span>{referral.patient_name ?? 'Referral'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--ps-space-sm)' }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            📞 {referral.patient_name ?? 'Unknown Patient'}
            <span className={urgency.cls}>{urgency.icon} {urgency.label}</span>
            <span className={status.cls}>{status.label}</span>
          </h1>
          <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/services/111-referrals')}>
            ← Back to Queue
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-lg)', flexWrap: 'wrap' }}>
        {referral.status === 'received' && (
          <>
            <button className="ps-btn ps-btn-primary" onClick={handleAccept} disabled={loading}>
              ✓ Accept Referral
            </button>
            <button
              className="ps-btn ps-btn-secondary"
              style={{ borderColor: 'var(--ps-red)', color: 'var(--ps-red)' }}
              onClick={() => setRejectModalOpen(true)}
              disabled={loading}
            >
              ✕ Reject
            </button>
          </>
        )}
        {referral.status === 'accepted' && (
          <button className="ps-btn ps-btn-primary" onClick={handleStart} disabled={loading}>
            🩺 Start Consultation
          </button>
        )}
        {referral.status === 'in_progress' && (
          <button className="ps-btn ps-btn-primary" onClick={() => setCompleteModalOpen(true)} disabled={loading}>
            ✓ Complete
          </button>
        )}
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-lg)', alignItems: 'start' }}>
        {/* LEFT — Patient & Clinical */}
        <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
          {/* Patient Demographics */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>👤 Patient</h3>
            <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
              <Row label="Name" value={referral.patient_name} />
              <Row label="NHS Number" value={referral.patient_nhs_number} />
              <Row label="Date of Birth" value={fmtDob(referral.patient_dob)} />
              <Row label="Phone" value={referral.patient_phone} />
              {address && (
                <Row
                  label="Address"
                  value={[
                    ...(address.line ?? []),
                    address.city,
                    address.postalCode,
                  ].filter(Boolean).join(', ')}
                />
              )}
              <Row label="GP Practice" value={
                referral.patient_gp_name
                  ? `${referral.patient_gp_name}${referral.patient_gp_ods_code ? ` (${referral.patient_gp_ods_code})` : ''}`
                  : referral.patient_gp_ods_code
              } />
            </div>
          </div>

          {/* Clinical: Presenting Complaint */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>🩺 Clinical</h3>
            <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
              <Row label="Presenting Complaint" value={referral.presenting_complaint} />
              <Row label="Disposition" value={
                referral.disposition_text
                  ? `${referral.disposition_text}${referral.disposition_code ? ` (${referral.disposition_code})` : ''}`
                  : referral.disposition_code
              } />
              <Row label="Event Type" value={referral.event_type === 'referral' ? 'Referral' : 'Discharge Details'} />
            </div>
          </div>

          {/* Care Plan */}
          {referral.care_plan && (
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>📋 Care Advice</h3>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--ps-ink)' }}>
                {referral.care_plan}
              </div>
            </div>
          )}

          {/* Encounter Summary */}
          {referral.encounter_summary && (
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>📝 Encounter Summary</h3>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--ps-ink)' }}>
                {referral.encounter_summary}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Triage Q&A, Metadata, Notes */}
        <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
          {/* Triage Q&A */}
          {referral.triage_questions && referral.triage_questions.length > 0 && (
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>❓ Triage Questions</h3>
              <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
                {referral.triage_questions.map((qa, i) => (
                  <div key={i} style={{
                    padding: 'var(--ps-space-sm)',
                    background: 'var(--ps-off-white)',
                    borderRadius: 'var(--ps-radius-sm)',
                  }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 2 }}>
                      {qa.question}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--ps-ink)' }}>
                      {qa.answer}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Referral Metadata */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>📎 Referral Details</h3>
            <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
              <Row label="Case ID" value={referral.case_id} />
              <Row label="Case Ref" value={referral.case_ref} />
              <Row label="Source" value={
                referral.source_org_name
                  ? `${referral.source_org_name}${referral.source_ods_code ? ` (${referral.source_ods_code})` : ''}`
                  : referral.source_ods_code
              } />
              <Row label="Received" value={fmtDate(referral.received_at)} />
              <Row label="Actioned" value={fmtDate(referral.actioned_at)} />
              <Row label="Completed" value={fmtDate(referral.completed_at)} />
              {referral.rejection_reason && (
                <Row label="Rejection Reason" value={referral.rejection_reason} />
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>💬 Notes</h3>
            {referral.notes && (
              <div style={{
                whiteSpace: 'pre-wrap',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                marginBottom: 'var(--ps-space-md)',
                padding: 'var(--ps-space-sm)',
                background: 'var(--ps-off-white)',
                borderRadius: 'var(--ps-radius-sm)',
              }}>
                {referral.notes}
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
              <input
                type="text"
                placeholder="Add a note…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 'var(--ps-radius-md)',
                  border: '1px solid var(--ps-border)',
                  fontSize: '0.85rem',
                }}
              />
              <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={handleAddNote} disabled={!noteText.trim()}>
                Add
              </button>
            </div>
          </div>

          {/* Raw FHIR bundle toggle */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>🔧 Raw FHIR Bundle</h3>
              <button
                className="ps-btn ps-btn-ghost ps-btn-sm"
                onClick={() => setShowRawBundle(!showRawBundle)}
              >
                {showRawBundle ? 'Hide' : 'Show'}
              </button>
            </div>
            {showRawBundle && referral.raw_fhir_bundle && (
              <pre style={{
                marginTop: 'var(--ps-space-md)',
                padding: 'var(--ps-space-md)',
                background: 'var(--ps-off-white)',
                borderRadius: 'var(--ps-radius-sm)',
                fontSize: '0.7rem',
                maxHeight: 400,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {JSON.stringify(referral.raw_fhir_bundle, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Reject Modal */}
      {rejectModalOpen && (
        <ModalOverlay onClose={() => setRejectModalOpen(false)}>
          <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>Reject Referral</h3>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
            Please provide a reason for rejecting this referral.
          </p>
          <textarea
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection…"
            style={{
              width: '100%',
              padding: 'var(--ps-space-sm)',
              borderRadius: 'var(--ps-radius-md)',
              border: '1px solid var(--ps-border)',
              fontSize: '0.9rem',
              marginBottom: 'var(--ps-space-md)',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-ghost" onClick={() => setRejectModalOpen(false)}>Cancel</button>
            <button
              className="ps-btn ps-btn-primary"
              style={{ background: 'var(--ps-red)', borderColor: 'var(--ps-red)' }}
              onClick={handleReject}
              disabled={!rejectReason.trim() || loading}
            >
              Reject
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* Complete Modal */}
      {completeModalOpen && (
        <ModalOverlay onClose={() => setCompleteModalOpen(false)}>
          <h3 style={{ marginBottom: 'var(--ps-space-md)' }}>Complete Referral</h3>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
            Optionally add any completion notes.
          </p>
          <textarea
            rows={3}
            value={completeNotes}
            onChange={(e) => setCompleteNotes(e.target.value)}
            placeholder="Completion notes (optional)…"
            style={{
              width: '100%',
              padding: 'var(--ps-space-sm)',
              borderRadius: 'var(--ps-radius-md)',
              border: '1px solid var(--ps-border)',
              fontSize: '0.9rem',
              marginBottom: 'var(--ps-space-md)',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-ghost" onClick={() => setCompleteModalOpen(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleComplete} disabled={loading}>
              ✓ Complete
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

// ============================================================
// Shared sub-components
// ============================================================

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--ps-space-md)' }}>
      <span style={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 140, color: 'var(--ps-slate)' }}>
        {label}
      </span>
      <span style={{ fontSize: '0.85rem', color: 'var(--ps-ink)' }}>
        {value || '—'}
      </span>
    </div>
  )
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="ps-card"
        style={{
          padding: 'var(--ps-space-xl)',
          minWidth: 400,
          maxWidth: 500,
        }}
      >
        {children}
      </div>
    </div>
  )
}
