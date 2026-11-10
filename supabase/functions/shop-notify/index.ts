import '../_shared/monitoring.ts' // platform error tracking (see _shared/monitoring.ts)
// ============================================================
// shop-notify — texts shop customers about their order.
//
// Called by the database (trigger ps_shop_order_text_customer, through
// pg_net) with the x-internal-secret header, never by browsers. Deploy with
// verify_jwt off: the secret is the check.
//
//   order_event { order_id, event }
//     event: placed | ready | out_for_delivery | cancelled
//
// Texts go out in the pharmacy's name using its SMS settings and credits
// (sendPatientSms). Nothing is sent when the pharmacy has SMS off. Each event
// is texted at most once per order; the result is kept on
// ps_shop_orders.customer_texts.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'
import { sendPatientSms } from '../_shared/patient-sms.ts'

const EVENTS = ['placed', 'ready', 'out_for_delivery', 'cancelled'] as const
type ShopEvent = typeof EVENTS[number]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function appUrl() {
  return (Deno.env.get('PUBLIC_APP_URL') || 'https://pharmstation.co.uk').replace(/\/+$/, '')
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`

type Order = {
  id: string
  org_id: string
  order_number: string
  status: string
  review_status: string
  payment_method: string
  payment_status: string
  fulfilment_method: string
  guest_name: string | null
  guest_phone: string | null
  patient_id: string | null
  total_pence: number
  customer_texts: Record<string, unknown> | null
}

export function buildText(
  event: ShopEvent,
  o: Order,
  pharmacy: { name: string; phone: string | null },
  firstName: string | null,
): string {
  const track = `${appUrl()}/shop/order/${o.order_number}`
  const hi = firstName ? `Hi ${firstName}, ` : ''
  const payLater = o.payment_method !== 'card'
  switch (event) {
    case 'placed': {
      const check = o.review_status === 'pending' ? ' A pharmacist will check it before it is prepared.' : ''
      return `${pharmacy.name}: ${hi}thanks for your order ${o.order_number} (${money(o.total_pence)}).${check} Track it at ${track}`
    }
    case 'ready': {
      const pay = payLater ? ` Please pay ${money(o.total_pence)} when you collect.` : ''
      return `${pharmacy.name}: ${hi}your order ${o.order_number} is ready to collect.${pay}`
    }
    case 'out_for_delivery': {
      const pay = payLater ? ` Please have ${money(o.total_pence)} ready to pay the driver.` : ''
      return `${pharmacy.name}: ${hi}your order ${o.order_number} is out for delivery today.${pay}`
    }
    case 'cancelled': {
      const refund = o.payment_status === 'refunded' || o.payment_status === 'partially_refunded' || o.payment_status === 'paid'
        ? ' Your card payment is being refunded. It can take 5 to 10 days to show.'
        : ''
      const call = pharmacy.phone ? ` Questions? Call us on ${pharmacy.phone}.` : ''
      return `${pharmacy.name}: ${hi}your order ${o.order_number} has been cancelled.${refund}${call}`
    }
  }
}

async function orderEvent(req: Request, body: Record<string, unknown>) {
  const db = admin()
  const { data: secret } = await db.from('ps_internal_secrets').select('value').eq('key', 'shop_notify_secret').maybeSingle()
  const given = req.headers.get('x-internal-secret') ?? ''
  if (!secret?.value || given.length !== secret.value.length || given !== secret.value) {
    return json({ error: 'Forbidden' }, 403)
  }

  const orderId = typeof body.order_id === 'string' && UUID.test(body.order_id) ? body.order_id : null
  const event = EVENTS.find((e) => e === body.event)
  if (!orderId || !event) return json({ error: 'Bad request' }, 400)

  const { data: order } = await db.from('ps_shop_orders')
    .select('id, org_id, order_number, status, review_status, payment_method, payment_status, fulfilment_method, guest_name, guest_phone, patient_id, total_pence, customer_texts')
    .eq('id', orderId).maybeSingle()
  if (!order) return json({ error: 'Order not found' }, 404)
  const o = order as Order
  if (o.customer_texts && event in o.customer_texts) return json({ skipped: 'already_sent' })

  // Record the event before sending so a retry can't text twice.
  const claimed = { ...(o.customer_texts ?? {}), [event]: { at: new Date().toISOString(), sent: false } }
  await db.from('ps_shop_orders').update({ customer_texts: claimed }).eq('id', o.id)

  const [{ data: org }, { data: settings }, patient] = await Promise.all([
    db.from('ps_organisations').select('name').eq('id', o.org_id).maybeSingle(),
    db.from('ps_shop_settings').select('contact_phone').eq('org_id', o.org_id).maybeSingle(),
    o.patient_id
      ? db.from('ps_patients').select('first_name, phone').eq('id', o.patient_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ])

  const phone = o.guest_phone || (patient as { phone?: string | null } | null)?.phone || null
  const first = (o.guest_name ?? '').trim().split(/\s+/)[0] || (patient as { first_name?: string | null } | null)?.first_name || null
  const text = buildText(event, o, { name: org?.name ?? 'Your pharmacy', phone: settings?.contact_phone ?? null }, first)

  const result = await sendPatientSms(db, {
    org_id: o.org_id,
    patient_id: o.patient_id,
    phone,
    body: text,
    feature: 'shop',
    reference: `shop:${o.order_number}:${event}`,
  })

  await db.from('ps_shop_orders').update({
    customer_texts: { ...claimed, [event]: { at: new Date().toISOString(), sent: result.sent, reason: result.reason ?? null } },
  }).eq('id', o.id)

  return json(result)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
  try {
    if (body.action === 'order_event') return await orderEvent(req, body)
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    console.error('shop-notify failed', e)
    return json({ error: 'Something went wrong' }, 500)
  }
})
