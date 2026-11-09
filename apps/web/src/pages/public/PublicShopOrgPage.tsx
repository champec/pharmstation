// ============================================================
// PublicShopOrgPage — /shop/:orgSlug
// A single pharmacy's shop front: product grid, cart drawer,
// and Phase 1 checkout (collection or delivery, pay in store /
// on delivery). Guests order with name + phone; patients who
// are signed in are linked automatically by the RPC.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useShopStore, type ShopFrontOrg } from '@pharmstation/core'
import type { ShopPlaceOrderResult, ShopQuestion } from '@pharmstation/types'
import { PublicFooter } from '../../components/public/PublicFooter'
import { usePageTitle } from '../../seo/RouteMeta'
import { confirmDialog } from '../../components/ui/dialog'

const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`
/** Most of one product a customer can put in the basket: stock, capped by the pharmacy's per-order limit. */
const maxQty = (p: { stock_quantity: number; max_per_order?: number | null }) =>
  p.max_per_order ? Math.min(p.stock_quantity, p.max_per_order) : p.stock_quantity

export function PublicShopOrgPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const {
    shopOrgs, publicProducts, categories, publicLoading,
    cart, cartOrgId,
    fetchShopOrgs, fetchPublicProducts, fetchCategories,
    addToCart, updateCartQuantity, removeFromCart, clearCart, syncCart, deliveryDistance, placeOrder, startShopCheckout,
  } = useShopStore()

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [cartOpen, setCartOpen] = useState(() => new URLSearchParams(location.search).get('basket') === 'open')
  const [checkoutOpen, setCheckoutOpen] = useState(false)

  // Checkout form
  const [fulfilment, setFulfilment] = useState<'collection' | 'delivery'>('collection')
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [addr1, setAddr1] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrPostcode, setAddrPostcode] = useState('')
  const [notes, setNotes] = useState('')
  const [placing, setPlacing] = useState(false)
  const [payBy, setPayBy] = useState<'card' | 'in_store'>('card')
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ShopPlaceOrderResult | null>(null)
  const [consultationAnswered, setConsultationAnswered] = useState(false)
  // Delivery area check: postcode looked up with postcodes.io, distance from the pharmacy by the database.
  const [area, setArea] = useState<{ postcode: string; state: 'checking' | 'ok' | 'outside' | 'unknown' | 'invalid'; km?: number; lat?: number; lng?: number } | null>(null)
  // questionnaire answers: productId -> questionId -> answer
  const [qAnswers, setQAnswers] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    if (!shopOrgs.length) fetchShopOrgs()
    fetchCategories()
  }, [fetchShopOrgs, fetchCategories, shopOrgs.length])

  const org: ShopFrontOrg | undefined = useMemo(
    () => shopOrgs.find((o) => o.slug === orgSlug || o.org_id === orgSlug),
    [shopOrgs, orgSlug]
  )
  usePageTitle(org ? `${org.name} shop` : null)

  useEffect(() => {
    if (org) fetchPublicProducts({ orgId: org.org_id })
  }, [org, fetchPublicProducts])

  // A saved basket may hold old prices or items that have since sold out.
  useEffect(() => {
    if (!publicLoading && publicProducts.length) syncCart(publicProducts)
  }, [publicLoading, publicProducts, syncCart])

  const checkPostcode = async (raw: string) => {
    const postcode = raw.trim().toUpperCase()
    if (!org || !postcode) { setArea(null); return }
    if (area?.postcode === postcode && area.state !== 'checking') return
    setArea({ postcode, state: 'checking' })
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`)
      if (res.status === 404) { setArea({ postcode, state: 'invalid' }); return }
      const body = await res.json()
      const lat = body?.result?.latitude as number | undefined
      const lng = body?.result?.longitude as number | undefined
      if (typeof lat !== 'number' || typeof lng !== 'number') { setArea({ postcode, state: 'unknown' }); return }
      const km = await deliveryDistance(org.org_id, lat, lng)
      if (km == null) { setArea({ postcode, state: 'unknown', lat, lng }); return }
      setArea({ postcode, state: km > org.delivery_radius_km ? 'outside' : 'ok', km, lat, lng })
    } catch {
      setArea({ postcode, state: 'unknown' })
    }
  }

  const products = useMemo(() => {
    return publicProducts.filter((p) => {
      if (org && p.org_id !== org.org_id) return false
      if (categoryId && p.category_id !== categoryId) return false
      const q = search.toLowerCase()
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [publicProducts, org, categoryId, search])

  const usedCategoryIds = useMemo(() => new Set(publicProducts.filter((p) => !org || p.org_id === org.org_id).map((p) => p.category_id)), [publicProducts, org])

  const cartForThisOrg = org && cartOrgId === org.org_id ? cart : []
  const cartOwner = cartOrgId ? shopOrgs.find((shopOrg) => shopOrg.org_id === cartOrgId) : undefined
  const cartCount = cart.reduce((n, c) => n + c.quantity, 0)
  const cartSubtotal = cartForThisOrg.reduce((n, c) => n + c.product.price_pence * c.quantity, 0)
  const hasCheckItems = cartForThisOrg.some((c) => c.product.requires_availability_check)
  const consultationItems = cartForThisOrg.filter((c) => c.product.questionnaire && c.product.questionnaire.questions.length > 0)

  const setAnswer = (productId: string, questionId: string, value: string) => {
    setQAnswers((prev) => ({ ...prev, [productId]: { ...(prev[productId] || {}), [questionId]: value } }))
  }

  const addProductToCart = async (product: typeof publicProducts[number]) => {
    if (cart.length && cartOrgId && cartOrgId !== product.org_id) {
      const shouldSwitch = await confirmDialog(
        `Your basket contains items from ${cartOwner?.name || 'another pharmacy'}. `
        + `Pharmacies are checked out separately, so starting an order with ${org?.name || 'this pharmacy'} will clear that basket. Continue?`,
      )
      if (!shouldSwitch) return
    }
    addToCart(product)
  }

  const missingRequiredAnswers = consultationItems.some((c) =>
    (c.product.questionnaire!.questions as ShopQuestion[]).some(
      (q) => q.required && !(qAnswers[c.product.id]?.[q.id] || '').trim()
    )
  )

  const deliveryFee = useMemo(() => {
    if (!org || fulfilment !== 'delivery') return 0
    if (org.free_delivery_threshold_pence != null && cartSubtotal >= org.free_delivery_threshold_pence) return 0
    return org.delivery_fee_pence
  }, [org, fulfilment, cartSubtotal])

  // Mirrors ps_shop_normalise_uk_phone on the server, for early feedback.
  const phoneDigits = guestPhone.replace(/[\s\-().]/g, '').replace(/^(\+44|0044)/, '0').replace(/^00?0/, '0')
  const phoneInvalid = guestPhone.trim() !== '' && !/^0[1-9]\d{8,9}$/.test(phoneDigits)

  const payOptions = org?.payment_options ?? 'in_store'
  const effectivePayBy: 'card' | 'in_store' = payOptions === 'both' ? payBy : payOptions === 'card' ? 'card' : 'in_store'

  const handlePlaceOrder = async () => {
    if (!org) return
    setPlacing(true); setCheckoutError(null)
    try {
      const responses = consultationItems.map((c) => ({
        product_id: c.product.id,
        questionnaire_id: c.product.questionnaire!.id,
        answers: (c.product.questionnaire!.questions as ShopQuestion[]).map((q) => ({
          question_id: q.id,
          label: q.label,
          answer: (qAnswers[c.product.id]?.[q.id] || '').trim(),
        })),
      }))
      const result = await placeOrder({
        orgId: org.org_id,
        fulfilmentMethod: fulfilment,
        deliveryAddress: fulfilment === 'delivery'
          ? {
              line_1: addr1.trim(),
              city: addrCity.trim(),
              postcode: addrPostcode.trim(),
              ...(area?.postcode === addrPostcode.trim().toUpperCase() && area.lat != null && area.lng != null
                ? { lat: area.lat, lng: area.lng }
                : {}),
            }
          : null,
        guestName: guestName.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        customerNotes: notes.trim() || undefined,
        responses,
        paymentMethod: effectivePayBy,
      })
      if (effectivePayBy === 'card') {
        // Hand over to Stripe Checkout; the result page confirms the payment.
        const base = `${window.location.origin}/shop/${orgSlug}/payment-result`
        const url = await startShopCheckout({
          orderId: result.order_id,
          successUrl: `${base}?order=${encodeURIComponent(result.order_number)}`,
          cancelUrl: `${base}?canceled=1&order=${encodeURIComponent(result.order_number)}`,
        })
        window.location.assign(url)
        return
      }
      setConsultationAnswered(responses.length > 0)
      setConfirmation(result)
      setCheckoutOpen(false)
      setCartOpen(false)
      setQAnswers({})
    } catch (e: any) {
      setCheckoutError(e.message)
    } finally {
      setPlacing(false)
    }
  }

  if (!publicLoading && shopOrgs.length && !org) {
    return (
      <div className="modern-shop patient-shop-missing">
        <div>
          <span className="modern-shop-wordmark">Pharm<span>Station</span></span>
          <h2>Shop not found</h2>
          <p>This pharmacy's shop is not available right now.</p>
          <button onClick={() => navigate('/shop')}>← Back to local shops</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modern-shop modern-store">
      <div className="modern-shop-offer">Order from your local pharmacy <span>•</span> Collect in store or get it delivered</div>
      <header className="modern-store-header">
        <button className="modern-shop-logo" type="button" onClick={() => navigate('/shop')}>
          <span className="modern-shop-wordmark">Pharm<span>Station</span></span><small>Shop</small>
        </button>
        <nav>
          <a href="/shop" onClick={(event) => { event.preventDefault(); navigate('/shop') }}>Shop all</a>
          <a href={`/book/${org?.slug || org?.org_id || ''}`} onClick={(event) => { event.preventDefault(); if (org) navigate(`/book/${org.slug || org.org_id}`) }}>Book a service</a>
          <button className="modern-store-basket" type="button" onClick={() => setCartOpen(true)}>
            <span>▢</span> Basket <b>{cartCount}</b>
          </button>
        </nav>
      </header>

      {org && (
        <section className="patient-shop-store-hero">
          <div className="patient-shop-store-identity">
            {org.public_logo_url ? (
              <img src={org.public_logo_url} alt={org.name} />
            ) : (
              <span className="patient-shop-store-logo" aria-hidden="true">{org.name.slice(0, 2).toUpperCase()}</span>
            )}
            <div>
              <span className="patient-shop-eyebrow">Local independent pharmacy</span>
              <h1>{org.name}</h1>
              <p>{[org.address?.line_1, org.address?.city, org.address?.postcode].filter(Boolean).join(', ')}</p>
              {org.public_description && <p className="patient-shop-store-description">{org.public_description}</p>}
            </div>
          </div>
          <div className="patient-shop-store-service">
            <div><span>Fulfilment</span><strong>{org.delivery_enabled ? 'Collection & local delivery' : 'Collection from pharmacy'}</strong></div>
            {org.delivery_enabled && <div><span>Delivery area</span><strong>Up to {org.delivery_radius_km} km · {org.delivery_fee_pence ? formatPrice(org.delivery_fee_pence) : 'Free'}</strong></div>}
            {org.free_delivery_threshold_pence != null && org.delivery_fee_pence > 0 && <div><span>Free delivery</span><strong>Orders over {formatPrice(org.free_delivery_threshold_pence)}</strong></div>}
            <a href={`/book/${org.slug || org.org_id}`} onClick={(event) => { event.preventDefault(); navigate(`/book/${org.slug || org.org_id}`) }}>Book a pharmacy service →</a>
          </div>
        </section>
      )}

      {org && (
        <section className="shop-legal-strip" aria-label="About this pharmacy">
          <div>
            <span>Registered pharmacy</span>
            <strong>{org.gphc_premises_number ? `GPhC premises ${org.gphc_premises_number}` : 'GPhC registered'}</strong>
            <a href="https://www.pharmacyregulation.org/registers/pharmacy" target="_blank" rel="noreferrer">Check the GPhC register</a>
          </div>
          {org.pharmacist_in_charge_name && (
            <div>
              <span>Pharmacist in charge</span>
              <strong>{org.pharmacist_in_charge_name}</strong>
              {org.pharmacist_in_charge_gphc && <small>GPhC {org.pharmacist_in_charge_gphc}</small>}
            </div>
          )}
          {(org.contact_phone || org.contact_email) && (
            <div>
              <span>Contact</span>
              {org.contact_phone && <a href={`tel:${org.contact_phone.replace(/\s/g, '')}`}>{org.contact_phone}</a>}
              {org.contact_email && <a href={`mailto:${org.contact_email}`}>{org.contact_email}</a>}
            </div>
          )}
          <div>
            <span>Your order</span>
            <Link to="/shop/order">Track an order</Link>
            <Link to="/shop/terms">Terms and returns</Link>
          </div>
        </section>
      )}

      <main className="patient-shop-store-main">
        <div className="patient-shop-store-heading"><div><span className="patient-shop-eyebrow">Shop the pharmacy</span><h2>Everyday health & wellbeing</h2></div><span>{products.length} product{products.length === 1 ? '' : 's'}</span></div>
        <div className="patient-shop-store-tools">
          <label className="patient-shop-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this pharmacy" /></label>
          <div className="patient-shop-categories">
            <button type="button" className={!categoryId ? 'active' : ''} onClick={() => setCategoryId('')}>All products</button>
            {categories.filter((category) => usedCategoryIds.has(category.id)).map((category) => <button type="button" key={category.id} className={categoryId === category.id ? 'active' : ''} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}
          </div>
        </div>

        {publicLoading && <div className="patient-shop-loading"><i /><span>Loading the pharmacy shelves…</span></div>}
        {!publicLoading && products.length === 0 && (
          <div className="patient-shop-empty"><strong>No products{search || categoryId ? ' match your filters' : ' are listed yet'}.</strong><span>Try another search or category.</span></div>
        )}
        <div className="patient-shop-store-products">
          {products.map((p) => {
            const inCart = cartForThisOrg.find((c) => c.product.id === p.id)
            const out = p.stock_quantity === 0
            return (
              <article key={p.id} className="patient-shop-store-product">
                <div className="patient-shop-store-product-media">{p.image_url ? <img src={p.image_url} alt={p.name} /> : <span className="modern-shop-product-placeholder">Product image</span>}{p.medicine_class === 'p' ? <b>Pharmacy medicine</b> : p.questionnaire && <b>Consultation</b>}</div>
                <div className="patient-shop-store-product-copy">
                  <small>{p.category?.name || 'Pharmacy product'}</small>
                  <h3>{p.name}</h3>
                  {p.description && <p>{p.description}</p>}
                  {p.requires_availability_check && <em>Pharmacy confirms availability</em>}
                  <div className="patient-shop-store-product-buy">
                    <strong>{formatPrice(p.price_pence)}</strong>
                    {out ? (
                      <span className="patient-shop-out">Out of stock</span>
                    ) : inCart ? (
                      <div className="patient-shop-quantity">
                        <button type="button" onClick={() => updateCartQuantity(p.id, inCart.quantity - 1)}>−</button><span>{inCart.quantity}</span><button type="button" onClick={() => addProductToCart(p)} disabled={inCart.quantity >= maxQty(p)} aria-label={`Add another ${p.name}`}>+</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => addProductToCart(p)}>Add to basket</button>
                    )}
                  </div>
                  {inCart && !out && inCart.quantity >= maxQty(p) && (
                    <small className="shop-max-note">
                      {p.max_per_order && maxQty(p) === p.max_per_order ? `Max ${p.max_per_order} per order` : `Only ${p.stock_quantity} in stock`}
                    </small>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </main>

      {/* Cart drawer */}
      {cartOpen && (
        <div className="patient-shop-overlay patient-shop-cart-overlay" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.4)' }} onClick={() => setCartOpen(false)}>
          <div className="patient-shop-cart-panel" style={{ background: 'white', width: 'min(420px, 100%)', height: '100%', padding: 24, boxSizing: 'border-box', overflowY: 'auto', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Your basket</h2>
              <button onClick={() => setCartOpen(false)} aria-label="Close basket" title="Close basket" style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: '#64748b' }}>×</button>
            </div>
            {cart.length === 0 ? (
              <p style={{ color: '#64748b' }}>Your basket is empty.</p>
            ) : cartOrgId !== org?.org_id ? (
              <div className="modern-store-other-cart">
                <span>Basket saved</span>
                <strong>{cartCount} item{cartCount === 1 ? '' : 's'} from {cartOwner?.name || 'another pharmacy'}</strong>
                <p>Each pharmacy is a separate order. Delivery charges and collection options are calculated by that pharmacy.</p>
                <button type="button" onClick={() => { setCartOpen(false); navigate(`/shop/${cartOwner?.slug || cartOrgId}?basket=open`) }}>Go to this basket</button>
                <button type="button" onClick={clearCart}>Empty basket</button>
              </div>
            ) : (
              <>
                <div style={{ flex: 1, display: 'grid', gap: 12, alignContent: 'start' }}>
                  {cartForThisOrg.map((c) => (
                    <div key={c.product.id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{c.product.name}</div>
                        <div style={{ color: '#64748b', fontSize: 13 }}>
                          {formatPrice(c.product.price_pence)} each
                          {c.quantity >= maxQty(c.product) && (c.product.max_per_order && maxQty(c.product) === c.product.max_per_order ? ` · max ${c.product.max_per_order} per order` : ` · only ${c.product.stock_quantity} in stock`)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => updateCartQuantity(c.product.id, c.quantity - 1)} style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer' }}>−</button>
                        <span style={{ fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{c.quantity}</span>
                        <button onClick={() => addToCart(c.product)} disabled={c.quantity >= maxQty(c.product)} style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', opacity: c.quantity >= maxQty(c.product) ? 0.4 : 1 }}>+</button>
                      </div>
                      <strong style={{ minWidth: 60, textAlign: 'right', fontSize: 14 }}>{formatPrice(c.product.price_pence * c.quantity)}</strong>
                      <button onClick={() => removeFromCart(c.product.id)} aria-label={`Remove ${c.product.name}`} title="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
                    <span>Subtotal</span><span>{formatPrice(cartSubtotal)}</span>
                  </div>
                  <button
                    onClick={() => { setCheckoutOpen(true); setCheckoutError(null); if (org && !org.collection_enabled && org.delivery_enabled) setFulfilment('delivery') }}
                    style={{ width: '100%', background: '#0077B6', color: 'white', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Checkout →
                  </button>
                  <button onClick={clearCart} style={{ width: '100%', background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, marginTop: 8, cursor: 'pointer' }}>
                    Empty basket
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {checkoutOpen && org && (
        <div className="patient-shop-overlay patient-shop-checkout-overlay" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)', padding: 16 }} onClick={() => setCheckoutOpen(false)}>
          <div className="patient-shop-checkout-panel" style={{ background: 'white', borderRadius: 16, padding: 28, width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#0f172a' }}>Checkout</h2>
            <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: 13 }}>
              {org.name} · {payOptions === 'card'
                ? 'Pay securely by card at the next step.'
                : payOptions === 'both'
                  ? 'Pay by card now, or when you collect or receive your order.'
                  : `Pay in store${org.delivery_enabled ? ' or on delivery' : ''}.`}
            </p>
            {payOptions === 'both' && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                {(['card', 'in_store'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={payBy === m ? 'selected' : ''}
                    onClick={() => setPayBy(m)}
                    style={{ flex: 1, border: payBy === m ? '2px solid #0077B6' : '1px solid #e2e8f0', background: payBy === m ? '#e0f2fe' : 'white', borderRadius: 10, padding: '12px 8px', fontWeight: 700, cursor: 'pointer', color: '#0f172a' }}
                  >
                    {m === 'card' ? 'Pay now by card' : `Pay ${fulfilment === 'delivery' ? 'on delivery' : 'in store'}`}
                  </button>
                ))}
              </div>
            )}

            {checkoutError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{checkoutError}</div>
            )}

            {/* Fulfilment */}
            <div className="modern-store-fulfilment" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {org.collection_enabled && (
                <button
                  className={fulfilment === 'collection' ? 'selected' : ''}
                  onClick={() => setFulfilment('collection')}
                  style={{ flex: 1, border: fulfilment === 'collection' ? '2px solid #0077B6' : '1px solid #e2e8f0', background: fulfilment === 'collection' ? '#e0f2fe' : 'white', borderRadius: 10, padding: '12px 8px', fontWeight: 700, cursor: 'pointer', color: '#0f172a' }}
                >
                  Collection
                </button>
              )}
              {org.delivery_enabled && (
                <button
                  className={fulfilment === 'delivery' ? 'selected' : ''}
                  onClick={() => setFulfilment('delivery')}
                  style={{ flex: 1, border: fulfilment === 'delivery' ? '2px solid #0077B6' : '1px solid #e2e8f0', background: fulfilment === 'delivery' ? '#e0f2fe' : 'white', borderRadius: 10, padding: '12px 8px', fontWeight: 700, cursor: 'pointer', color: '#0f172a' }}
                >
                  Delivery {org.delivery_fee_pence > 0 ? `(${formatPrice(org.delivery_fee_pence)})` : '(Free)'}
                </button>
              )}
            </div>

            {/* Contact */}
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                Your name *
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box' }} />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                Phone number *
                <input type="tel" inputMode="tel" autoComplete="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="07…" aria-invalid={phoneInvalid} style={{ width: '100%', border: `1px solid ${phoneInvalid ? '#f87171' : '#e2e8f0'}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box' }} />
                {phoneInvalid && <span style={{ display: 'block', marginTop: 4, color: '#b91c1c', fontSize: 12, fontWeight: 500 }}>Please enter a UK phone number, like 07700 900123.</span>}
              </label>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: 12 }}>
                Signed in as a patient? Your order links to your account automatically — name and phone are still used for this order's contact details.
              </p>

              {fulfilment === 'delivery' && (
                <>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                    Address line 1 *
                    <input value={addr1} onChange={(e) => setAddr1(e.target.value)} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box' }} />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                      City
                      <input value={addrCity} onChange={(e) => setAddrCity(e.target.value)} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box' }} />
                    </label>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                      Postcode *
                      <input value={addrPostcode} onChange={(e) => setAddrPostcode(e.target.value)} onBlur={(e) => void checkPostcode(e.target.value)} autoComplete="postal-code" aria-invalid={area?.state === 'outside' || area?.state === 'invalid'} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box' }} />
                    </label>
                  </div>
                  {area && area.postcode === addrPostcode.trim().toUpperCase() && (
                    <p className={`shop-area-note ${area.state}`} role={area.state === 'outside' || area.state === 'invalid' ? 'alert' : undefined}>
                      {area.state === 'checking' && 'Checking the pharmacy delivers to this postcode…'}
                      {area.state === 'ok' && `✓ About ${area.km!.toFixed(1)} km from the pharmacy. They deliver here.`}
                      {area.state === 'outside' && `Sorry, this postcode is about ${area.km!.toFixed(1)} km away and ${org.name} delivers up to ${org.delivery_radius_km} km.${org.collection_enabled ? ' You can choose collection instead.' : ''}`}
                      {area.state === 'invalid' && 'We couldn\'t find that postcode. Please check it.'}
                      {area.state === 'unknown' && 'We couldn\'t check this postcode right now. The pharmacy will confirm they can deliver to you.'}
                    </p>
                  )}
                </>
              )}

              <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                Notes for the pharmacy
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box', resize: 'vertical' }} />
              </label>
            </div>

            {hasCheckItems && (
              <div style={{ background: '#fef3c7', color: '#92400e', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginTop: 14 }}>
                Some items need the pharmacy to confirm availability. They'll contact you on the number above to confirm your order.
              </div>
            )}

            {/* Consultation questionnaires */}
            {consultationItems.map((c) => (
              <div className="modern-store-consultation" key={c.product.id} style={{ marginTop: 16, border: '1px solid #ede9fe', background: '#faf5ff', borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#5b21b6', marginBottom: 4 }}>
                  {c.product.questionnaire!.name}
                </div>
                <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: 12 }}>
                  Required for <strong>{c.product.name}</strong> — a pharmacist reviews your answers before the sale is completed.
                </p>
                <div style={{ display: 'grid', gap: 10 }}>
                  {(c.product.questionnaire!.questions as ShopQuestion[]).map((q) => (
                    <label key={q.id} style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                      {q.label}{q.required && ' *'}
                      {q.type === 'text' && (
                        <input
                          value={qAnswers[c.product.id]?.[q.id] || ''}
                          onChange={(e) => setAnswer(c.product.id, q.id, e.target.value)}
                          style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box' }}
                        />
                      )}
                      {q.type === 'yesno' && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          {['Yes', 'No'].map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setAnswer(c.product.id, q.id, opt)}
                              style={{
                                flex: 1, borderRadius: 8, padding: '8px 0', fontWeight: 700, cursor: 'pointer', fontSize: 13,
                                border: qAnswers[c.product.id]?.[q.id] === opt ? '2px solid #7c3aed' : '1px solid #e2e8f0',
                                background: qAnswers[c.product.id]?.[q.id] === opt ? '#ede9fe' : 'white',
                                color: '#334155',
                              }}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                      {q.type === 'choice' && (
                        <select
                          value={qAnswers[c.product.id]?.[q.id] || ''}
                          onChange={(e) => setAnswer(c.product.id, q.id, e.target.value)}
                          style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box', background: 'white' }}
                        >
                          <option value="">Select…</option>
                          {(q.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {/* Totals */}
            <div style={{ marginTop: 18, borderTop: '1px solid #f1f5f9', paddingTop: 14, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#64748b' }}>Subtotal</span><span>{formatPrice(cartSubtotal)}</span>
              </div>
              {fulfilment === 'delivery' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#64748b' }}>Delivery</span><span>{deliveryFee > 0 ? formatPrice(deliveryFee) : 'Free'}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16, marginTop: 6 }}>
                <span>Total to pay {effectivePayBy === 'card' ? 'now by card' : fulfilment === 'delivery' ? 'on delivery' : 'in store'}</span>
                <span>{formatPrice(cartSubtotal + deliveryFee)}</span>
              </div>
            </div>

            <p className="shop-checkout-terms">
              By placing this order you agree to the <Link to="/shop/terms" target="_blank">shop terms and returns</Link>.
              {org.name} uses your details to fulfil your order, as set out in our <Link to="/privacy" target="_blank">privacy notice</Link>.
            </p>

            <button
              onClick={handlePlaceOrder}
              disabled={placing || !guestName.trim() || !guestPhone.trim() || phoneInvalid || (fulfilment === 'delivery' && (!addr1.trim() || !addrPostcode.trim() || area?.state === 'outside' || area?.state === 'invalid' || area?.state === 'checking')) || missingRequiredAnswers}
              style={{ width: '100%', marginTop: 16, background: '#0077B6', color: 'white', border: 'none', borderRadius: 10, padding: '14px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: placing ? 0.6 : 1 }}
            >
              {placing
                ? (effectivePayBy === 'card' ? 'Opening secure payment…' : 'Placing order…')
                : missingRequiredAnswers ? 'Answer the questions above to continue'
                : effectivePayBy === 'card' ? `Pay ${formatPrice(cartSubtotal + deliveryFee)} by card` : 'Place order'}
            </button>
          </div>
        </div>
      )}

      {/* Order confirmation */}
      {confirmation && (
        <div className="patient-shop-overlay patient-shop-confirm-overlay" style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)', padding: 16 }}>
          <div className="patient-shop-confirm-panel" style={{ background: 'white', borderRadius: 16, padding: 32, width: 'min(440px, 100%)', textAlign: 'center', boxSizing: 'border-box' }}>
            <div aria-hidden="true" style={{ width: 64, height: 64, borderRadius: '50%', background: '#e5f2f0', color: '#137763', display: 'grid', placeItems: 'center', fontSize: 32, fontWeight: 800, margin: '0 auto 10px' }}>✓</div>
            <h2 style={{ margin: '0 0 6px', color: '#0f172a' }}>Order placed</h2>
            <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: 14 }}>
              Your order number is
            </p>
            <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 800, background: '#f1f5f9', borderRadius: 10, padding: '10px 0', marginBottom: 14, color: '#0f172a' }}>
              {confirmation.order_number}
            </div>
            <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
              {org?.name} has your order and will contact you on the number you gave if they need to.
              Total {formatPrice(confirmation.total_pence)}, to pay {fulfilment === 'delivery' ? 'on delivery' : 'when you collect'}.
              {consultationAnswered ? ' A pharmacist checks your answers before your order is prepared.' : ''}
              {' '}Keep your order number to track your order.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => { const n = confirmation.order_number; setConfirmation(null); navigate(`/shop/order/${n}`) }}
                style={{ background: '#0077B6', color: 'white', border: 'none', borderRadius: 10, padding: '12px 24px', fontWeight: 700, cursor: 'pointer' }}
              >
                Track your order
              </button>
              <button
                onClick={() => { setConfirmation(null) }}
                style={{ background: 'white', color: '#0f172a', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 24px', fontWeight: 700, cursor: 'pointer' }}
              >
                Keep shopping
              </button>
            </div>
          </div>
        </div>
      )}

      <PublicFooter />
    </div>
  )
}
