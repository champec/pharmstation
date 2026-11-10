import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import { bookingModeLabel, bookingStatusLabel, locumErrorText } from '../../components/locum/labels'
import { confirmDialog } from '../../components/ui/dialog'

interface BookingRow {
  id: string
  shift_id: string
  status: string
  applied_at: string
  reviewed_at: string | null
  cancellation_reason: string | null
  shift: {
    id: string
    date: string
    start_time: string
    end_time: string
    rate_per_hour: number
    org_id: string
    status: string
    booking_mode: string
  } | null
  org?: { name: string; address: string } | null
  sign_in: {
    id: string
    signed_in_at: string
    signed_out_at: string | null
    duration_minutes: number | null
  } | null
}

type Tab = 'upcoming' | 'pending' | 'past'

function fmt(t: string) { return t.slice(0, 5) }
function minutesBetween(a: string, b: string) {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  return bh * 60 + bm - (ah * 60 + am)
}

/** Current UK date and time as 'YYYY-MM-DD HH:MM', comparable with a shift's date and start. */
function ukNow() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' }).slice(0, 16)
}
function hasStarted(shift: { date: string; start_time: string }) {
  return ukNow() >= `${shift.date} ${fmt(shift.start_time)}`
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtTs(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const BOOKING_BADGE: Record<string, string> = {
  pending:   'ps-badge ps-badge-warning',
  approved:  'ps-badge ps-badge-primary',
  rejected:  'ps-badge ps-badge-danger',
  cancelled: 'ps-badge',
  completed: 'ps-badge ps-badge-success',
  no_show:   'ps-badge ps-badge-danger',
}

export function LocumBookingsPage() {
  const { locumProfile } = useAuthStore()

  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('upcoming')
  const [actionId, setActionId] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]

  const load = useCallback(async () => {
    if (!locumProfile) return
    const client = getUserClient()
    setLoading(true)
    setError(null)

    try {
      const { data, error: bErr } = await client
        .from('ps_locum_bookings')
        .select('id, shift_id, status, applied_at, reviewed_at, cancellation_reason, shift:ps_locum_shifts(id, date, start_time, end_time, rate_per_hour, org_id, status, booking_mode)')
        .eq('locum_id', locumProfile.id)
        .order('applied_at', { ascending: false })
      if (bErr) throw bErr

      const rows = (data ?? []) as unknown as BookingRow[]

      // Load sign-in records for confirmed bookings
      const confirmedIds = rows.filter((b) => b.status === 'approved').map((b) => b.id)
      let signInMap: Record<string, BookingRow['sign_in']> = {}
      if (confirmedIds.length > 0) {
        const { data: sis } = await client
          .from('ps_locum_sign_ins')
          .select('id, booking_id, signed_in_at, signed_out_at, duration_minutes')
          .in('booking_id', confirmedIds)
        for (const si of sis ?? []) {
          signInMap[si.booking_id] = si
        }
      }

      // Pharmacy name and address for each booking
      const orgIds = [...new Set(rows.flatMap((b) => (b.shift ? [b.shift.org_id] : [])))]
      const orgMap: Record<string, { name: string; address: string }> = {}
      if (orgIds.length > 0) {
        const { data: orgs } = await client.rpc('ps_locum_shift_orgs', { p_org_ids: orgIds })
        for (const o of (orgs ?? []) as { id: string; name: string; address: Record<string, string> | null }[]) {
          const a = o.address ?? {}
          orgMap[o.id] = { name: o.name, address: [a.line_1 ?? a.line1, a.line_2 ?? a.line2, a.city ?? a.town, a.postcode].filter(Boolean).join(', ') }
        }
      }

      setBookings(rows.map((b) => ({ ...b, org: b.shift ? orgMap[b.shift.org_id] ?? null : null, sign_in: signInMap[b.id] ?? null })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings')
    } finally {
      setLoading(false)
    }
  }, [locumProfile])

  useEffect(() => { load() }, [load])

  async function handleSignIn(booking: BookingRow) {
    if (!locumProfile || !booking.shift) return
    setActionId(booking.id)
    try {
      const { error } = await getUserClient().rpc('ps_locum_sign_in', { p_booking_id: booking.id })
      if (error) throw error
      await load()
    } catch (err) {
      setError(locumErrorText(err, 'Sign-in failed'))
    } finally {
      setActionId(null)
    }
  }

  async function handleSignOut(booking: BookingRow) {
    if (!booking.sign_in || !booking.shift) return
    const sh = booking.shift
    const now = ukNow().slice(11)
    const end = fmt(sh.end_time)
    const overnight = sh.end_time <= sh.start_time
    if (!hasStarted(sh)) {
      setError(`Your shift starts at ${fmt(sh.start_time)} on ${fmtDate(sh.date)}. You can sign out once it has started.`)
      return
    }
    const early = !overnight && sh.date === ukNow().slice(0, 10) && now < end && minutesBetween(now, end) > 30
    const ok = await confirmDialog({
      title: 'Sign out of this shift?',
      body: `It started at ${fmt(sh.start_time)} and ends at ${end}.`
        + (early ? ` It's ${now}, which is ${minutesBetween(now, end)} minutes before the end. The pharmacy will be asked to confirm your hours.` : ''),
      confirmLabel: 'Sign out',
      danger: early,
    })
    if (!ok) return
    setActionId(booking.id)
    try {
      const { error } = await getUserClient().rpc('ps_locum_sign_out', { p_booking_id: booking.id })
      if (error) throw error
      await load()
    } catch (err) {
      setError(locumErrorText(err, 'Sign-out failed'))
    } finally {
      setActionId(null)
    }
  }

  async function handleCancelApplication(bookingId: string) {
    if (!await confirmDialog('Withdraw this application?')) return
    setActionId(bookingId)
    try {
      // The RPC records the reason and reopens an instant-book shift
      const { error } = await getUserClient().rpc('ps_locum_cancel_booking', { p_booking_id: bookingId })
      if (error) throw error
      await load()
    } catch (err) {
      setError(locumErrorText(err, 'Cancellation failed'))
    } finally {
      setActionId(null)
    }
  }

  // Split by tab
  const upcoming = bookings.filter((b) => b.status === 'approved' && b.shift && b.shift.date >= today)
  const pending  = bookings.filter((b) => b.status === 'pending')
  const past     = bookings.filter((b) => !upcoming.includes(b) && !pending.includes(b))

  const displayed = tab === 'upcoming' ? upcoming : tab === 'pending' ? pending : past

  function calcHours(b: BookingRow) {
    if (!b.shift) return null
    const [sh, sm] = b.shift.start_time.split(':').map(Number)
    const [eh, em] = b.shift.end_time.split(':').map(Number)
    const mins = (eh * 60 + em) - (sh * 60 + sm)
    return mins > 0 ? (mins / 60).toFixed(1) : null
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Bookings</h1>
          <p className="page-subtitle">All your shift applications and confirmed bookings</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/locum/shifts" className="ps-btn ps-btn-primary ps-btn-sm">Browse Shifts</Link>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Tabs */}
      <div className="ps-tabs" style={{ marginBottom: '1.5rem' }}>
        {([['upcoming', `Upcoming (${upcoming.length})`], ['pending', `Pending (${pending.length})`], ['past', `Past (${past.length})`]] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            className={`ps-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--ps-slate)' }}>Loading…</div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">
            {tab === 'upcoming' && 'No upcoming confirmed shifts. Browse available shifts to apply.'}
            {tab === 'pending' && 'No pending applications.'}
            {tab === 'past' && 'No past booking history.'}
          </p>
          {tab !== 'past' && (
            <Link to="/locum/shifts" className="ps-btn ps-btn-primary ps-btn-sm" style={{ marginTop: '0.75rem' }}>
              Browse Shifts
            </Link>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {displayed.map((b) => {
            if (!b.shift) return null
            const hours = calcHours(b)
            const total = hours && Number(b.shift.rate_per_hour)
              ? `£${(parseFloat(hours) * Number(b.shift.rate_per_hour)).toFixed(2)}`
              : null
            const isToday = b.shift.date === today
            const hasSignIn = !!b.sign_in
            const hasSignOut = !!b.sign_in?.signed_out_at

            return (
              <div key={b.id} className="ps-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                      <strong>{fmtDate(b.shift.date)}</strong>
                      <span className="text-muted">·</span>
                      <span>{fmt(b.shift.start_time)} – {fmt(b.shift.end_time)}</span>
                      {hours && <span className="text-muted">({hours}h)</span>}
                      <span className={BOOKING_BADGE[b.status] ?? 'ps-badge'}>{bookingStatusLabel(b.status)}</span>
                    </div>
                    {b.org && (
                      <div style={{ marginBottom: '0.25rem' }}>
                        <strong>{b.org.name}</strong>
                        {b.org.address && (
                          <> · <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.org.name}, ${b.org.address}`)}`} target="_blank" rel="noopener noreferrer">{b.org.address}</a></>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: '0.875rem', color: 'var(--ps-slate)' }}>
                      £{Number(b.shift.rate_per_hour).toFixed(2)}/hr
                      {total && <> · {total} total</>}
                      {' · '}<span className="ps-badge">{bookingModeLabel(b.shift.booking_mode)}</span>
                    </div>
                    {b.cancellation_reason && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--ps-danger)', marginTop: '0.25rem' }}>
                        Reason: {b.cancellation_reason}
                      </p>
                    )}
                    {/* Sign-in record */}
                    {b.sign_in && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--ps-slate)' }}>
                        Signed in: {fmtTs(b.sign_in.signed_in_at)}
                        {b.sign_in.signed_out_at && (
                          <> · Signed out: {fmtTs(b.sign_in.signed_out_at)}</>
                        )}
                        {b.sign_in.duration_minutes != null && (
                          <> · {b.sign_in.duration_minutes < 1 ? 'under 1 min' : `${b.sign_in.duration_minutes} min`}</>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
                    {/* Sign-in / sign-out on day of confirmed shift */}
                    {b.status === 'approved' && (isToday || (hasSignIn && !hasSignOut)) && (
                      !hasSignIn ? (
                        <button
                          className="ps-btn ps-btn-primary ps-btn-sm"
                          disabled={actionId === b.id}
                          onClick={() => handleSignIn(b)}
                        >
                          {actionId === b.id ? '…' : 'Sign In'}
                        </button>
                      ) : !hasSignOut && !hasStarted(b.shift) ? (
                        <span className="ps-badge" title="You can sign out once the shift has started">Sign out from {fmt(b.shift.start_time)}</span>
                      ) : !hasSignOut ? (
                        <button
                          className="ps-btn ps-btn-warning ps-btn-sm"
                          disabled={actionId === b.id}
                          onClick={() => handleSignOut(b)}
                        >
                          {actionId === b.id ? '…' : 'Sign Out'}
                        </button>
                      ) : (
                        <span className="ps-badge ps-badge-success" title="The pharmacy confirms the shift, or it is confirmed automatically after the shift if your hours match the booking">Signed out · awaiting confirmation</span>
                      )
                    )}
                    {/* Withdraw pending application */}
                    {b.status === 'pending' && (
                      <button
                        className="ps-btn ps-btn-ghost ps-btn-sm"
                        disabled={actionId === b.id}
                        onClick={() => handleCancelApplication(b.id)}
                      >
                        {actionId === b.id ? '…' : 'Withdraw'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
