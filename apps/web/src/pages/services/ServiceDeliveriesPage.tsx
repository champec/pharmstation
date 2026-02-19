import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useServiceStore } from '@pharmstation/core'
import type { ServiceDelivery, Service } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

export function ServiceDeliveriesPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    services,
    deliveries,
    loading,
    error,
    fetchServices,
    fetchDeliveries,
    clearError,
  } = useServiceStore()

  const [filterServiceId, setFilterServiceId] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [selectedDelivery, setSelectedDelivery] = useState<ServiceDelivery | null>(null)

  const load = useCallback(() => {
    if (!organisation?.id) return
    fetchServices(organisation.id)
    fetchDeliveries(organisation.id)
  }, [organisation?.id, fetchServices, fetchDeliveries])

  useEffect(() => { load() }, [load])

  /* Build a service-id → name lookup */
  const serviceMap = useMemo(() => {
    const map = new Map<string, Service>()
    services.forEach((s) => map.set(s.id, s))
    return map
  }, [services])

  /* Filtered deliveries */
  const filtered = useMemo(() => {
    let list = deliveries
    if (filterServiceId) list = list.filter((d) => d.service_id === filterServiceId)
    if (filterStatus) list = list.filter((d) => d.status === filterStatus)
    return list
  }, [deliveries, filterServiceId, filterStatus])

  /* Date formatter */
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <span>Delivery History</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📋 Delivery History</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services')}>
            ← Back to Services
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)', display: 'flex', gap: 'var(--ps-space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
          <label style={{ fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-xs)' }}>Service</label>
          <select
            className="ps-input"
            value={filterServiceId}
            onChange={(e) => setFilterServiceId(e.target.value)}
          >
            <option value="">All Services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0, flex: '1 1 160px' }}>
          <label style={{ fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-xs)' }}>Status</label>
          <select
            className="ps-input"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="draft">Draft</option>
          </select>
        </div>

        <div style={{ alignSelf: 'flex-end' }}>
          <span style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Loading */}
      {loading && deliveries.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--ps-slate)' }}>Loading delivery records…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>📋</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>
            {deliveries.length === 0 ? 'No deliveries yet' : 'No matching records'}
          </h2>
          <p style={{ color: 'var(--ps-slate)', maxWidth: 400, margin: '0 auto' }}>
            {deliveries.length === 0
              ? 'Delivery records will appear here once you deliver a service.'
              : 'Try changing your filters to see more results.'}
          </p>
        </div>
      )}

      {/* Delivery table */}
      {filtered.length > 0 && (
        <div className="ps-card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--ps-off-white)', textAlign: 'left' }}>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)', fontWeight: 600 }}>Date</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)', fontWeight: 600 }}>Service</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)', fontWeight: 600 }}>Patient</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)', fontWeight: 600 }}>Status</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)', fontWeight: 600 }}>Notes</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)', fontWeight: 600, width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const svc = serviceMap.get(d.service_id)
                const patientName = extractPatientName(d)
                return (
                  <tr
                    key={d.id}
                    style={{
                      borderBottom: '1px solid var(--ps-off-white)',
                      cursor: 'pointer',
                      transition: 'background var(--ps-transition-fast)',
                    }}
                    onClick={() => setSelectedDelivery(d)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--ps-off-white)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                  >
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', whiteSpace: 'nowrap' }}>
                      {fmtDate(d.completed_at || d.created_at)}
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 500, color: 'var(--ps-midnight)' }}>
                      {svc?.name || 'Unknown Service'}
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)' }}>
                      {patientName || '—'}
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                      <span className={`ps-badge ${d.status === 'completed' ? 'ps-badge-green' : 'ps-badge-amber'}`}>
                        {d.status === 'completed' ? '✓ Completed' : '⏳ Draft'}
                      </span>
                    </td>
                    <td style={{
                      padding: 'var(--ps-space-sm) var(--ps-space-md)',
                      color: 'var(--ps-slate)',
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {d.notes || '—'}
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                      <button
                        className="ps-btn ps-btn-ghost ps-btn-sm"
                        onClick={(e) => { e.stopPropagation(); setSelectedDelivery(d) }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      <Modal
        isOpen={!!selectedDelivery}
        onClose={() => setSelectedDelivery(null)}
        title="Delivery Record"
      >
        {selectedDelivery && (
          <DeliveryDetail
            delivery={selectedDelivery}
            serviceName={serviceMap.get(selectedDelivery.service_id)?.name || 'Unknown Service'}
            fmtDate={fmtDate}
          />
        )}
      </Modal>
    </div>
  )
}

/* ---- Helpers ---- */

/** Try to extract a patient name from form_data (common field names) */
function extractPatientName(d: ServiceDelivery): string {
  if (!d.form_data || typeof d.form_data !== 'object') return ''
  const data = d.form_data as Record<string, unknown>
  // Check common keys
  for (const key of ['patient_name', 'patientName', 'full_name', 'name', 'patient']) {
    if (typeof data[key] === 'string' && data[key]) return data[key] as string
  }
  // Check for first_name + last_name combo
  const first = data['first_name'] ?? data['firstName'] ?? ''
  const last = data['last_name'] ?? data['lastName'] ?? ''
  if (first || last) return `${first} ${last}`.trim()
  return ''
}

/* ---- Detail sub-component ---- */

function DeliveryDetail({
  delivery,
  serviceName,
  fmtDate,
}: {
  delivery: ServiceDelivery
  serviceName: string
  fmtDate: (iso: string) => string
}) {
  const formEntries = delivery.form_data
    ? Object.entries(delivery.form_data as Record<string, unknown>)
    : []

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
        <div>
          <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginBottom: 2 }}>Service</div>
          <div style={{ fontWeight: 600, color: 'var(--ps-midnight)' }}>{serviceName}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginBottom: 2 }}>Status</div>
          <span className={`ps-badge ${delivery.status === 'completed' ? 'ps-badge-green' : 'ps-badge-amber'}`}>
            {delivery.status === 'completed' ? '✓ Completed' : '⏳ Draft'}
          </span>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginBottom: 2 }}>Created</div>
          <div>{fmtDate(delivery.created_at)}</div>
        </div>
        {delivery.completed_at && (
          <div>
            <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginBottom: 2 }}>Completed</div>
            <div>{fmtDate(delivery.completed_at)}</div>
          </div>
        )}
      </div>

      {/* Notes */}
      {delivery.notes && (
        <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
          <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginBottom: 4 }}>Notes</div>
          <div className="ps-card" style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', background: 'var(--ps-off-white)', fontSize: 'var(--ps-font-sm)' }}>
            {delivery.notes}
          </div>
        </div>
      )}

      {/* Form data */}
      {formEntries.length > 0 && (
        <div>
          <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>
            📝 Form Responses
          </h3>
          <div className="ps-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
              <tbody>
                {formEntries.map(([key, value]) => (
                  <tr key={key} style={{ borderBottom: '1px solid var(--ps-off-white)' }}>
                    <td style={{
                      padding: 'var(--ps-space-sm) var(--ps-space-md)',
                      fontWeight: 500,
                      color: 'var(--ps-midnight)',
                      width: '40%',
                      verticalAlign: 'top',
                    }}>
                      {formatFieldLabel(key)}
                    </td>
                    <td style={{
                      padding: 'var(--ps-space-sm) var(--ps-space-md)',
                      color: 'var(--ps-slate)',
                      wordBreak: 'break-word',
                    }}>
                      {formatFieldValue(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formEntries.length === 0 && (
        <p style={{ color: 'var(--ps-slate)', fontStyle: 'italic', fontSize: 'var(--ps-font-sm)' }}>
          No form data recorded for this delivery.
        </p>
      )}
    </div>
  )
}

/** snake_case or camelCase → readable label */
function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Render a form value nicely */
function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
