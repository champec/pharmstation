import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { OrganisationAddress } from '@pharmstation/types'

// PharmStation platform admins check each self-registered pharmacy against the
// GPhC premises register before it can use network messaging or list itself
// publicly. Access is enforced in the database (ps_admin_* check
// ps_platform_admins), not by this page.

type Row = {
  id: string
  name: string
  gphc_premises_number: string | null
  address: OrganisationAddress | null
  login_email: string | null
  owner_name: string | null
  owner_email: string | null
  owner_gphc_number: string | null
  member_count: number
  verification_status: 'pending' | 'verified' | 'rejected'
  verification_note: string | null
  created_at: string
  verified_at: string | null
}

const STATUSES = ['pending', 'verified', 'rejected'] as const

function formatAddress(a: OrganisationAddress | null) {
  if (!a) return 'No address'
  return [a.line_1, a.line_2, a.city, a.postcode].filter(Boolean).join(', ') || 'No address'
}

export function PharmacyApprovalsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>('pending')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Pharmacies where Genie may see patient data (off by default; admins only).
  const [geniePatientData, setGeniePatientData] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await getUserClient().rpc('ps_admin_list_organisations', { p_status: filter })
    if (error) {
      setError(error.message === 'Forbidden' ? 'Only PharmStation admins can see this page.' : error.message)
      setRows([])
    } else {
      setRows((data ?? []) as Row[])
      const { data: genie } = await getUserClient().rpc('ps_admin_list_genie_patient_data')
      setGeniePatientData(new Set(
        ((genie ?? []) as { organisation_id: string; genie_patient_data: boolean }[])
          .filter((g) => g.genie_patient_data)
          .map((g) => g.organisation_id),
      ))
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  const setStatus = async (row: Row, status: Row['verification_status']) => {
    let note: string | null = null
    if (status === 'verified' && !window.confirm(
      `Verify ${row.name}?\n\nOnly do this after finding premises ${row.gphc_premises_number ?? '(none given)'} on the GPhC register with a matching name and address, and checking the owner is connected to it.`,
    )) return
    if (status === 'rejected') {
      note = window.prompt('Reason (shown to the pharmacy):', 'We couldn’t match these details to the GPhC register.')
      if (note === null) return
    }
    setBusyId(row.id)
    const { error } = await getUserClient().rpc('ps_admin_set_organisation_verification', {
      p_org_id: row.id, p_status: status, p_note: note,
    })
    setBusyId(null)
    if (error) setError(error.message)
    else load()
  }

  const toggleGeniePatientData = async (row: Row) => {
    const enable = !geniePatientData.has(row.id)
    if (enable && !window.confirm(
      `Let Genie see patient data for ${row.name}?\n\nPatient and prescriber names from their registers will be sent to the AI provider (zero data retention). Only do this once the DPIA and privacy notice cover it.`,
    )) return
    setBusyId(row.id)
    const { error } = await getUserClient().rpc('ps_admin_set_genie_patient_data', { p_org_id: row.id, p_enabled: enable })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    setGeniePatientData((prev) => {
      const next = new Set(prev)
      if (enable) next.add(row.id)
      else next.delete(row.id)
      return next
    })
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/me" onClick={(e) => { e.preventDefault(); navigate('/me') }}>My Account</a>
          <span className="separator">/</span>
          <span>Verify pharmacies</span>
        </div>
        <h1>🏥 Verify pharmacies</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Find each premises number on the{' '}
          <a href="https://www.pharmacyregulation.org/registers" target="_blank" rel="noopener noreferrer">GPhC register</a>{' '}
          and check the name and address match before verifying.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`ps-btn ps-btn-sm ${filter === s ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
            onClick={() => setFilter(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}
      {loading && <p>Loading…</p>}
      {!loading && !error && rows.length === 0 && <p className="text-muted">No {filter} pharmacies.</p>}

      {rows.map((row) => (
        <div key={row.id} className="ps-card" style={{ marginBottom: 'var(--ps-space-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <strong>{row.name}</strong>{' '}
              <span className="ps-badge">GPhC {row.gphc_premises_number ?? 'not given'}</span>
              <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 4, overflowWrap: 'anywhere' }}>
                {formatAddress(row.address)}
              </div>
              <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', overflowWrap: 'anywhere' }}>
                Pharmacy login {row.login_email ?? 'none'} · Owner {row.owner_name ?? 'not linked yet'}
                {row.owner_email && <> ({row.owner_email})</>}
                {row.owner_gphc_number && <> · owner GPhC {row.owner_gphc_number}</>}
                {' '}· {row.member_count} active member{row.member_count === 1 ? '' : 's'}
              </div>
              <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                Signed up {new Date(row.created_at).toLocaleDateString('en-GB')}
                {row.verified_at && <> · verified {new Date(row.verified_at).toLocaleDateString('en-GB')}</>}
                {row.verification_note && <> · note: {row.verification_note}</>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--ps-space-xs, 4px)', alignItems: 'center', flexWrap: 'wrap' }}>
              {row.verification_status !== 'verified' && (
                <button className="ps-btn ps-btn-primary ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'verified')}>
                  Verify
                </button>
              )}
              {row.verification_status !== 'rejected' && (
                <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'rejected')}>
                  Reject
                </button>
              )}
              {row.verification_status !== 'pending' && (
                <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'pending')}>
                  Back to pending
                </button>
              )}
              {row.verification_status === 'verified' && (
                <button
                  className="ps-btn ps-btn-ghost ps-btn-sm"
                  disabled={busyId === row.id}
                  onClick={() => toggleGeniePatientData(row)}
                  title="Whether Genie may see patient names for this pharmacy"
                >
                  Genie patient data: {geniePatientData.has(row.id) ? 'On' : 'Off'}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
