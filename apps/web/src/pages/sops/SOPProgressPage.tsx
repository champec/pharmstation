import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useSOPStore, canManageSOPs } from '@pharmstation/core'
import type { SOPCompletion, SOPReview } from '@pharmstation/types'
import { SOPReviewBadge, SOPReviewHistoryTable, formatReviewDate } from '../../components/sop/SOPReviewBar'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { Download, Users } from 'lucide-react'

const ukDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })

function csvCell(value: string | number | null | undefined): string {
  let v = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}` // stop spreadsheet formulas
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function SOPProgressPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const { organisation, membership } = useAuthStore()

  // Only SOP managers can assign and see everyone's progress; staff go to the read view.
  const isManager = canManageSOPs(membership)
  useEffect(() => {
    if (membership && !isManager && docId) navigate(`/sops/${docId}/read`, { replace: true })
  }, [membership, isManager, docId, navigate])

  const {
    activeDocument,
    memberProgress,
    loading,
    error,
    fetchDocument,
    fetchMemberProgress,
    fetchSignOffHistory,
    fetchReviews,
    clearError,
  } = useSOPStore()

  const [history, setHistory] = useState<SOPCompletion[]>([])
  const [reviews, setReviews] = useState<SOPReview[]>([])

  useEffect(() => {
    if (docId) fetchReviews(docId).then(setReviews).catch(() => setReviews([]))
  }, [docId, fetchReviews])

  useEffect(() => {
    if (docId) fetchSignOffHistory(docId).then(setHistory).catch(() => setHistory([]))
  }, [docId, fetchSignOffHistory])

  useEffect(() => {
    if (docId) fetchDocument(docId)
  }, [docId])

  useEffect(() => {
    if (docId && organisation?.id) fetchMemberProgress(docId, organisation.id)
  }, [docId, organisation?.id])

  const doc = activeDocument
  const currentVersion = doc?.version ?? 1

  const completed = memberProgress.filter((p) => p.is_current_version)
  const needsReread = memberProgress.filter((p) => p.completion && !p.is_current_version)
  const notStarted = memberProgress.filter((p) => !p.completion)
  const total = memberProgress.length

  const pct = total > 0 ? Math.round((completed.length / total) * 100) : 0

  // Names for sign-offs: the stored signer name, or the member's current profile.
  const memberNames = new Map(memberProgress.map((p) => [p.member.id, p.member.user_profile?.full_name ?? null]))
  const memberRoles = new Map(memberProgress.map((p) => [p.member.id, p.member.role as string]))
  const signerName = (c: SOPCompletion) =>
    c.signer_name || (c.member_id ? memberNames.get(c.member_id) : null) || (c.member_id ? 'Unknown' : 'Former staff member')

  const exportCsv = () => {
    if (!doc) return
    const rows = [
      ['SOP', 'Version signed', 'Current version', 'Signed by', 'Role', 'Signed at (UK time)'],
      ...history.map((c) => [
        doc.title,
        c.document_version,
        currentVersion,
        signerName(c),
        (c.member_id && memberRoles.get(c.member_id)) || '',
        ukDateTime(c.completed_at),
      ]),
    ]
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-sign-offs.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getStatusBadge = (p: (typeof memberProgress)[0]) => {
    if (p.is_current_version) return { label: '✓ Completed', color: 'var(--ps-success)', bg: 'var(--ps-success)20' }
    if (p.completion) return { label: 'Re-read required', color: 'var(--ps-warning)', bg: 'var(--ps-warning)20' }
    return { label: '○ Not started', color: 'var(--ps-text-muted)', bg: 'transparent' }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', to: '/' },
          { label: 'SOPs', to: '/sops' },
          { label: doc?.title ?? 'Editor', to: `/sops/${docId}/edit` },
          { label: 'Progress' },
        ]}
        title="Staff progress"
        subtitle={doc ? (
          <>
            {doc.title} · v{currentVersion} ·{' '}
            <span style={{ color: doc.status === 'published' ? 'var(--ps-success)' : 'var(--ps-warning)', fontWeight: 600 }}>
              {doc.status === 'published' ? 'Published' : doc.status === 'archived' ? 'Archived' : 'Draft'}
            </span>
            {doc.next_review_due && doc.status === 'published' && (
              <> · Next review {formatReviewDate(doc.next_review_due)} <SOPReviewBadge doc={doc} /></>
            )}
          </>
        ) : undefined}
        actions={
          <span className="no-print" style={{ display: 'contents' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/edit`)}>
              ← Back to editor
            </button>
            <button className="ps-btn ps-btn-secondary" onClick={() => window.print()}>
              Print
            </button>
            <button className="ps-btn ps-btn-secondary" onClick={exportCsv} disabled={!doc || history.length === 0} title={history.length === 0 ? 'No one has signed yet' : undefined}>
              <Download size={16} strokeWidth={1.75} aria-hidden="true" /> Export sign-offs (CSV)
            </button>
          </span>
        }
      />

      {error && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={clearError} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--ps-text-muted)' }}>Loading…</div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Total assigned', value: total, color: 'var(--ps-text)' },
              { label: 'Completed current version', value: completed.length, color: 'var(--ps-success)' },
              { label: 'Re-read required', value: needsReread.length, color: 'var(--ps-warning)' },
              { label: 'Not started', value: notStarted.length, color: 'var(--ps-text-muted)' },
            ].map((s) => (
              <div
                key={s.label}
                className="ps-card"
                style={{ flex: '1 1 140px', textAlign: 'center', padding: 20 }}
              >
                <div style={{ fontSize: 32, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--ps-text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="ps-card" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Completion — Current Version (v{currentVersion})</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: pct >= 100 ? 'var(--ps-success)' : 'var(--ps-accent)' }}>
                  {pct}%
                </span>
              </div>
              <div
                style={{
                  height: 10,
                  borderRadius: 5,
                  background: 'var(--ps-surface-hover)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    borderRadius: 5,
                    background: pct >= 100 ? 'var(--ps-success)' : 'var(--ps-accent)',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ps-text-muted)' }}>
                {completed.length} of {total} staff have completed the current version
              </div>
            </div>
          )}

          {/* Member table */}
          {memberProgress.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Not assigned to anyone yet"
              actions={
                <button className="ps-btn ps-btn-primary" onClick={() => navigate(`/sops/${docId}/assign`)}>
                  Assign staff
                </button>
              }
            >
              Assign this SOP to staff to track who has read and signed it.
            </EmptyState>
          ) : (
            <div className="ps-card" style={{ overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--ps-border)' }}>
                    {['Staff Member', 'Role', 'Status', 'Version read', 'Completed at'].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '10px 16px',
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                          color: 'var(--ps-text-muted)',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {memberProgress.map((p) => {
                    const badge = getStatusBadge(p)
                    return (
                      <tr
                        key={p.member.id}
                        style={{ borderBottom: '1px solid var(--ps-border)' }}
                      >
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                background: 'var(--ps-accent)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 13,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {(p.member.user_profile?.full_name ?? '?')[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>
                                {p.member.user_profile?.full_name ?? '—'}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--ps-text-muted)' }}>
                                {p.member.user_profile?.email ?? ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, textTransform: 'capitalize' }}>
                          {p.member.role}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              padding: '3px 10px',
                              borderRadius: 10,
                              background: badge.bg,
                              color: badge.color,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--ps-text-muted)' }}>
                          {p.completion ? `v${p.completion.document_version}` : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--ps-text-muted)' }}>
                          {p.completion ? ukDateTime(p.completion.completed_at) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Full sign-off record, every version, including staff who have left */}
          <div className="ps-card" style={{ marginTop: 24, overflow: 'hidden' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Sign-off record (all versions)</h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ps-text-muted)' }}>
              Sign-offs can't be edited or deleted. Each one is for the exact text published as that version.
            </p>
            {history.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ps-text-muted)' }}>No one has signed this SOP yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--ps-border)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px' }}>Signed by</th>
                      <th style={{ padding: '8px 12px' }}>Version</th>
                      <th style={{ padding: '8px 12px' }}>Signed at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((c) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--ps-border)' }}>
                        <td style={{ padding: '8px 12px' }}>{signerName(c)}</td>
                        <td style={{ padding: '8px 12px' }}>
                          v{c.document_version}
                          {c.document_version === currentVersion ? ' (current)' : ''}
                        </td>
                        <td style={{ padding: '8px 12px' }}>{ukDateTime(c.completed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Review history: scheduled reviews and new versions */}
          <div className="ps-card" style={{ marginTop: 24, overflow: 'hidden' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Review history</h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ps-text-muted)' }}>
              Every time this SOP was reviewed: published as a new version, or checked and confirmed with no changes.
            </p>
            <SOPReviewHistoryTable reviews={reviews} />
          </div>
        </>
      )}
    </div>
  )
}
