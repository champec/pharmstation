import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useNHS111Store } from '@pharmstation/core'
import type { NHS111ReferralStatus, NHS111Urgency } from '@pharmstation/types'

// ============================================================
// Status & urgency badge helpers
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

const STATUS_FILTERS: Array<{ value: NHS111ReferralStatus | 'all'; label: string }> = [
  { value: 'all',         label: 'All' },
  { value: 'received',    label: 'New' },
  { value: 'accepted',    label: 'Accepted' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed' },
  { value: 'rejected',    label: 'Rejected' },
]

// ============================================================
// Page Component
// ============================================================

export function ReferralQueuePage() {
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const {
    referrals,
    loading,
    error,
    totalCount,
    unreadCount,
    statusFilter,
    setStatusFilter,
    fetchReferrals,
    subscribeToReferrals,
    unsubscribeFromReferrals,
    clearError,
  } = useNHS111Store()

  const [search, setSearch] = useState('')

  const orgId = organisation?.id

  // Fetch & subscribe on mount
  const load = useCallback(() => {
    if (!orgId) return
    fetchReferrals(orgId)
    subscribeToReferrals(orgId)
  }, [orgId, fetchReferrals, subscribeToReferrals])

  useEffect(() => {
    load()
    return () => unsubscribeFromReferrals()
  }, [load, unsubscribeFromReferrals])

  // Re-fetch when filter changes
  useEffect(() => {
    if (orgId) fetchReferrals(orgId)
  }, [statusFilter, orgId, fetchReferrals])

  // Search filter (client-side on loaded data)
  const filtered = useMemo(() => {
    if (!search.trim()) return referrals
    const q = search.toLowerCase()
    return referrals.filter((r) =>
      (r.patient_name ?? '').toLowerCase().includes(q) ||
      (r.patient_nhs_number ?? '').includes(q) ||
      (r.presenting_complaint ?? '').toLowerCase().includes(q) ||
      (r.case_ref ?? '').toLowerCase().includes(q) ||
      (r.disposition_text ?? '').toLowerCase().includes(q)
    )
  }, [referrals, search])

  // Date formatter
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  // Time-since helper
  const timeSince = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <span>111 Referrals</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--ps-space-sm)' }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            📞 NHS 111 Referrals
            {unreadCount > 0 && (
              <span className="ps-badge ps-badge-red" style={{ fontSize: '0.75rem' }}>
                {unreadCount} new
              </span>
            )}
          </h1>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Filters & Search */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--ps-space-sm)',
        marginBottom: 'var(--ps-space-md)',
        flexWrap: 'wrap',
      }}>
        {/* Status tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`ps-btn ps-btn-sm ${statusFilter === f.value ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
              onClick={() => setStatusFilter(f.value)}
              style={{ fontSize: '0.8rem' }}
            >
              {f.label}
              {f.value === 'received' && unreadCount > 0 && (
                <span className="ps-badge ps-badge-red" style={{ marginLeft: 4, fontSize: '0.65rem', padding: '1px 5px' }}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search patient, NHS number, complaint…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 200,
            padding: '6px 10px',
            borderRadius: 'var(--ps-radius-md)',
            border: '1px solid var(--ps-border)',
            fontSize: '0.85rem',
          }}
        />

        {/* Total count */}
        <span style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
          {totalCount} total
        </span>
      </div>

      {/* Loading */}
      {loading && referrals.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          Loading referrals…
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 'var(--ps-space-sm)' }}>📭</div>
          <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>No referrals found</h3>
          <p style={{ color: 'var(--ps-slate)', margin: 0 }}>
            {statusFilter !== 'all'
              ? `No ${STATUS_LABELS[statusFilter as NHS111ReferralStatus]?.label.toLowerCase()} referrals. Try changing the filter.`
              : "When NHS 111 sends referrals to your pharmacy, they'll appear here."}
          </p>
        </div>
      )}

      {/* Referral list */}
      {filtered.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
          {filtered.map((r) => {
            const status = STATUS_LABELS[r.status] ?? STATUS_LABELS.received
            const urgency = URGENCY_LABELS[r.urgency] ?? URGENCY_LABELS.routine
            const isNew = r.status === 'received'

            return (
              <div
                key={r.id}
                className="ps-card"
                onClick={() => navigate(`/services/111-referrals/${r.id}`)}
                style={{
                  padding: 'var(--ps-space-md)',
                  cursor: 'pointer',
                  borderLeft: isNew ? '4px solid var(--ps-amber)' : '4px solid transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--ps-off-white)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
                  {/* Left: patient + complaint */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                        {r.patient_name ?? 'Unknown Patient'}
                      </span>
                      {r.patient_nhs_number && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                          NHS: {r.patient_nhs_number}
                        </span>
                      )}
                    </div>

                    {/* Presenting complaint */}
                    {r.presenting_complaint && (
                      <div style={{ marginTop: 4, fontSize: '0.9rem', color: 'var(--ps-ink)' }}>
                        {r.presenting_complaint}
                      </div>
                    )}

                    {/* Disposition */}
                    {r.disposition_text && (
                      <div style={{ marginTop: 2, fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                        Dx: {r.disposition_text}
                        {r.disposition_code && ` (${r.disposition_code})`}
                      </div>
                    )}

                    {/* Source & time */}
                    <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--ps-slate)', display: 'flex', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
                      {r.source_org_name && <span>From: {r.source_org_name}</span>}
                      <span>Received: {fmtDate(r.received_at)}</span>
                      <span style={{ fontWeight: 500 }}>{timeSince(r.received_at)}</span>
                    </div>
                  </div>

                  {/* Right: badges */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span className={urgency.cls} style={{ fontSize: '0.75rem' }}>
                      {urgency.icon} {urgency.label}
                    </span>
                    <span className={status.cls} style={{ fontSize: '0.75rem' }}>
                      {status.label}
                    </span>
                    {r.event_type === 'discharge_details' && (
                      <span className="ps-badge" style={{ fontSize: '0.7rem' }}>
                        ℹ️ Discharge
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
