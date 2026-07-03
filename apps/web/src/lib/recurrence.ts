/**
 * Minimal RRULE expansion for appointment slots.
 *
 * The slots UI stores a simple RRULE string (e.g. "FREQ=DAILY",
 * "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"). Nothing server-side expands these,
 * so we materialise concrete slot rows at creation time over a fixed horizon.
 *
 * Supported: FREQ=DAILY | WEEKLY | MONTHLY, optional BYDAY (weekly), optional INTERVAL.
 * Unknown rules fall back to a single occurrence on the start date.
 */

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

export const RECURRENCE_HORIZON_DAYS = 56 // 8 weeks

export function expandRecurrenceDates(
  startDate: Date,
  rrule: string,
  horizonDays: number = RECURRENCE_HORIZON_DAYS
): Date[] {
  const parts: Record<string, string> = {}
  for (const seg of (rrule || '').split(';')) {
    const [k, v] = seg.split('=')
    if (k && v) parts[k.trim().toUpperCase()] = v.trim().toUpperCase()
  }

  const freq = parts['FREQ']
  const byday = parts['BYDAY'] ? parts['BYDAY'].split(',').filter(Boolean) : null
  const interval = Math.max(1, parseInt(parts['INTERVAL'] || '1', 10) || 1)

  const out: Date[] = []
  const horizon = new Date(startDate)
  horizon.setDate(horizon.getDate() + horizonDays)

  if (freq === 'DAILY') {
    const d = new Date(startDate)
    while (d <= horizon) {
      out.push(new Date(d))
      d.setDate(d.getDate() + interval)
    }
  } else if (freq === 'WEEKLY' && byday && byday.length > 0) {
    // Walk each day in the horizon; include days matching BYDAY.
    const d = new Date(startDate)
    while (d <= horizon) {
      if (byday.includes(DAY_CODES[d.getDay()])) {
        const weeksFromStart = Math.floor((d.getTime() - startDate.getTime()) / (7 * 86_400_000))
        if (weeksFromStart % interval === 0) out.push(new Date(d))
      }
      d.setDate(d.getDate() + 1)
    }
  } else if (freq === 'WEEKLY') {
    const d = new Date(startDate)
    while (d <= horizon) {
      out.push(new Date(d))
      d.setDate(d.getDate() + 7 * interval)
    }
  } else if (freq === 'MONTHLY') {
    const d = new Date(startDate)
    while (d <= horizon) {
      out.push(new Date(d))
      d.setMonth(d.getMonth() + interval)
    }
  } else {
    out.push(new Date(startDate))
  }

  return out
}

/** Format a Date's local date portion as YYYY-MM-DD (no UTC shift). */
export function toLocalDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
