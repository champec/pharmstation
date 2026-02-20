import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useSOPStore } from '@pharmstation/core'

export function SOPProgressPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()

  const {
    activeDocument,
    memberProgress,
    loading,
    error,
    fetchDocument,
    fetchMemberProgress,
    clearError,
  } = useSOPStore()

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

  const getStatusBadge = (p: (typeof memberProgress)[0]) => {
    if (p.is_current_version) return { label: '✓ Completed', color: 'var(--ps-success)', bg: 'var(--ps-success)20' }
    if (p.completion) return { label: '⚠ Re-read required', color: 'var(--ps-warning)', bg: 'var(--ps-warning)20' }
    return { label: '○ Not started', color: 'var(--ps-text-muted)', bg: 'transparent' }
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/sops" onClick={(e) => { e.preventDefault(); navigate('/sops') }}>SOPs</a>
          <span className="separator">/</span>
          <a href={`/sops/${docId}/edit`} onClick={(e) => { e.preventDefault(); navigate(`/sops/${docId}/edit`) }}>
            {doc?.title ?? 'Editor'}
          </a>
          <span className="separator">/</span>
          <span>Progress</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1>📊 Staff Progress</h1>
            {doc && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ps-text-muted)' }}>
                {doc.title} · v{currentVersion} ·{' '}
                <span
                  style={{
                    color: doc.status === 'published' ? 'var(--ps-success)' : 'var(--ps-warning)',
                    fontWeight: 600,
                  }}
                >
                  {doc.status === 'published' ? 'Published' : 'Draft'}
                </span>
              </p>
            )}
          </div>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/edit`)}>
            ← Back to Editor
          </button>
        </div>
      </div>

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
            <div className="ps-empty-state">
              <div style={{ fontSize: 40 }}>👥</div>
              <h3>No active members found</h3>
              <p style={{ color: 'var(--ps-text-muted)' }}>
                Make sure this SOP is assigned to staff via the <strong>Assign</strong> page.
              </p>
              <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/assign`)}>
                Go to Assign
              </button>
            </div>
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
                          {p.completion
                            ? new Date(p.completion.completed_at).toLocaleString()
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
