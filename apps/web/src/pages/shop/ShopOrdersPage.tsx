// ============================================================
// ShopOrdersPage — /shop-admin/orders
// Org-side: incoming marketplace orders with status workflow.
// new → confirmed → ready → out_for_delivery/collected → completed
// ============================================================

import { useEffect, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useShopStore } from '@pharmstation/core'
import type { ShopOrder, ShopOrderStatus } from '@pharmstation/types'

const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`

const STATUS_META: Record<ShopOrderStatus, { label: string; color: string; bg: string }> = {
  new: { label: 'New', color: '#1d4ed8', bg: '#dbeafe' },
  confirmed: { label: 'Confirmed', color: '#92400e', bg: '#fef3c7' },
  ready: { label: 'Ready', color: '#065f46', bg: '#d1fae5' },
  out_for_delivery: { label: 'Out for delivery', color: '#5b21b6', bg: '#ede9fe' },
  collected: { label: 'Collected', color: '#065f46', bg: '#d1fae5' },
  completed: { label: 'Completed', color: '#334155', bg: '#f1f5f9' },
  cancelled: { label: 'Cancelled', color: '#991b1b', bg: '#fee2e2' },
}

/** Sensible next-step transitions per status. */
const NEXT_ACTIONS: Record<ShopOrderStatus, ShopOrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'collected', 'cancelled'],
  out_for_delivery: ['completed'],
  collected: ['completed'],
  completed: [],
  cancelled: [],
}

export function ShopOrdersPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { orders, loading, error, fetchOrders, updateOrderStatus, clearError } = useShopStore()
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | ShopOrderStatus>('active')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(() => {
    if (organisation?.id) fetchOrders(organisation.id)
  }, [organisation?.id, fetchOrders])

  useEffect(() => { load() }, [load])

  const filtered = orders.filter((o) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return !['completed', 'cancelled'].includes(o.status)
    return o.status === statusFilter
  })

  const handleStatus = async (order: ShopOrder, status: ShopOrderStatus) => {
    if (status === 'cancelled' && !window.confirm(`Cancel order ${order.order_number}?`)) return
    try {
      await updateOrderStatus(order.id, status)
    } catch { /* error surfaced by store */ }
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/shop-admin" onClick={(e) => { e.preventDefault(); navigate('/shop-admin') }}>Shop</a>
          <span className="separator">/</span>
          <span>Orders</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>📦 Shop Orders</h1>
          <button className="ps-btn ps-btn-secondary" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {error && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', color: 'var(--ps-error, #dc2626)' }}>
          {error} <button className="ps-btn ps-btn-secondary" onClick={clearError} style={{ marginLeft: 8 }}>Dismiss</button>
        </div>
      )}

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-lg)', flexWrap: 'wrap' }}>
        {(['active', 'all', 'new', 'confirmed', 'ready', 'out_for_delivery', 'collected', 'completed', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            className="ps-btn ps-btn-secondary"
            onClick={() => setStatusFilter(s)}
            style={statusFilter === s ? { background: 'var(--ps-deep-blue, #0077B6)', color: 'white' } : undefined}
          >
            {s === 'active' ? 'Active' : s === 'all' ? 'All' : STATUS_META[s].label}
            {s === 'new' && orders.some((o) => o.status === 'new') && (
              <span style={{ marginLeft: 6, background: '#dc2626', color: 'white', borderRadius: 999, padding: '0 7px', fontSize: 12 }}>
                {orders.filter((o) => o.status === 'new').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--ps-slate)' }}>Loading…</p>}

      {!loading && filtered.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          No orders here yet. When customers order from your shop they will appear in this list.
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--ps-space-sm)' }}>
        {filtered.map((o) => {
          const meta = STATUS_META[o.status]
          const isOpen = expandedId === o.id
          return (
            <div key={o.id} className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)', cursor: 'pointer', flexWrap: 'wrap' }}
                onClick={() => setExpandedId(isOpen ? null : o.id)}
              >
                <strong style={{ fontFamily: 'monospace' }}>{o.order_number}</strong>
                <span className="ps-badge" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                  {o.fulfilment_method === 'delivery' ? '🚚 Delivery' : '🏪 Collection'}
                </span>
                <span style={{ flex: 1, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                  {o.guest_name || 'Registered patient'}{o.guest_phone ? ` · ${o.guest_phone}` : ''}
                </span>
                <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                  {new Date(o.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <strong>{formatPrice(o.total_pence)}</strong>
                <span>{isOpen ? '▾' : '▸'}</span>
              </div>

              {isOpen && (
                <div style={{ marginTop: 'var(--ps-space-md)', paddingTop: 'var(--ps-space-md)', borderTop: '1px solid var(--ps-off-white)' }}>
                  <table style={{ width: '100%', fontSize: 'var(--ps-font-sm)', borderCollapse: 'collapse' }}>
                    <tbody>
                      {(o.items || []).map((it) => (
                        <tr key={it.id}>
                          <td style={{ padding: '4px 0' }}>{it.quantity} × {it.product_name}</td>
                          <td style={{ textAlign: 'right' }}>{formatPrice(it.line_total_pence)}</td>
                        </tr>
                      ))}
                      {o.delivery_fee_pence > 0 && (
                        <tr>
                          <td style={{ padding: '4px 0', color: 'var(--ps-slate)' }}>Delivery fee</td>
                          <td style={{ textAlign: 'right' }}>{formatPrice(o.delivery_fee_pence)}</td>
                        </tr>
                      )}
                      <tr style={{ fontWeight: 700 }}>
                        <td style={{ padding: '4px 0' }}>Total</td>
                        <td style={{ textAlign: 'right' }}>{formatPrice(o.total_pence)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {o.fulfilment_method === 'delivery' && o.delivery_address && (
                    <p style={{ margin: 'var(--ps-space-sm) 0 0', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                      📍 {[o.delivery_address.line_1, o.delivery_address.city, o.delivery_address.postcode].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {o.customer_notes && (
                    <p style={{ margin: 'var(--ps-space-sm) 0 0', fontSize: 'var(--ps-font-sm)' }}>
                      💬 <em>{o.customer_notes}</em>
                    </p>
                  )}

                  {/* Consultation questionnaire answers */}
                  {(o.responses || []).map((r) => {
                    const item = (o.items || []).find((it) => it.product_id === r.product_id)
                    return (
                      <div key={r.id} style={{ marginTop: 'var(--ps-space-md)', border: '1px solid #ede9fe', background: '#faf5ff', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-md)' }}>
                        <strong style={{ color: '#5b21b6', fontSize: 'var(--ps-font-sm)' }}>
                          📝 Consultation answers{item ? ` — ${item.product_name}` : ''}
                        </strong>
                        <table style={{ width: '100%', fontSize: 'var(--ps-font-sm)', marginTop: 6, borderCollapse: 'collapse' }}>
                          <tbody>
                            {r.answers.map((a) => (
                              <tr key={a.question_id}>
                                <td style={{ padding: '3px 12px 3px 0', color: 'var(--ps-slate)', verticalAlign: 'top', width: '55%' }}>{a.label}</td>
                                <td style={{ padding: '3px 0', fontWeight: 600 }}>{a.answer || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}

                  {NEXT_ACTIONS[o.status].length > 0 && (
                    <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
                      {NEXT_ACTIONS[o.status]
                        .filter((s) => !(s === 'out_for_delivery' && o.fulfilment_method !== 'delivery'))
                        .filter((s) => !(s === 'collected' && o.fulfilment_method !== 'collection'))
                        .map((s) => (
                          <button
                            key={s}
                            className={s === 'cancelled' ? 'ps-btn ps-btn-secondary' : 'ps-btn ps-btn-primary'}
                            onClick={() => handleStatus(o, s)}
                          >
                            {s === 'cancelled' ? 'Cancel order' : `Mark ${STATUS_META[s].label.toLowerCase()}`}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
