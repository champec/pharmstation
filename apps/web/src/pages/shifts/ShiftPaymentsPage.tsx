import { useCallback, useEffect, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

type PaymentTab = 'invoices' | 'mandate'

interface Invoice {
  id: string
  invoice_number: string
  locum_id: string
  week_start: string
  week_end: string
  issued_at: string
  due_date: string
  subtotal_pence: number
  platform_fee_pence: number
  total_pence: number
  status: string
  pdf_url: string | null
  locum_name?: string
}

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

interface Mandate {
  id: string
  stripe_payment_method: string | null
  is_active: boolean
  created_at: string
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

export function ShiftPaymentsPage() {
  const { organisation } = useAuthStore()
  const orgId = organisation?.id
  const [tab, setTab] = useState<PaymentTab>('invoices')

  /* Invoices */
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(true)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [lineMap, setLineMap] = useState<Record<string, InvoiceLine[]>>({})
  const [loadingLines, setLoadingLines] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  /* Invoice job runner */
  const [showJobPanel, setShowJobPanel] = useState(false)
  const [jobWeekStart, setJobWeekStart] = useState('')
  const [jobWeekEnd, setJobWeekEnd] = useState('')
  const [runningJob, setRunningJob] = useState(false)
  const [jobResult, setJobResult] = useState<{ ok: boolean; message: string } | null>(null)

  /* Mandate */
  const [mandate, setMandate] = useState<Mandate | null>(null)
  const [loadingMandate, setLoadingMandate] = useState(true)

  const loadInvoices = useCallback(async () => {
    if (!orgId) return
    setLoadingInvoices(true)
    setInvoiceError(null)
    const client = getUserClient()
    const { data, error: qErr } = await client
      .from('ps_locum_invoices')
      .select('*')
      .eq('org_id', orgId)
      .order('week_start', { ascending: false })
    if (qErr) { setInvoiceError(qErr.message); setLoadingInvoices(false); return }

    const list = (data ?? []) as Invoice[]
    const locumIds = [...new Set(list.map((i) => i.locum_id))]
    if (locumIds.length > 0) {
      const { data: profiles } = await client.from('ps_locum_profiles').select('id, user_id').in('id', locumIds)
      const userIds = ((profiles ?? []) as { id: string; user_id: string }[]).map((p) => p.user_id)
      const { data: users } = await client.from('ps_user_profiles').select('id, full_name').in('id', userIds)
      const userMap = new Map(((users ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]))
      const profileMap = new Map(((profiles ?? []) as { id: string; user_id: string }[]).map((p) => [p.id, p.user_id]))
      for (const inv of list) inv.locum_name = userMap.get(profileMap.get(inv.locum_id) ?? '') ?? 'Locum'
    }
    setInvoices(list)
    setLoadingInvoices(false)
  }, [orgId])

  const loadMandate = useCallback(async () => {
    if (!orgId) return
    setLoadingMandate(true)
    const { data } = await getUserClient().from('ps_locum_payment_mandates').select('*').eq('org_id', orgId).maybeSingle()
    setMandate(data as Mandate | null)
    setLoadingMandate(false)
  }, [orgId])

  useEffect(() => {
    loadInvoices()
    loadMandate()
  }, [loadInvoices, loadMandate])

  async function runInvoiceJob() {
    setRunningJob(true)
    setJobResult(null)
    try {
      const client = getUserClient()
      const body = jobWeekStart && jobWeekEnd ? { week_start: jobWeekStart, week_end: jobWeekEnd } : {}
      const { data, error } = await client.functions.invoke('generate-weekly-invoices', { body })
      if (error) throw error
      const r = data as { ok: boolean; invoicesCreated: number; invoiceNumbers: string[]; skipped: number; weekStart: string; weekEnd: string; message?: string }
      if (r.ok) {
        setJobResult({
          ok: true,
          message: r.message ?? `Created ${r.invoicesCreated} invoice(s) for ${r.weekStart} → ${r.weekEnd}. Skipped ${r.skipped} (already exist).`
        })
        if (r.invoicesCreated > 0) await loadInvoices()
      } else {
        setJobResult({ ok: false, message: 'Job returned ok:false' })
      }
    } catch (err) {
      setJobResult({ ok: false, message: err instanceof Error ? err.message : 'Job failed' })
    } finally {
      setRunningJob(false)
    }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (lineMap[id]) return
    setLoadingLines(id)
    const { data } = await getUserClient()
      .from('ps_locum_invoice_lines')
      .select('*')
      .eq('invoice_id', id)
      .order('shift_date')
    setLineMap((prev) => ({ ...prev, [id]: (data ?? []) as InvoiceLine[] }))
    setLoadingLines(null)
  }

  const filtered = statusFilter === 'all' ? invoices : invoices.filter((i) => i.status === statusFilter)

  const totals = filtered.reduce(
    (acc, i) => ({ total: acc.total + i.total_pence, outstanding: acc.outstanding + (['pending', 'overdue'].includes(i.status) ? i.total_pence : 0) }),
    { total: 0, outstanding: 0 }
  )

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Invoice management for locum shifts</p>
        </div>
        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { loadInvoices(); loadMandate() }} disabled={loadingInvoices}>Refresh</button>
      </div>

      <div className="ps-tabs" style={{ marginBottom: '1.5rem' }}>
        {(['invoices', 'mandate'] as PaymentTab[]).map((t) => (
          <button key={t} className={`ps-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'invoices' ? 'Invoices' : 'Payment Mandate'}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <>
          {invoiceError && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{invoiceError}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="stat-card">
              <div className="stat-card-label">Total Invoiced (filtered)</div>
              <div className="stat-card-value">{loadingInvoices ? '…' : pence(totals.total)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Outstanding</div>
              <div className="stat-card-value" style={{ color: totals.outstanding > 0 ? 'var(--ps-danger)' : undefined }}>
                {loadingInvoices ? '…' : pence(totals.outstanding)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Total Invoices</div>
              <div className="stat-card-value">{loadingInvoices ? '…' : filtered.length}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            {['all', 'pending', 'processing', 'paid', 'overdue', 'disputed'].map((s) => (
              <button
                key={s}
                className={`ps-btn ps-btn-sm ${statusFilter === s ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          <div className="ps-alert ps-alert-info" style={{ marginBottom: '1.25rem', fontSize: '0.875rem' }}>
            Invoices are generated every Wednesday for the Mon–Sun work period. Payment due by Friday. Stripe payment integration coming soon.
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <button
              className="ps-btn ps-btn-ghost ps-btn-sm"
              onClick={() => { setShowJobPanel((v) => !v); setJobResult(null) }}
            >
              {showJobPanel ? 'Hide' : '⚙ Generate Invoices Manually'}
            </button>
            {showJobPanel && (
              <div className="ps-card" style={{ marginTop: '0.75rem' }}>
                <div className="ps-card-header"><h2 className="ps-card-title">Run Invoice Job</h2></div>
                <div className="ps-card-body">
                  <p style={{ fontSize: '0.875rem', marginBottom: '1rem', color: 'var(--ps-slate)' }}>
                    Generates invoices for the specified week (or auto-detects last Mon–Sun). Only creates invoices for completed shifts with no existing invoice.
                  </p>
                  <div className="form-row" style={{ marginBottom: '1rem' }}>
                    <div className="form-group">
                      <label className="form-label">Week Start (Monday, optional)</label>
                      <input className="form-input" type="date" value={jobWeekStart} onChange={(e) => setJobWeekStart(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Week End (Sunday, optional)</label>
                      <input className="form-input" type="date" value={jobWeekEnd} onChange={(e) => setJobWeekEnd(e.target.value)} />
                    </div>
                  </div>
                  {jobResult && (
                    <div className={`ps-alert ps-alert-${jobResult.ok ? 'success' : 'error'}`} style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                      {jobResult.message}
                    </div>
                  )}
                  <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={runInvoiceJob} disabled={runningJob}>
                    {runningJob ? 'Running…' : 'Run Now'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {loadingInvoices ? (
            <div className="loading-indicator" style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="ps-card">
              <div className="ps-card-body" style={{ padding: '2rem', textAlign: 'center' }}>
                <p className="text-muted">{statusFilter === 'all' ? 'No invoices yet.' : `No ${statusFilter} invoices.`}</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {filtered.map((inv) => (
                <div key={inv.id} className="ps-card">
                  <div
                    style={{ display: 'grid', gridTemplateColumns: '1fr 160px 120px 120px auto', gap: '1rem', alignItems: 'center', padding: '1rem', cursor: 'pointer' }}
                    onClick={() => toggleExpand(inv.id)}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{inv.invoice_number}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>{inv.locum_name ?? 'Locum'}</div>
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
                      ) : !lineMap[inv.id]?.length ? (
                        <div style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--ps-slate)' }}>No line items.</div>
                      ) : (
                        <table className="ps-table" style={{ margin: 0 }}>
                          <thead>
                            <tr><th>Date</th><th>Time</th><th>Duration</th><th>Rate</th><th>Gross</th><th>Fee</th><th>Net</th></tr>
                          </thead>
                          <tbody>
                            {lineMap[inv.id].map((line) => (
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
        </>
      )}

      {tab === 'mandate' && (
        <div style={{ maxWidth: 560 }}>
          {loadingMandate ? (
            <div className="loading-indicator">Loading…</div>
          ) : mandate?.is_active ? (
            <div className="ps-card">
              <div className="ps-card-header"><h2 className="ps-card-title">Payment Mandate Active</h2></div>
              <div className="ps-card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">Status</span>
                    <span className="ps-badge ps-badge-success">Active</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">Payment Method</span>
                    <span style={{ fontWeight: 600 }}>
                      {mandate.stripe_payment_method ? `•••• ${mandate.stripe_payment_method.slice(-4)}` : 'On file'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">Set up</span>
                    <span>{fmtDate(mandate.created_at)}</span>
                  </div>
                </div>
                <div className="ps-alert ps-alert-info" style={{ marginTop: '1.25rem', fontSize: '0.875rem' }}>
                  To update your payment method, contact support or use the Stripe billing portal (coming soon).
                </div>
              </div>
            </div>
          ) : (
            <div className="ps-card">
              <div className="ps-card-header"><h2 className="ps-card-title">Payment Mandate</h2></div>
              <div className="ps-card-body">
                <p style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
                  A payment mandate allows PharmStation to automatically collect invoice payments when they fall due. You will receive notice before each collection.
                </p>
                <div className="ps-alert ps-alert-warning">
                  <strong>No active mandate.</strong>&nbsp;Stripe mandate setup is coming soon. You will be notified when this feature is available.
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <button className="ps-btn ps-btn-primary" disabled>Set Up Direct Debit Mandate (Coming Soon)</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
