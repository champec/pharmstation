// Small pure helpers shared by the deliveries stores and pages.
// Kept free of Supabase and React so they can be unit tested on their own
// (packages/core/src/deliveries.test.ts, run with `node --test`).

export interface StopAddressFields {
  delivery_address_line_1?: string | null
  delivery_address_line_2?: string | null
  delivery_city?: string | null
  delivery_postcode?: string | null
  patient?: {
    address_line_1?: string | null
    address_line_2?: string | null
    city?: string | null
    postcode?: string | null
  } | null
}

/** Stop statuses that mean the driver has finished with the stop. */
export const RESOLVED_STOP_STATUSES = [
  'delivered',
  'failed',
  'skipped',
  'pending_redelivery',
  'moved_to_round',
  'returned',
  'cancelled',
] as const

export function isResolvedStopStatus(status: string): boolean {
  return (RESOLVED_STOP_STATUSES as readonly string[]).includes(status)
}

/** Stops that can be moved to another round from the redelivery queue. */
export const REDELIVERABLE_STOP_STATUSES = ['failed', 'pending_redelivery', 'skipped'] as const

/**
 * The address the driver should go to. A stop's own delivery address wins
 * over the patient's home address; when the stop has an override line 1 the
 * whole override is used, so we never mix two addresses.
 */
export function stopAddressLines(stop: StopAddressFields): string[] {
  const usesOverride = !!(stop.delivery_address_line_1 || stop.delivery_postcode)
  const lines = usesOverride
    ? [stop.delivery_address_line_1, stop.delivery_address_line_2, stop.delivery_city, stop.delivery_postcode]
    : [stop.patient?.address_line_1, stop.patient?.address_line_2, stop.patient?.city, stop.patient?.postcode]
  return lines.map((l) => (l ?? '').trim()).filter(Boolean)
}

export function stopAddress(stop: StopAddressFields): string {
  return stopAddressLines(stop).join(', ')
}

export function stopPostcode(stop: StopAddressFields): string | null {
  const usesOverride = !!(stop.delivery_address_line_1 || stop.delivery_postcode)
  const pc = usesOverride ? stop.delivery_postcode : stop.patient?.postcode
  return pc?.trim() || null
}

/** "HH:MM:SS" or "HH:MM" from Postgres → "HH:MM". */
function shortTime(t: string | null | undefined): string | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** "between 10:00 and 12:00", "from 10:00", "by 12:00", or null. */
export function formatTimeWindow(start: string | null | undefined, end: string | null | undefined): string | null {
  const s = shortTime(start)
  const e = shortTime(end)
  if (s && e) return `between ${s} and ${e}`
  if (s) return `from ${s}`
  if (e) return `by ${e}`
  return null
}

/** Normalise a UK/intl phone number the same way the sms-works function does. */
export function normalisePhone(raw: string | null | undefined): string | null {
  let n = (raw || '').replace(/[^\d+]/g, '')
  if (n.startsWith('+')) n = n.slice(1)
  else if (n.startsWith('00')) n = n.slice(2)
  else if (n.startsWith('0')) n = `44${n.slice(1)}`
  else if (n.startsWith('7') && n.length === 10) n = `44${n}`
  return /^\d{8,15}$/.test(n) ? n : null
}

export function buildDeliveryReminder(opts: {
  firstName?: string | null
  scheduledDate?: string | null
  timeStart?: string | null
  timeEnd?: string | null
}): string {
  const dateStr = opts.scheduledDate
    ? `on ${new Date(`${opts.scheduledDate}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' })}`
    : 'soon'
  const window = formatTimeWindow(opts.timeStart, opts.timeEnd)
  const greeting = opts.firstName ? `Hello ${opts.firstName}, your` : 'Your'
  return `${greeting} pharmacy will be delivering your medication ${dateStr}${window ? `, ${window}` : ''}. If you have any questions, please contact the pharmacy.`
}

/**
 * Map a pointer position in CSS pixels to canvas pixels, so drawing lands
 * under the finger when the canvas is scaled to fit the screen.
 */
export function toCanvasPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number },
): { x: number; y: number } {
  const sx = rect.width ? canvas.width / rect.width : 1
  const sy = rect.height ? canvas.height / rect.height : 1
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy }
}

/** True when a new GPS fix should be sent: 15 s or 50 m since the last one. */
export function shouldSendLocation(
  last: { lat: number; lng: number; at: number } | null,
  next: { lat: number; lng: number; at: number },
  minMs = 15000,
  minMetres = 50,
): boolean {
  if (!last) return true
  if (next.at - last.at >= minMs) return true
  return distanceMetres(last, next) >= minMetres
}

export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Google Maps directions link for one stop (works on iOS and Android). */
export function mapsLink(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`
}
