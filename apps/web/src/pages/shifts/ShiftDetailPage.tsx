import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { bookingModeLabel, bookingStatusLabel, complianceLabel, paymentModeLabel, shiftStatusLabel } from '../../components/locum/labels'
import { useAuthStore } from '@pharmstation/core'
import { confirmDialog, promptDialog } from '../../components/ui/dialog'

interface Shift {
  id: string
  date: string
  start_time: string
  end_time: string
  rate_per_hour: number
  booking_mode: string
  payment_mode: string
  status: string
  notes: string | null
  created_at: string
}

interface ShiftCriteria {
  id: string
  required_service_ids: string[] | null
  references_required: boolean
  sop_required: boolean
}

/** Row from ps_org_shift_locums. Contact and compliance fields are null
 *  unless the viewer has the approve_locums permission. */
interface LocumSummary {
  locum_id: string
  full_name: string
  email: string | null
  phone: string | null
  gphc_number: string | null
  gphc_expiry: string | null
  indemnity_provider: string | null
  indemnity_expiry: string | null
  dbs_expiry: string | null
  smart_card_held: boolean | null
  compliance_status: string | null
}

interface Booking {
  id: string
  locum_id: string
  status: string
  applied_at: string
  reviewed_at: string | null
  cancellation_reason: string | null
  locum?: LocumSummary
}

interface SignIn {
  id: string
  signed_in_at: string
  signed_out_at: string | null
  duration_minutes: number | null
}

function fmt(time: string) { return time.slice(0, 5) }
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtTs(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STATUS_COLOURS: Record<string, string> = {
  open: 'ps-badge ps-badge-success',
  filled: 'ps-badge ps-badge-primary',
  completed: 'ps-badge ps-badge-muted',
  cancelled: 'ps-badge ps-badge-danger',
}

const BOOKING_STATUS_COLOURS: Record<string, string> = {
  pending: 'ps-badge ps-badge-warning',
  approved: 'ps-badge ps-badge-primary',
  rejected: 'ps-badge ps-badge-danger',
  cancelled: 'ps-badge',
  completed: 'ps-badge ps-badge-success',
  no_show: 'ps-badge ps-badge-danger',
}

export function ShiftDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()

  const [shift, setShift] = useState<Shift | null>(null)
  const [criteria, setCriteria] = useState<ShiftCriteria | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [signIn, setSignIn] = useState<SignIn | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id || !organisation?.id) return
    setLoading(true)
    setError(null)

    try {
      const client = getUserClient()

      const [shiftRes, criteriaRes, bookingsRes] = await Promise.all([
        client.from('ps_locum_shifts').select('*').eq('id', id).single(),
        client.from('ps_locum_shift_criteria').select('*').eq('shift_id', id).maybeSingle(),
        client.from('ps_locum_bookings').select('*').eq('shift_id', id).order('applied_at'),
      ])

      if (shiftRes.error) throw shiftRes.error
      if (bookingsRes.error) throw bookingsRes.error

      const shiftData = shiftRes.data as Shift
      // Verify this shift belongs to the current org
      if ((shiftData as unknown as { org_id: string }).org_id !== organisation.id) {
        throw new Error('Shift not found.')
      }

      setShift(shiftData)
      setCriteria(criteriaRes.data as ShiftCriteria | null)

      // Names and compliance of the locums who applied
      const rawBookings = (bookingsRes.data ?? []) as Booking[]
      const locumIds = [...new Set(rawBookings.map((b) => b.locum_id))]
      let locumMap = new Map<string, LocumSummary>()
      if (locumIds.length > 0) {
        const { data: locums, error: lErr } = await client.rpc('ps_org_shift_locums', {
          p_org_id: organisation.id,
          p_locum_ids: locumIds,
        })
        if (lErr) throw lErr
        locumMap = new Map(((locums ?? []) as LocumSummary[]).map((l) => [l.locum_id, l]))
      }
      setBookings(rawBookings.map((b) => ({ ...b, locum: locumMap.get(b.locum_id) })))

      // Load sign-in for the booked locum
      const confirmedBooking = rawBookings.find((b) => ['approved', 'completed', 'no_show'].includes(b.status))
      if (confirmedBooking) {
        const { data: si } = await client
          .from('ps_locum_sign_ins')
          .select('*')
          .eq('booking_id', confirmedBooking.id)
          .maybeSingle()
        setSignIn(si as SignIn | null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shift')
    } finally {
      setLoading(false)
    }
  }, [id, organisation?.id])

  useEffect(() => { load() }, [load])

  async function handleBookingAction(bookingId: string, action: 'confirm' | 'reject') {
    if (!activeUser?.id) return
    let reason: string | null = null
    if (action === 'reject') {
      reason = await promptDialog('Reason (optional, the locum sees this):', '')
      if (reason === null) return
    }
    setActionLoading(bookingId)
    setError(null)
    try {
      // One transaction: confirms, fills the shift and turns down other applicants
      const { error } = await getUserClient().rpc('ps_org_review_booking', {
        p_booking_id: bookingId,
        p_action: action === 'confirm' ? 'approve' : 'reject',
        p_reason: reason,
      })
      if (error) throw error
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCancelShift() {
    const reason = await promptDialog('Cancel this shift? Applications are turned down and any confirmed locum is told it is cancelled.\n\nReason (optional, locums see this):', '')
    if (reason === null) return
    setActionLoading('cancel')
    setError(null)
    try {
      const { error } = await getUserClient().rpc('ps_org_cancel_shift', { p_shift_id: id, p_reason: reason })
      if (error) throw error
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleMark(bookingId: string, status: 'completed' | 'no_show') {
    const question = status === 'completed'
      ? 'Confirm this locum worked the shift?'
      : 'Record that this locum did not turn up?'
    if (!await confirmDialog(question)) return
    setActionLoading(status)
    setError(null)
    try {
      const { error } = await getUserClient().rpc('ps_org_mark_booking', { p_booking_id: bookingId, p_status: status })
      if (error) throw error
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return <div className="page-container loading-indicator">Loading shift…</div>
  }

  if (!shift) {
    return (
      <div className="page-container">
        <div className="ps-alert ps-alert-error">{error ?? 'Shift not found.'}</div>
        <Link to="/shifts" className="ps-btn ps-btn-ghost" style={{ marginTop: '1rem' }}>← Back to Shifts</Link>
      </div>
    )
  }

  const hours = (() => {
    const [sh, sm] = shift.start_time.split(':').map(Number)
    const [eh, em] = shift.end_time.split(':').map(Number)
    const diff = (eh * 60 + em) - (sh * 60 + sm)
    return diff > 0 ? (diff / 60).toFixed(1) : '?'
  })()

  const pendingBookings = bookings.filter((b) => b.status === 'pending')
  const confirmedBooking = bookings.find((b) => ['approved', 'completed', 'no_show'].includes(b.status))
  const canManage = ['open', 'filled'].includes(shift.status)
  const shiftStarted = new Date(`${shift.date}T${shift.start_time}`) <= new Date()

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <Link to="/shifts">Shifts</Link>
          <span className="separator">/</span>
          <span>{fmtDate(shift.date)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">
              {fmt(shift.start_time)} – {fmt(shift.end_time)} &nbsp;
              <span className={STATUS_COLOURS[shift.status] ?? 'ps-badge'}>{shiftStatusLabel(shift.status)}</span>
            </h1>
            <p className="page-subtitle">{fmtDate(shift.date)} · {hours}h · £{Number(shift.rate_per_hour).toFixed(2)}/hr</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {canManage && shift.status !== 'cancelled' && (
              <button
                className="ps-btn ps-btn-danger ps-btn-sm"
                onClick={handleCancelShift}
                disabled={actionLoading === 'cancel'}
              >
                {actionLoading === 'cancel' ? 'Cancelling…' : 'Cancel Shift'}
              </button>
            )}
            <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load}>Refresh</button>
          </div>
        </div>
      </div>

      {error && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: '1.5rem' }}>{error}</div>
      )}

      <div className="ps-split" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left: bookings */}
        <div>
          {/* Confirmed locum */}
          {confirmedBooking && (
            <div className="ps-card" style={{ marginBottom: '1.5rem', border: '2px solid var(--ps-primary)' }}>
              <div className="ps-card-header">
                <h2 className="ps-card-title">Booked Locum</h2>
                <span className={BOOKING_STATUS_COLOURS[confirmedBooking.status] ?? 'ps-badge'}>{bookingStatusLabel(confirmedBooking.status)}</span>
              </div>
              <div className="ps-card-body">
                <div className="review-row"><span>Name</span><strong>{confirmedBooking.locum?.full_name ?? '—'}</strong></div>
                <div className="review-row"><span>Email</span><strong>{confirmedBooking.locum?.email ?? '—'}</strong></div>
                <div className="review-row"><span>Phone</span><strong>{confirmedBooking.locum?.phone ?? '—'}</strong></div>
                <div className="review-row"><span>GPhC</span><strong>{confirmedBooking.locum?.gphc_number ?? '—'}</strong></div>
                <div className="review-row"><span>Indemnity</span><strong>{confirmedBooking.locum?.indemnity_provider ?? <span className="ps-badge ps-badge-warning">None on file</span>}</strong></div>
                <div className="review-row"><span>Smartcard</span><strong>{confirmedBooking.locum?.smart_card_held == null ? '—' : confirmedBooking.locum.smart_card_held ? 'Yes' : 'No'}</strong></div>
                {confirmedBooking.status === 'approved' && shiftStarted && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    <button className="ps-btn ps-btn-primary ps-btn-sm" disabled={!!actionLoading} onClick={() => handleMark(confirmedBooking.id, 'completed')}>
                      Confirm shift worked
                    </button>
                    {!signIn && (
                      <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={!!actionLoading} onClick={() => handleMark(confirmedBooking.id, 'no_show')}>
                        Record no-show
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* Sign-in status */}
              {signIn ? (
                <div className="ps-card-body" style={{ borderTop: '1px solid var(--ps-border)' }}>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Sign-In Record</h3>
                  <div className="review-row"><span>Signed In</span><strong>{fmtTs(signIn.signed_in_at)}</strong></div>
                  <div className="review-row"><span>Signed Out</span><strong>{signIn.signed_out_at ? fmtTs(signIn.signed_out_at) : 'Still on site'}</strong></div>
                  {signIn.duration_minutes != null && (
                    <div className="review-row"><span>Duration</span><strong>{signIn.duration_minutes < 1 ? 'Under 1 min' : `${Math.floor(signIn.duration_minutes / 60)}h ${signIn.duration_minutes % 60}m`}</strong></div>
                  )}
                </div>
              ) : shift.status === 'filled' ? (
                <div className="ps-card-body" style={{ borderTop: '1px solid var(--ps-border)' }}>
                  <p className="text-muted" style={{ fontSize: '0.875rem' }}>Locum has not signed in yet.</p>
                </div>
              ) : null}
            </div>
          )}

          {/* Pending applicants (manual mode) */}
          {shift.booking_mode === 'manual' && pendingBookings.length > 0 && (
            <div className="ps-card" style={{ marginBottom: '1.5rem' }}>
              <div className="ps-card-header">
                <h2 className="ps-card-title">Applicants ({pendingBookings.length})</h2>
              </div>
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>GPhC</th>
                    <th>Applied</th>
                    <th>Compliance</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingBookings.map((b) => (
                    <tr key={b.id}>
                      <td>{b.locum?.full_name ?? '—'}</td>
                      <td>
                        {b.locum?.gphc_number ?? '—'}
                        {!b.locum?.indemnity_provider && <div><span className="ps-badge ps-badge-warning">No indemnity on file</span></div>}
                      </td>
                      <td>{fmtTs(b.applied_at)}</td>
                      <td>
                        {b.locum?.compliance_status === 'approved' ? (
                          <span className="ps-badge ps-badge-success">Approved</span>
                        ) : b.locum?.compliance_status ? (
                          <span className="ps-badge ps-badge-warning">{complianceLabel(b.locum.compliance_status)}</span>
                        ) : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            className="ps-btn ps-btn-primary ps-btn-xs"
                            disabled={!!actionLoading || !!confirmedBooking}
                            onClick={() => handleBookingAction(b.id, 'confirm')}
                          >
                            {actionLoading === b.id ? '…' : 'Confirm'}
                          </button>
                          <button
                            className="ps-btn ps-btn-ghost ps-btn-xs"
                            disabled={!!actionLoading}
                            onClick={() => handleBookingAction(b.id, 'reject')}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* All bookings history */}
          {bookings.filter((b) => b.status !== 'pending').length > 0 && (
            <div className="ps-card">
              <div className="ps-card-header"><h2 className="ps-card-title">Booking History</h2></div>
              <table className="ps-table">
                <thead>
                  <tr><th>Name</th><th>Status</th><th>Applied</th><th>Reviewed</th></tr>
                </thead>
                <tbody>
                  {bookings.filter((b) => b.status !== 'pending').map((b) => (
                    <tr key={b.id}>
                      <td>{b.locum?.full_name ?? '—'}</td>
                      <td><span className={BOOKING_STATUS_COLOURS[b.status] ?? 'ps-badge'}>{bookingStatusLabel(b.status)}</span></td>
                      <td>{fmtTs(b.applied_at)}</td>
                      <td>{b.reviewed_at ? fmtTs(b.reviewed_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {bookings.length === 0 && (
            <div className="ps-card">
              <div className="ps-card-body empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
                <p className="text-muted">No applications yet. Share this shift with your locum network.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: shift info */}
        <div>
          <div className="ps-card" style={{ marginBottom: '1rem' }}>
            <div className="ps-card-header"><h2 className="ps-card-title">Shift Info</h2></div>
            <div className="ps-card-body">
              <div className="review-row"><span>Date</span><strong>{fmtDate(shift.date)}</strong></div>
              <div className="review-row"><span>Time</span><strong>{fmt(shift.start_time)} – {fmt(shift.end_time)}</strong></div>
              <div className="review-row"><span>Duration</span><strong>{hours}h</strong></div>
              <div className="review-row"><span>Rate</span><strong>£{Number(shift.rate_per_hour).toFixed(2)}/hr</strong></div>
              <div className="review-row"><span>Total est.</span><strong>£{(Number(shift.rate_per_hour) * parseFloat(hours)).toFixed(2)}</strong></div>
              <div className="review-row"><span>Booking Mode</span><strong>{bookingModeLabel(shift.booking_mode)}</strong></div>
              <div className="review-row"><span>Payment</span><strong>{paymentModeLabel(shift.payment_mode)}</strong></div>
              {shift.notes && (
                <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'var(--ps-surface)', borderRadius: 4, fontSize: '0.875rem' }}>
                  {shift.notes}
                </div>
              )}
            </div>
          </div>

          {criteria && (
            <div className="ps-card">
              <div className="ps-card-header"><h2 className="ps-card-title">Eligibility Criteria</h2></div>
              <div className="ps-card-body">
                <div className="review-row"><span>References</span><strong>{criteria.references_required ? 'Required' : 'Not required'}</strong></div>
                <div className="review-row"><span>SOPs</span><strong>{criteria.sop_required ? 'Must acknowledge' : 'Not required'}</strong></div>
                {criteria.required_service_ids && criteria.required_service_ids.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <p style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', marginBottom: '0.25rem' }}>Required services:</p>
                    <p style={{ fontSize: '0.875rem' }}>{criteria.required_service_ids.length} service(s) required</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
