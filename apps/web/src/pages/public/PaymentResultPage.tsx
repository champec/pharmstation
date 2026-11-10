import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { PublicFooter } from '../../components/public/PublicFooter'
import { trackConversion } from '../../lib/adTracking'

type PaymentInfo = {
  id: string
  status: string
  amount_pence: number
  currency: string
  description: string | null
  paid_at: string | null
}

/**
 * Landing page after Stripe Checkout (success or cancel).
 * Polls the stripe-checkout edge function (get_payment) until the webhook
 * confirms the payment — usually within a couple of seconds.
 */
export function PaymentResultPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const paymentId = searchParams.get('payment_id')
  const canceled = searchParams.get('canceled') === '1'

  const [payment, setPayment] = useState<PaymentInfo | null>(null)
  useEffect(() => {
    if (payment?.status === 'succeeded') trackConversion('booking', { id: payment.id, valuePence: payment.amount_pence })
  }, [payment])
  const [timedOut, setTimedOut] = useState(false)
  const [released, setReleased] = useState(false)
  const attempts = useRef(0)

  // Patient backed out of Checkout: cancel the unpaid booking now so the
  // slot is free for someone else, rather than held until Stripe expires it.
  useEffect(() => {
    if (!canceled || !paymentId) return
    getUserClient().functions.invoke('stripe-checkout', {
      body: { action: 'cancel_checkout', payment_id: paymentId },
    }).then(({ data }) => {
      if (data?.payment?.status === 'canceled') setReleased(true)
    })
  }, [canceled, paymentId])

  useEffect(() => {
    if (canceled || !paymentId) return
    let stopped = false

    const poll = async () => {
      attempts.current += 1
      const { data } = await getUserClient().functions.invoke('stripe-checkout', {
        body: { action: 'get_payment', payment_id: paymentId },
      })
      if (stopped) return
      const p = data?.payment as PaymentInfo | undefined
      if (p) {
        setPayment(p)
        // Terminal states: stop polling
        if (['succeeded', 'failed', 'refunded', 'canceled'].includes(p.status)) return
      }
      if (attempts.current >= 10) { setTimedOut(true); return }
      setTimeout(poll, 2000)
    }
    poll()
    return () => { stopped = true }
  }, [paymentId, canceled])

  const backBtn = (
    <button type="button" className="booking-primary-action" onClick={() => navigate(`/book/${orgSlug ?? ''}`)}>
      Back to pharmacy
    </button>
  )

  const card = (icon: string, title: string, body: React.ReactNode) => (
    <div className="booking-public">
      <header className="booking-nav"><button type="button" className="booking-wordmark" onClick={() => navigate('/book')}>Pharm<span>Station</span><small>Book</small></button></header>
      <main className="booking-result booking-payment-result"><div className="booking-result-mark">{icon}</div><span className="booking-eyebrow">Payment update</span><h1>{title}</h1><div className="booking-payment-copy">{body}</div>{backBtn}</main><PublicFooter />
    </div>
  )

  if (canceled) {
    return card('⚠️', 'Payment cancelled', (
      <p>
        {released
          ? 'You have not been charged and the appointment has been released. You can book again whenever you like.'
          : 'You have not been charged. Unpaid bookings are released automatically within 30 minutes, so please book again if you still want this appointment.'}
      </p>
    ))
  }

  if (!paymentId) {
    return card('❓', 'No payment reference', (
      <p>We couldn't find a payment reference in the link.</p>
    ))
  }

  if (payment?.status === 'succeeded') {
    return card('✅', 'Payment successful', (
      <>
        <p>
          {payment.description ?? 'Your booking'} — <strong>£{(payment.amount_pence / 100).toFixed(2)}</strong>
        </p>
        <p>
          Your appointment is confirmed and paid. Stripe has emailed you a receipt, and if you gave a mobile number we have texted you a link to view, move or cancel the booking.
        </p>
      </>
    ))
  }

  if (payment && ['failed', 'canceled'].includes(payment.status)) {
    return card('❌', 'Payment not completed', (
      <p>
        Your payment didn't go through, so you have not been charged and the appointment was not booked. Please try booking again.
      </p>
    ))
  }

  if (timedOut) {
    return card('⏳', 'Payment Processing', (
      <p>
        Your payment is still being confirmed. If you were charged, your booking is safe and the pharmacy will see the payment shortly.
      </p>
    ))
  }

  return card('⏳', 'Confirming your payment…', (
    <p>One moment while we confirm your payment with Stripe.</p>
  ))
}
