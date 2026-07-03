import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { PsPayment } from '@pharmstation/types'

type PaymentRow = PsPayment & {
  patient?: { first_name: string; last_name: string } | null
  service?: { name: string } | null
}

const STATUS_BADGE: Record<string, string> = {
  succeeded: 'ps-badge-green',
  processing: 'ps-badge-blue',
  pending: 'ps-badge-blue',
  failed: 'ps-badge-red',
  canceled: 'ps-badge-red',
  refunded: 'ps-badge-amber',
  partially_refunded: 'ps-badge-amber',
}

export function PaymentsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const orgId = organisation?.id

  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    let query = getUserClient()
      .from('ps_payments')
      .select('*, patient:ps_patients(first_name, last_name), service:ps_services(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    const { data } = await query
    setPayments((data as PaymentRow[]) ?? [])
    setLoading(false)
  }, [orgId, statusFilter])

  useEffect(() => { load() }, [load])

  const totalPaid = payments
    .filter((p) => p.status === 'succeeded')
    .reduce((sum, p) => sum + p.amount_pence - p.refunded_pence, 0)

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Payments</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>💳 Payments</h1>
          <select
            className="ps-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: '200px' }}
          >
            <option value="all">All statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="processing">Processing</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)', display: 'flex', gap: 'var(--ps-space-2xl)' }}>
        <div>
          <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Collected (shown)</div>
          <div style={{ fontSize: 'var(--ps-font-xl)', fontWeight: 700, color: 'var(--ps-midnight)' }}>
            £{(totalPaid / 100).toFixed(2)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Transactions</div>
          <div style={{ fontSize: 'var(--ps-font-xl)', fontWeight: 700, color: 'var(--ps-midnight)' }}>
            {payments.length}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading…</div>
      ) : payments.length === 0 ? (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--ps-slate)', margin: 0 }}>
            No payments yet. Mark a service as chargeable (Services → service → Payments) and payments from online bookings will appear here.
          </p>
        </div>
      ) : (
        <div className="ps-card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="ps-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>Date</th>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>Patient</th>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>Description</th>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>Kind</th>
                <th style={{ textAlign: 'right', padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--ps-off-white)' }}>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', whiteSpace: 'nowrap', fontSize: 'var(--ps-font-sm)' }}>
                    {new Date(p.paid_at ?? p.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', fontSize: 'var(--ps-font-sm)' }}>
                    {p.patient ? `${p.patient.first_name} ${p.patient.last_name}` : (p.payer_email ?? '—')}
                  </td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', fontSize: 'var(--ps-font-sm)' }}>
                    {p.description ?? p.service?.name ?? '—'}
                  </td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                    <span className="ps-badge">{p.kind}</span>
                  </td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    £{(p.amount_pence / 100).toFixed(2)}
                    {p.refunded_pence > 0 && (
                      <span style={{ color: 'var(--ps-error)', fontSize: 'var(--ps-font-sm)', fontWeight: 400 }}>
                        {' '}(−£{(p.refunded_pence / 100).toFixed(2)})
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                    <span className={`ps-badge ${STATUS_BADGE[p.status] ?? ''}`}>{p.status.replace('_', ' ')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 'var(--ps-space-md)' }}>
        Refunds are issued from the Stripe Dashboard — they sync back here automatically.
      </p>
    </div>
  )
}
