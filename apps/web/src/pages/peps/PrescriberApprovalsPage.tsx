import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'

// PharmStation platform admins verify each prescriber's registration with the
// regulator before activating them. Access is enforced in the database
// (ps_admin_* functions check ps_platform_admins), not by this page.

type Row = {
  id: string
  full_name: string
  prescriber_type: string
  registration_number: string
  registration_body: string | null
  email: string | null
  phone: string | null
  status: string
  approved_at: string | null
  created_at: string
}

const STATUSES = ['pending', 'active', 'suspended', 'revoked'] as const

const REGISTERS: { label: string; url: string }[] = [
  { label: 'GMC (doctors)', url: 'https://www.gmc-uk.org/registration-and-licensing/the-medical-register' },
  { label: 'GPhC (pharmacists)', url: 'https://www.pharmacyregulation.org/registers' },
  { label: 'NMC (nurses)', url: 'https://www.nmc.org.uk/registration/search-the-register/' },
  { label: 'GDC (dentists)', url: 'https://olr.gdc-uk.org/searchregister' },
  { label: 'HCPC', url: 'https://www.hcpc-uk.org/check-the-register/' },
  { label: 'RCVS (vets)', url: 'https://findavet.rcvs.org.uk/' },
]

export function PrescriberApprovalsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>('pending')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await getUserClient().rpc('ps_admin_list_prescribers', { p_status: filter })
    if (error) {
      setError(error.message === 'Forbidden' ? 'Only PharmStation admins can see this page.' : error.message)
      setRows([])
    } else {
      setRows((data ?? []) as Row[])
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  const setStatus = async (row: Row, status: string) => {
    if (status === 'active' && !window.confirm(
      `Activate ${row.full_name}?\n\nOnly do this after confirming registration ${row.registration_number} on the ${row.registration_body || 'regulator'} register, with a matching name.`,
    )) return
    setBusyId(row.id)
    const { error } = await getUserClient().rpc('ps_admin_set_prescriber_status', { p_prescriber_id: row.id, p_status: status })
    setBusyId(null)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/me" onClick={(e) => { e.preventDefault(); navigate('/me') }}>My Account</a>
          <span className="separator">/</span>
          <span>Approve prescribers</span>
        </div>
        <h1>Approve prescribers</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Check each registration number and name on the regulator's register before activating.
        </p>
      </div>

      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)' }}>
        <strong>Registers:</strong>{' '}
        {REGISTERS.map((r, i) => (
          <span key={r.url}>
            {i > 0 && ' · '}
            <a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a>
          </span>
        ))}
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
      {!loading && !error && rows.length === 0 && <p className="text-muted">No {filter} prescribers.</p>}

      {rows.map((row) => (
        <div key={row.id} className="ps-card" style={{ marginBottom: 'var(--ps-space-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
            <div>
              <strong>{row.full_name}</strong>{' '}
              <span className="ps-badge">{row.prescriber_type}</span>
              <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 4 }}>
                {row.registration_body || 'Register not stated'} · {row.registration_number}
                {row.email && <> · {row.email}</>}
                {row.phone && <> · {row.phone}</>}
              </div>
              <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                Registered {new Date(row.created_at).toLocaleDateString('en-GB')}
                {row.approved_at && <> · approved {new Date(row.approved_at).toLocaleDateString('en-GB')}</>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--ps-space-xs, 4px)', alignItems: 'center', flexWrap: 'wrap' }}>
              {row.status !== 'active' && (
                <button className="ps-btn ps-btn-primary ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'active')}>
                  Activate
                </button>
              )}
              {row.status === 'active' && (
                <button className="ps-btn ps-btn-secondary ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'suspended')}>
                  Suspend
                </button>
              )}
              {row.status !== 'revoked' && (
                <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'revoked')}>
                  Reject
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
