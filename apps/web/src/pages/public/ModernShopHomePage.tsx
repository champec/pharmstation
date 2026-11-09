import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { AudienceSwitch } from '../../components/public/AudienceSwitch'
import { useShopStore } from '@pharmstation/core'
import { PublicFooter } from '../../components/public/PublicFooter'

const HERO_SLIDES = [
  { key: 'everyday', image: '/images/shop-hero.webp', label: 'Everyday essentials', match: null },
  { key: 'vitamins', image: '/images/hero-vitamins.webp', label: 'Vitamins and supplements', match: /vitamin|supplement/i },
  { key: 'skincare', image: '/images/hero-skincare.webp', label: 'Skin care', match: /skin|toiletries|personal care/i },
  { key: 'coldflu', image: '/images/hero-coldflu.webp', label: 'Cold, flu and allergy', match: /cold|flu|allerg|hay ?fever/i },
  { key: 'baby', image: '/images/hero-baby.webp', label: 'Baby and child', match: /baby|child/i },
] as const
const HERO_INTERVAL_MS = 6000

const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`

async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim().replace(/\s+/g, ''))}`)
    if (!response.ok) return null
    const json = await response.json()
    return json?.result?.latitude != null ? { lat: json.result.latitude, lng: json.result.longitude } : null
  } catch {
    return null
  }
}

export function ModernShopHomePage() {
  const navigate = useNavigate()
  const {
    shopOrgs, publicProducts, categories, publicLoading, cart, cartOrgId,
    fetchShopOrgs, fetchPublicProducts, fetchCategories,
    updateCartQuantity, removeFromCart, clearCart,
  } = useShopStore()
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [locationLabel, setLocationLabel] = useState('Set delivery location')
  const [postcode, setPostcode] = useState('')
  const [locationOpen, setLocationOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [categoryId, setCategoryId] = useState('')
  const [deliveryOnly, setDeliveryOnly] = useState(false)
  const [view, setView] = useState<'products' | 'pharmacies'>('products')
  const [basketOpen, setBasketOpen] = useState(false)
  const [heroIndex, setHeroIndex] = useState(0)
  const [heroPaused, setHeroPaused] = useState(false)

  useEffect(() => {
    fetchShopOrgs(location?.lat ?? null, location?.lng ?? null)
  }, [location, fetchShopOrgs])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  useEffect(() => {
    fetchPublicProducts({ categoryId: categoryId || undefined, search: search || undefined })
  }, [categoryId, search, fetchPublicProducts])

  const setPostcodeLocation = async () => {
    if (!postcode.trim()) return
    setLocating(true)
    setLocationError(null)
    const coordinates = await geocodePostcode(postcode)
    if (coordinates) {
      setLocation(coordinates)
      setLocationLabel(postcode.trim().toUpperCase())
      setLocationOpen(false)
    } else {
      setLocationError('Postcode not found. Check it and try again.')
    }
    setLocating(false)
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Location is unavailable. Enter a postcode instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ lat: coords.latitude, lng: coords.longitude })
        setLocationLabel('Current location')
        setLocationOpen(false)
        setLocating(false)
      },
      () => {
        setLocationError('We could not find your location. Enter a postcode instead.')
        setLocating(false)
      },
      { timeout: 10000 },
    )
  }

  const orgById = useMemo(() => new Map(shopOrgs.map((org) => [org.org_id, org])), [shopOrgs])
  const products = useMemo(() => {
    const result = deliveryOnly
      ? publicProducts.filter((product) => orgById.get(product.org_id)?.delivery_enabled)
      : publicProducts
    return location ? [...result].sort((left, right) =>
      (orgById.get(left.org_id)?.distance_km ?? Infinity) - (orgById.get(right.org_id)?.distance_km ?? Infinity)
    ) : result
  }, [publicProducts, deliveryOnly, location, orgById])
  const pharmacies = useMemo(() => shopOrgs.filter((org) => {
    if (deliveryOnly && !org.delivery_enabled) return false
    const query = search.toLowerCase()
    return !query || `${org.name} ${org.address?.city || ''} ${org.address?.postcode || ''}`.toLowerCase().includes(query)
  }), [shopOrgs, deliveryOnly, search])
  const rootCategories = categories.filter((category) => !category.parent_id)
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])
  const heroSlides = useMemo(() => {
    const withImages = products.filter((product) => product.image_url)
    const categoryText = (categoryId: string | null) => {
      const category = categoryId ? categoryById.get(categoryId) : undefined
      const parent = category?.parent_id ? categoryById.get(category.parent_id) : undefined
      return `${category?.name ?? ''} ${parent?.name ?? ''}`
    }
    return HERO_SLIDES.map((slide) => {
      const matched = slide.match ? withImages.filter((product) => slide.match!.test(categoryText(product.category_id))) : []
      const filler = withImages.filter((product) => !matched.includes(product))
      return { ...slide, products: [...matched, ...(slide.match ? [] : filler)].slice(0, 3) }
    }).filter((slide, index) => index === 0 || slide.products.length > 0)
  }, [products, categoryById])
  const activeHeroIndex = heroIndex % heroSlides.length
  const heroProducts = heroSlides[activeHeroIndex]?.products ?? []
  useEffect(() => {
    if (heroPaused || heroSlides.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setHeroIndex((index) => (index + 1) % heroSlides.length), HERO_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [heroPaused, heroSlides.length])
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0)
  const cartSubtotal = cart.reduce((total, item) => total + item.product.price_pence * item.quantity, 0)
  const cartOrg = cartOrgId ? orgById.get(cartOrgId) : undefined

  const openProductShop = (orgId: string, openBasket = false) => {
    const org = orgById.get(orgId)
    navigate(`/shop/${org?.slug || orgId}${openBasket ? '?basket=open' : ''}`)
  }

  return <div className="modern-shop">
    <AudienceSwitch active="patients" />
    <div className="modern-shop-offer">Free collection from participating pharmacies <span>•</span> Pharmacist support when you need it</div>
    <header className="modern-shop-header">
      <button type="button" className="modern-shop-logo" onClick={() => navigate('/shop')}><span className="modern-shop-wordmark">Pharm<span>Station</span></span><small>Shop</small></button>
      <button type="button" className="modern-shop-location" onClick={() => setLocationOpen(true)}><span>⌖</span><div><small>Shopping near</small><strong>{locationLabel}</strong></div><b>⌄</b></button>
      <label className="modern-shop-global-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search medicines, wellness and everyday care" /><kbd>Search</kbd></label>
      <nav>
        <a href="/book">Services</a>
        <a href="/patient/login">Account</a>
        <button type="button" aria-label={`Open basket with ${cartCount} item${cartCount === 1 ? '' : 's'}`} className="modern-shop-basket" onClick={() => setBasketOpen(true)}><span>▢</span><b>{cartCount}</b></button>
      </nav>
    </header>

    <nav className="modern-shop-department-nav" aria-label="Shop departments">
      <button type="button" className={!categoryId ? 'active' : ''} onClick={() => { setCategoryId(''); setView('products') }}>Shop all</button>
      {rootCategories.map((category) => <button type="button" key={category.id} className={categoryId === category.id ? 'active' : ''} onClick={() => { setCategoryId(category.id); setView('products') }}>{category.name}</button>)}
      <button type="button" onClick={() => setView('pharmacies')}>Local pharmacies</button>
    </nav>

    {locationOpen && <div className="modern-shop-location-popover">
      <button type="button" aria-label="Close location picker" onClick={() => setLocationOpen(false)}>×</button>
      <strong>Where should we look?</strong><p>Set your location to see nearby stock and delivery options.</p>
      <div><input value={postcode} onChange={(event) => setPostcode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setPostcodeLocation() }} placeholder="Enter postcode" /><button type="button" disabled={locating} onClick={setPostcodeLocation}>Apply</button></div>
      <button type="button" className="modern-shop-use-location" disabled={locating} onClick={useCurrentLocation}>⌖ {locating ? 'Finding you…' : 'Use current location'}</button>
      {locationError && <span>{locationError}</span>}
    </div>}

    {basketOpen && <div className="modern-shop-cart-overlay" onClick={() => setBasketOpen(false)}>
      <aside className="modern-shop-cart-drawer" role="dialog" aria-modal="true" aria-labelledby="marketplace-basket-title" onClick={(event) => event.stopPropagation()}>
        <header><div><span>Your order</span><h2 id="marketplace-basket-title">Basket</h2></div><button type="button" aria-label="Close basket" onClick={() => setBasketOpen(false)}>×</button></header>
        {!cart.length ? <div className="modern-shop-cart-empty"><span>▢</span><strong>Your basket is empty</strong><p>Choose a pharmacy and add products to begin an order.</p><button type="button" onClick={() => { setBasketOpen(false); document.getElementById('shop-products')?.scrollIntoView({ behavior: 'smooth' }) }}>Browse products</button></div> : <>
          <div className="modern-shop-cart-pharmacy"><span>Fulfilled by</span><strong>{cartOrg?.name || 'Selected pharmacy'}</strong><p>Each pharmacy is checked out separately. Delivery is calculated once for this pharmacy at checkout.</p></div>
          <div className="modern-shop-cart-items">{cart.map((item) => <article key={item.product.id}>
            {item.product.image_url ? <img src={item.product.image_url} alt="" /> : <span className="modern-shop-cart-item-placeholder">Product</span>}
            <div><strong>{item.product.name}</strong><small>{formatPrice(item.product.price_pence)} each</small><div><button type="button" aria-label={`Decrease ${item.product.name}`} onClick={() => updateCartQuantity(item.product.id, item.quantity - 1)}>−</button><span>{item.quantity}</span><button type="button" aria-label={`Increase ${item.product.name}`} disabled={item.quantity >= item.product.stock_quantity} onClick={() => updateCartQuantity(item.product.id, item.quantity + 1)}>+</button></div></div>
            <button type="button" className="modern-shop-cart-remove" aria-label={`Remove ${item.product.name}`} onClick={() => removeFromCart(item.product.id)}>×</button>
          </article>)}</div>
          <footer><div><span>Subtotal</span><strong>{formatPrice(cartSubtotal)}</strong></div><small>Collection is free. Any pharmacy delivery charge is shown before you place the order.</small><button type="button" onClick={() => { setBasketOpen(false); openProductShop(cartOrgId || cart[0].product.org_id, true) }}>Review and checkout</button><button type="button" className="modern-shop-cart-clear" onClick={clearCart}>Empty basket</button></footer>
        </>}
      </aside>
    </div>}

    <main>
      {!search && !categoryId && view === 'products' && <>
        <section className="modern-shop-hero">
          <div className="modern-shop-hero-copy"><span>Local pharmacy, made effortless</span><h1>Health essentials.<br />Ready when you are.</h1><p>Browse nearby pharmacy stock, choose collection or delivery, and get pharmacist-led support for products that need it.</p><div><button type="button" onClick={() => document.getElementById('shop-products')?.scrollIntoView({ behavior: 'smooth' })}>Shop essentials</button><button type="button" onClick={() => setView('pharmacies')}>Choose a pharmacy</button></div></div>
          <div className="modern-shop-hero-products" aria-roledescription="carousel" aria-label="Featured products" onMouseEnter={() => setHeroPaused(true)} onMouseLeave={() => setHeroPaused(false)} onFocus={() => setHeroPaused(true)} onBlur={() => setHeroPaused(false)}>
            {heroSlides.map((slide, index) => <div key={slide.key} className={`modern-shop-hero-slide${index === activeHeroIndex ? ' is-active' : ''}`} style={{ backgroundImage: `url(${slide.image})` }} aria-hidden="true" />)}
            {heroProducts.length ? heroProducts.map((product, index) => <button type="button" key={`${heroSlides[activeHeroIndex]?.key}-${product.id}`} className={`modern-shop-hero-card item-${index + 1}`} onClick={() => navigate(`/shop/${orgById.get(product.org_id)?.slug || product.org_id}/${product.id}`)}><img src={product.image_url!} alt={product.name} /><span>{product.name}</span><b>{formatPrice(product.price_pence)}</b></button>) : <div className="modern-shop-hero-placeholder"><b>Everyday care</b><small>Products from pharmacies near you</small></div>}
            {heroSlides.length > 1 && <div className="modern-shop-hero-dots" role="tablist" aria-label="Choose a featured range">{heroSlides.map((slide, index) => <button type="button" role="tab" key={slide.key} aria-selected={index === activeHeroIndex} aria-label={slide.label} className={index === activeHeroIndex ? 'is-active' : ''} onClick={() => setHeroIndex(index)} />)}</div>}
          </div>
        </section>

        <section className="modern-shop-benefits"><div><span>✓</span><strong>Pharmacy fulfilled</strong><small>Prepared by a real local team</small></div><div><span>⌖</span><strong>Collection or delivery</strong><small>Options shown before checkout</small></div><div><span>＋</span><strong>Clinical confidence</strong><small>Consultation when a product requires it</small></div><div><span>↗</span><strong>Simple ordering</strong><small>Pay by card, in store or on delivery</small></div></section>

        {rootCategories.length > 0 && <section className="modern-shop-departments"><div className="modern-shop-section-title"><div><span>Browse by need</span><h2>Shop departments</h2></div><button type="button" onClick={() => document.getElementById('shop-products')?.scrollIntoView()}>View everything →</button></div><div>{rootCategories.slice(0, 8).map((category) => <button type="button" key={category.id} onClick={() => setCategoryId(category.id)}><span>{category.name.slice(0, 1).toUpperCase()}</span><strong>{category.name}</strong><small>Explore products</small></button>)}</div></section>}
      </>}

      <section className="modern-shop-catalog" id="shop-products">
        <header><div><span>{view === 'products' ? categoryId ? 'Selected department' : search ? 'Search results' : 'Popular nearby' : 'Choose where to shop'}</span><h2>{view === 'products' ? categoryId ? rootCategories.find((category) => category.id === categoryId)?.name : search ? `Results for “${search}”` : 'Everyday pharmacy picks' : 'Pharmacies near you'}</h2></div><div className="modern-shop-catalog-actions"><div><button type="button" className={view === 'products' ? 'active' : ''} onClick={() => setView('products')}>Products</button><button type="button" className={view === 'pharmacies' ? 'active' : ''} onClick={() => setView('pharmacies')}>Pharmacies</button></div><label><input type="checkbox" checked={deliveryOnly} onChange={(event) => setDeliveryOnly(event.target.checked)} /> Delivery only</label></div></header>

        {publicLoading && <div className="modern-shop-loading"><i /><span>Stocking the shelves…</span></div>}
        {!publicLoading && view === 'products' && (products.length ? <div className="modern-shop-product-grid">{products.map((product) => {
          const org = orgById.get(product.org_id)
          const href = `/shop/${org?.slug || product.org_id}/${product.id}`
          return <article key={product.id} className="modern-shop-product-card">
            <Link to={href} className="modern-shop-product-image">{product.image_url ? <img src={product.image_url} alt={product.name} /> : <span className="modern-shop-product-placeholder">Product image</span>}{product.medicine_class === 'p' ? <em>Pharmacy medicine</em> : product.questionnaire && <em>Pharmacist check</em>}{product.stock_quantity === 0 && <b>Out of stock</b>}</Link>
            <div><small>{product.category?.name || 'Pharmacy essentials'}</small><Link to={href} className="modern-shop-product-name">{product.name}</Link><p>{org?.name || 'Local pharmacy'}{org?.distance_km != null ? ` · ${org.distance_km.toFixed(1)} km` : ''}</p><footer><strong>{formatPrice(product.price_pence)}</strong><Link to={href} aria-label={`View ${product.name}`}><Plus size={18} aria-hidden="true" /></Link></footer></div>
          </article>
        })}</div> : <div className="modern-shop-empty"><span>⌕</span><strong>No products found</strong><p>Try another search or browse all departments.</p><button type="button" onClick={() => { setSearch(''); setCategoryId('') }}>Clear filters</button></div>)}

        {!publicLoading && view === 'pharmacies' && (pharmacies.length ? <div className="modern-shop-pharmacy-grid">{pharmacies.map((org) => <article key={org.org_id}><button type="button" onClick={() => navigate(`/shop/${org.slug || org.org_id}`)}>{org.public_logo_url ? <img src={org.public_logo_url} alt="" /> : <span aria-hidden="true">{org.name.slice(0, 2).toUpperCase()}</span>}<div><small>{org.distance_km != null ? `${org.distance_km.toFixed(1)} km away` : org.address?.city || 'Local pharmacy'}</small><h3>{org.name}</h3><p>{org.public_description || 'Browse health, wellbeing and everyday pharmacy products.'}</p><footer><b>{org.delivery_enabled ? 'Delivery available' : 'Collection'}</b><span>Visit shop →</span></footer></div></button></article>)}</div> : <div className="modern-shop-empty"><span>⌖</span><strong>No pharmacies match</strong><p>Try removing the delivery filter or setting another location.</p></div>)}
      </section>
    </main>

    <PublicFooter />
  </div>
}