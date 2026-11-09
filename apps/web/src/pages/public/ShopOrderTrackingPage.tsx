// ============================================================
// /shop/order and /shop/order/:orderNumber — public order tracking.
// The customer enters their order number (prefilled from the link in their
// text) and the phone number they ordered with. ps_shop_track_order only
// returns the order when both match.
// ============================================================

import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useShopStore, type ShopTrackedOrder } from '@pharmstation/core'
import { PublicFooter } from '../../components/public/PublicFooter'
import { usePageTitle } from '../../seo/RouteMeta'

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`

type Step = { key: string; label: string }

function stepsFor(o: ShopTrackedOrder): Step[] {
  const steps: Step[] = [{ key: 'placed', label: 'Order placed' }]
  if (o.review_status !== 'not_required') steps.push({ key: 'check', label: 'Pharmacist check' })
  steps.push({ key: 'confirmed', label: 'Being prepared' })
  if (o.fulfilment_method === 'delivery') {
    steps.push({ key: 'out_for_delivery', label: 'Out for delivery' }, { key: 'done', label: 'Delivered' })
  } else {
    steps.push({ key: 'ready', label: 'Ready to collect' }, { key: 'done', label: 'Collected' })
  }
  return steps
}

/** Index of the last step reached. */
function reached(o: ShopTrackedOrder, steps: Step[]): number {
  const at = (key: string) => steps.findIndex((s) => s.key === key)
  switch (o.status) {
    case 'completed':
    case 'collected':
      return at('done')
    case 'out_for_delivery':
      return at('out_for_delivery')
    case 'ready':
      return at('ready') >= 0 ? at('ready') : at('confirmed')
    case 'confirmed':
      return at('confirmed')
    default:
      if (o.review_status === 'approved') return at('check')
      return 0
  }
}

function headline(o: ShopTrackedOrder): { title: string; body: string } {
  if (o.status === 'cancelled') {
    const refund = ['paid', 'refunded', 'partially_refunded'].includes(o.payment_status)
      ? ' Your card payment has been refunded. It can take 5 to 10 days to show on your statement.'
      : ''
    const expired = o.payment_status === 'expired'
      ? ' The card payment wasn\'t completed, so you have not been charged.'
      : ''
    return { title: 'Order cancelled', body: `This order has been cancelled.${expired}${refund}` }
  }
  if (o.payment_status === 'awaiting_payment') {
    return { title: 'Waiting for payment', body: 'We haven\'t received your card payment yet. If you closed the payment page, the order is cancelled automatically after 45 minutes.' }
  }
  if (o.review_status === 'pending') {
    return { title: 'A pharmacist is checking your order', body: 'Your order includes a pharmacy medicine, so a pharmacist checks your answers before it is prepared. They may call you if they need to know more.' }
  }
  switch (o.status) {
    case 'new':
      return { title: 'Order received', body: 'The pharmacy has your order and will start preparing it soon.' }
    case 'confirmed':
      return { title: 'Being prepared', body: 'The pharmacy is getting your order ready.' }
    case 'ready':
      return o.fulfilment_method === 'collection'
        ? { title: 'Ready to collect', body: o.payment_method === 'card' ? 'Your order is ready. Pop in to collect it.' : `Your order is ready. Please pay ${money(o.total_pence)} when you collect.` }
        : { title: 'Ready for delivery', body: 'Your order is packed and will be sent out soon.' }
    case 'out_for_delivery':
      return { title: 'Out for delivery', body: o.payment_method === 'card' ? 'Your order is on its way.' : `Your order is on its way. Please have ${money(o.total_pence)} ready to pay.` }
    case 'collected':
      return { title: 'Collected', body: 'Thanks for shopping with your local pharmacy.' }
    case 'completed':
      return { title: o.fulfilment_method === 'delivery' ? 'Delivered' : 'Complete', body: 'Thanks for shopping with your local pharmacy.' }
    default:
      return { title: 'Order received', body: '' }
  }
}

export function ShopOrderTrackingPage() {
  usePageTitle('Track your order')
  const navigate = useNavigate()
  const params = useParams<{ orderNumber?: string }>()
  const trackOrder = useShopStore((s) => s.trackOrder)
  const [orderNumber, setOrderNumber] = useState(params.orderNumber?.toUpperCase() ?? '')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<ShopTrackedOrder | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const found = await trackOrder(orderNumber.trim(), phone.trim())
      if (!found) setError('We couldn\'t find an order with that number and phone number. Check both and try again.')
      setOrder(found)
    } catch {
      setError('Something went wrong. Please try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const steps = order ? stepsFor(order) : []
  const current = order ? reached(order, steps) : 0
  const head = order ? headline(order) : null
  const pharmacy = order?.pharmacy
  const pharmacyAddress = pharmacy?.address
    ? [pharmacy.address.line_1, pharmacy.address.city, pharmacy.address.postcode].filter(Boolean).join(', ')
    : ''

  return (
    <div className="booking-public shop-track">
      <header className="booking-nav">
        <button type="button" className="booking-wordmark" onClick={() => navigate('/shop')}>
          Pharm<span>Station</span><small>Shop</small>
        </button>
      </header>

      <main className="shop-track-main">
        {!order ? (
          <form className="shop-track-form" onSubmit={submit}>
            <span className="booking-eyebrow">Track your order</span>
            <h1>Where's my order?</h1>
            <p>Enter your order number and the phone number you ordered with.</p>
            {error && <div className="shop-track-error" role="alert">{error}</div>}
            <label>
              Order number
              <input
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
                placeholder="PS-1A2B3C4D"
                autoCapitalize="characters"
                autoComplete="off"
                required
              />
            </label>
            <label>
              Phone number
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07700 900123"
                required
              />
            </label>
            <button type="submit" className="booking-primary-action" disabled={busy || !orderNumber.trim() || !phone.trim()}>
              {busy ? 'Checking…' : 'Track order'}
            </button>
          </form>
        ) : (
          <section className="shop-track-result">
            <span className="booking-eyebrow">Order {order.order_number}</span>
            <h1>{head?.title}</h1>
            {head?.body && <p>{head.body}</p>}

            {order.status !== 'cancelled' && (
              <ol className="shop-track-steps" aria-label="Order progress">
                {steps.map((s, i) => (
                  <li key={s.key} className={i < current ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>
                    <i aria-hidden="true">{i < current || (i === current && s.key === 'done') ? '✓' : i + 1}</i>
                    <span>{s.label}</span>
                  </li>
                ))}
              </ol>
            )}

            <div className="shop-track-card">
              <h2>Your order</h2>
              <ul>
                {order.items.map((it, i) => (
                  <li key={i}><span>{it.quantity} × {it.name}</span><strong>{money(it.line_total_pence)}</strong></li>
                ))}
                {order.delivery_fee_pence > 0 && <li><span>Delivery</span><strong>{money(order.delivery_fee_pence)}</strong></li>}
                <li className="total"><span>Total</span><strong>{money(order.total_pence)}</strong></li>
              </ul>
              <p>
                {order.fulfilment_method === 'delivery' ? `Delivery${order.postcode ? ` to ${order.postcode}` : ''}` : 'Collection from the pharmacy'}
                {' · '}
                {order.payment_method === 'card'
                  ? (order.payment_status === 'paid' ? 'Paid by card' : order.payment_status === 'refunded' ? 'Refunded' : 'Card payment')
                  : order.fulfilment_method === 'delivery' ? 'Pay on delivery' : 'Pay when you collect'}
                {' · '}
                Ordered {new Date(order.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {pharmacy && (
              <div className="shop-track-card">
                <h2>{pharmacy.name}</h2>
                {pharmacyAddress && <p>{pharmacyAddress}</p>}
                <p>
                  Questions about your order?{' '}
                  {pharmacy.phone ? <>Call <a href={`tel:${pharmacy.phone.replace(/\s/g, '')}`}>{pharmacy.phone}</a></> : null}
                  {pharmacy.phone && pharmacy.email ? ' or email ' : pharmacy.email ? 'Email ' : null}
                  {pharmacy.email ? <a href={`mailto:${pharmacy.email}`}>{pharmacy.email}</a> : null}
                  {!pharmacy.phone && !pharmacy.email ? 'Contact the pharmacy.' : '.'}
                </p>
              </div>
            )}

            <div className="shop-track-actions">
              <button type="button" className="booking-secondary-action" onClick={() => setOrder(null)}>Track another order</button>
              <button type="button" className="booking-primary-action" onClick={() => navigate(pharmacy?.slug ? `/shop/${pharmacy.slug}` : '/shop')}>
                Back to the shop
              </button>
            </div>
          </section>
        )}
      </main>
      <PublicFooter />
    </div>
  )
}
