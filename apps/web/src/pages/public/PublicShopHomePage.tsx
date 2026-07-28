// ============================================================
// PublicShopHomePage — /shop
// Marketplace landing: find pharmacy shops near you (Deliveroo
// style), search products across every shop, filter by delivery.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShopStore } from '@pharmstation/core'

const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`

async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const clean = postcode.trim().replace(/\s+/g, '')
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`)
    if (!res.ok) return null
    const json = await res.json()
    if (json?.result?.latitude != null) return { lat: json.result.latitude, lng: json.result.longitude }
    return null
  } catch {
    return null
  }
}

export function PublicShopHomePage() {
  const navigate = useNavigate()
  const {
    shopOrgs, publicProducts, categories, publicLoading, cart,
    fetchShopOrgs, fetchPublicProducts, fetchCategories,
  } = useShopStore()

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [locationLabel, setLocationLabel] = useState<string | null>(null)
  const [postcode, setPostcode] = useState('')
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [deliveryOnly, setDeliveryOnly] = useState(false)
  const [tab, setTab] = useState<'pharmacies' | 'products'>('pharmacies')

  useEffect(() => {
    fetchShopOrgs(location?.lat ?? null, location?.lng ?? null)
  }, [location, fetchShopOrgs])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  useEffect(() => {
    if (tab === 'products') {
      fetchPublicProducts({ categoryId: categoryId || undefined, search: search || undefined })
    }
  }, [tab, categoryId, search, fetchPublicProducts])

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocError('Location is not available in this browser.'); return }
    setLocating(true); setLocError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocationLabel('your location')
        setLocating(false)
      },
      () => { setLocError('Could not get your location — try a postcode instead.'); setLocating(false) },
      { timeout: 10000 }
    )
  }

  const usePostcode = async () => {
    if (!postcode.trim()) return
    setLocating(true); setLocError(null)
    const coords = await geocodePostcode(postcode)
    if (coords) {
      setLocation(coords)
      setLocationLabel(postcode.trim().toUpperCase())
    } else {
      setLocError('Postcode not found — please check and try again.')
    }
    setLocating(false)
  }

  const filteredOrgs = useMemo(() => {
    return shopOrgs.filter((o) => {
      if (deliveryOnly && !o.delivery_enabled) return false
      const q = search.toLowerCase()
      if (tab === 'pharmacies' && q) {
        return o.name.toLowerCase().includes(q)
          || (o.address?.postcode || '').toLowerCase().includes(q)
          || (o.address?.city || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [shopOrgs, deliveryOnly, search, tab])

  const orgById = useMemo(() => new Map(shopOrgs.map((o) => [o.org_id, o])), [shopOrgs])

  const filteredProducts = useMemo(() => {
    let list = publicProducts
    if (deliveryOnly) list = list.filter((p) => orgById.get(p.org_id)?.delivery_enabled)
    if (location) {
      list = [...list].sort((a, b) => {
        const da = orgById.get(a.org_id)?.distance_km ?? Infinity
        const db = orgById.get(b.org_id)?.distance_km ?? Infinity
        return da - db
      })
    }
    return list
  }, [publicProducts, deliveryOnly, orgById, location])

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0)

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
          <a href="/book" style={{ color: '#475569', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>Book a Service</a>
          <a href="/maps" style={{ color: '#475569', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>Find a Pharmacy</a>
          <a href="/patient/login" style={{ color: '#475569', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>Sign in</a>
          {cartCount > 0 && (
            <span style={{ background: '#0077B6', color: 'white', borderRadius: 999, padding: '4px 12px', fontSize: 13, fontWeight: 700 }}>
              🛒 {cartCount}
            </span>
          )}
        </nav>
      </header>

      {/* Hero + location */}
      <section style={{ background: 'linear-gradient(135deg, #0077B6, #00B4D8)', padding: '48px 24px', textAlign: 'center', color: 'white' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 32, fontWeight: 800, lineHeight: 1.2 }}>Pharmacy products, delivered near you</h1>
        <p style={{ margin: '0 0 24px', opacity: 0.9, fontSize: 16 }}>
          Browse products and services from local pharmacies. Collect in store or get them delivered.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 640, margin: '0 auto' }}>
          <button
            onClick={useMyLocation}
            disabled={locating}
            style={{ background: 'white', color: '#0077B6', border: 'none', borderRadius: 10, padding: '12px 20px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
          >
            📍 {locating ? 'Locating…' : 'Use my location'}
          </button>
          <div style={{ display: 'flex', background: 'white', borderRadius: 10, overflow: 'hidden' }}>
            <input
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') usePostcode() }}
              placeholder="Or enter a postcode…"
              style={{ border: 'none', outline: 'none', padding: '12px 14px', fontSize: 15, width: 180 }}
            />
            <button onClick={usePostcode} disabled={locating} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '0 18px', fontWeight: 700, cursor: 'pointer' }}>
              Go
            </button>
          </div>
        </div>
        {locationLabel && (
          <p style={{ margin: '14px 0 0', fontSize: 14, opacity: 0.95 }}>Showing results near <strong>{locationLabel}</strong></p>
        )}
        {locError && <p style={{ margin: '14px 0 0', fontSize: 14, background: 'rgba(0,0,0,0.25)', display: 'inline-block', padding: '6px 14px', borderRadius: 8 }}>{locError}</p>}
      </section>

      {/* Controls */}
      <div style={{ maxWidth: 1080, margin: '0 auto', width: '100%', padding: '24px 24px 0', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', background: 'white', borderRadius: 10, padding: 4, border: '1px solid #e2e8f0' }}>
            {(['pharmacies', 'products'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  background: tab === t ? '#0077B6' : 'transparent', color: tab === t ? 'white' : '#475569',
                }}
              >
                {t === 'pharmacies' ? '🏥 Pharmacies' : '📦 Products'}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'pharmacies' ? 'Search pharmacies…' : 'Search products…'}
            style={{ flex: 1, minWidth: 200, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 14 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#475569', fontWeight: 500, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 14px', cursor: 'pointer' }}>
            <input type="checkbox" checked={deliveryOnly} onChange={(e) => setDeliveryOnly(e.target.checked)} />
            🚚 Delivery only
          </label>
        </div>

        {/* Category chips (products tab) */}
        {tab === 'products' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              onClick={() => setCategoryId('')}
              style={{ border: '1px solid #e2e8f0', background: categoryId === '' ? '#0077B6' : 'white', color: categoryId === '' ? 'white' : '#475569', borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              All
            </button>
            {categories.filter((c) => !c.parent_id).map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                style={{ border: '1px solid #e2e8f0', background: categoryId === c.id ? '#0077B6' : 'white', color: categoryId === c.id ? 'white' : '#475569', borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <main style={{ flex: 1, maxWidth: 1080, margin: '0 auto', width: '100%', padding: 24, boxSizing: 'border-box' }}>
        {publicLoading && <p style={{ textAlign: 'center', color: '#64748b' }}>Loading…</p>}

        {tab === 'pharmacies' && !publicLoading && (
          filteredOrgs.length === 0 ? (
            <div style={{ background: 'white', borderRadius: 14, padding: 40, textAlign: 'center', color: '#64748b' }}>
              No pharmacy shops found{deliveryOnly ? ' offering delivery' : ''} yet. Check back soon — new pharmacies are joining the marketplace.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {filteredOrgs.map((o) => (
                <div
                  key={o.org_id}
                  onClick={() => navigate(`/shop/${o.slug || o.org_id}`)}
                  style={{ background: 'white', borderRadius: 14, padding: 20, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'transform .1s, box-shadow .1s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.10)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                    {o.public_logo_url ? (
                      <img src={o.public_logo_url} alt={o.name} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 48, height: 48, borderRadius: 10, background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🏥</div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>{o.name}</h3>
                      <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: 13 }}>
                        {[o.address?.city, o.address?.postcode].filter(Boolean).join(', ')}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {o.distance_km != null && (
                      <span style={{ background: '#f1f5f9', color: '#334155', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                        📍 {o.distance_km < 1 ? `${Math.round(o.distance_km * 1000)} m` : `${o.distance_km.toFixed(1)} km`}
                      </span>
                    )}
                    {o.delivery_enabled ? (
                      <span style={{ background: '#d1fae5', color: '#065f46', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                        🚚 Delivers up to {o.delivery_radius_km} km{o.delivery_fee_pence > 0 ? ` · ${formatPrice(o.delivery_fee_pence)}` : ' · Free'}
                      </span>
                    ) : (
                      <span style={{ background: '#f1f5f9', color: '#475569', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>🏪 Collection</span>
                    )}
                  </div>
                  {o.public_description && (
                    <p style={{ margin: '10px 0 0', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>{o.public_description}</p>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'products' && !publicLoading && (
          filteredProducts.length === 0 ? (
            <div style={{ background: 'white', borderRadius: 14, padding: 40, textAlign: 'center', color: '#64748b' }}>
              No products found. Try a different search or category.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {filteredProducts.map((p) => {
                const org = orgById.get(p.org_id)
                return (
                  <div
                    key={p.id}
                    onClick={() => navigate(`/shop/${org?.slug || p.org_id}`)}
                    style={{ background: 'white', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
                  >
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} style={{ width: '100%', height: 130, objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: 130, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>📦</div>
                    )}
                    <div style={{ padding: 14 }}>
                      <h4 style={{ margin: 0, fontSize: 14, color: '#0f172a' }}>{p.name}</h4>
                      <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12 }}>
                        {org?.name}{org?.distance_km != null ? ` · ${org.distance_km.toFixed(1)} km` : ''}
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                        <strong style={{ color: '#0077B6', fontSize: 15 }}>{formatPrice(p.price_pence)}</strong>
                        {p.stock_quantity === 0
                          ? <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Out of stock</span>
                          : <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>In stock</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </main>

      <footer style={{ textAlign: 'center', padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>
        © {new Date().getFullYear()} PharmStation · Orders are fulfilled directly by each pharmacy
      </footer>
    </div>
  )
}
