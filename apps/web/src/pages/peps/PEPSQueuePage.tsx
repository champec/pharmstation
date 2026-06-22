import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, usePepsStore } from '@pharmstation/core'
import type { PepsPrescription, PepsSpineResult } from '@pharmstation/types'

function statusBadge(rx: PepsPrescription) {
  switch (rx.status) {
    case 'held':
      return <span className="ps-badge ps-badge-success">Held</span>
    case 'available':
      return <span className="ps-badge ps-badge-warning">Incoming</span>
    case 'dispensed':
      return <span className="ps-badge ps-badge-primary">Dispensed</span>
    case 'cancelled':
      return <span className="ps-badge ps-badge-muted">Cancelled</span>
    default:
      return <span className="ps-badge">{rx.status}</span>
  }
}

export function PEPSQueuePage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { queue, loading, error, fetchQueue, fetchAvailableForOrg, downloadFromSpine, spineSearch } = usePepsStore()

  const [available, setAvailable] = useState<PepsPrescription[]>([])
  const [fetching, setFetching] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  // Spine lookup
  const [spineQuery, setSpineQuery] = useState('')
  const [spineResults, setSpineResults] = useState<PepsSpineResult[]>([])
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    if (!organisation?.id) return
    await fetchQueue(organisation.id)
    try {
      setAvailable(await fetchAvailableForOrg(organisation.id))
    } catch {
      setAvailable([])
    }
  }, [organisation?.id, fetchQueue, fetchAvailableForOrg])

  useEffect(() => { load() }, [load])

  const handleFetch = async () => {
    if (!organisation?.id) return
    setFetching(true)
    try {
      await downloadFromSpine(organisation.id)
      setAvailable(await fetchAvailableForOrg(organisation.id))
    } finally {
      setFetching(false)
    }
  }

  const handleSpineSearch = async () => {
    if (spineQuery.trim().length < 2) return
    setSearching(true)
    try {
      setSpineResults(await spineSearch(spineQuery.trim()))
    } finally {
      setSearching(false)
    }
  }

  const filtered = useMemo(() => {
    let list = queue
    if (statusFilter) list = list.filter((r) => r.status === statusFilter)
    if (typeFilter) list = list.filter((r) => r.prescription_type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          r.prescription_ref.toLowerCase().includes(q) ||
          (r.patient_snapshot?.full_name ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [queue, statusFilter, typeFilter, search])

  const stats = useMemo(() => ({
    held: queue.filter((r) => r.status === 'held').length,
    dispensed: queue.filter((r) => r.status === 'dispensed').length,
    waiting: available.length,
  }), [queue, available])

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>PEPS Queue</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>℞ PEPS Queue</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/peps/write')}>✍️ Write prescription</button>
        </div>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Prescriptions held by {organisation?.name ?? 'your pharmacy'}. Fetch new ones from the spine to claim them.
        </p>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      {/* Stats */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <div className="stat-card stat-card-accent">
          <div className="stat-card-label">Waiting on spine</div>
          <div className="stat-card-value">{stats.waiting}</div>
          <span className="stat-card-link">Ready to download</span>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Held by you</div>
          <div className="stat-card-value">{stats.held}</div>
          <span className="stat-card-link">Locked to your pharmacy</span>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Dispensed</div>
          <div className="stat-card-value">{stats.dispensed}</div>
          <span className="stat-card-link">Completed</span>
        </div>
      </div>

      {/* Fetch from spine */}
      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '4px solid var(--ps-electric-cyan)' }}>
        <div>
          <strong>{available.length}</strong> prescription{available.length === 1 ? '' : 's'} waiting to be collected
          <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '4px 0 0' }}>
            Open spine scripts and any sent directly to you. Downloading locks them to your pharmacy.
          </p>
        </div>
        <button className="ps-btn ps-btn-primary" onClick={handleFetch} disabled={fetching || available.length === 0}>
          {fetching ? 'Fetching…' : `📥 Download ${available.length || ''}`}
        </button>
      </div>

      {/* Spine lookup */}
      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)' }}>
        <label style={{ fontWeight: 600 }}>Locate a patient's prescription on the spine</label>
        <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '4px 0 8px' }}>
          Find where a script is across PharmStation. You can only view or dispense it once it is on the open spine and you download it.
        </p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
          <input
            className="ps-input"
            placeholder="Patient name, NHS number, or prescription reference…"
            value={spineQuery}
            onChange={(e) => setSpineQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSpineSearch() }}
          />
          <button className="ps-btn ps-btn-secondary" onClick={handleSpineSearch} disabled={searching}>
            {searching ? 'Searching…' : 'Search spine'}
          </button>
        </div>
        {spineResults.length > 0 && (
          <table className="ps-table" style={{ marginTop: 'var(--ps-space-md)' }}>
            <thead>
              <tr><th>Reference</th><th>Patient</th><th>Date</th><th>Status</th><th>Location</th></tr>
            </thead>
            <tbody>
              {spineResults.map((r) => (
                <tr key={r.id}>
                  <td>{r.prescription_ref}</td>
                  <td>{r.patient_name ?? '—'}</td>
                  <td>{r.prescription_date}</td>
                  <td>{r.status}</td>
                  <td>{r.is_open ? <span className="ps-badge ps-badge-success">{r.location}</span> : r.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Queue table */}
      <div className="ps-card">
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
          <input className="ps-input" style={{ maxWidth: 280 }} placeholder="Search ref or patient…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="ps-input" style={{ maxWidth: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="held">Held</option>
            <option value="dispensed">Dispensed</option>
          </select>
          <select className="ps-input" style={{ maxWidth: 180 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            <option value="private">Private</option>
            <option value="vet">Veterinary</option>
          </select>
        </div>

        {loading ? (
          <p style={{ color: 'var(--ps-slate)' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--ps-slate)' }}>No prescriptions in your queue yet.</p>
        ) : (
          <table className="ps-table">
            <thead>
              <tr><th>Reference</th><th>Patient</th><th>Type</th><th>Items</th><th>Date</th><th>Repeats</th><th>Status</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/peps/${r.id}`)}>
                  <td>{r.prescription_ref}</td>
                  <td>{r.patient_snapshot?.full_name ?? '—'}</td>
                  <td>{r.prescription_type === 'vet' ? 'Vet' : 'Private'}</td>
                  <td>{r.items?.length ?? 0}</td>
                  <td>{r.prescription_date}</td>
                  <td>{r.repeats > 0 ? `${r.repeats_dispensed}/${r.repeats + 1}` : '—'}</td>
                  <td>{statusBadge(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
