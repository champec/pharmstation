import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePepsStore } from '@pharmstation/core'

export function PEPSMyPrescriptionsPage() {
  const navigate = useNavigate()
  const { myPrescriptions, loading, error, fetchMyPrescriptions } = usePepsStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => { fetchMyPrescriptions() }, [fetchMyPrescriptions])

  const filtered = useMemo(() => {
    let list = myPrescriptions
    if (statusFilter) list = list.filter((r) => r.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          r.prescription_ref.toLowerCase().includes(q) ||
          (r.patient_snapshot?.full_name ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [myPrescriptions, statusFilter, search])

  const locationOf = (status: string, assignedName?: string | null) => {
    if (status === 'dispensed') return 'Dispensed'
    if (status === 'cancelled') return 'Cancelled'
    if (assignedName) return assignedName
    return 'Spine (unclaimed)'
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/peps" onClick={(e) => { e.preventDefault(); navigate('/peps') }}>PEPS</a>
          <span className="separator">/</span>
          <span>My Prescriptions</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>📄 My Prescriptions</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/peps/write')}>✍️ Write prescription</button>
        </div>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>Prescriptions you have written, and where they are now.</p>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div className="ps-card">
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
          <input className="ps-input" style={{ maxWidth: 280 }} placeholder="Search ref or patient…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="ps-input" style={{ maxWidth: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="available">On spine / directed</option>
            <option value="held">Held by pharmacy</option>
            <option value="dispensed">Dispensed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {loading ? (
          <p style={{ color: 'var(--ps-slate)' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--ps-slate)' }}>You haven't written any prescriptions yet.</p>
        ) : (
          <table className="ps-table">
            <thead>
              <tr><th>Reference</th><th>Patient</th><th>Type</th><th>Date</th><th>Repeats</th><th>Location</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/peps/${r.id}`)}>
                  <td>{r.prescription_ref}</td>
                  <td>{r.patient_snapshot?.full_name ?? '—'}</td>
                  <td>{r.prescription_type === 'vet' ? 'Vet' : 'Private'}</td>
                  <td>{r.prescription_date}</td>
                  <td>{r.repeats > 0 ? `${r.repeats_dispensed}/${r.repeats + 1}` : '—'}</td>
                  <td>{locationOf(r.status, r.assigned_org?.name)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
