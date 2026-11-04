// ============================================
// IdleLock — signs the staff member out of a shared counter computer
// after a period without activity. The pharmacy stays signed in, so the
// next person just picks their name and enters their password.
//
// The limit is per pharmacy (organisation.settings.idle_lock_minutes,
// default 15, 0 = off). Activity is shared across tabs through
// localStorage, so a second open tab doesn't sign someone out early.
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { Modal } from './Modal'

export const DEFAULT_IDLE_LOCK_MINUTES = 15
export const IDLE_SIGNOUT_FLAG = 'ps-idle-signout'
const LAST_ACTIVITY_KEY = 'ps-last-activity'
const WARNING_SECONDS = 60
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

export function idleLockMinutes(settings: Record<string, unknown> | null | undefined): number {
  const value = settings?.idle_lock_minutes
  return typeof value === 'number' && value >= 0 ? value : DEFAULT_IDLE_LOCK_MINUTES
}

function readLastActivity(): number {
  try {
    return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || 0
  } catch {
    return 0
  }
}

function writeLastActivity(at: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at))
  } catch {
    // Storage blocked: this tab still tracks activity in memory.
  }
}

export function IdleLock() {
  const organisation = useAuthStore((s) => s.organisation)
  const isUserLoggedIn = useAuthStore((s) => s.isUserLoggedIn)
  const switchUser = useAuthStore((s) => s.switchUser)
  const signInTime = useAuthStore((s) => s.userSession?.user?.last_sign_in_at)
  const minutes = idleLockMinutes(organisation?.settings)
  const limitMs = minutes * 60_000

  const lastActivity = useRef(Date.now())
  const lastWrite = useRef(0)
  const signingOut = useRef(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const markActive = useCallback(() => {
    const now = Date.now()
    lastActivity.current = now
    // Writing on every mouse move is wasteful; every few seconds is enough.
    if (now - lastWrite.current > 5_000) {
      lastWrite.current = now
      writeLastActivity(now)
    }
  }, [])

  const signOut = useCallback(async () => {
    if (signingOut.current) return
    signingOut.current = true
    try {
      sessionStorage.setItem(IDLE_SIGNOUT_FLAG, String(minutes))
    } catch {
      // The notice on the sign-in page is a nicety only.
    }
    await switchUser('idle')
  }, [minutes, switchUser])

  useEffect(() => {
    if (!isUserLoggedIn || limitMs <= 0) return
    signingOut.current = false

    // A computer that slept past the limit signs out as soon as it wakes,
    // unless the person has only just signed in.
    const stored = readLastActivity()
    const signedInAt = Date.parse(signInTime ?? '') || 0
    if (Date.now() - stored >= limitMs && stored > 0 && signedInAt < stored) {
      void signOut()
      return
    }
    markActive()

    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, markActive, { passive: true }))

    const tick = window.setInterval(() => {
      const last = Math.max(lastActivity.current, readLastActivity())
      const idleMs = Date.now() - last
      if (idleMs >= limitMs) {
        setSecondsLeft(null)
        void signOut()
      } else if (idleMs >= limitMs - WARNING_SECONDS * 1000) {
        setSecondsLeft(Math.ceil((limitMs - idleMs) / 1000))
      } else {
        setSecondsLeft(null)
      }
    }, 1_000)

    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, markActive))
      window.clearInterval(tick)
    }
  }, [isUserLoggedIn, limitMs, markActive, signOut, signInTime])

  const stayHere = useCallback(() => {
    lastWrite.current = 0
    markActive()
    setSecondsLeft(null)
  }, [markActive])

  return (
    <Modal isOpen={secondsLeft !== null} onClose={stayHere} title="Still there?" width="420px">
      <p style={{ marginBottom: 'var(--ps-space-md)' }}>
        To keep this computer safe, you&rsquo;ll be signed out in <strong>{secondsLeft} seconds</strong>. The
        pharmacy stays signed in.
      </p>
      <button type="button" className="ps-btn ps-btn-primary" style={{ width: '100%' }} onClick={stayHere}>
        I&rsquo;m still here
      </button>
    </Modal>
  )
}
