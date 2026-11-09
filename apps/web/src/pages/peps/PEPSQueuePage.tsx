import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, usePepsStore } from '@pharmstation/core'
import type { PepsPrescription, PepsSpineResult } from '@pharmstation/types'

function statusBadge(rx: PepsPrescription) {
  const expired = !!rx.expires_at && new Date(rx.expires_at).getTime() < Date.now()
  if (expired && (rx.status === 'held' || rx.status === 'available')) {
    return <span className="ps-badge ps-badge-muted">Expired</span>
  }
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
  const { queue, loading, error, fetchQueue, fetchAvailableForOrg, downloadFromSpine, claimByReference, spineSearch } = usePepsStore()
  const verified = organisation?.verification_status === undefined || organisation?.verification_status === 'verified'

  const [available, setAvailable] = useState<PepsPrescription[]>([])
  const [fetching, setFetching] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  // Claim an open-spine prescription
  const [claimRef, setClaimRef] = useState('')
  const [claimCheck, setClaimCheck] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimMsg, setClaimMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Spine lookup
  const [spineQuery, setSpineQuery] = useState('')
  const [spineResults, setSpineResults] = useState<PepsSpineResult[]>([])
  const [searching, setSearching] = useState(false)
  const [spineSearched, setSpineSearched] = useState(false)

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

  const handleClaim = async () => {
    if (!organisation?.id) return
    setClaimMsg(null)
    setClaiming(true)
    try {
      const rx = await claimByReference(organisation.id, claimRef, claimCheck)
      if (rx) {
        setClaimRef('')
        setClaimCheck('')
        navigate(`/peps/${rx.id}`)
      } else {
        setClaimMsg({ ok: false, text: 'No open prescription matches that reference and patient detail. Check both with the patient.' })
      }
    } catch (e: any) {
      setClaimMsg({ ok: false, text: e.message })
    } finally {
      setClaiming(false)
    }
  }

  const handleSpineSearch = async () => {
    if (spineQuery.trim().length < 6) return
    setSearching(true)
    try {
      setSpineResults(await spineSearch(spineQuery.trim()))
      setSpineSearched(true)
    } catch {
      setSpineResults([])
      setSpineSearched(true)
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
          <h1>PEPS Queue</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/peps/write')}>Write prescription</button>
        </div>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Prescriptions held by {organisation?.name ?? 'your pharmacy'}. Download ones sent to you, or claim a patient's spine prescription with their reference.
        </p>
      </div>

      {!verified && (
        <div className="ps-alert ps-alert-warning" style={{ marginBottom: 'var(--ps-space-md)' }}>
          Your pharmacy hasn't been verified yet. You can receive and dispense private prescriptions once PharmStation has checked your pharmacy's details.
        </div>
      )}

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      {/* Stats */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <div className="stat-card stat-card-accent">
          <div className="stat-card-label">Sent to you</div>
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

      {/* Directed to this pharmacy */}
      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--ps-space-md)', flexWrap: 'wrap', borderLeft: '4px solid var(--ps-electric-cyan)' }}>
        <div>
          <strong>{available.length}</strong> prescription{available.length === 1 ? '' : 's'} sent directly to you
          <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '4px 0 0' }}>
            Downloading locks them to your pharmacy.
          </p>
        </div>
        <button className="ps-btn ps-btn-primary" onClick={handleFetch} disabled={!verified || fetching || available.length === 0}>
          {fetching ? 'Downloading…' : `Download ${available.length || ''}`}
        </button>
      </div>

      {/* Claim from spine */}
      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)' }}>
        <label style={{ fontWeight: 600 }}>Collect a patient's spine prescription</label>
        <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '4px 0 8px' }}>
          Ask the patient for their prescription reference (for example PX-ABCD-12345) and check it against their surname or date of birth.
        </p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
          <input
            className="ps-input"
            style={{ flex: '1 1 180px' }}
            placeholder="Prescription reference"
            value={claimRef}
            onChange={(e) => setClaimRef(e.target.value)}
          />
          <input
            className="ps-input"
            style={{ flex: '1 1 180px' }}
            placeholder="Surname or DOB (DD/MM/YYYY)"
            value={claimCheck}
            onChange={(e) => setClaimCheck(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleClaim() }}
          />
          <button
            className="ps-btn ps-btn-primary"
            onClick={handleClaim}
            disabled={!verified || claiming || claimRef.trim().length < 6 || claimCheck.trim().length < 2}
          >
            {claiming ? 'Checking…' : 'Collect'}
          </button>
        </div>
        {claimMsg && (
          <div className={`ps-alert ${claimMsg.ok ? 'ps-alert-success' : 'ps-alert-error'}`} style={{ marginTop: 'var(--ps-space-sm)' }}>
            {claimMsg.text}
          </div>
        )}
      </div>

      {/* Where is it? */}
      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)' }}>
        <label style={{ fontWeight: 600 }}>Where is this prescription?</label>
        <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '4px 0 8px' }}>
          Enter a full prescription reference to see whether it is still on the spine or which pharmacy has it.
        </p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
          <input
            className="ps-input"
            style={{ flex: '1 1 240px' }}
            placeholder="Prescription reference"
            value={spineQuery}
            onChange={(e) => setSpineQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSpineSearch() }}
          />
          <button className="ps-btn ps-btn-secondary" onClick={handleSpineSearch} disabled={!verified || searching}>
            {searching ? 'Searching…' : 'Look up'}
          </button>
        </div>
        {spineSearched && spineResults.length === 0 && !searching && (
          <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginTop: 'var(--ps-space-sm)' }}>No prescription with that reference.</p>
        )}
        {spineResults.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
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
          </div>
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
