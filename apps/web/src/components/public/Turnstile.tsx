import { useEffect, useRef } from 'react'

// Cloudflare Turnstile: a free, privacy-friendly "are you a person" check
// for the public booking form. Renders nothing until VITE_TURNSTILE_SITE_KEY
// is set, so bookings keep working (with server-side rate limits only)
// before it is configured.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => { scriptPromise = null; reject(new Error('Turnstile failed to load')) }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

export const turnstileEnabled = !!SITE_KEY

/** Call `resetRef.current?.()` after a failed submit to get a fresh token. */
export function Turnstile({
  onToken,
  resetRef,
}: {
  onToken: (token: string | null) => void
  resetRef?: React.MutableRefObject<(() => void) | null>
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!SITE_KEY || !box.current) return
    let id: string | null = null
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !box.current || !window.turnstile) return
      id = window.turnstile.render(box.current, {
        sitekey: SITE_KEY,
        theme: 'light',
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      })
      if (resetRef) resetRef.current = () => { if (id) window.turnstile?.reset(id); onToken(null) }
    }).catch(() => onToken(null))
    return () => {
      cancelled = true
      if (id) window.turnstile?.remove(id)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!SITE_KEY) return null
  return <div ref={box} className="booking-turnstile" />
}
