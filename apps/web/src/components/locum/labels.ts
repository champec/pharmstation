// Plain-English labels for locum shift and booking values stored in the database.

const pick = (map: Record<string, string>, value: string | null | undefined) =>
  value ? map[value] ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—'

export const bookingStatusLabel = (v?: string | null) => pick({
  pending: 'Applied', approved: 'Confirmed', rejected: 'Not successful', completed: 'Worked',
  cancelled: 'Cancelled', no_show: 'No-show',
}, v)

export const shiftStatusLabel = (v?: string | null) => pick({
  open: 'Open', filled: 'Booked', completed: 'Completed', cancelled: 'Cancelled',
}, v)

export const bookingModeLabel = (v?: string | null) => pick({
  auto: 'Auto-accept', manual: 'You confirm applicants',
}, v)

export const paymentModeLabel = (v?: string | null) => pick({
  external: 'Pharmacy pays the locum directly', platform: 'Paid through PharmStation',
}, v)

export const complianceLabel = (v?: string | null) => pick({
  pending: 'Under review', approved: 'Approved', rejected: 'Not approved',
  changes_requested: 'Changes needed', suspended: 'Suspended',
}, v)

/** Friendly text for errors from locum profile saves. */
export function locumErrorText(err: unknown, fallback: string) {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : ''
  if (msg.includes('ps_locum_profiles_gphc_number_unique')) {
    return 'That GPhC number is already registered to another PharmStation locum. Check the number, or contact support@pharmstation.co.uk if it is yours.'
  }
  return msg || fallback
}
