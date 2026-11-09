import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useAuthStore,
  useDriverStore,
  isResolvedStopStatus,
  stopAddress,
  mapsLink,
  toCanvasPoint,
  formatTimeWindow,
} from '@pharmstation/core'
import type { DeliveryRoundPatient, DeliveryMethod } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

const PATIENT_STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  pending: { cls: 'ps-badge-slate', label: 'Pending' },
  delivered: { cls: 'ps-badge-green', label: 'Delivered' },
  failed: { cls: 'ps-badge-red', label: 'Failed' },
  pending_redelivery: { cls: 'ps-badge-red', label: 'Redelivery' },
  skipped: { cls: 'ps-badge-slate', label: 'Skipped' },
  moved_to_round: { cls: 'ps-badge-blue', label: 'Moved' },
  returned: { cls: 'ps-badge-slate', label: 'Returned' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
}

const METHODS: { value: DeliveryMethod; label: string }[] = [
  { value: 'handed_to_patient', label: 'Handed to patient' },
  { value: 'handed_to_representative', label: 'Handed to someone else' },
  { value: 'left_in_safe_place', label: 'Left in a safe place' },
]

const FAIL_REASONS = [
  'No answer at door',
  'Patient not home',
  'Wrong address',
  'Patient refused delivery',
  'Access issue (gate, buzzer)',
  'Safety concern',
]

const SKIP_REASONS = [
  'Ran out of time',
  'Road or access closed',
  'Patient asked to rearrange',
  'Pharmacy asked me to skip',
]

function patientName(stop: DeliveryRoundPatient | null): string {
  const p = stop?.patient as any
  return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'patient'
}

export function DriverRoutePage() {
  const { roundId } = useParams<{ roundId: string }>()
  const navigate = useNavigate()
  const { membership } = useAuthStore()
  const {
    activeRoute: round,
    loading,
    saving,
    error,
    fetchRoundRoute,
    startRound,
    completeDelivery,
    failDelivery,
    skipDelivery,
    startLocationTracking,
    stopLocationTracking,
    subscribeToRoute,
    clearError,
  } = useDriverStore()

  const [activeStop, setActiveStop] = useState<DeliveryRoundPatient | null>(null)
  const [modal, setModal] = useState<'deliver' | 'fail' | 'skip' | null>(null)
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<DeliveryMethod>('handed_to_patient')
  const [recipientName, setRecipientName] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [hasSignature, setHasSignature] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const load = useCallback(() => {
    if (roundId) fetchRoundRoute(roundId)
  }, [roundId, fetchRoundRoute])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!roundId) return
    return subscribeToRoute(roundId)
  }, [roundId, subscribeToRoute])

  // Share live location only while this driver's round is in progress.
  const isMyRound = !!round && !!membership?.id && round.driver_id === membership.id
  useEffect(() => {
    if (round?.status === 'in_progress' && isMyRound && roundId && membership?.id) {
      startLocationTracking(roundId, membership.id)
      return () => stopLocationTracking()
    }
  }, [round?.status, isMyRound, roundId, membership?.id, startLocationTracking, stopLocationTracking])

  const handleStartRound = async () => {
    if (!roundId) return
    setStarting(true)
    try {
      await startRound(roundId)
    } catch (e: any) {
      alert(e.message)
    }
    setStarting(false)
  }

  const closeModal = () => {
    setModal(null)
    setActiveStop(null)
    setFormError(null)
  }

  const openModal = (kind: 'deliver' | 'fail' | 'skip', stop: DeliveryRoundPatient) => {
    setActiveStop(stop)
    setReason('')
    setMethod('handed_to_patient')
    setRecipientName('')
    setPhotos([])
    setHasSignature(false)
    setFormError(null)
    setModal(kind)
    if (kind === 'deliver') setTimeout(() => clearCanvas(), 50)
  }

  // ── Signature pad ──
  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    setHasSignature(false)
  }

  const getCanvasPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!
    const point = 'touches' in e ? e.touches[0] : (e as React.MouseEvent)
    return toCanvasPoint(point.clientX, point.clientY, canvas.getBoundingClientRect(), canvas)
  }

  const handleDrawStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    isDrawing.current = true
    lastPos.current = getCanvasPos(e)
  }

  const handleDrawMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    const pos = getCanvasPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.stroke()
    lastPos.current = pos
    if (!hasSignature) setHasSignature(true)
  }

  const handleDrawEnd = () => { isDrawing.current = false }

  // ── Outcomes ──
  const handleConfirmDelivery = async () => {
    if (!activeStop) return
    const handedOver = method !== 'left_in_safe_place'
    if (handedOver && !hasSignature && !recipientName.trim()) {
      setFormError('Ask the person to sign, or type the name of the person who took it.')
      return
    }
    if (method === 'handed_to_representative' && !recipientName.trim()) {
      setFormError('Type the name of the person who took the delivery.')
      return
    }
    if (method === 'left_in_safe_place' && !recipientName.trim()) {
      setFormError('Describe where you left it.')
      return
    }
    try {
      await completeDelivery(activeStop.id, {
        deliveryMethod: method,
        recipientName,
        signatureData: hasSignature ? canvasRef.current?.toDataURL('image/png') : undefined,
        photos,
      })
      closeModal()
    } catch (e: any) {
      setFormError(e.message)
    }
  }

  const handleConfirmReason = async () => {
    if (!activeStop || !reason.trim()) return
    try {
      if (modal === 'fail') await failDelivery(activeStop.id, reason)
      else await skipDelivery(activeStop.id, reason)
      closeModal()
    } catch (e: any) {
      setFormError(e.message)
    }
  }

  if (loading && !round) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading route…</div>
  }

  if (!round) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Round not found</div>
  }

  const patients = round.patients || []
  const deliveredCount = patients.filter((p) => p.status === 'delivered').length
  const resolvedCount = patients.filter((p) => isResolvedStopStatus(p.status)).length
  const progressPct = patients.length ? Math.round((resolvedCount / patients.length) * 100) : 0
  const window = formatTimeWindow(round.scheduled_time_start, round.scheduled_time_end)

  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs">
          <a href="/driver" onClick={(e) => { e.preventDefault(); navigate('/driver') }}>My Deliveries</a>
          <span className="separator">/</span>
          <span>{round.title || 'Delivery Route'}</span>
        </div>
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">Delivery route</p>
            <h1>{round.title || 'Delivery route'}</h1>
            {window && <p className="care-home-subtitle">{window}</p>}
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>✕</button>
        </div>
      )}

      {/* Progress */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--ps-space-xs)', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>Progress</span>
          <span style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
            {deliveredCount} delivered · {resolvedCount}/{patients.length} done
          </span>
        </div>
        <div style={{ height: 8, background: 'var(--ps-off-white)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--ps-deep-blue)', borderRadius: 4, transition: 'width 0.3s ease' }} />
        </div>

        {round.status === 'scheduled' && isMyRound && (
          <button
            className="ps-btn ps-btn-primary"
            onClick={handleStartRound}
            disabled={starting}
            style={{ marginTop: 'var(--ps-space-sm)', width: '100%' }}
          >
            {starting ? 'Starting…' : 'Start deliveries'}
          </button>
        )}
        {round.status === 'draft' && (
          <p style={{ marginTop: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            The pharmacy hasn't scheduled this round yet.
          </p>
        )}
        {round.status === 'in_progress' && isMyRound && (
          <p style={{ marginTop: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>
            Your location is shared with the pharmacy until the round is finished.
          </p>
        )}
        {round.status === 'completed' && (
          <div style={{ textAlign: 'center', marginTop: 'var(--ps-space-sm)', color: 'var(--ps-success)', fontWeight: 600 }}>
            Round complete
          </div>
        )}
      </div>

      {/* Stops */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
        {patients.map((p) => {
          const pat = p.patient as any
          const badge = PATIENT_STATUS_BADGE[p.status] || PATIENT_STATUS_BADGE.pending
          const resolved = isResolvedStopStatus(p.status)
          const address = stopAddress(p)

          return (
            <div
              key={p.id}
              className="ps-card"
              style={{
                padding: 'var(--ps-space-md)',
                opacity: resolved ? 0.6 : 1,
                borderLeft: p.status === 'delivered' ? '4px solid var(--ps-success)' : ['pending_redelivery', 'failed'].includes(p.status) ? '4px solid var(--ps-error)' : '4px solid transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--ps-space-sm)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--ps-deep-blue)' }}>{p.delivery_order}</span>
                    <span style={{ fontWeight: 600 }}>{pat?.first_name} {pat?.last_name}</span>
                    <span className={`ps-badge ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', overflowWrap: 'anywhere' }}>
                    {address || 'No address recorded'}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-md)', flexWrap: 'wrap', marginTop: 2, fontSize: 'var(--ps-font-sm)' }}>
                    {address && (
                      <a href={mapsLink(address)} target="_blank" rel="noreferrer" style={{ color: 'var(--ps-deep-blue)' }}>Directions</a>
                    )}
                    {pat?.phone && (
                      <a href={`tel:${pat.phone}`} style={{ color: 'var(--ps-deep-blue)' }}>{pat.phone}</a>
                    )}
                  </div>
                  {p.notes && (
                    <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4, fontStyle: 'italic' }}>{p.notes}</div>
                  )}
                </div>
                {p.signature_data && <span className="ps-badge ps-badge-success" title="Signature collected">Signed</span>}
              </div>

              {p.medications && p.medications.length > 0 && (
                <div style={{ marginTop: 'var(--ps-space-xs)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {p.medications.map((m) => (
                    <span key={m.id} className="ps-badge ps-badge-slate" style={{ fontSize: 'var(--ps-font-xs)' }}>
                      {(m.patient_medication as any)?.drug_name || 'Medication'}{m.quantity ? ` × ${m.quantity}` : ''}
                    </span>
                  ))}
                </div>
              )}

              {p.failure_reason && (
                <div style={{ marginTop: 'var(--ps-space-xs)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-error)' }}>
                  Reason: {p.failure_reason}
                </div>
              )}

              {round.status === 'in_progress' && isMyRound && !resolved && (
                <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
                  <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => openModal('deliver', p)} disabled={saving}>
                    Delivered
                  </button>
                  <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => openModal('fail', p)} disabled={saving} style={{ color: 'var(--ps-error)' }}>
                    Couldn't deliver
                  </button>
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => openModal('skip', p)} disabled={saving}>
                    Skip
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

      {/* Deliver */}
      <Modal isOpen={modal === 'deliver'} onClose={closeModal} title={`Deliver to ${patientName(activeStop)}`} width="440px">
        <div>
          <div className="form-group">
            <label>How was it delivered? *</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {METHODS.map((m) => (
                <label key={m.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                  <input type="radio" name="delivery-method" checked={method === m.value} onChange={() => setMethod(m.value)} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>
              {method === 'left_in_safe_place' ? 'Where did you leave it? *' : method === 'handed_to_representative' ? 'Name of the person who took it *' : 'Name of the person who took it'}
            </label>
            <input
              className="ps-input"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder={method === 'left_in_safe_place' ? 'e.g. Behind the side gate, as agreed' : 'e.g. Jane Smith (daughter)'}
            />
          </div>

          {method !== 'left_in_safe_place' && (
            <>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Signature</label>
              <div style={{ border: '2px solid var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-xs)', touchAction: 'none' }}>
                <canvas
                  ref={canvasRef}
                  width={760}
                  height={320}
                  style={{ display: 'block', width: '100%', height: 160, cursor: 'crosshair' }}
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
                Clear signature
              </button>
            </>
          )}

          <div className="form-group">
            <label>Photo (optional)</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 3))}
            />
            {photos.length > 0 && (
              <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4 }}>{photos.length} photo{photos.length === 1 ? '' : 's'} attached</div>
            )}
          </div>

          {formError && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-sm)' }}>{formError}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={closeModal}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleConfirmDelivery} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm delivery'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Couldn't deliver / Skip */}
      <Modal
        isOpen={modal === 'fail' || modal === 'skip'}
        onClose={closeModal}
        title={`${modal === 'skip' ? 'Skip' : "Couldn't deliver"} — ${patientName(activeStop)}`}
        width="420px"
      >
        <div>
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-sm)' }}>
            The pharmacy will see this in the redelivery queue.
          </p>
          <div className="form-group">
            <label>Reason *</label>
            <select className="ps-input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select reason…</option>
              {(modal === 'skip' ? SKIP_REASONS : FAIL_REASONS).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {formError && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-sm)' }}>{formError}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={closeModal}>Cancel</button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={handleConfirmReason}
              disabled={saving || !reason.trim()}
              style={{ background: 'var(--ps-error)' }}
            >
              {saving ? 'Saving…' : modal === 'skip' ? 'Skip stop' : 'Confirm'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
