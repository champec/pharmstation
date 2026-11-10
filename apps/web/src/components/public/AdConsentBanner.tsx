import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { adsEnabled, consentChoice, initAdTracking, setAdConsent } from '../../lib/adTracking'

// Patient-facing pages only: staff screens never load ad tags.
const PUBLIC_PREFIXES = ['/pharmacies', '/book', '/booking', '/shop', '/maps']

function isPatientPage(path: string) {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

/** Consent banner for ad measurement. Renders nothing unless VITE_GOOGLE_ADS_ID is set. */
export function AdConsentBanner() {
  const { pathname } = useLocation()
  const [choice, setChoice] = useState(consentChoice)
  const onPatientPage = isPatientPage(pathname)

  useEffect(() => {
    if (onPatientPage) initAdTracking()
  }, [onPatientPage])

  if (!adsEnabled() || !onPatientPage || choice) return null

  const decide = (c: 'granted' | 'denied') => { setAdConsent(c); setChoice(c) }

  return (
    <div
      role="region"
      aria-label="Cookie choice"
      style={{
        position: 'fixed', left: 'var(--ps-space-md)', right: 'var(--ps-space-md)', bottom: 'var(--ps-space-md)',
        zIndex: 1000, maxWidth: 560, margin: '0 auto', background: 'var(--ps-off-white)',
        border: '1px solid var(--ps-border)', borderRadius: 'var(--ps-radius-lg)', boxShadow: 'var(--ps-shadow-lg)',
        padding: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-midnight)',
      }}
    >
      <p style={{ margin: '0 0 var(--ps-space-sm)' }}>
        We use one advertising cookie to see whether our ads led to a booking or order. It never includes your
        health details. <a href="/privacy">Privacy notice</a>
      </p>
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="booking-secondary-action" onClick={() => decide('denied')}>Essential only</button>
        <button type="button" className="booking-primary-action" onClick={() => decide('granted')}>Accept</button>
      </div>
    </div>
  )
}
