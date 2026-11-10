// ============================================================
// PublicShopProductPage — /shop/:orgSlug/:productSlug
// One product at one pharmacy: its own URL for search and ads,
// add to basket, and a clear note when a pharmacist checks it.
// Checkout (and any questionnaire) stays on the shop page.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ShieldCheck, ShoppingBasket, Store, Truck } from 'lucide-react'
import { useShopStore } from '@pharmstation/core'
import type { ShopProduct } from '@pharmstation/types'
import { AudienceSwitch } from '../../components/public/AudienceSwitch'
import { PublicFooter } from '../../components/public/PublicFooter'
import { confirmDialog } from '../../components/ui/dialog'
import { findBySlug, formatAddress, formatPounds, slugMap } from '../../lib/publicDirectory'
import { usePageMeta, useStructuredData } from '../../seo/RouteMeta'
import { productJsonLd } from '../../seo/structuredData'

/** Most of one product a customer can put in the basket: stock, capped by the pharmacy's per-order limit. */
const maxQty = (p: { stock_quantity: number; max_per_order?: number | null }) =>
  p.max_per_order ? Math.min(p.stock_quantity, p.max_per_order) : p.stock_quantity

export function PublicShopProductPage() {
  const navigate = useNavigate()
  const { orgSlug, productSlug } = useParams<{ orgSlug: string; productSlug: string }>()
  const {
    shopOrgs, publicProducts, publicLoading, cart, cartOrgId,
    fetchShopOrgs, fetchPublicProducts, addToCart, updateCartQuantity, syncCart,
  } = useShopStore()
  const [added, setAdded] = useState(false)
  const [shopsLoaded, setShopsLoaded] = useState(shopOrgs.length > 0)
  const [loadedOrg, setLoadedOrg] = useState<string | null>(null)

  useEffect(() => {
    if (shopOrgs.length) { setShopsLoaded(true); return }
    fetchShopOrgs().finally(() => setShopsLoaded(true))
  }, [fetchShopOrgs, shopOrgs.length])
  const org = useMemo(() => shopOrgs.find((o) => o.slug === orgSlug || o.org_id === orgSlug), [shopOrgs, orgSlug])
  useEffect(() => {
    if (!org) return
    fetchPublicProducts({ orgId: org.org_id }).finally(() => setLoadedOrg(org.org_id))
  }, [org, fetchPublicProducts])

  const orgProducts = useMemo(() => (org ? publicProducts.filter((p) => p.org_id === org.org_id) : []), [publicProducts, org])
  useEffect(() => { if (!publicLoading && orgProducts.length) syncCart(orgProducts) }, [publicLoading, orgProducts, syncCart])

  const slugs = useMemo(() => slugMap(orgProducts as Array<ShopProduct & { slug?: string | null }>), [orgProducts])
  const product = useMemo(() => findBySlug(orgProducts, slugs, productSlug), [orgProducts, slugs, productSlug])
  const orgSegment = org?.slug || org?.org_id || orgSlug || ''
  const productPath = product ? `/shop/${orgSegment}/${slugs.get(product.id)}` : ''
  // Links from search results use the product id; show the readable address instead.
  useEffect(() => {
    if (product && productPath && productSlug !== slugs.get(product.id)) navigate(productPath, { replace: true })
  }, [product, productPath, productSlug, slugs, navigate])
  const related = useMemo(() => {
    if (!product) return []
    const same = orgProducts.filter((p) => p.id !== product.id && p.category_id === product.category_id)
    const others = orgProducts.filter((p) => p.id !== product.id && p.category_id !== product.category_id)
    return [...same, ...others].slice(0, 4)
  }, [orgProducts, product])

  const town = org?.address?.city || org?.address?.postcode || ''
  usePageMeta(org && product ? {
    title: `${product.name} from ${org.name}${town ? `, ${town}` : ''}`,
    description: `${product.description ? `${product.description.replace(/\s+/g, ' ').slice(0, 140)} ` : ''}${formatPounds(product.price_pence)} from ${org.name}${town ? ` in ${town}` : ''}. ${org.delivery_enabled ? 'Click and collect or local delivery.' : 'Click and collect.'}`,
    image: product.image_url,
    canonicalPath: productPath,
    type: 'product',
  } : null)
  useStructuredData(org && product ? productJsonLd({
    name: product.name,
    description: product.description,
    image: product.image_url,
    path: productPath,
    sku: product.sku,
    price_pence: product.price_pence,
    inStock: product.stock_quantity > 0,
    category: product.category?.name,
    pharmacy: {
      name: org.name,
      slug: orgSegment,
      address: org.address,
      description: org.public_description,
      logo: org.public_logo_url,
      gphc: org.gphc_premises_number,
      phone: org.contact_phone,
      email: org.contact_email,
    },
  }) : null)

  const inCart = product && cartOrgId === product.org_id ? cart.find((c) => c.product.id === product.id) : undefined
  const cartCount = cart.reduce((n, c) => n + c.quantity, 0)
  const cartOwner = cartOrgId ? shopOrgs.find((o) => o.org_id === cartOrgId) : undefined

  const add = async () => {
    if (!product) return
    if (cart.length && cartOrgId && cartOrgId !== product.org_id) {
      const ok = await confirmDialog(
        `Your basket contains items from ${cartOwner?.name || 'another pharmacy'}. `
        + `Pharmacies are checked out separately, so starting an order with ${org?.name || 'this pharmacy'} will clear that basket. Continue?`,
      )
      if (!ok) return
    }
    addToCart(product)
    setAdded(true)
  }

  const notFound = shopsLoaded && (!org || (loadedOrg === org.org_id && !publicLoading && !product))

  return (
    <div className="modern-shop modern-store">
      <AudienceSwitch active="patients" />
      <header className="modern-store-header">
        <Link className="modern-shop-logo" to="/shop"><span className="modern-shop-wordmark">Pharm<span>Station</span></span><small>Shop</small></Link>
        <nav>
          <Link to="/shop">Shop all</Link>
          {org && <Link to={`/book/${orgSegment}`}>Book a service</Link>}
          <Link className="modern-store-basket" to={cartOrgId ? `/shop/${cartOwner?.slug || cartOrgId}?basket=open` : `/shop/${orgSegment}`}>
            <ShoppingBasket size={16} aria-hidden="true" /> Basket <b>{cartCount}</b>
          </Link>
        </nav>
      </header>

      {notFound ? (
        <main className="shop-product-missing">
          <h1>Product not available</h1>
          <p>This product isn't for sale online right now. It may have sold out or been removed.</p>
          <Link to={org ? `/shop/${orgSegment}` : '/shop'}>{org ? `See everything at ${org.name}` : 'Back to the shop'}</Link>
        </main>
      ) : !org || !product ? (
        <div className="patient-shop-loading"><i /><span>Loading product…</span></div>
      ) : (
        <main className="shop-product">
          <nav className="shop-product-crumbs" aria-label="Breadcrumb">
            <Link to="/shop">Shop</Link> / <Link to={`/shop/${orgSegment}`}>{org.name}</Link>
            {product.category && <> / <span>{product.category.name}</span></>}
          </nav>

          <section className="shop-product-main">
            <div className="shop-product-media">
              {product.image_url ? <img src={product.image_url} alt={product.name} /> : <span>No image</span>}
            </div>
            <div className="shop-product-info">
              {product.category && <small>{product.category.name}</small>}
              <h1>{product.name}</h1>
              <p className="shop-product-seller">Sold and dispatched by <Link to={`/shop/${orgSegment}`}>{org.name}</Link>{town && `, ${town}`}</p>
              <strong className="shop-product-price">{formatPounds(product.price_pence)}</strong>

              {product.medicine_class === 'p' && (
                <div className="shop-product-check">
                  <ShieldCheck size={20} aria-hidden="true" />
                  <div><strong>Pharmacy medicine</strong><span>You'll answer a few short questions at checkout. A pharmacist checks your answers before your order is ready, and may contact you.</span></div>
                </div>
              )}
              {product.medicine_class !== 'p' && product.questionnaire && (
                <div className="shop-product-check">
                  <ShieldCheck size={20} aria-hidden="true" />
                  <div><strong>Quick consultation</strong><span>You'll answer a few short questions at checkout so the pharmacy team can check this product is right for you.</span></div>
                </div>
              )}
              {product.requires_availability_check && <p className="shop-product-note">The pharmacy confirms availability before your order is ready.</p>}

              <div className="shop-product-buy">
                {product.stock_quantity === 0 ? (
                  <span className="patient-shop-out">Out of stock</span>
                ) : inCart ? (
                  <>
                    <div className="patient-shop-quantity">
                      <button type="button" onClick={() => updateCartQuantity(product.id, inCart.quantity - 1)} aria-label={`Remove one ${product.name}`}>−</button>
                      <span>{inCart.quantity}</span>
                      <button type="button" onClick={add} disabled={inCart.quantity >= maxQty(product)} aria-label={`Add another ${product.name}`}>+</button>
                    </div>
                    <button type="button" className="shop-product-primary" onClick={() => navigate(`/shop/${orgSegment}?basket=open`)}>Go to basket</button>
                  </>
                ) : (
                  <button type="button" className="shop-product-primary" onClick={add}>Add to basket</button>
                )}
              </div>
              {inCart && inCart.quantity >= maxQty(product) && (
                <small className="shop-max-note">
                  {product.max_per_order && maxQty(product) === product.max_per_order ? `Max ${product.max_per_order} per order` : `Only ${product.stock_quantity} in stock`}
                </small>
              )}
              {added && inCart && <p className="shop-product-added" role="status"><Check size={16} aria-hidden="true" /> Added to your basket</p>}

              <ul className="shop-product-fulfilment">
                {org.collection_enabled && <li><Store size={16} aria-hidden="true" /> Free click and collect from {org.name}</li>}
                {org.delivery_enabled && <li><Truck size={16} aria-hidden="true" /> Local delivery up to {org.delivery_radius_km} km{org.delivery_fee_pence ? `, ${formatPounds(org.delivery_fee_pence)}` : ', free'}{org.free_delivery_threshold_pence != null && org.delivery_fee_pence > 0 ? ` (free over ${formatPounds(org.free_delivery_threshold_pence)})` : ''}</li>}
              </ul>

              {product.description && (
                <div className="shop-product-description">
                  <h2>About this product</h2>
                  <p>{product.description}</p>
                </div>
              )}
            </div>
          </section>

          <section className="shop-legal-strip" aria-label="About this pharmacy">
            <div>
              <span>Registered pharmacy</span>
              <strong>{org.name}</strong>
              <small>{org.gphc_premises_number ? `GPhC premises ${org.gphc_premises_number}` : 'GPhC registered'}</small>
              <a href="https://www.pharmacyregulation.org/registers/pharmacy" target="_blank" rel="noreferrer">Check the GPhC register</a>
            </div>
            <div>
              <span>Address</span>
              <strong>{formatAddress(org.address)}</strong>
            </div>
            {org.pharmacist_in_charge_name && (
              <div>
                <span>Pharmacist in charge</span>
                <strong>{org.pharmacist_in_charge_name}</strong>
                {org.pharmacist_in_charge_gphc && <small>GPhC {org.pharmacist_in_charge_gphc}</small>}
              </div>
            )}
            <div>
              <span>Your order</span>
              <Link to="/shop/order">Track an order</Link>
              <Link to="/shop/terms">Terms and returns</Link>
            </div>
          </section>

          {related.length > 0 && (
            <section className="shop-product-related">
              <h2>More from {org.name}</h2>
              <div>
                {related.map((p) => (
                  <Link key={p.id} to={`/shop/${orgSegment}/${slugs.get(p.id)}`}>
                    {p.image_url ? <img src={p.image_url} alt="" /> : <span aria-hidden="true" />}
                    <strong>{p.name}</strong>
                    <b>{formatPounds(p.price_pence)}</b>
                  </Link>
                ))}
              </div>
              <Link className="shop-product-all" to={`/shop/${orgSegment}`}><ArrowLeft size={16} aria-hidden="true" /> See everything at {org.name}</Link>
            </section>
          )}
        </main>
      )}
      <PublicFooter />
    </div>
  )
}
