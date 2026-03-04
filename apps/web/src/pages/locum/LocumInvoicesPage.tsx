import { useCallback, useEffect, useState } from 'react'
import { getLocumClient } from '@pharmstation/supabase-client'
import { useLocumAuthStore } from '@pharmstation/core'

interface InvoiceLine {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  duration_minutes: number
  rate_per_hour: number
  line_total_pence: number
  platform_fee_pence: number
}

interface Invoice {
  id: string
  invoice_number: string
  week_start: string
  week_end: string
  issued_at: string
  due_date: string
  subtotal_pence: number
  platform_fee_pence: number
  total_pence: number
  status: string
  pdf_url: string | null
  org_id: string
  lines?: InvoiceLine[]
  payment_status?: string
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'ps-badge ps-badge-warning',
  processing: 'ps-badge ps-badge-primary',
  paid: 'ps-badge ps-badge-success',
  overdue: 'ps-badge ps-badge-danger',
  disputed: 'ps-badge ps-badge-danger',
}

function pence(p: number) { return `£${(p / 100).toFixed(2)}` }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
function fmtTime(t: string) { return t.slice(0, 5) }

export function LocumInvoicesPage() {
  const { locumProfile } = useLocumAuthStore()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [orgNames, setOrgNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loadingLines, setLoadingLines] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!locumProfile?.id) return
    setLoading(true)
    setError(null)
    const client = getLocumClient()
    try {
      const { data, error: qErr } = await client
        .from('ps_locum_invoices')
        .select('*')
        .eq('locum_id', locumProfile.id)
        .order('week_start', { ascending: false })
      if (qErr) throw qErr
      const list = (data ?? []) as Invoice[]

      const ids = list.map((i) => i.id)
      const paymentMap: Record<string, string> = {}
      if (ids.length > 0) {
        const { data: pmts } = await client
          .from('ps_locum_payments')
          .select('invoice_id, status')
          .in('invoice_id', ids)
        for (const p of pmts ?? []) paymentMap[(p as { invoice_id: string; status: string }).invoice_id] = (p as { invoice_id: string; status: string }).status
      }

      const orgIds = [...new Set(list.map((i) => i.org_id))]
      if (orgIds.length > 0) {
        const { data: orgs } = await client.from('ps_organisations').select('id, name').in('id', orgIds)
        const map: Record<string, string> = {}
        for (const o of (orgs ?? []) as { id: string; name: string }[]) map[o.id] = o.name
        setOrgNames(map)
      }

      setInvoices(list.map((i) => ({ ...i, payment_status: paymentMap[i.id] })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [locumProfile?.id])

  useEffect(() => { load() }, [load])

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (invoices.find((i) => i.id === id)?.lines) return
    setLoadingLines(id)
    try {
      const { data } = await getLocumClient()
        .from('ps_locum_invoice_lines')
        .select('*')
        .eq('invoice_id', id)
        .order('shift_date')
      setInvoices((prev) => prev.map((i) => i.id === id ? { ...i, lines: (data ?? []) as InvoiceLine[] } : i))
    } finally {
      setLoadingLines(null)
    }
  }

  const totals = invoices.reduce(
    (acc, i) => ({ earned: acc.earned + i.total_pence, fees: acc.fees + i.platform_fee_pence }),
    { earned: 0, fees: 0 }
  )

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices &amp; Payments</h1>
          <p className="page-subtitle">Your earnings from locum shifts</p>
        </div>
        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="stat-card">
          <div className="stat-card-label">Total Invoiced</div>
          <div className="stat-card-value">{loading ? '…' : pence(totals.earned)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Platform Fees</div>
          <div className="stat-card-value">{loading ? '…' : pence(totals.fees)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Net Earnings</div>
          <div className="stat-card-value">{loading ? '…' : pence(totals.earned - totals.fees)}</div>
        </div>
      </div>

      <div className="ps-alert ps-alert-info" style={{ marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        Invoices are generated every Wednesday for the Mon–Sun work period. Payment is due by Friday.
      </div>

      {loading ? (
        <div className="loading-indicator" style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>
      ) : invoices.length === 0 ? (
        <div className="ps-card">
          <div className="ps-card-body" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="text-muted">No invoices yet. Complete a shift and invoices will appear here.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {invoices.map((inv) => (
            <div key={inv.id} className="ps-card">
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr 160px 120px 120px auto', gap: '1rem', alignItems: 'center', padding: '1rem', cursor: 'pointer' }}
                onClick={() => toggleExpand(inv.id)}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{inv.invoice_number}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>{orgNames[inv.org_id] ?? 'Pharmacy'}</div>
                </div>
                <div style={{ fontSize: '0.875rem' }}>
                  <div>{fmtDate(inv.week_start)}</div>
                  <div style={{ color: 'var(--ps-slate)', fontSize: '0.8rem' }}>to {fmtDate(inv.week_end)}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{pence(inv.total_pence)}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>Due {fmtDate(inv.due_date)}</div>
                </div>
                <div><span className={STATUS_BADGE[inv.status] ?? 'ps-badge'}>{inv.status}</span></div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {inv.pdf_url && (
                    <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className="ps-btn ps-btn-ghost ps-btn-xs" onClick={(e) => e.stopPropagation()}>PDF</a>
                  )}
                  <span style={{ fontSize: '0.75rem', color: 'var(--ps-slate)' }}>{expandedId === inv.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedId === inv.id && (
                <div style={{ borderTop: '1px solid var(--ps-border)' }}>
                  {loadingLines === inv.id ? (
                    <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--ps-slate)' }}>Loading…</div>
                  ) : !inv.lines?.length ? (
                    <div style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--ps-slate)' }}>No line items found.</div>
                  ) : (
                    <table className="ps-table" style={{ margin: 0 }}>
                      <thead>
                        <tr><th>Date</th><th>Time</th><th>Duration</th><th>Rate</th><th>Gross</th><th>Fee</th><th>Net</th></tr>
                      </thead>
                      <tbody>
                        {inv.lines.map((line) => (
                          <tr key={line.id}>
                            <td>{fmtDate(line.shift_date)}</td>
                            <td>{fmtTime(line.start_time)} – {fmtTime(line.end_time)}</td>
                            <td>{(line.duration_minutes / 60).toFixed(1)}h</td>
                            <td>£{Number(line.rate_per_hour).toFixed(2)}/hr</td>
                            <td>{pence(line.line_total_pence)}</td>
                            <td style={{ color: 'var(--ps-slate)', fontSize: '0.8rem' }}>-{pence(line.platform_fee_pence)}</td>
                            <td style={{ fontWeight: 600 }}>{pence(line.line_total_pence - line.platform_fee_pence)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 600, background: 'var(--ps-surface)' }}>
                          <td colSpan={4}>Totals</td>
                          <td>{pence(inv.subtotal_pence)}</td>
                          <td style={{ color: 'var(--ps-slate)' }}>-{pence(inv.platform_fee_pence)}</td>
                          <td>{pence(inv.total_pence)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
