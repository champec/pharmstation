// ============================================================
// Shop: landing page after Stripe Checkout for a card order.
// Success: polls get_payment until the webhook confirms it.
// Cancelled: cancels the checkout straight away, which cancels the
// order and puts its stock back (ps_shop_sync_order_payment trigger).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { PublicFooter } from '../../components/public/PublicFooter'

type PaymentInfo = { id: string; status: string; amount_pence: number; description: string | null }

export function ShopPaymentResultPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const paymentId = searchParams.get('payment_id')
  const orderNumber = searchParams.get('order')
  const canceled = searchParams.get('canceled') === '1'

  const [payment, setPayment] = useState<PaymentInfo | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const attempts = useRef(0)

  useEffect(() => {
    if (!canceled || !paymentId) return
    getUserClient().functions.invoke('stripe-checkout', {
      body: { action: 'cancel_checkout', payment_id: paymentId },
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
        if (['succeeded', 'failed', 'refunded', 'canceled'].includes(p.status)) return
      }
      if (attempts.current >= 10) { setTimedOut(true); return }
      setTimeout(poll, 2000)
    }
    poll()
    return () => { stopped = true }
  }, [paymentId, canceled])

  const view = (icon: string, title: string, body: React.ReactNode) => (
    <div className="booking-public">
      <header className="booking-nav">
        <button type="button" className="booking-wordmark" onClick={() => navigate('/shop')}>Pharm<span>Station</span><small>Shop</small></button>
      </header>
      <main className="booking-result booking-payment-result">
        <div className="booking-result-mark">{icon}</div>
        <span className="booking-eyebrow">Order {orderNumber ?? ''}</span>
        <h1>{title}</h1>
        <div className="booking-payment-copy">{body}</div>
        <div className="shop-track-actions">
          {orderNumber && !canceled && (
            <button type="button" className="booking-secondary-action" onClick={() => navigate(`/shop/order/${encodeURIComponent(orderNumber)}`)}>
              Track your order
            </button>
          )}
          <button type="button" className="booking-primary-action" onClick={() => navigate(orgSlug ? `/shop/${orgSlug}` : '/shop')}>
            Back to the shop
          </button>
        </div>
      </main>
      <PublicFooter />
    </div>
  )

  if (canceled) {
    return view('!', 'Payment cancelled', (
      <p>You have not been charged and your order has been cancelled. You can order again whenever you like.</p>
    ))
  }
  if (!paymentId) {
    return view('?', 'No payment reference', <p>We couldn't find a payment reference in the link.</p>)
  }
  if (payment?.status === 'succeeded') {
    return view('✓', 'Order paid', (
      <>
        <p>{payment.description ?? 'Your order'}: <strong>£{(payment.amount_pence / 100).toFixed(2)}</strong></p>
        <p>
          The pharmacy has your order and will be in touch on the number you gave. Stripe has emailed you a receipt.
          If your order includes a pharmacy medicine, a pharmacist checks your answers first, and you are refunded in full if it can't be supplied.
        </p>
      </>
    ))
  }
  if (payment && ['failed', 'canceled'].includes(payment.status)) {
    return view('✕', 'Payment not completed', (
      <p>Your payment didn't go through, so you have not been charged. Please try ordering again.</p>
    ))
  }
  if (timedOut) {
    return view('…', 'Payment processing', (
      <p>Your payment is still being confirmed. If you were charged, your order is safe and the pharmacy will see it shortly.</p>
    ))
  }
  return view('…', 'Confirming your payment…', <p>One moment while we confirm your payment with Stripe.</p>)
}
