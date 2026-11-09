import { useEffect, useState } from 'react'
import { useSOPStore, sopReviewStatus } from '@pharmstation/core'
import type { SOPDocument, SOPReview } from '@pharmstation/types'
import { Modal } from '../Modal'

export const REVIEW_INTERVALS = [6, 12, 18, 24, 36]

export function formatReviewDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export const REVIEW_OUTCOME_LABEL: Record<SOPReview['outcome'], string> = {
  first_published: 'First published',
  new_version: 'New version published',
  no_changes: 'Reviewed, no changes',
}

/** Small coloured badge for a published SOP's review status. Renders nothing when fine. */
export function SOPReviewBadge({ doc, showOk = false }: { doc: Pick<SOPDocument, 'status' | 'next_review_due'>; showOk?: boolean }) {
  const status = sopReviewStatus(doc)
  if (!status || (status === 'ok' && !showOk)) return null
  const style =
    status === 'overdue'
      ? { background: 'var(--ps-error)20', color: 'var(--ps-error)' }
      : status === 'due_soon'
        ? { background: 'var(--ps-warning)20', color: 'var(--ps-warning)' }
        : { background: 'var(--ps-success)20', color: 'var(--ps-success)' }
  const label =
    status === 'overdue'
      ? 'Review overdue'
      : status === 'due_soon'
        ? `Review due ${formatReviewDate(doc.next_review_due)}`
        : `Next review ${formatReviewDate(doc.next_review_due)}`
  return (
    <span
      title={`Next review due ${formatReviewDate(doc.next_review_due)}`}
      style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, whiteSpace: 'nowrap', ...style }}
    >
      {label}
    </span>
  )
}

export function SOPReviewHistoryTable({ reviews }: { reviews: SOPReview[] }) {
  if (reviews.length === 0) {
    return <p style={{ color: 'var(--ps-text-muted)', fontSize: 13, margin: 0 }}>No reviews recorded yet. Publishing the SOP records its first review.</p>
  }
  const th = { padding: '8px 12px' }
  const td = { padding: '8px 12px' }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--ps-border)', textAlign: 'left' }}>
            <th style={th}>Date</th>
            <th style={th}>Version</th>
            <th style={th}>Outcome</th>
            <th style={th}>Reviewed by</th>
            <th style={th}>Next review</th>
            <th style={th}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--ps-border)' }}>
              <td style={td}>{formatReviewDate(r.reviewed_at)}</td>
              <td style={td}>v{r.version}</td>
              <td style={td}>{REVIEW_OUTCOME_LABEL[r.outcome] ?? r.outcome}</td>
              <td style={td}>{r.reviewer_name ?? '—'}</td>
              <td style={td}>{formatReviewDate(r.next_review_due)}</td>
              <td style={{ ...td, whiteSpace: 'pre-wrap' }}>{r.notes ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Review schedule strip for the SOP editor (managers only). */
export function SOPReviewBar({ doc }: { doc: SOPDocument }) {
  const { saving, markReviewed, setReviewInterval, fetchReviews } = useSOPStore()
  const [showReview, setShowReview] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [notes, setNotes] = useState('')
  const [reviews, setReviews] = useState<SOPReview[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const interval = doc.review_interval_months ?? 12
  const intervals = REVIEW_INTERVALS.includes(interval) ? REVIEW_INTERVALS : [...REVIEW_INTERVALS, interval].sort((a, b) => a - b)
  const published = doc.status === 'published'
  const canMarkReviewed = published && !doc.has_unpublished_changes

  useEffect(() => {
    if (!showHistory) return
    setReviews(null)
    setHistoryError(null)
    fetchReviews(doc.id).then(setReviews).catch((e) => setHistoryError(e.message))
  }, [showHistory, doc.id, fetchReviews])

  const confirmReviewed = async () => {
    const ok = await markReviewed(doc.id, notes)
    if (ok) {
      setShowReview(false)
      setNotes('')
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        margin: '0 0 12px',
        border: '1px solid var(--ps-border)',
        borderRadius: 8,
        fontSize: 13,
        background: 'var(--ps-surface)',
      }}
    >
      <span style={{ fontWeight: 600 }}>Review</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ps-text-muted)' }}>
        every
        <select
          className="ps-input"
          value={interval}
          disabled={saving}
          onChange={(e) => setReviewInterval(doc.id, Number(e.target.value))}
          style={{ padding: '2px 6px', width: 'auto' }}
          aria-label="Review interval"
        >
          {intervals.map((m) => (
            <option key={m} value={m}>{m} months</option>
          ))}
        </select>
      </label>
      <span style={{ color: 'var(--ps-text-muted)' }}>
        {doc.next_review_due
          ? <>Next review due <strong style={{ color: 'var(--ps-text)' }}>{formatReviewDate(doc.next_review_due)}</strong></>
          : 'Review date is set when you publish'}
      </span>
      <SOPReviewBadge doc={doc} />
      {doc.last_reviewed_at && (
        <span style={{ color: 'var(--ps-text-muted)' }}>Last reviewed {formatReviewDate(doc.last_reviewed_at)}</span>
      )}
      <span style={{ flex: 1 }} />
      {published && (
        <button
          className="ps-btn ps-btn-secondary"
          disabled={!canMarkReviewed || saving}
          title={canMarkReviewed ? 'Record that you reviewed this SOP and it needs no changes' : 'Publish your changes as a new version instead'}
          onClick={() => setShowReview(true)}
        >
          ✓ Mark reviewed
        </button>
      )}
      <button className="ps-btn ps-btn-secondary" onClick={() => setShowHistory(true)}>Review history</button>

      <Modal isOpen={showReview} onClose={() => setShowReview(false)} title="Mark as reviewed" width="480px">
        <p style={{ marginTop: 0 }}>
          Record that you have reviewed <strong>{doc.title}</strong> (v{doc.version}) and it is still correct. Staff do not need to sign again.
          The next review will be due {interval} months from today.
        </p>
        <p style={{ color: 'var(--ps-text-muted)', fontSize: 13 }}>If something needs changing, edit the sections and publish a new version instead.</p>
        <textarea
          className="ps-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional), e.g. checked against current guidance"
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="ps-btn ps-btn-secondary" onClick={() => setShowReview(false)}>Cancel</button>
          <button className="ps-btn ps-btn-primary" onClick={confirmReviewed} disabled={saving}>
            {saving ? 'Saving…' : 'Mark reviewed'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={showHistory} onClose={() => setShowHistory(false)} title="Review history" width="760px">
        {historyError ? (
          <div className="ps-alert ps-alert-error">{historyError}</div>
        ) : reviews === null ? (
          <p style={{ color: 'var(--ps-text-muted)' }}>Loading…</p>
        ) : (
          <SOPReviewHistoryTable reviews={reviews} />
        )}
      </Modal>
    </div>
  )
}
