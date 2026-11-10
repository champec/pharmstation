import { useEffect, useRef, useState } from 'react'

// Cloudflare Turnstile: a free, privacy-friendly "are you a person" check
// for the public booking form. The appointments edge function rejects a
// booking without a valid token whenever TURNSTILE_SECRET_KEY is set there.
//
// The site key is public (it ships in the page anyway), so the PharmStation
// widget's key is the default here and local runs work without a .env.
// VITE_TURNSTILE_SITE_KEY overrides it. The widget's hostname list in
// Cloudflare must include every host the page runs on (incl. localhost).

const PHARMSTATION_SITE_KEY = '0x4AAAAAAF1C-lRDsx8b3Ye5'
const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || PHARMSTATION_SITE_KEY
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
  const [failed, setFailed] = useState<string | null>(null)

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
        'error-callback': (code?: string) => {
          onToken(null)
          // 1102xx: this web address isn't on the widget's hostname list.
          setFailed(String(code ?? '').startsWith('1102')
            ? 'Online booking is not available on this web address. Please use pharmstation.co.uk or contact the pharmacy.'
            : 'The security check could not load. Please refresh the page, or contact the pharmacy to book.')
          return true
        },
      })
      if (resetRef) resetRef.current = () => { if (id) window.turnstile?.reset(id); onToken(null) }
    }).catch(() => {
      onToken(null)
      setFailed('The security check could not load. Check your connection and refresh the page, or contact the pharmacy to book.')
    })
    return () => {
      cancelled = true
      if (id) window.turnstile?.remove(id)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div ref={box} className="booking-turnstile" />
      {failed && <div className="booking-form-error" role="alert">{failed}</div>}
    </>
  )
}
