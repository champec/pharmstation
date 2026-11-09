import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { DELIVERY_LIST_SELECT, fmtDateTime, type DeliveryListRow } from './serviceRecord'

/** Patient page tab: every service delivered to this patient, newest first. */
export function PatientServicesTab({ patientId, orgId }: { patientId: string; orgId: string }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<DeliveryListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getUserClient()
      .from('ps_service_deliveries')
      .select(DELIVERY_LIST_SELECT)
      .eq('org_id', orgId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message)
        else setRows((data as unknown as DeliveryListRow[]) || [])
      })
    return () => { cancelled = true }
  }, [patientId, orgId])

  if (error) return <div className="auth-error">{error}</div>
  if (!rows) return <p style={{ color: 'var(--ps-slate)' }}>Loading services…</p>
  if (rows.length === 0) {
    return (
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', textAlign: 'center', color: 'var(--ps-slate)' }}>
        No services delivered to this patient yet.
      </div>
    )
  }

  const cell: React.CSSProperties = { padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left' }
  return (
    <div className="ps-card" style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--ps-off-white)', color: 'var(--ps-slate)' }}>
            <th style={cell}>Date</th><th style={cell}>Service</th><th style={cell}>Delivered by</th><th style={cell}>Status</th><th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} style={{ borderBottom: '1px solid var(--ps-off-white)' }}>
              <td style={cell}>{fmtDateTime(d.completed_at || d.created_at)}</td>
              <td style={cell}>{d.service?.name || 'Unknown service'}</td>
              <td style={cell}>{d.deliverer?.full_name || '—'}</td>
              <td style={cell}>
                <span className={`ps-badge ${d.status === 'completed' ? 'ps-badge-green' : 'ps-badge-amber'}`}>
                  {d.status === 'completed' ? 'Completed' : 'Draft'}
                </span>
                {(d.amendment_count ?? 0) > 0 && <span className="ps-badge" style={{ marginLeft: 4 }}>Amended</span>}
              </td>
              <td style={{ ...cell, textAlign: 'right' }}>
                <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => navigate(`/services/deliveries/${d.id}`)}>View</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
