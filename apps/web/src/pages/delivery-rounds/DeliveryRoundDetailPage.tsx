import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore } from '@pharmstation/core'
import type { DeliveryRoundStatus, DeliveryPatientStatus } from '@pharmstation/types'
import { DeliveryRouteMap } from '../../components/maps/DeliveryRouteMap'

const ROUND_STATUS_BADGE: Record<DeliveryRoundStatus, { cls: string; label: string }> = {
  draft: { cls: 'ps-badge-slate', label: 'Draft' },
  scheduled: { cls: 'ps-badge-blue', label: 'Scheduled' },
  in_progress: { cls: 'ps-badge-amber', label: 'In Progress' },
  completed: { cls: 'ps-badge-green', label: 'Completed' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
}

const PATIENT_STATUS_BADGE: Record<DeliveryPatientStatus, { cls: string; label: string }> = {
  pending: { cls: 'ps-badge-slate', label: 'Pending' },
  in_transit: { cls: 'ps-badge-blue', label: 'In Transit' },
  arrived: { cls: 'ps-badge-amber', label: 'Arrived' },
  delivered: { cls: 'ps-badge-green', label: 'Delivered' },
  failed: { cls: 'ps-badge-red', label: 'Failed' },
  skipped: { cls: 'ps-badge-amber', label: 'Skipped' },
  pending_redelivery: { cls: 'ps-badge-red', label: 'Pending Redelivery' },
  moved_to_round: { cls: 'ps-badge-blue', label: 'Moved' },
  returned: { cls: 'ps-badge-slate', label: 'Returned' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
}

export function DeliveryRoundDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { organisation, membership } = useAuthStore()
  const {
    activeRound: round,
    loading,
    error,
    fetchRound,
    startRound,
    completeRound,
    cancelRound,
    saveAsTemplate,
    repeatRound,
    sendRoundNotifications,
    subscribeToRound,
    clearError,
  } = useDeliveryRoundStore()

  const [saving, setSaving] = useState(false)
  const [notifying, setNotifying] = useState(false)

  const load = useCallback(() => {
    if (id) fetchRound(id)
  }, [id, fetchRound])

  useEffect(() => { load() }, [load])

  // Subscribe to realtime updates
  useEffect(() => {
    if (!id) return
    const unsub = subscribeToRound(id)
    return unsub
  }, [id, subscribeToRound])

  const handleStart = async () => {
    if (!id) return
    setSaving(true)
    try { await startRound(id) } catch {}
    setSaving(false)
  }

  const handleComplete = async () => {
    if (!id) return
    setSaving(true)
    try { await completeRound(id) } catch {}
    setSaving(false)
  }

  const handleCancel = async () => {
    if (!id || !confirm('Cancel this delivery round?')) return
    setSaving(true)
    try { await cancelRound(id) } catch {}
    setSaving(false)
  }

  const handleSaveTemplate = async () => {
    if (!id || !organisation?.id || !membership?.user_id) return
    const name = prompt('Template name:')
    if (!name) return
    setSaving(true)
    try {
      await saveAsTemplate(id, name, organisation.id, membership.user_id)
      alert('Saved as template!')
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleRepeat = async () => {
    if (!id || !organisation?.id || !membership?.user_id) return
    setSaving(true)
    try {
      const newRound = await repeatRound(id, organisation.id, membership.user_id)
      navigate(`/delivery-rounds/${newRound.id}`)
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleNotifyPatients = async () => {
    if (!id || !organisation?.id) return
    if (!confirm('Send SMS notifications to all patients in this round?')) return
    setNotifying(true)
    try {
      const result = await sendRoundNotifications(id, organisation.id)
      alert(`Notifications sent: ${result.sent} successful, ${result.failed} failed.`)
    } catch (e: any) {
      alert(`Failed to send notifications: ${e.message}`)
    }
    setNotifying(false)
  }

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const formatTime = (t: string | null) => t ? t.slice(0, 5) : ''
  const formatDatetime = (d: string | null) =>
    d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

  if (loading && !round) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading…</div>
  }
  if (!round) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Round not found</div>
  }

  const patients = round.patients ?? []
  const delivered = patients.filter((p) => p.status === 'delivered').length
  const failed = patients.filter((p) => ['failed', 'pending_redelivery'].includes(p.status)).length
  const pending = patients.filter((p) => p.status === 'pending').length

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/delivery-rounds" onClick={(e) => { e.preventDefault(); navigate('/delivery-rounds') }}>Delivery Rounds</a>
          <span className="separator">/</span>
          <span>{round.title || round.id.slice(0, 8)}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
            <h1>📦 {round.title || `Round ${round.id.slice(0, 8)}`}</h1>
            <span className={`ps-badge ${ROUND_STATUS_BADGE[round.status]?.cls}`}>
              {ROUND_STATUS_BADGE[round.status]?.label}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            {round.status === 'draft' && (
              <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/delivery-rounds/${round.id}/edit`)}>Edit</button>
            )}
            {round.status === 'scheduled' && (
              <button className="ps-btn ps-btn-primary" onClick={handleStart} disabled={saving}>Start Round</button>
            )}
            {['scheduled', 'in_progress'].includes(round.status) && (
              <button className="ps-btn ps-btn-secondary" onClick={handleNotifyPatients} disabled={notifying}>
                {notifying ? 'Sending…' : '📱 Notify Patients'}
              </button>
            )}
            {['draft', 'scheduled'].includes(round.status) && (
              <button className="ps-btn ps-btn-ghost" onClick={handleCancel} disabled={saving} style={{ color: 'var(--ps-red)' }}>Cancel</button>
            )}
            {round.status === 'completed' && (
              <>
                <button className="ps-btn ps-btn-secondary" onClick={handleRepeat} disabled={saving}>Repeat Round</button>
                <button className="ps-btn ps-btn-secondary" onClick={handleSaveTemplate} disabled={saving}>Save as Template</button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {round.care_home_batch_id && (
        <div className="care-home-delivery-link">
          <div><strong>Care-home medicine delivery</strong><span>This route was generated from a packed care-home supply batch. Packing contents and receipt reconciliation are managed in Care Homes.</span></div>
          <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/care-homes/supplies/${round.care_home_batch_id}`)}>Open supply batch</button>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ps-midnight)' }}>{patients.length}</div>
          <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Patients</div>
        </div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ps-green)' }}>{delivered}</div>
          <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Delivered</div>
        </div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ps-red)' }}>{failed}</div>
          <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Failed</div>
        </div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ps-slate)' }}>{pending}</div>
          <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Pending</div>
        </div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--ps-font-sm)', fontWeight: 600, color: 'var(--ps-midnight)' }}>
            {formatDate(round.scheduled_date)}
          </div>
          <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
            {round.scheduled_time_start && `${formatTime(round.scheduled_time_start)}`}
            {round.scheduled_time_end && `–${formatTime(round.scheduled_time_end)}`}
          </div>
          <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Scheduled</div>
        </div>
      </div>

      {/* Driver info */}
      {round.driver && (
        <div style={{ marginBottom: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
          <strong>Driver:</strong> {(round.driver as any).user_profile?.full_name}
        </div>
      )}

      {round.notes && (
        <div style={{ marginBottom: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
          <strong>Notes:</strong> {round.notes}
        </div>
      )}

      {/* Route Map */}
      {patients.length > 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--ps-space-sm)' }}>🗺️ Route Map</h3>
          <DeliveryRouteMap
            patients={patients}
            roundId={round.id}
            driverId={round.driver_id}
            height={350}
            showDriverLocation={round.status === 'in_progress'}
          />
        </div>
      )}

      {/* Patient List */}
      <h2 style={{ marginBottom: 'var(--ps-space-md)' }}>Patients</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
        {patients
          .sort((a, b) => a.delivery_order - b.delivery_order)
          .map((rp) => (
            <div key={rp.id} className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600, marginRight: 'var(--ps-space-sm)' }}>
                    #{rp.delivery_order}
                  </span>
                  <span style={{ fontWeight: 500 }}>
                    {(rp.patient as any)?.first_name} {(rp.patient as any)?.last_name}
                  </span>
                  <span style={{ color: 'var(--ps-slate)', marginLeft: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
                    {rp.delivery_address_line_1 || (rp.patient as any)?.address_line_1}
                    {', '}
                    {rp.delivery_postcode || (rp.patient as any)?.postcode}
                  </span>
                </div>
                <span className={`ps-badge ${PATIENT_STATUS_BADGE[rp.status]?.cls}`}>
                  {PATIENT_STATUS_BADGE[rp.status]?.label}
                </span>
              </div>

              {/* Medications */}
              {rp.medications && rp.medications.length > 0 && (
                <div style={{ marginTop: 'var(--ps-space-sm)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {rp.medications.map((dm) => (
                    <span key={dm.id} style={{ background: 'var(--ps-off-white)', padding: '2px 8px', borderRadius: 'var(--ps-radius-sm)', fontSize: 'var(--ps-font-xs)' }}>
                      {(dm.patient_medication as any)?.drug_name ?? 'Unknown'} ×{dm.quantity ?? '—'}{dm.notes ? ` · ${dm.notes}` : ''}
                    </span>
                  ))}
                </div>
              )}

              {rp.notes && (
                <div style={{ marginTop: 4, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                  📝 {rp.notes}
                </div>
              )}

              {rp.failure_reason && (
                <div style={{ marginTop: 4, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-red)' }}>
                  ⚠️ {rp.failure_reason}
                </div>
              )}

              {rp.delivered_at && (
                <div style={{ marginTop: 4, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-green)' }}>
                  ✓ Delivered at {formatDatetime(rp.delivered_at)}
                </div>
              )}

              {rp.signature_data && (
                <div style={{ marginTop: 4, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                  ✍️ Signature captured
                </div>
              )}
            </div>
          ))}
      </div>

      {patients.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          No patients in this round yet.
        </div>
      )}

      {/* Timeline */}
      <h2 style={{ marginTop: 'var(--ps-space-xl)', marginBottom: 'var(--ps-space-md)' }}>Timeline</h2>
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
        <div style={{ fontSize: 'var(--ps-font-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-xs)' }}>
          <div>📋 Created: {formatDatetime(round.created_at)}</div>
          {round.started_at && <div>🚀 Started: {formatDatetime(round.started_at)}</div>}
          {round.completed_at && <div>✅ Completed: {formatDatetime(round.completed_at)}</div>}
        </div>
      </div>
    </div>
  )
}
