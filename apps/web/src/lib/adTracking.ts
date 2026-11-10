// ============================================================
// Paid-ads conversion tracking (Google Ads), consent-first.
//
// Off entirely unless VITE_GOOGLE_ADS_ID (e.g. AW-123456789) is set.
// When on, the Google tag loads with Consent Mode v2 defaulting to
// "denied"; nothing is stored and no ad cookies are set until the
// visitor accepts on the consent banner (UK GDPR / PECR).
//
// Only conversion facts are sent: type, value and an opaque id.
// Never pass names, emails, phone numbers, health answers or the
// service name: an ad platform must not learn what care someone booked.
// ============================================================

const ADS_ID = (import.meta.env.VITE_GOOGLE_ADS_ID as string | undefined)?.trim() || ''
const LABELS: Record<ConversionKind, string> = {
  booking: (import.meta.env.VITE_GOOGLE_ADS_BOOKING_LABEL as string | undefined)?.trim() || '',
  purchase: (import.meta.env.VITE_GOOGLE_ADS_PURCHASE_LABEL as string | undefined)?.trim() || '',
}
const CONSENT_KEY = 'ps_ad_consent' // 'granted' | 'denied'

export type ConversionKind = 'booking' | 'purchase'

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: Gtag }
}

export const adsEnabled = () => ADS_ID.startsWith('AW-')

function readConsent(): 'granted' | 'denied' | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch { return null }
}

export const consentChoice = readConsent

let loaded = false
function gtag(..._args: unknown[]) {
  window.dataLayer = window.dataLayer || []
  // gtag.js expects the arguments object itself.
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments)
}

/** Load the Google tag once, consent denied by default. Safe to call repeatedly. */
export function initAdTracking() {
  if (loaded || !adsEnabled() || typeof window === 'undefined') return
  loaded = true
  window.gtag = gtag
  const granted = readConsent() === 'granted'
  gtag('consent', 'default', {
    ad_storage: granted ? 'granted' : 'denied',
    ad_user_data: granted ? 'granted' : 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  })
  gtag('set', 'url_passthrough', false)
  gtag('set', 'ads_data_redaction', !granted)
  gtag('js', new Date())
  // Health pages: never send the full URL with query strings to the ad platform.
  gtag('config', ADS_ID, { send_page_view: false })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ADS_ID)}`
  document.head.appendChild(s)
}

export function setAdConsent(choice: 'granted' | 'denied') {
  try { localStorage.setItem(CONSENT_KEY, choice) } catch { /* private mode */ }
  if (!adsEnabled()) return
  initAdTracking()
  window.gtag?.('consent', 'update', {
    ad_storage: choice,
    ad_user_data: choice,
  })
  window.gtag?.('set', 'ads_data_redaction', choice !== 'granted')
}

/**
 * Report a completed booking or order. Deduplicated per id, so a page
 * refresh on a result screen does not count twice.
 */
export function trackConversion(kind: ConversionKind, opts: { id: string; valuePence?: number | null }) {
  if (!adsEnabled() || !LABELS[kind] || !opts.id) return
  const key = `ps_conv_${kind}_${opts.id}`
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch { /* still send once */ }
  initAdTracking()
  window.gtag?.('event', 'conversion', {
    send_to: `${ADS_ID}/${LABELS[kind]}`,
    value: opts.valuePence != null ? opts.valuePence / 100 : undefined,
    currency: 'GBP',
    transaction_id: opts.id,
  })
}
