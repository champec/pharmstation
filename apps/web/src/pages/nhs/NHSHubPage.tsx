import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { NHSClaimSubmission } from '@pharmstation/types'

interface NHSService {
  id: string
  name: string
  nhs_service_type: string
  description: string | null
  library_name: string
}

interface ClaimStats {
  pending: number
  submittedThisMonth: number
  rejected: number
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  cpcs_emg_med:     'CPCS — Emergency Medicine Supply',
  cpcs_min_ill:     'CPCS — Minor Illness',
  cpcs_emg_uec:     'CPCS — Emergency Medicine Supply (UEC)',
  cpcs_min_ill_uec: 'CPCS — Minor Illness (UEC)',
  cpcs_ccs:         'Pharmacy First',
  flu_vac:          'NHS Flu Vaccination',
  covid_vac:        'COVID Vaccination',
  gp_covid_vac:     'COVID Vaccination (GP Referral)',
  nms:              'New Medicines Service',
  scs:              'Smoking Cessation Service',
  cvd_hypertension: 'Hypertension Case-Finding',
  contraception:    'NHS Contraception Service',
}

const SERVICE_TYPE_ICONS: Record<string, string> = {
  cpcs_emg_med:     '🚨',
  cpcs_min_ill:     '🩺',
  cpcs_emg_uec:     '🚨',
  cpcs_min_ill_uec: '🩺',
  cpcs_ccs:         '💊',
  flu_vac:          '💉',
  covid_vac:        '💉',
  gp_covid_vac:     '💉',
  nms:              '📋',
  scs:              '🚭',
  cvd_hypertension: '❤️',
  contraception:    '🏥',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Draft',            color: 'var(--ps-slate)' },
  pending:   { label: 'Pending Submission', color: 'var(--ps-warning)' },
  submitted: { label: 'Submitted',        color: 'var(--ps-info)' },
  accepted:  { label: 'Accepted',         color: 'var(--ps-success)' },
  rejected:  { label: 'Rejected',         color: 'var(--ps-error)' },
  updated:   { label: 'Updated',          color: 'var(--ps-info)' },
  deleted:   { label: 'Deleted',          color: 'var(--ps-slate)' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, color: 'var(--ps-slate)' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: '0.75rem', fontWeight: 600,
      background: `${s.color}22`, color: s.color, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

export function NHSHubPage() {
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()

  const [services, setServices] = useState<NHSService[]>([])
  const [recentClaims, setRecentClaims] = useState<(NHSClaimSubmission & { patient_name?: string })[]>([])
  const [stats, setStats] = useState<ClaimStats>({ pending: 0, submittedThisMonth: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [odsCode, setOdsCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organisation?.id) return
    setLoading(true)
    const client = getUserClient()

    const [servicesRes, claimsRes, orgRes] = await Promise.all([
      // Subscribed NHS services with library info
      client
        .from('ps_services')
        .select('id, name, description, library_service_id, ps_service_library(name, nhs_service_type)')
        .eq('org_id', organisation.id)
        .eq('is_nhs_service', true)
        .eq('is_active', true),

      // Recent claims
      client
        .from('ps_nhs_claim_submissions')
        .select('*')
        .eq('org_id', organisation.id)
        .order('created_at', { ascending: false })
        .limit(10),

      // Org ods_code
      client
        .from('ps_organisations')
        .select('ods_code')
        .eq('id', organisation.id)
        .single(),
    ])

    // Process services
    if (servicesRes.data) {
      const mapped: NHSService[] = (servicesRes.data as any[]).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        nhs_service_type: s.ps_service_library?.nhs_service_type ?? '',
        library_name: s.ps_service_library?.name ?? s.name,
      }))
      setServices(mapped)
    }

    // Process claims
    if (claimsRes.data) {
      const claims = claimsRes.data as NHSClaimSubmission[]
      setRecentClaims(claims)

      const now = new Date()
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      setStats({
        pending:            claims.filter((c) => c.status === 'pending').length,
        submittedThisMonth: claims.filter((c) => c.status === 'submitted' && c.claim_year_month === thisMonth).length,
        rejected:           claims.filter((c) => c.status === 'rejected').length,
      })
    }

    setOdsCode((orgRes.data as any)?.ods_code ?? null)
    setLoading(false)
  }, [organisation?.id])

  useEffect(() => { load() }, [load])

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1>🏥 NHS Services</h1></div>
        <div style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading…</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>NHS Services</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>🏥 NHS Services</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/nhs/claims')}>
              📋 All Claims
            </button>
            <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/settings?tab=nhs')}>
              ⚙ NHS Settings
            </button>
          </div>
        </div>
      </div>

      {/* ODS warning */}
      {!odsCode && (
        <div style={{
          padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)',
          background: '#fff8e1', borderRadius: 'var(--ps-radius-md)',
          border: '1px solid #f59e0b', color: '#92400e',
        }}>
          ⚠️ No ODS code configured. NHS claims cannot be submitted without an ODS code.{' '}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => navigate('/settings?tab=nhs')}>
            Configure →
          </button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
        {[
          { label: 'Pending Submission', value: stats.pending, color: 'var(--ps-warning)', icon: '⏳' },
          { label: 'Submitted This Month', value: stats.submittedThisMonth, color: 'var(--ps-success)', icon: '✅' },
          { label: 'Rejected', value: stats.rejected, color: 'var(--ps-error)', icon: '❌' },
        ].map((stat) => (
          <div key={stat.label} className="ps-card" style={{ padding: 'var(--ps-space-lg)', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 'var(--ps-space-xs)' }}>{stat.icon}</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)', marginTop: 'var(--ps-space-xs)' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Subscribed NHS Services */}
      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-lg)' }}>
        <div style={{ padding: 'var(--ps-space-md) var(--ps-space-lg)', borderBottom: '1px solid var(--ps-mist)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Your NHS Services</h3>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => navigate('/services/library')}>
            + Subscribe to more
          </button>
        </div>

        {services.length === 0 ? (
          <div style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 'var(--ps-space-sm)' }}>🏥</div>
            <p>No NHS services subscribed yet.</p>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/services/library')}>
              Browse NHS Services
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--ps-space-md)', padding: 'var(--ps-space-lg)' }}>
            {services.map((svc) => (
              <div key={svc.id} className="ps-card" style={{ padding: 'var(--ps-space-md)', border: '1px solid var(--ps-mist)', display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
                  <span style={{ fontSize: '1.5rem' }}>{SERVICE_TYPE_ICONS[svc.nhs_service_type] ?? '🏥'}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{SERVICE_TYPE_LABELS[svc.nhs_service_type] ?? svc.name}</div>
                    {svc.description && <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>{svc.description}</div>}
                  </div>
                </div>
                <button
                  className="ps-btn ps-btn-primary ps-btn-sm"
                  style={{ marginTop: 'auto' }}
                  onClick={() => navigate(`/nhs/claim/${svc.nhs_service_type}?serviceId=${svc.id}`)}
                >
                  + New Claim
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Claims */}
      <div className="ps-card">
        <div style={{ padding: 'var(--ps-space-md) var(--ps-space-lg)', borderBottom: '1px solid var(--ps-mist)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Recent Claims</h3>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => navigate('/nhs/claims')}>View all →</button>
        </div>

        {recentClaims.length === 0 ? (
          <div style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
            No claims recorded yet. Start by selecting a service above.
          </div>
        ) : (
          <table className="ps-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Service</th>
                <th>Claim Month</th>
                <th>Status</th>
                <th>Deposit ID</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentClaims.map((claim) => (
                <tr key={claim.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/nhs/claims/${claim.id}`)}>
                  <td>{SERVICE_TYPE_LABELS[claim.service_type] ?? claim.service_type}</td>
                  <td>{claim.claim_year_month}</td>
                  <td><StatusBadge status={claim.status} /></td>
                  <td><code style={{ fontSize: '0.8rem' }}>{claim.platform_deposit_id}</code></td>
                  <td>{fmtDate(claim.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
