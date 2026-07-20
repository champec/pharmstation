import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore } from '@pharmstation/core'
import type { DeliveryRoundPatient } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

export function RedeliveryQueuePage() {
  const navigate = useNavigate()
  const { organisation, membership } = useAuthStore()
  const {
    redeliveryQueue,
    rounds,
    loading,
    error,
    fetchRedeliveryQueue,
    fetchRounds,
    movePatientToRound,
    createRedeliveryRound,
    markReturned,
    cancelRedelivery,
    clearError,
  } = useDeliveryRoundStore()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [movingPatientId, setMovingPatientId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (!organisation?.id) return
    fetchRedeliveryQueue(organisation.id)
    fetchRounds(organisation.id)
  }, [organisation?.id, fetchRedeliveryQueue, fetchRounds])

  useEffect(() => { load() }, [load])

  const draftOrScheduledRounds = rounds.filter((r) => ['draft', 'scheduled'].includes(r.status))

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleMoveToRound = async () => {
    if (!movingPatientId || !moveTargetId || !organisation?.id) return
    setSaving(true)
    try {
      await movePatientToRound(movingPatientId, moveTargetId, organisation.id)
      setShowMoveModal(false)
      setMovingPatientId(null)
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleCreateRedeliveryRound = async () => {
    if (!organisation?.id || !membership?.user_id || selectedIds.length === 0) return
    setSaving(true)
    try {
      const round = await createRedeliveryRound(organisation.id, membership.user_id, selectedIds)
      setSelectedIds([])
      navigate(`/deliveries/${round.id}`)
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleReturned = async (rpId: string) => {
    if (!confirm('Mark medications as returned to pharmacy?')) return
    setSaving(true)
    try { await markReturned(rpId) } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  const handleCancel = async (rpId: string) => {
    if (!confirm('Cancel redelivery for this patient?')) return
    setSaving(true)
    try { await cancelRedelivery(rpId) } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  const formatDatetime = (d: string) =>
    new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/deliveries" onClick={(e) => { e.preventDefault(); navigate('/deliveries') }}>Deliveries</a>
          <span className="separator">/</span>
          <span>Redelivery Queue</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>⚠️ Redelivery Queue</h1>
          {selectedIds.length > 0 && (
            <button className="ps-btn ps-btn-primary" onClick={handleCreateRedeliveryRound} disabled={saving}>
              Create Redelivery Round ({selectedIds.length} patient{selectedIds.length !== 1 ? 's' : ''})
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {loading && redeliveryQueue.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading…</div>
      )}

      {!loading && redeliveryQueue.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>✅</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>Queue is empty</h2>
          <p style={{ color: 'var(--ps-slate)' }}>No failed deliveries awaiting redelivery.</p>
        </div>
      )}

      {redeliveryQueue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
          {redeliveryQueue.map((rp) => (
            <div key={rp.id} className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(rp.id)}
                  onChange={() => toggleSelect(rp.id)}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {(rp.patient as any)?.first_name} {(rp.patient as any)?.last_name}
                  </div>
                  <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                    {rp.delivery_address_line_1 || (rp.patient as any)?.address_line_1}
                    {rp.delivery_postcode || (rp.patient as any)?.postcode ? `, ${rp.delivery_postcode || (rp.patient as any)?.postcode}` : ''}
                  </div>
                  {rp.failure_reason && (
                    <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-red)', marginTop: 2 }}>
                      Reason: {rp.failure_reason}
                    </div>
                  )}
                  {rp.medications && rp.medications.length > 0 && (
                    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {rp.medications.map((dm) => (
                        <span key={dm.id} style={{ background: 'var(--ps-off-white)', padding: '2px 8px', borderRadius: 'var(--ps-radius-sm)', fontSize: 'var(--ps-font-xs)' }}>
                          {(dm.patient_medication as any)?.drug_name ?? 'Unknown'} ×{dm.quantity ?? '—'}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4 }}>
                    Failed: {formatDatetime(rp.updated_at)}
                    {(rp as any).round && <> · From: {(rp as any).round.title || (rp as any).round.id.slice(0, 8)}</>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', flexWrap: 'wrap' }}>
                  <button
                    className="ps-btn ps-btn-secondary ps-btn-sm"
                    onClick={() => { setMovingPatientId(rp.id); setShowMoveModal(true) }}
                    disabled={saving}
                  >
                    Move to Round
                  </button>
                  <button
                    className="ps-btn ps-btn-ghost ps-btn-sm"
                    onClick={() => handleReturned(rp.id)}
                    disabled={saving}
                  >
                    Returned
                  </button>
                  <button
                    className="ps-btn ps-btn-ghost ps-btn-sm"
                    onClick={() => handleCancel(rp.id)}
                    disabled={saving}
                    style={{ color: 'var(--ps-red)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Move to Round Modal */}
      <Modal isOpen={showMoveModal} onClose={() => setShowMoveModal(false)} title="Move to Round" width="480px">
        <div>
          <div className="form-group">
            <label>Select an existing round:</label>
            <select className="ps-input" value={moveTargetId} onChange={(e) => setMoveTargetId(e.target.value)}>
              <option value="">— Select Round —</option>
              {draftOrScheduledRounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title || r.id.slice(0, 8)} ({r.status}) — {r.scheduled_date || 'No date'}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowMoveModal(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleMoveToRound} disabled={saving || !moveTargetId}>
              {saving ? 'Moving…' : 'Move Patient'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
