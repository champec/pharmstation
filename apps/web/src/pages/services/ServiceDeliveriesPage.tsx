import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import {
  DELIVERY_LIST_SELECT,
  fmtDateTime,
  patientName,
  type DeliveryListRow,
} from '../../components/services/serviceRecord'
import { ClipboardList } from 'lucide-react'

const PAGE_SIZE = 25

/** Service History: every delivery for the pharmacy, newest first, paged on the server. */
export function ServiceDeliveriesPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()

  const [services, setServices] = useState<Array<{ id: string; name: string; archived_at: string | null }>>([])
  const [rows, setRows] = useState<DeliveryListRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filterServiceId, setFilterServiceId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [patientQuery, setPatientQuery] = useState('')
  const [debouncedPatient, setDebouncedPatient] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPatient(patientQuery.replace(/[,()"\\%*:]/g, ' ').trim()), 350)
    return () => clearTimeout(t)
  }, [patientQuery])

  // Services for the filter, archived ones included (their records still exist).
  useEffect(() => {
    if (!organisation?.id) return
    getUserClient()
      .from('ps_services')
      .select('id, name, archived_at')
      .eq('org_id', organisation.id)
      .order('name')
      .then(({ data }) => setServices((data as typeof services) || []))
  }, [organisation?.id])

  // Any filter change goes back to the first page.
  useEffect(() => { setPage(0) }, [filterServiceId, filterStatus, fromDate, toDate, debouncedPatient])

  const load = useCallback(async () => {
    if (!organisation?.id) return
    setLoading(true)
    setError(null)
    try {
      const client = getUserClient()
      let patientIds: string[] | null = null
      if (debouncedPatient.length >= 2) {
        const q = debouncedPatient
        const compact = q.replace(/\s/g, '')
        const { data: pts, error: pErr } = await client
          .from('ps_patients')
          .select('id')
          .eq('organisation_id', organisation.id)
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,nhs_number.ilike.%${compact}%`)
          .limit(200)
        if (pErr) throw pErr
        patientIds = (pts ?? []).map((p: { id: string }) => p.id)
        if (patientIds.length === 0) {
          setRows([])
          setTotal(0)
          setLoading(false)
          return
        }
      }

      let query = client
        .from('ps_service_deliveries')
        .select(DELIVERY_LIST_SELECT, { count: 'exact' })
        .eq('org_id', organisation.id)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (filterServiceId) query = query.eq('service_id', filterServiceId)
      if (filterStatus) query = query.eq('status', filterStatus)
      if (fromDate) query = query.gte('created_at', new Date(`${fromDate}T00:00:00`).toISOString())
      if (toDate) query = query.lt('created_at', new Date(new Date(`${toDate}T00:00:00`).getTime() + 86400000).toISOString())
      if (patientIds) query = query.in('patient_id', patientIds)

      const { data, error: qErr, count } = await query
      if (qErr) throw qErr
      setRows((data as unknown as DeliveryListRow[]) || [])
      setTotal(count ?? 0)
    } catch (e: any) {
      setError(e.message || 'Records could not be loaded.')
    }
    setLoading(false)
  }, [organisation?.id, page, filterServiceId, filterStatus, fromDate, toDate, debouncedPatient])

  useEffect(() => { load() }, [load])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const th: React.CSSProperties = { padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)', fontWeight: 600 }
  const td: React.CSSProperties = { padding: 'var(--ps-space-sm) var(--ps-space-md)' }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <span>Service History</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>Service History</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services')}>
            ← Back to Services
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setError(null)} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)', display: 'flex', gap: 'var(--ps-space-md)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
          <label style={{ fontSize: 'var(--ps-font-sm)' }}>Patient</label>
          <input className="ps-input" placeholder="Name or NHS number" value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} />
        </div>
        <div className="form-group" style={{ margin: 0, flex: '1 1 180px' }}>
          <label style={{ fontSize: 'var(--ps-font-sm)' }}>Service</label>
          <select className="ps-input" value={filterServiceId} onChange={(e) => setFilterServiceId(e.target.value)}>
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.archived_at ? ' (removed)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, flex: '0 1 140px' }}>
          <label style={{ fontSize: 'var(--ps-font-sm)' }}>Status</label>
          <select className="ps-input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, flex: '0 1 150px' }}>
          <label style={{ fontSize: 'var(--ps-font-sm)' }}>From</label>
          <input className="ps-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="form-group" style={{ margin: 0, flex: '0 1 150px' }}>
          <label style={{ fontSize: 'var(--ps-font-sm)' }}>To</label>
          <input className="ps-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <span style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
          {total} record{total !== 1 ? 's' : ''}
        </span>
      </div>

      {loading && rows.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--ps-slate)' }}>Loading records…</p>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <span className="ps-empty-icon" aria-hidden="true"><ClipboardList size={26} strokeWidth={1.75} /></span>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No records found</h2>
          <p style={{ color: 'var(--ps-slate)', maxWidth: 400, margin: '0 auto' }}>
            Records appear here once a service is delivered. Try clearing the filters.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="ps-card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--ps-off-white)', textAlign: 'left' }}>
                <th style={th}>Date</th>
                <th style={th}>Service</th>
                <th style={th}>Patient</th>
                <th style={th}>Delivered by</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr
                  key={d.id}
                  style={{ borderBottom: '1px solid var(--ps-off-white)', cursor: 'pointer' }}
                  onClick={() => navigate(`/services/deliveries/${d.id}`)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--ps-off-white)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                >
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateTime(d.completed_at || d.created_at)}</td>
                  <td style={{ ...td, fontWeight: 500, color: 'var(--ps-midnight)' }}>{d.service?.name || 'Unknown service'}</td>
                  <td style={{ ...td, color: 'var(--ps-slate)' }}>
                    {patientName(d.patient) || 'Walk-in'}
                    {d.patient?.nhs_number && <span style={{ fontSize: 'var(--ps-font-xs)' }}> · {d.patient.nhs_number}</span>}
                  </td>
                  <td style={{ ...td, color: 'var(--ps-slate)' }}>{d.deliverer?.full_name || '—'}</td>
                  <td style={td}>
                    <span className={`ps-badge ${d.status === 'completed' ? 'ps-badge-green' : 'ps-badge-amber'}`}>
                      {d.status === 'completed' ? '✓ Completed' : 'Draft'}
                    </span>
                    {(d.amendment_count ?? 0) > 0 && <span className="ps-badge" style={{ marginLeft: 4 }}>Amended</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
              <button className="ps-btn ps-btn-secondary ps-btn-sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>← Newer</button>
              <span style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Page {page + 1} of {pages}</span>
              <button className="ps-btn ps-btn-secondary ps-btn-sm" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>Older →</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
