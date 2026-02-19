import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useVideoStore } from '@pharmstation/core'
import { Modal } from '../../components/Modal'
import type DailyIframe from '@daily-co/daily-js'

export function VideoRoomPage() {
  const { consultationId } = useParams<{ consultationId: string }>()
  const navigate = useNavigate()
  const { activeConsultation, loading, error, fetchConsultation, endConsultation, getStaffToken } = useVideoStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const callFrameRef = useRef<any>(null)
  const [joined, setJoined] = useState(false)
  const [joining, setJoining] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [ending, setEnding] = useState(false)

  // Fetch consultation on mount
  useEffect(() => {
    if (consultationId) fetchConsultation(consultationId)
  }, [consultationId, fetchConsultation])

  // Join the call once consultation is loaded
  const joinCall = useCallback(async () => {
    if (!activeConsultation || !containerRef.current || callFrameRef.current || joining) return
    if (activeConsultation.status === 'completed' || activeConsultation.status === 'cancelled') return

    setJoining(true)
    try {
      // Get staff token from edge function
      const token = await getStaffToken(activeConsultation.id)

      // Dynamically import daily-js
      const Daily = (await import('@daily-co/daily-js')).default

      const callFrame = Daily.createFrame(containerRef.current, {
        iframeStyle: {
          width: '100%',
          height: '100%',
          border: '0',
          borderRadius: '12px',
        },
        showLeaveButton: true,
        showFullscreenButton: true,
      })

      callFrame.on('joined-meeting', () => {
        setJoined(true)
        setJoining(false)
      })

      callFrame.on('left-meeting', () => {
        setShowLeaveModal(true)
      })

      callFrame.on('error', (e: any) => {
        console.error('Daily error:', e)
        setJoining(false)
      })

      await callFrame.join({
        url: activeConsultation.daily_room_url,
        token,
      })

      callFrameRef.current = callFrame
    } catch (e) {
      console.error('Failed to join call:', e)
      setJoining(false)
    }
  }, [activeConsultation, joining, getStaffToken])

  useEffect(() => {
    if (activeConsultation && !callFrameRef.current) {
      joinCall()
    }
  }, [activeConsultation, joinCall])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (callFrameRef.current) {
        try { callFrameRef.current.destroy() } catch {}
        callFrameRef.current = null
      }
    }
  }, [])

  /* ---- End consultation ---- */
  const handleEndConsultation = async () => {
    if (!consultationId) return
    setEnding(true)
    try {
      await endConsultation(consultationId)
      if (callFrameRef.current) {
        try { callFrameRef.current.destroy() } catch {}
        callFrameRef.current = null
      }
      navigate('/video')
    } catch (e) {
      console.error('Failed to end consultation:', e)
      setEnding(false)
    }
  }

  const handleLeaveOnly = () => {
    setShowLeaveModal(false)
    if (callFrameRef.current) {
      try { callFrameRef.current.destroy() } catch {}
      callFrameRef.current = null
    }
    navigate('/video')
  }

  /* ---- Format date ---- */
  const fmtDateTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' at ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  // Consultation ended or cancelled
  if (activeConsultation && (activeConsultation.status === 'completed' || activeConsultation.status === 'cancelled')) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 'var(--ps-space-lg)' }}>
        <div style={{ fontSize: '3rem' }}>📹</div>
        <h2>This consultation has ended</h2>
        <p style={{ color: 'var(--ps-slate)' }}>The video consultation with {activeConsultation.patient_name} is no longer active.</p>
        <button className="ps-btn ps-btn-primary" onClick={() => navigate('/video')}>
          ← Back to Video Consultations
        </button>
      </div>
    )
  }

  if (loading || !activeConsultation) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="loading-spinner" />
        <p style={{ marginLeft: 'var(--ps-space-md)' }}>Loading consultation...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 'var(--ps-space-md)' }}>
        <p style={{ color: 'var(--ps-error)' }}>{error}</p>
        <button className="ps-btn ps-btn-primary" onClick={() => navigate('/video')}>← Back</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--ps-space-sm) var(--ps-space-md)',
        borderBottom: '1px solid var(--ps-off-white)',
        background: 'var(--ps-white)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/video')} style={{ padding: '4px 8px' }}>
            ← Back
          </button>
          <div>
            <span style={{ fontWeight: 600 }}>{activeConsultation.patient_name}</span>
            {activeConsultation.patient_phone && (
              <span style={{ color: 'var(--ps-slate)', marginLeft: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
                {activeConsultation.patient_phone}
              </span>
            )}
            <span style={{ color: 'var(--ps-mist)', marginLeft: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
              · {fmtDateTime(activeConsultation.scheduled_for)}
            </span>
          </div>
        </div>

        <button
          className="ps-btn ps-btn-danger"
          onClick={handleEndConsultation}
          disabled={ending}
        >
          {ending ? 'Ending...' : '⏹ End Consultation'}
        </button>
      </div>

      {/* Video container */}
      <div style={{ flex: 1, position: 'relative', background: '#111' }}>
        {joining && !joined && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
          }}>
            <div className="loading-spinner" style={{ marginRight: 'var(--ps-space-md)' }} />
            <p>Joining video call...</p>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Leave modal — shown when staff clicks Daily's leave button */}
      <Modal isOpen={showLeaveModal} onClose={() => setShowLeaveModal(false)} title="Left Meeting" width="480px">
        <p>You have left the video call. Would you like to end the consultation for everyone?</p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end', marginTop: 'var(--ps-space-lg)' }}>
          <button className="ps-btn ps-btn-secondary" onClick={handleLeaveOnly}>
            Just Leave
          </button>
          <button className="ps-btn ps-btn-danger" onClick={handleEndConsultation} disabled={ending}>
            {ending ? 'Ending...' : 'End for All'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
