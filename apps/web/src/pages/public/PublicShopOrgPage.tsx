// ============================================================
// PublicShopOrgPage — /shop/:orgSlug
// A single pharmacy's shop front: product grid, cart drawer,
// and Phase 1 checkout (collection or delivery, pay in store /
// on delivery). Guests order with name + phone; patients who
// are signed in are linked automatically by the RPC.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useShopStore, type ShopFrontOrg } from '@pharmstation/core'
import type { ShopPlaceOrderResult, ShopQuestion } from '@pharmstation/types'
import { PublicFooter } from '../../components/public/PublicFooter'

const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`

export function PublicShopOrgPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const {
    shopOrgs, publicProducts, categories, publicLoading,
    cart, cartOrgId,
    fetchShopOrgs, fetchPublicProducts, fetchCategories,
    addToCart, updateCartQuantity, removeFromCart, clearCart, placeOrder,
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
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ShopPlaceOrderResult | null>(null)
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

  useEffect(() => {
    if (org) fetchPublicProducts({ orgId: org.org_id })
  }, [org, fetchPublicProducts])

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

  const addProductToCart = (product: typeof publicProducts[number]) => {
    if (cart.length && cartOrgId && cartOrgId !== product.org_id) {
      const shouldSwitch = window.confirm(
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
          ? { line_1: addr1.trim(), city: addrCity.trim(), postcode: addrPostcode.trim() }
          : null,
        guestName: guestName.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        customerNotes: notes.trim() || undefined,
        responses,
      })
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
      <div className="modern-shop-offer">Order from your local pharmacy <span>•</span> Pay in store or on delivery</div>
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

      <main className="patient-shop-store-main">
        <div className="patient-shop-store-heading"><div><span className="patient-shop-eyebrow">Shop the pharmacy</span><h2>Everyday health & wellbeing</h2></div><span>{products.length} products</span></div>
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
                <div className="patient-shop-store-product-media">{p.image_url ? <img src={p.image_url} alt={p.name} /> : <span className="modern-shop-product-placeholder">Product image</span>}{p.questionnaire && <b>Consultation</b>}</div>
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
                        <button type="button" onClick={() => updateCartQuantity(p.id, inCart.quantity - 1)}>−</button><span>{inCart.quantity}</span><button type="button" onClick={() => addProductToCart(p)} disabled={inCart.quantity >= p.stock_quantity}>+</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => addProductToCart(p)}>Add to basket</button>
                    )}
                  </div>
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
              <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>🛒 Your basket</h2>
              <button onClick={() => setCartOpen(false)} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: '#64748b' }}>×</button>
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
                        <div style={{ color: '#64748b', fontSize: 13 }}>{formatPrice(c.product.price_pence)} each</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => updateCartQuantity(c.product.id, c.quantity - 1)} style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer' }}>−</button>
                        <span style={{ fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{c.quantity}</span>
                        <button onClick={() => addToCart(c.product)} disabled={c.quantity >= c.product.stock_quantity} style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', opacity: c.quantity >= c.product.stock_quantity ? 0.4 : 1 }}>+</button>
                      </div>
                      <strong style={{ minWidth: 60, textAlign: 'right', fontSize: 14 }}>{formatPrice(c.product.price_pence * c.quantity)}</strong>
                      <button onClick={() => removeFromCart(c.product.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>🗑️</button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
                    <span>Subtotal</span><span>{formatPrice(cartSubtotal)}</span>
                  </div>
                  <button
                    onClick={() => { setCheckoutOpen(true); setCheckoutError(null) }}
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
              {org.name} · Pay in store{org.delivery_enabled ? ' or on delivery' : ''}. Online payment is coming soon.
            </p>

            {checkoutError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{checkoutError}</div>
            )}

            {/* Fulfilment */}
            <div className="modern-store-fulfilment" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                className={fulfilment === 'collection' ? 'selected' : ''}
                onClick={() => setFulfilment('collection')}
                style={{ flex: 1, border: fulfilment === 'collection' ? '2px solid #0077B6' : '1px solid #e2e8f0', background: fulfilment === 'collection' ? '#e0f2fe' : 'white', borderRadius: 10, padding: '12px 8px', fontWeight: 700, cursor: 'pointer', color: '#0f172a' }}
              >
                🏪 Collection
              </button>
              {org.delivery_enabled && (
                <button
                  className={fulfilment === 'delivery' ? 'selected' : ''}
                  onClick={() => setFulfilment('delivery')}
                  style={{ flex: 1, border: fulfilment === 'delivery' ? '2px solid #0077B6' : '1px solid #e2e8f0', background: fulfilment === 'delivery' ? '#e0f2fe' : 'white', borderRadius: 10, padding: '12px 8px', fontWeight: 700, cursor: 'pointer', color: '#0f172a' }}
                >
                  🚚 Delivery {org.delivery_fee_pence > 0 ? `(${formatPrice(org.delivery_fee_pence)})` : '(Free)'}
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
                <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="07…" style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box' }} />
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
                      <input value={addrPostcode} onChange={(e) => setAddrPostcode(e.target.value)} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, marginTop: 4, boxSizing: 'border-box' }} />
                    </label>
                  </div>
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
                  📝 {c.product.questionnaire!.name}
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
                <span>Total to pay {fulfilment === 'delivery' ? 'on delivery' : 'in store'}</span>
                <span>{formatPrice(cartSubtotal + deliveryFee)}</span>
              </div>
            </div>

            <button
              onClick={handlePlaceOrder}
              disabled={placing || !guestName.trim() || !guestPhone.trim() || (fulfilment === 'delivery' && (!addr1.trim() || !addrPostcode.trim())) || missingRequiredAnswers}
              style={{ width: '100%', marginTop: 16, background: '#0077B6', color: 'white', border: 'none', borderRadius: 10, padding: '14px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: placing ? 0.6 : 1 }}
            >
              {placing ? 'Placing order…' : missingRequiredAnswers ? 'Answer the questions above to continue' : 'Place order'}
            </button>
          </div>
        </div>
      )}

      {/* Order confirmation */}
      {confirmation && (
        <div className="patient-shop-overlay patient-shop-confirm-overlay" style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)', padding: 16 }}>
          <div className="patient-shop-confirm-panel" style={{ background: 'white', borderRadius: 16, padding: 32, width: 'min(440px, 100%)', textAlign: 'center', boxSizing: 'border-box' }}>
            <div style={{ fontSize: 52, marginBottom: 8 }}>✅</div>
            <h2 style={{ margin: '0 0 6px', color: '#0f172a' }}>Order placed!</h2>
            <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: 14 }}>
              Your order number is
            </p>
            <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 800, background: '#f1f5f9', borderRadius: 10, padding: '10px 0', marginBottom: 14, color: '#0f172a' }}>
              {confirmation.order_number}
            </div>
            <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
              {org?.name} has received your order and will be in touch on the number you provided.
              Total {formatPrice(confirmation.total_pence)} — payable {fulfilment === 'delivery' ? 'on delivery' : 'in store on collection'}.
            </p>
            <button
              onClick={() => { setConfirmation(null); navigate('/shop') }}
              style={{ background: '#0077B6', color: 'white', border: 'none', borderRadius: 10, padding: '12px 24px', fontWeight: 700, cursor: 'pointer' }}
            >
              Back to marketplace
            </button>
          </div>
        </div>
      )}

      <PublicFooter />
    </div>
  )
}
