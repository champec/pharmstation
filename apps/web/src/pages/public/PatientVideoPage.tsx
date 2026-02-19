import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'

type PageState = 'code_entry' | 'joining' | 'in_call' | 'ended' | 'error'

interface VerifyResult {
  valid: boolean
  reason?: string
  room_url?: string
  patient_token?: string
  patient_name?: string
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export function PatientVideoPage() {
  const { consultationId } = useParams<{ consultationId: string }>()
  const containerRef = useRef<HTMLDivElement>(null)
  const callFrameRef = useRef<any>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const [pageState, setPageState] = useState<PageState>('code_entry')
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [patientName, setPatientName] = useState('')

  /* ---- OTP-style digit input ---- */
  const handleDigitChange = (index: number, value: string) => {
    // Only allow single numeric digit
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all 6 filled
    if (digit && index === 5 && next.every((d) => d !== '')) {
      handleVerify(next.join(''))
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 0) return
    const next = [...digits]
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i]
    }
    setDigits(next)

    // Focus the next empty, or last
    const focusIdx = Math.min(pasted.length, 5)
    inputRefs.current[focusIdx]?.focus()

    // Auto-submit if all 6 filled
    if (next.every((d) => d !== '')) {
      handleVerify(next.join(''))
    }
  }

  /* ---- Verify access code ---- */
  const handleVerify = useCallback(async (code?: string) => {
    const accessCode = code || digits.join('')
    if (accessCode.length !== 6 || !consultationId) return

    setVerifying(true)
    setErrorMsg(null)

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'verify_access_code',
          consultation_id: consultationId,
          access_code: accessCode,
        }),
      })

      const result: VerifyResult = await res.json()

      if (result.valid && result.room_url && result.patient_token) {
        setPatientName(result.patient_name || 'Patient')
        joinCall(result.room_url, result.patient_token, result.patient_name || 'Patient')
      } else {
        switch (result.reason) {
          case 'not_found':
            setErrorMsg('Consultation not found. Please check your link.')
            break
          case 'too_many_attempts':
            setErrorMsg('Too many attempts. Please contact your pharmacy.')
            setPageState('error')
            break
          case 'consultation_ended':
            setErrorMsg('This consultation has ended.')
            setPageState('ended')
            break
          case 'invalid_code':
            setErrorMsg('Invalid code. Please try again.')
            setDigits(['', '', '', '', '', ''])
            inputRefs.current[0]?.focus()
            break
          default:
            setErrorMsg('Something went wrong. Please try again.')
        }
      }
    } catch {
      setErrorMsg('Unable to connect. Please check your internet connection.')
    }

    setVerifying(false)
  }, [digits, consultationId])

  /* ---- Join Daily Prebuilt call ---- */
  const joinCall = async (roomUrl: string, token: string, name: string) => {
    setPageState('joining')
    try {
      // Wait for container to render
      await new Promise((resolve) => setTimeout(resolve, 100))

      const Daily = (await import('@daily-co/daily-js')).default

      if (!containerRef.current) {
        setPageState('error')
        setErrorMsg('Unable to load video. Please refresh the page.')
        return
      }

      const callFrame = Daily.createFrame(containerRef.current, {
        iframeStyle: {
          width: '100%',
          height: '100%',
          border: '0',
        },
        showLeaveButton: true,
        showFullscreenButton: true,
      })

      callFrame.on('joined-meeting', () => {
        setPageState('in_call')
      })

      callFrame.on('left-meeting', () => {
        if (callFrameRef.current) {
          try { callFrameRef.current.destroy() } catch {}
          callFrameRef.current = null
        }
        setPageState('ended')
      })

      callFrame.on('error', () => {
        setPageState('error')
        setErrorMsg('Video call error. Please refresh and try again.')
      })

      await callFrame.join({
        url: roomUrl,
        token,
        userName: name,
      })

      callFrameRef.current = callFrame
    } catch {
      setPageState('error')
      setErrorMsg('Failed to join video call. Please refresh and try again.')
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (callFrameRef.current) {
        try { callFrameRef.current.destroy() } catch {}
        callFrameRef.current = null
      }
    }
  }, [])

  /* ---- Code entry screen ---- */
  if (pageState === 'code_entry') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--ps-off-white) 0%, var(--ps-white) 100%)',
        padding: 'var(--ps-space-lg)',
      }}>
        <div style={{
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
        }}>
          {/* Logo */}
          <div style={{ marginBottom: 'var(--ps-space-xl)', fontSize: 'var(--ps-font-xl)', fontWeight: 700, color: 'var(--ps-deep-blue)' }}>
            Pharm<span style={{ color: 'var(--ps-electric-cyan)' }}>Station</span>
          </div>

          <h1 style={{
            fontSize: 'var(--ps-font-2xl)',
            fontWeight: 700,
            color: 'var(--ps-midnight)',
            marginBottom: 'var(--ps-space-sm)',
          }}>
            Join Your Video Consultation
          </h1>

          <p style={{
            color: 'var(--ps-slate)',
            fontSize: 'var(--ps-font-base)',
            marginBottom: 'var(--ps-space-xl)',
            lineHeight: 1.6,
          }}>
            Enter the 6-digit code you received from your pharmacy.
          </p>

          {/* 6-digit OTP input */}
          <div style={{
            display: 'flex',
            gap: 'var(--ps-space-sm)',
            justifyContent: 'center',
            marginBottom: 'var(--ps-space-lg)',
          }}
            onPaste={handlePaste}
          >
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]"
                maxLength={1}
                value={d}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                autoFocus={i === 0}
                style={{
                  width: '56px',
                  height: '64px',
                  textAlign: 'center',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  fontFamily: 'var(--ps-font-mono)',
                  borderRadius: '12px',
                  border: d ? '2px solid var(--ps-deep-blue)' : '2px solid var(--ps-mist)',
                  background: 'var(--ps-white)',
                  color: 'var(--ps-midnight)',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ps-electric-cyan)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = d ? 'var(--ps-deep-blue)' : 'var(--ps-mist)' }}
                aria-label={`Digit ${i + 1}`}
              />
            ))}
          </div>

          {/* Error message */}
          {errorMsg && (
            <p style={{
              color: 'var(--ps-error)',
              fontSize: 'var(--ps-font-sm)',
              marginBottom: 'var(--ps-space-md)',
              fontWeight: 500,
            }}>
              {errorMsg}
            </p>
          )}

          {/* Join button */}
          <button
            className="ps-btn ps-btn-primary"
            style={{
              width: '100%',
              padding: 'var(--ps-space-md)',
              fontSize: 'var(--ps-font-lg)',
              borderRadius: '12px',
            }}
            disabled={digits.some((d) => d === '') || verifying}
            onClick={() => handleVerify()}
          >
            {verifying ? 'Verifying...' : 'Join Call'}
          </button>

          <p style={{
            color: 'var(--ps-mist)',
            fontSize: 'var(--ps-font-xs)',
            marginTop: 'var(--ps-space-lg)',
          }}>
            No account needed. Your call is private and secure.
          </p>
        </div>
      </div>
    )
  }

  /* ---- Joining screen ---- */
  if (pageState === 'joining') {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#111',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          color: 'white',
        }}>
          <div className="loading-spinner" style={{ marginBottom: 'var(--ps-space-md)' }} />
          <p style={{ fontSize: 'var(--ps-font-lg)' }}>Joining your video consultation...</p>
        </div>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    )
  }

  /* ---- In-call screen ---- */
  if (pageState === 'in_call') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#111' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    )
  }

  /* ---- Call ended screen ---- */
  if (pageState === 'ended') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--ps-off-white) 0%, var(--ps-white) 100%)',
        padding: 'var(--ps-space-lg)',
      }}>
        <div style={{ maxWidth: '480px', width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--ps-space-md)' }}>✅</div>
          <h1 style={{ fontSize: 'var(--ps-font-2xl)', fontWeight: 700, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            Call Ended
          </h1>
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-base)', lineHeight: 1.6 }}>
            Your video consultation has ended. If you need to speak with the pharmacy again, please call them directly.
          </p>
          <p style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-sm)', marginTop: 'var(--ps-space-xl)' }}>
            You can close this tab now.
          </p>
        </div>
      </div>
    )
  }

  /* ---- Error screen ---- */
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--ps-off-white) 0%, var(--ps-white) 100%)',
      padding: 'var(--ps-space-lg)',
    }}>
      <div style={{ maxWidth: '480px', width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: 'var(--ps-space-md)' }}>⚠️</div>
        <h1 style={{ fontSize: 'var(--ps-font-2xl)', fontWeight: 700, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
          {errorMsg || 'Something went wrong'}
        </h1>
        <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-base)', lineHeight: 1.6 }}>
          Please contact your pharmacy for assistance.
        </p>
      </div>
    </div>
  )
}
