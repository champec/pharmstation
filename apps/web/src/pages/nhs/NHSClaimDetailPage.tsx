import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { NHSClaimSubmission, NHSSubmissionAttempt } from '@pharmstation/types'

const SERVICE_TYPE_LABELS: Record<string, string> = {
  cpcs_emg_med:     'CPCS Emergency Medicine Supply',
  cpcs_min_ill:     'CPCS Minor Illness',
  cpcs_emg_uec:     'CPCS Emergency Medicine Supply (UEC)',
  cpcs_min_ill_uec: 'CPCS Minor Illness (UEC)',
  cpcs_ccs:         'Pharmacy First',
  flu_vac:          'NHS Flu Vaccination',
  covid_vac:        'COVID Vaccination',
  gp_covid_vac:     'COVID Vaccination (GP Referral)',
  nms:              'New Medicines Service',
  scs:              'Smoking Cessation Service',
  cvd_hypertension: 'Hypertension Case-Finding Service',
  contraception:    'NHS Contraception Service',
}

const STATUS_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  draft:     { label: 'Draft',              bg: '#f1f5f9', color: '#475569' },
  pending:   { label: 'Pending Submission', bg: '#fff8e1', color: '#b45309' },
  submitted: { label: 'Submitted',          bg: '#eff6ff', color: '#1d4ed8' },
  accepted:  { label: 'Accepted',           bg: '#f0fdf4', color: '#16a34a' },
  rejected:  { label: 'Rejected',           bg: '#fef2f2', color: '#dc2626' },
  updated:   { label: 'Updated',            bg: '#eff6ff', color: '#1d4ed8' },
  deleted:   { label: 'Deleted',            bg: '#f8fafc', color: '#94a3b8' },
}

export function NHSClaimDetailPage() {
  const { claimId } = useParams<{ claimId: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()

  const [claim, setClaim] = useState<NHSClaimSubmission | null>(null)
  const [attempts, setAttempts] = useState<NHSSubmissionAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [patientName, setPatientName] = useState<string | null>(null)
  const [showPayload, setShowPayload] = useState(false)

  const load = useCallback(async () => {
    if (!claimId) return
    setLoading(true)
    const client = getUserClient()
    const [claimRes, attemptsRes] = await Promise.all([
      client.from('nhs_claim_submissions').select('*').eq('id', claimId).single(),
      client.from('nhs_submission_attempts').select('*').eq('submission_id', claimId).order('attempt_number'),
    ])
    if (claimRes.data) {
      const c = claimRes.data as NHSClaimSubmission
      setClaim(c)
      if (c.patient_id) {
        const { data: pt } = await client
          .from('ps_patients')
          .select('first_name, last_name, nhs_number')
          .eq('id', c.patient_id)
          .single()
        if (pt) setPatientName(`${(pt as any).first_name} ${(pt as any).last_name}`.trim())
      }
    }
    if (attemptsRes.data) setAttempts(attemptsRes.data as NHSSubmissionAttempt[])
    setLoading(false)
  }, [claimId])

  useEffect(() => { load() }, [load])

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1>NHS Claim</h1></div>
        <div style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading…</div>
      </div>
    )
  }

  if (!claim) {
    return (
      <div>
        <div className="page-header"><h1>NHS Claim</h1></div>
        <div style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>Claim not found.</div>
      </div>
    )
  }

  const statusStyle = STATUS_STYLES[claim.status] ?? { label: claim.status, bg: '#f1f5f9', color: '#475569' }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/nhs" onClick={(e) => { e.preventDefault(); navigate('/nhs') }}>NHS Services</a>
          <span className="separator">/</span>
          <a href="/nhs/claims" onClick={(e) => { e.preventDefault(); navigate('/nhs/claims') }}>Claims</a>
          <span className="separator">/</span>
          <span>Claim Detail</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>
            📋 {SERVICE_TYPE_LABELS[claim.service_type] ?? claim.service_type}
            <span style={{
              marginLeft: 'var(--ps-space-sm)',
              display: 'inline-block', padding: '2px 10px', borderRadius: 99,
              fontSize: '0.7rem', fontWeight: 600,
              background: statusStyle.bg, color: statusStyle.color,
              verticalAlign: 'middle',
            }}>
              {statusStyle.label}
            </span>
          </h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/nhs/claims')}>← Back</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        {/* Claim summary */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>Claim Summary</h3>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-xs) var(--ps-space-md)', margin: 0 }}>
            {[
              ['Deposit ID', claim.platform_deposit_id],
              ['Claim Month', claim.claim_year_month],
              ['Patient', patientName ?? 'Not linked'],
              ['NHS Number', (claim.payload?.PATIENT_NHSNO as string) ?? '—'],
              ['Recorded', fmtDate(claim.created_at)],
              ['Submitted', fmtDate(claim.submitted_at)],
            ].map(([label, value]) => (
              <>
                <dt key={`dt-${label}`} style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--ps-slate)' }}>{label}</dt>
                <dd key={`dd-${label}`} style={{ margin: 0, fontSize: '0.9rem' }}>{value}</dd>
              </>
            ))}
          </dl>
        </div>

        {/* BSA response */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>BSA Response</h3>
          {claim.bsa_response ? (
            <pre style={{
              background: 'var(--ps-mist)', padding: 'var(--ps-space-sm)',
              borderRadius: 'var(--ps-radius-sm)', fontSize: '0.75rem',
              overflow: 'auto', maxHeight: 200, margin: 0,
            }}>
              {JSON.stringify(claim.bsa_response, null, 2)}
            </pre>
          ) : (
            <p style={{ color: 'var(--ps-slate)', margin: 0, fontSize: '0.9rem' }}>
              {claim.status === 'pending' ? 'Awaiting submission to NHSBSA.' : 'No response recorded.'}
            </p>
          )}
        </div>
      </div>

      {/* Payload */}
      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)' }}>
        <div
          style={{ padding: 'var(--ps-space-md) var(--ps-space-lg)', borderBottom: showPayload ? '1px solid var(--ps-mist)' : 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          onClick={() => setShowPayload((v) => !v)}
        >
          <h3 style={{ margin: 0 }}>Clinical Claim Payload</h3>
          <span style={{ color: 'var(--ps-slate)', fontSize: '0.85rem' }}>{showPayload ? '▲ Hide' : '▼ Show'}</span>
        </div>
        {showPayload && (
          <div style={{ padding: 'var(--ps-space-md)' }}>
            <pre style={{
              background: 'var(--ps-mist)', padding: 'var(--ps-space-md)',
              borderRadius: 'var(--ps-radius-sm)', fontSize: '0.8rem',
              overflow: 'auto', maxHeight: 400, margin: 0,
            }}>
              {JSON.stringify(claim.payload, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Submission Attempts */}
      {attempts.length > 0 && (
        <div className="ps-card">
          <div style={{ padding: 'var(--ps-space-md) var(--ps-space-lg)', borderBottom: '1px solid var(--ps-mist)' }}>
            <h3 style={{ margin: 0 }}>Submission Log</h3>
          </div>
          <table className="ps-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>#</th>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Result</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td>{a.attempt_number}</td>
                  <td><code style={{ fontSize: '0.8rem' }}>{a.http_method}</code></td>
                  <td style={{ fontSize: '0.75rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.endpoint_url}</td>
                  <td>{a.response_status ?? '—'}</td>
                  <td>
                    <span style={{ color: a.succeeded ? 'var(--ps-success)' : 'var(--ps-error)', fontWeight: 600, fontSize: '0.85rem' }}>
                      {a.succeeded ? '✓ Success' : '✗ Failed'}
                    </span>
                    {a.error_message && <span style={{ fontSize: '0.8rem', color: 'var(--ps-error)', marginLeft: 4 }}> — {a.error_message}</span>}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>{fmtDate(a.attempted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
