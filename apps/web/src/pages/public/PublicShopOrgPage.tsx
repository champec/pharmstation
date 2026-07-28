// ============================================================
// PublicShopOrgPage — /shop/:orgSlug
// A single pharmacy's shop front: product grid, cart drawer,
// and Phase 1 checkout (collection or delivery, pay in store /
// on delivery). Guests order with name + phone; patients who
// are signed in are linked automatically by the RPC.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useShopStore, type ShopFrontOrg } from '@pharmstation/core'
import type { ShopPlaceOrderResult, ShopQuestion } from '@pharmstation/types'

const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`

export function PublicShopOrgPage() {
  const navigate = useNavigate()
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const {
    shopOrgs, publicProducts, categories, publicLoading,
    cart, cartOrgId,
    fetchShopOrgs, fetchPublicProducts, fetchCategories,
    addToCart, updateCartQuantity, removeFromCart, clearCart, placeOrder,
  } = useShopStore()

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
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
  const cartCount = cartForThisOrg.reduce((n, c) => n + c.quantity, 0)
  const cartSubtotal = cartForThisOrg.reduce((n, c) => n + c.product.price_pence * c.quantity, 0)
  const hasCheckItems = cartForThisOrg.some((c) => c.product.requires_availability_check)
  const consultationItems = cartForThisOrg.filter((c) => c.product.questionnaire && c.product.questionnaire.questions.length > 0)

  const setAnswer = (productId: string, questionId: string, value: string) => {
    setQAnswers((prev) => ({ ...prev, [productId]: { ...(prev[productId] || {}), [questionId]: value } }))
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
      <div style={{ minHeight: '100vh', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'white', borderRadius: 14, padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 40, margin: '0 0 8px' }}>🏥</p>
          <h2 style={{ margin: '0 0 8px', color: '#0f172a' }}>Shop not found</h2>
          <p style={{ color: '#64748b', margin: '0 0 20px' }}>This pharmacy's shop is not available right now.</p>
          <button onClick={() => navigate('/shop')} style={{ background: '#0077B6', color: 'white', border: 'none', borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer' }}>
            ← Back to marketplace
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', display: 'flex', flexDirection: 'column' }}>
      {/* Nav bar */}
      <header style={{
        background: 'white', borderBottom: '1px solid #e2e8f0', padding: '0 24px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: '#0077B6', letterSpacing: '-0.5px', cursor: 'pointer' }} onClick={() => navigate('/shop')}>
          Pharm<span style={{ color: '#00B4D8' }}>Station</span>
          <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 700, background: '#e0f2fe', color: '#0369a1', borderRadius: 999, padding: '3px 10px', verticalAlign: 'middle' }}>Shop</span>
        </span>
        <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a href="/shop" onClick={(e) => { e.preventDefault(); navigate('/shop') }} style={{ color: '#475569', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>← All pharmacies</a>
          <button
            onClick={() => setCartOpen(true)}
            style={{ background: cartCount ? '#0077B6' : '#f1f5f9', color: cartCount ? 'white' : '#475569', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            🛒 Basket{cartCount ? ` (${cartCount})` : ''}
          </button>
        </nav>
      </header>

      {/* Pharmacy header */}
      {org && (
        <section style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '28px 24px' }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {org.public_logo_url ? (
              <img src={org.public_logo_url} alt={org.name} style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 64, height: 64, borderRadius: 14, background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>🏥</div>
            )}
            <div style={{ flex: 1, minWidth: 220 }}>
              <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>{org.name}</h1>
              <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
                {[org.address?.line_1, org.address?.city, org.address?.postcode].filter(Boolean).join(', ')}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {org.delivery_enabled ? (
                  <span style={{ background: '#d1fae5', color: '#065f46', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                    🚚 Delivery up to {org.delivery_radius_km} km · {org.delivery_fee_pence > 0 ? formatPrice(org.delivery_fee_pence) : 'Free'}
                    {org.free_delivery_threshold_pence != null && org.delivery_fee_pence > 0 ? ` (free over ${formatPrice(org.free_delivery_threshold_pence)})` : ''}
                  </span>
                ) : (
                  <span style={{ background: '#f1f5f9', color: '#475569', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>🏪 Collection only</span>
                )}
                <a
                  href={`/book/${org.slug || org.org_id}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/book/${org.slug || org.org_id}`) }}
                  style={{ background: '#e0f2fe', color: '#0369a1', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                >
                  📅 Book a service →
                </a>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Controls */}
      <div style={{ maxWidth: 1080, margin: '0 auto', width: '100%', padding: '20px 24px 0', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this shop…"
            style={{ flex: 1, minWidth: 200, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 14 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => setCategoryId('')}
            style={{ border: '1px solid #e2e8f0', background: categoryId === '' ? '#0077B6' : 'white', color: categoryId === '' ? 'white' : '#475569', borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            All
          </button>
          {categories.filter((c) => usedCategoryIds.has(c.id)).map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              style={{ border: '1px solid #e2e8f0', background: categoryId === c.id ? '#0077B6' : 'white', color: categoryId === c.id ? 'white' : '#475569', borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Product grid */}
      <main style={{ flex: 1, maxWidth: 1080, margin: '0 auto', width: '100%', padding: 24, boxSizing: 'border-box' }}>
        {publicLoading && <p style={{ textAlign: 'center', color: '#64748b' }}>Loading…</p>}
        {!publicLoading && products.length === 0 && (
          <div style={{ background: 'white', borderRadius: 14, padding: 40, textAlign: 'center', color: '#64748b' }}>
            No products{search || categoryId ? ' match your filters' : ' listed yet'}.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {products.map((p) => {
            const inCart = cartForThisOrg.find((c) => c.product.id === p.id)
            const out = p.stock_quantity === 0
            return (
              <div key={p.id} style={{ background: 'white', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} style={{ width: '100%', height: 130, objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: 130, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>📦</div>
                )}
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: '#0f172a' }}>{p.name}</h4>
                  {p.description && <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12, lineHeight: 1.45 }}>{p.description}</p>}
                  {p.requires_availability_check && (
                    <span style={{ marginTop: 6, alignSelf: 'flex-start', background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                      Pharmacy confirms availability
                    </span>
                  )}
                  {p.questionnaire && (
                    <span style={{ marginTop: 6, alignSelf: 'flex-start', background: '#ede9fe', color: '#5b21b6', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                      📝 Short consultation at checkout
                    </span>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 10 }}>
                    <strong style={{ color: '#0077B6', fontSize: 15 }}>{formatPrice(p.price_pence)}</strong>
                    {out ? (
                      <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Out of stock</span>
                    ) : inCart ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => updateCartQuantity(p.id, inCart.quantity - 1)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontWeight: 700 }}>−</button>
                        <span style={{ fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{inCart.quantity}</span>
                        <button
                          onClick={() => addToCart(p)}
                          disabled={inCart.quantity >= p.stock_quantity}
                          style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: '#0077B6', color: 'white', cursor: 'pointer', fontWeight: 700, opacity: inCart.quantity >= p.stock_quantity ? 0.4 : 1 }}
                        >+</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => addToCart(p)}
                        style={{ background: '#0077B6', color: 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Add
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {/* Cart drawer */}
      {cartOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.4)' }} onClick={() => setCartOpen(false)}>
          <div style={{ background: 'white', width: 'min(420px, 100%)', height: '100%', padding: 24, boxSizing: 'border-box', overflowY: 'auto', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>🛒 Your basket</h2>
              <button onClick={() => setCartOpen(false)} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: '#64748b' }}>×</button>
            </div>
            {cartForThisOrg.length === 0 ? (
              <p style={{ color: '#64748b' }}>Your basket is empty.</p>
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)', padding: 16 }} onClick={() => setCheckoutOpen(false)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 28, width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#0f172a' }}>Checkout</h2>
            <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: 13 }}>
              {org.name} · Pay in store{org.delivery_enabled ? ' or on delivery' : ''}. Online payment is coming soon.
            </p>

            {checkoutError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{checkoutError}</div>
            )}

            {/* Fulfilment */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                onClick={() => setFulfilment('collection')}
                style={{ flex: 1, border: fulfilment === 'collection' ? '2px solid #0077B6' : '1px solid #e2e8f0', background: fulfilment === 'collection' ? '#e0f2fe' : 'white', borderRadius: 10, padding: '12px 8px', fontWeight: 700, cursor: 'pointer', color: '#0f172a' }}
              >
                🏪 Collection
              </button>
              {org.delivery_enabled && (
                <button
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
              <div key={c.product.id} style={{ marginTop: 16, border: '1px solid #ede9fe', background: '#faf5ff', borderRadius: 12, padding: 16 }}>
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)', padding: 16 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 32, width: 'min(440px, 100%)', textAlign: 'center', boxSizing: 'border-box' }}>
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

      <footer style={{ textAlign: 'center', padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>
        © {new Date().getFullYear()} PharmStation · Orders are fulfilled directly by {org?.name || 'the pharmacy'}
      </footer>
    </div>
  )
}
