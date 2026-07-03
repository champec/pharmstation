import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'

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
  const [timedOut, setTimedOut] = useState(false)
  const attempts = useRef(0)

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
    <button className="ps-btn ps-btn-primary" onClick={() => navigate(`/book/${orgSlug ?? ''}`)} style={{ marginTop: 'var(--ps-space-lg)' }}>
      Back to Pharmacy
    </button>
  )

  const card = (icon: string, title: string, body: React.ReactNode) => (
    <div style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center', padding: '0 var(--ps-space-lg)' }}>
      <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)' }}>
        <div style={{ fontSize: '3rem', marginBottom: 'var(--ps-space-md)' }}>{icon}</div>
        <h1 style={{ marginBottom: 'var(--ps-space-sm)' }}>{title}</h1>
        {body}
        {backBtn}
      </div>
    </div>
  )

  if (canceled) {
    return card('⚠️', 'Payment Cancelled', (
      <p style={{ color: 'var(--ps-slate)' }}>
        Your booking was created but has not been paid. You can contact the pharmacy to arrange payment, or book again.
      </p>
    ))
  }

  if (!paymentId) {
    return card('❓', 'No payment reference', (
      <p style={{ color: 'var(--ps-slate)' }}>We couldn't find a payment reference in the link.</p>
    ))
  }

  if (payment?.status === 'succeeded') {
    return card('✅', 'Payment Successful!', (
      <>
        <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-sm)' }}>
          {payment.description ?? 'Your booking'} — <strong>£{(payment.amount_pence / 100).toFixed(2)}</strong>
        </p>
        <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
          Your appointment is booked and paid. A receipt has been emailed to you by Stripe.
        </p>
      </>
    ))
  }

  if (payment && ['failed', 'canceled'].includes(payment.status)) {
    return card('❌', 'Payment Failed', (
      <p style={{ color: 'var(--ps-slate)' }}>
        Your payment didn't go through. Your booking was created — please contact the pharmacy to arrange payment.
      </p>
    ))
  }

  if (timedOut) {
    return card('⏳', 'Payment Processing', (
      <p style={{ color: 'var(--ps-slate)' }}>
        Your payment is still being confirmed. If you were charged, your booking is safe — the pharmacy will see the payment shortly.
      </p>
    ))
  }

  return card('⏳', 'Confirming your payment…', (
    <p style={{ color: 'var(--ps-slate)' }}>One moment — we're confirming your payment with Stripe.</p>
  ))
}
