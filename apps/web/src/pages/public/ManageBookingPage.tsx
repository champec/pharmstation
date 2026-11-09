import { BookingNavAccount } from '../../components/public/BookingNavAccount'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { PublicFooter } from '../../components/public/PublicFooter'

// The patient's manage link (/booking/manage/:token), texted after booking.
// Works without an account: the token in the link is the key.

type ManageInfo = {
  booking: {
    id: string
    status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
    awaiting_payment: boolean
    start_time: string | null
    end_time: string | null
    service_name: string
    is_video: boolean
    org_name: string
    org_slug: string | null
    org_phone: string | null
    patient_first_name: string | null
    paid_pence: number
  }
  can_cancel: boolean
  can_move: boolean
  refund_on_cancel: boolean
  refund_cutoff_hours: number
  video: { consultation_id: string; access_code: string } | null
}

type Slot = { id: string; start_time: string; end_time: string }

const STATUS_LABEL: Record<ManageInfo['booking']['status'], string> = {
  pending: 'Waiting for the pharmacy to confirm',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'Missed',
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await getUserClient().functions.invoke('appointments', { body })
  if (error || data?.error) {
    let msg = data?.error as string | undefined
    const ctx = (error as any)?.context
    if (!msg && ctx && typeof ctx.json === 'function') {
      try { msg = (await ctx.json())?.error } catch { /* ignore */ }
    }
    throw new Error(msg || 'Something went wrong. Please try again.')
  }
  return data
}

const pounds = (p: number) => `£${(p / 100).toFixed(2)}`
const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ManageBookingPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [info, setInfo] = useState<ManageInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [moveDay, setMoveDay] = useState('')
  const [moveTo, setMoveTo] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      setInfo(await call({ action: 'manage_get', token }) as ManageInfo)
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await call({ action: 'cancel', token })
      setNotice(out.refund_error
        ? out.refund_error
        : out.refunded_pence
          ? `Your booking is cancelled and ${pounds(out.refunded_pence)} will be refunded to your card within 5 to 10 days.`
          : 'Your booking is cancelled.')
      setConfirming(false)
      await load()
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(false)
  }

  const openMove = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await call({ action: 'available_slots', token })
      setSlots(out.slots as Slot[])
      setMoveDay(out.slots?.[0] ? dayKey(out.slots[0].start_time) : '')
      setMoveTo(null)
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(false)
  }

  const move = async () => {
    if (!moveTo) return
    setBusy(true)
    setError('')
    try {
      await call({ action: 'reschedule', token, slot_id: moveTo })
      setNotice('Your booking has been moved. We have texted you the new time.')
      setSlots(null)
      await load()
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(false)
  }

  const b = info?.booking
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="booking-public">
      <header className="booking-nav"><button type="button" className="booking-wordmark" onClick={() => navigate('/book')}>Pharm<span>Station</span><small>Book</small></button><nav><BookingNavAccount /></nav></header>
      <main className="booking-result booking-manage">
        {loading && <div className="booking-loading booking-page-state"><i /><span>Loading your booking…</span></div>}
        {!loading && !b && (
          <>
            <div className="booking-result-mark">?</div>
            <h1>Booking not found</h1>
            <p>{error || 'This link is not valid. Please check the text message you were sent, or contact the pharmacy.'}</p>
          </>
        )}
        {!loading && b && (
          <>
            <span className="booking-eyebrow">Your booking</span>
            <h1>{b.service_name}</h1>
            <p>at <strong>{b.org_name}</strong></p>
            <div className="booking-result-detail"><span>Status</span><strong>{b.awaiting_payment ? 'Waiting for payment' : STATUS_LABEL[b.status]}</strong></div>
            {b.start_time && (
              <div className="booking-result-detail"><span>Date and time</span><strong>{fmtDate(b.start_time)}, {fmtTime(b.start_time)}{b.end_time ? ` to ${fmtTime(b.end_time)}` : ''}</strong></div>
            )}
            {b.is_video && b.status === 'confirmed' && !info.video && (
              <div className="booking-result-detail"><span>How</span><strong>Video call. We'll text you the link and code before your appointment.</strong></div>
            )}
            {info.video && (
              <div className="booking-result-detail"><span>Video call</span><strong>Your code is {info.video.access_code}</strong>
                <a className="booking-primary-action" href={`/consult/${info.video.consultation_id}`}>Join video call</a></div>
            )}
            {b.paid_pence > 0 && (
              <div className="booking-result-detail"><span>Paid</span><strong>{pounds(b.paid_pence)}</strong></div>
            )}
            {notice && <div className="booking-form-notice">{notice}</div>}
            {error && <div className="booking-form-error">{error}</div>}

            {info.can_move && !slots && !confirming && (
              <button type="button" className="booking-secondary-action" onClick={openMove} disabled={busy}>Move to another time</button>
            )}
            {slots && (
              <div className="booking-manage-confirm">
                {slots.length === 0 ? (
                  <p>There are no other times available online. Please contact the pharmacy.</p>
                ) : (
                  <>
                    <label htmlFor="move-day">Choose a day</label>
                    <select id="move-day" className="ps-input" value={moveDay} onChange={(e) => { setMoveDay(e.target.value); setMoveTo(null) }}>
                      {[...new Set(slots.map((x) => dayKey(x.start_time)))].map((d) => (
                        <option key={d} value={d}>{fmtDate(`${d}T12:00:00`)}</option>
                      ))}
                    </select>
                    <div className="booking-manage-slots">
                      {slots.filter((x) => dayKey(x.start_time) === moveDay).map((x) => (
                        <button type="button" key={x.id} className={moveTo === x.id ? 'selected' : ''} onClick={() => setMoveTo(x.id)}>{fmtTime(x.start_time)}</button>
                      ))}
                    </div>
                  </>
                )}
                <div className="booking-manage-actions">
                  <button type="button" className="booking-secondary-action" onClick={() => setSlots(null)} disabled={busy}>Keep current time</button>
                  {slots.length > 0 && <button type="button" className="booking-primary-action" onClick={move} disabled={busy || !moveTo}>{busy ? 'Moving…' : 'Move my booking'}</button>}
                </div>
              </div>
            )}
            {info.can_cancel && !confirming && !slots && (
              <button type="button" className="booking-secondary-action" onClick={() => setConfirming(true)}>Cancel this booking</button>
            )}
            {info.can_cancel && confirming && (
              <div className="booking-manage-confirm">
                <p>
                  {b.paid_pence > 0
                    ? info.refund_on_cancel
                      ? `You'll get a full refund of ${pounds(b.paid_pence)}.`
                      : `This is within ${info.refund_cutoff_hours} hours of your appointment, so no refund is due.`
                    : 'The time will be released for someone else.'}
                </p>
                <div className="booking-manage-actions">
                  <button type="button" className="booking-secondary-action" onClick={() => setConfirming(false)} disabled={busy}>Keep booking</button>
                  <button type="button" className="booking-primary-action" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Yes, cancel it'}</button>
                </div>
              </div>
            )}
            {!info.can_cancel && (b.status === 'pending' || b.status === 'confirmed') && (
              <small>To change this booking, please contact {b.org_name}{b.org_phone ? ` on ${b.org_phone}` : ''}.</small>
            )}
            {b.org_slug && (b.status === 'cancelled') && (
              <button type="button" className="booking-primary-action" onClick={() => navigate(`/book/${b.org_slug}`)}>Book again</button>
            )}
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  )
}
