import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { NHSClaimSubmission } from '@pharmstation/types'

const SERVICE_TYPE_LABELS: Record<string, string> = {
  cpcs_emg_med:     'CPCS Emergency Medicine',
  cpcs_min_ill:     'CPCS Minor Illness',
  cpcs_emg_uec:     'CPCS Emergency (UEC)',
  cpcs_min_ill_uec: 'CPCS Minor Illness (UEC)',
  cpcs_ccs:         'Pharmacy First',
  flu_vac:          'Flu Vaccination',
  covid_vac:        'COVID Vaccination',
  gp_covid_vac:     'COVID (GP Referral)',
  nms:              'New Medicines Service',
  scs:              'Smoking Cessation',
  cvd_hypertension: 'Hypertension Case-Finding',
  contraception:    'Contraception Service',
}

const STATUS_OPTS = ['', 'pending', 'submitted', 'accepted', 'rejected', 'draft']

const STATUS_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  draft:     { label: 'Draft',              bg: '#f1f5f9', color: '#475569' },
  pending:   { label: 'Pending Submission', bg: '#fff8e1', color: '#b45309' },
  submitted: { label: 'Submitted',          bg: '#eff6ff', color: '#1d4ed8' },
  accepted:  { label: 'Accepted',           bg: '#f0fdf4', color: '#16a34a' },
  rejected:  { label: 'Rejected',           bg: '#fef2f2', color: '#dc2626' },
  updated:   { label: 'Updated',            bg: '#eff6ff', color: '#1d4ed8' },
  deleted:   { label: 'Deleted',            bg: '#f8fafc', color: '#94a3b8' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { label: status, bg: '#f1f5f9', color: '#475569' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: '0.75rem', fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  )
}

type ClaimRow = NHSClaimSubmission & { patient_first_name?: string; patient_last_name?: string; nhs_number?: string }

export function NHSClaimsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()

  const [claims, setClaims] = useState<ClaimRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterMonth, setFilterMonth] = useState('')

  const load = useCallback(async () => {
    if (!organisation?.id) return
    setLoading(true)
    const { data } = await getUserClient()
      .from('ps_nhs_claim_submissions')
      .select(`
        *,
        ps_patients (
          first_name,
          last_name,
          nhs_number
        )
      `)
      .eq('org_id', organisation.id)
      .order('created_at', { ascending: false })
    if (data) {
      const rows = (data as any[]).map((d) => ({
        ...d,
        patient_first_name: d.ps_patients?.first_name ?? null,
        patient_last_name:  d.ps_patients?.last_name ?? null,
        nhs_number:         d.ps_patients?.nhs_number ?? (d.payload?.PATIENT_NHSNO as string) ?? null,
      }))
      setClaims(rows)
    }
    setLoading(false)
  }, [organisation?.id])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    let list = claims
    if (filterStatus) list = list.filter((c) => c.status === filterStatus)
    if (filterType)   list = list.filter((c) => c.service_type === filterType)
    if (filterMonth)  list = list.filter((c) => c.claim_year_month === filterMonth)
    return list
  }, [claims, filterStatus, filterType, filterMonth])

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/nhs" onClick={(e) => { e.preventDefault(); navigate('/nhs') }}>NHS Services</a>
          <span className="separator">/</span>
          <span>All Claims</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📋 NHS Claims</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/nhs')}>← Back</button>
        </div>
      </div>

      {/* Filters */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="ps-input" style={{ width: 'auto', minWidth: 180 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUS_OPTS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{STATUS_STYLES[s]?.label ?? s}</option>
          ))}
        </select>

        <select className="ps-input" style={{ width: 'auto', minWidth: 220 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Service Types</option>
          {Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <input
          className="ps-input"
          type="month"
          style={{ width: 'auto' }}
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
        />

        {(filterStatus || filterType || filterMonth) && (
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { setFilterStatus(''); setFilterType(''); setFilterMonth('') }}>
            Clear filters
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
          {filtered.length} claim{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="ps-card">
        {loading ? (
          <div style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
            {claims.length === 0 ? 'No claims yet. Start a claim from the NHS hub.' : 'No claims match the current filters.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ps-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>NHS No.</th>
                  <th>Service</th>
                  <th>Claim Month</th>
                  <th>Status</th>
                  <th>Deposit ID</th>
                  <th>Date Recorded</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((claim) => (
                  <tr key={claim.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/nhs/claims/${claim.id}`)}>
                    <td>
                      {claim.patient_first_name
                        ? `${claim.patient_first_name} ${claim.patient_last_name ?? ''}`.trim()
                        : <span style={{ color: 'var(--ps-slate)', fontSize: '0.85rem' }}>Walk-in / Not linked</span>
                      }
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{claim.nhs_number ?? '—'}</td>
                    <td>{SERVICE_TYPE_LABELS[claim.service_type] ?? claim.service_type}</td>
                    <td>{claim.claim_year_month}</td>
                    <td><StatusBadge status={claim.status} /></td>
                    <td><code style={{ fontSize: '0.75rem' }}>{claim.platform_deposit_id}</code></td>
                    <td>{fmtDate(claim.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
