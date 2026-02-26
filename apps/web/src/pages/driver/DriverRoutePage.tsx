import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useDriverStore } from '@pharmstation/core'
import type { DeliveryRoundPatient, DeliveryPatientStatus } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

const PATIENT_STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  pending: { cls: 'ps-badge-slate', label: 'Pending' },
  in_transit: { cls: 'ps-badge-blue', label: 'In Transit' },
  arrived: { cls: 'ps-badge-amber', label: 'Arrived' },
  delivered: { cls: 'ps-badge-green', label: 'Delivered' },
  failed: { cls: 'ps-badge-red', label: 'Failed' },
  pending_redelivery: { cls: 'ps-badge-red', label: 'Redelivery' },
  skipped: { cls: 'ps-badge-slate', label: 'Skipped' },
  moved_to_round: { cls: 'ps-badge-blue', label: 'Moved' },
  returned: { cls: 'ps-badge-slate', label: 'Returned' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
}

function isResolved(status: string): boolean {
  return ['delivered', 'failed', 'pending_redelivery', 'skipped', 'moved_to_round', 'returned', 'cancelled'].includes(status)
}

export function DriverRoutePage() {
  const { roundId } = useParams<{ roundId: string }>()
  const navigate = useNavigate()
  const { membership } = useAuthStore()
  const {
    activeRoute: round,
    loading,
    error,
    fetchRoundRoute,
    startRound,
    updatePatientStatus,
    submitSignature,
    startLocationTracking,
    stopLocationTracking,
    subscribeToRoute,
    clearError,
  } = useDriverStore()

  const [activePatient, setActivePatient] = useState<DeliveryRoundPatient | null>(null)
  const [showDeliverModal, setShowDeliverModal] = useState(false)
  const [showFailModal, setShowFailModal] = useState(false)
  const [failureReason, setFailureReason] = useState('')
  const [processing, setProcessing] = useState(false)

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const load = useCallback(() => {
    if (roundId) fetchRoundRoute(roundId)
  }, [roundId, fetchRoundRoute])

  useEffect(() => { load() }, [load])

  // Subscribe to realtime updates
  useEffect(() => {
    if (!roundId) return
    const unsub = subscribeToRoute(roundId)
    return unsub
  }, [roundId, subscribeToRoute])

  // Start location tracking when round is in progress
  useEffect(() => {
    if (round?.status === 'in_progress' && roundId && membership?.id) {
      startLocationTracking(roundId, membership.id)
      return () => stopLocationTracking()
    }
  }, [round?.status, roundId, membership?.id, startLocationTracking, stopLocationTracking])

  const handleStartRound = async () => {
    if (!roundId) return
    setProcessing(true)
    try {
      await startRound(roundId)
    } catch (e: any) {
      alert(e.message)
    }
    setProcessing(false)
  }

  const openDeliverModal = (patient: DeliveryRoundPatient) => {
    setActivePatient(patient)
    setShowDeliverModal(true)
    // Reset canvas on next tick
    setTimeout(() => clearCanvas(), 50)
  }

  const openFailModal = (patient: DeliveryRoundPatient) => {
    setActivePatient(patient)
    setFailureReason('')
    setShowFailModal(true)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
  }

  const getCanvasPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const handleDrawStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    isDrawing.current = true
    lastPos.current = getCanvasPos(e)
  }

  const handleDrawMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing.current) return
    e.preventDefault()
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const pos = getCanvasPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.stroke()
    lastPos.current = pos
  }

  const handleDrawEnd = () => { isDrawing.current = false }

  const getSignatureData = (): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return canvas.toDataURL('image/png')
  }

  const handleConfirmDelivery = async () => {
    if (!activePatient) return
    setProcessing(true)
    try {
      const sigData = getSignatureData() || undefined
      await updatePatientStatus(activePatient.id, 'delivered', sigData)
      setShowDeliverModal(false)
      setActivePatient(null)
    } catch (e: any) {
      alert(e.message)
    }
    setProcessing(false)
  }

  const handleConfirmFailed = async () => {
    if (!activePatient || !failureReason.trim()) return
    setProcessing(true)
    try {
      await updatePatientStatus(activePatient.id, 'failed', undefined, failureReason.trim())
      setShowFailModal(false)
      setActivePatient(null)
    } catch (e: any) {
      alert(e.message)
    }
    setProcessing(false)
  }

  const handleSkip = async (patient: DeliveryRoundPatient) => {
    if (!confirm(`Skip delivery for ${(patient.patient as any)?.first_name} ${(patient.patient as any)?.last_name}?`)) return
    setProcessing(true)
    try {
      await updatePatientStatus(patient.id, 'skipped')
    } catch (e: any) {
      alert(e.message)
    }
    setProcessing(false)
  }

  if (loading && !round) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading route…</div>
  }

  if (!round) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Round not found</div>
  }

  const patients = round.patients || []
  const deliveredCount = patients.filter((p) => p.status === 'delivered').length
  const resolvedCount = patients.filter((p) => isResolved(p.status)).length
  const progressPct = patients.length ? Math.round((resolvedCount / patients.length) * 100) : 0

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/driver" onClick={(e) => { e.preventDefault(); navigate('/driver') }}>My Deliveries</a>
          <span className="separator">/</span>
          <span>{round.title || 'Delivery Route'}</span>
        </div>
        <h1>🗺️ {round.title || 'Delivery Route'}</h1>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      {/* Progress bar */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--ps-space-xs)' }}>
          <span style={{ fontWeight: 600 }}>Progress</span>
          <span style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
            {deliveredCount} delivered · {resolvedCount}/{patients.length} resolved
          </span>
        </div>
        <div style={{ height: 8, background: 'var(--ps-off-white)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--ps-primary)', borderRadius: 4, transition: 'width 0.3s ease' }} />
        </div>

        {round.status === 'scheduled' && (
          <button
            className="ps-btn ps-btn-primary"
            onClick={handleStartRound}
            disabled={processing}
            style={{ marginTop: 'var(--ps-space-sm)', width: '100%' }}
          >
            {processing ? 'Starting…' : '🚀 Start Deliveries'}
          </button>
        )}

        {round.status === 'completed' && (
          <div style={{ textAlign: 'center', marginTop: 'var(--ps-space-sm)', color: 'var(--ps-green)', fontWeight: 600 }}>
            ✅ Round Complete
          </div>
        )}
      </div>

      {/* Patient list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
        {patients.map((p, idx) => {
          const pat = p.patient as any
          const badge = PATIENT_STATUS_BADGE[p.status] || PATIENT_STATUS_BADGE.pending
          const resolved = isResolved(p.status)

          return (
            <div
              key={p.id}
              className="ps-card"
              style={{
                padding: 'var(--ps-space-md)',
                opacity: resolved ? 0.6 : 1,
                borderLeft: p.status === 'delivered' ? '4px solid var(--ps-green)' : p.status === 'pending_redelivery' || p.status === 'failed' ? '4px solid var(--ps-red)' : '4px solid transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--ps-primary)' }}>{p.delivery_order}</span>
                    <span style={{ fontWeight: 600 }}>{pat?.first_name} {pat?.last_name}</span>
                    <span className={`ps-badge ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                    📍 {pat?.address_line_1}{pat?.address_line_2 ? `, ${pat.address_line_2}` : ''}, {pat?.postcode}
                  </div>
                  {pat?.phone && (
                    <div style={{ fontSize: 'var(--ps-font-sm)', marginTop: 2 }}>
                      <a href={`tel:${pat.phone}`} style={{ color: 'var(--ps-primary)' }}>📞 {pat.phone}</a>
                    </div>
                  )}
                </div>
                {p.signature_data && <span title="Signature collected" style={{ fontSize: '1.2rem' }}>✍️</span>}
              </div>

              {/* Medications */}
              {p.medications && p.medications.length > 0 && (
                <div style={{ marginTop: 'var(--ps-space-xs)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {p.medications.map((m) => (
                    <span key={m.id} className="ps-badge ps-badge-slate" style={{ fontSize: 'var(--ps-font-xs)' }}>
                      {(m.patient_medication as any)?.drug_name || 'Medication'} × {m.quantity}
                    </span>
                  ))}
                </div>
              )}

              {/* Failure reason */}
              {p.failure_reason && (
                <div style={{ marginTop: 'var(--ps-space-xs)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-red)' }}>
                  ⚠️ {p.failure_reason}
                </div>
              )}

              {/* Actions — only for in-progress rounds and unresolved patients */}
              {round.status === 'in_progress' && !resolved && (
                <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-sm)' }}>
                  <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => openDeliverModal(p)} disabled={processing}>
                    ✅ Delivered
                  </button>
                  <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => openFailModal(p)} disabled={processing} style={{ color: 'var(--ps-red)' }}>
                    ❌ Failed
                  </button>
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => handleSkip(p)} disabled={processing}>
                    ⏭️ Skip
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {patients.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          No patients in this round.
        </div>
      )}

      {/* Deliver Modal — with signature capture */}
      <Modal
        isOpen={showDeliverModal}
        onClose={() => { setShowDeliverModal(false); setActivePatient(null) }}
        title={`Deliver to ${(activePatient?.patient as any)?.first_name} ${(activePatient?.patient as any)?.last_name}`}
        width="420px"
      >
        <div>
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-sm)' }}>
            Collect a signature from the patient to confirm delivery.
          </p>

          <div style={{ border: '2px solid var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-sm)', touchAction: 'none' }}>
            <canvas
              ref={canvasRef}
              width={376}
              height={160}
              style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
              onMouseDown={handleDrawStart}
              onMouseMove={handleDrawMove}
              onMouseUp={handleDrawEnd}
              onMouseLeave={handleDrawEnd}
              onTouchStart={handleDrawStart}
              onTouchMove={handleDrawMove}
              onTouchEnd={handleDrawEnd}
            />
          </div>

          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearCanvas} style={{ marginBottom: 'var(--ps-space-md)' }}>
            Clear Signature
          </button>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => { setShowDeliverModal(false); setActivePatient(null) }}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleConfirmDelivery} disabled={processing}>
              {processing ? 'Saving…' : 'Confirm Delivery'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Failed Delivery Modal */}
      <Modal
        isOpen={showFailModal}
        onClose={() => { setShowFailModal(false); setActivePatient(null) }}
        title={`Failed Delivery — ${(activePatient?.patient as any)?.first_name} ${(activePatient?.patient as any)?.last_name}`}
        width="420px"
      >
        <div>
          <div className="form-group">
            <label>Reason for failed delivery *</label>
            <select className="ps-input" value={failureReason} onChange={(e) => setFailureReason(e.target.value)} style={{ marginBottom: 'var(--ps-space-sm)' }}>
              <option value="">Select reason...</option>
              <option value="No answer at door">No answer at door</option>
              <option value="Patient not home">Patient not home</option>
              <option value="Wrong address">Wrong address</option>
              <option value="Patient refused delivery">Patient refused delivery</option>
              <option value="Access issue (gate, buzzer)">Access issue (gate, buzzer)</option>
              <option value="Safety concern">Safety concern</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => { setShowFailModal(false); setActivePatient(null) }}>Cancel</button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={handleConfirmFailed}
              disabled={processing || !failureReason.trim()}
              style={{ background: 'var(--ps-red)' }}
            >
              {processing ? 'Saving…' : 'Confirm Failed'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
