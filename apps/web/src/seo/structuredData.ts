// schema.org builders for the public pharmacy, service and product pages.
// Search engines read these to show the pharmacy's address, prices and stock in results.

import { SITE_URL } from './routeMeta'

interface Address { line_1?: string; line_2?: string; city?: string; postcode?: string; county?: string }

const postalAddress = (address: Address | null | undefined) => address && {
  '@type': 'PostalAddress',
  streetAddress: [address.line_1, address.line_2].filter(Boolean).join(', ') || undefined,
  addressLocality: address.city || undefined,
  addressRegion: address.county || undefined,
  postalCode: address.postcode || undefined,
  addressCountry: 'GB',
}

const price = (pence: number) => (pence / 100).toFixed(2)

export interface PharmacyLd {
  name: string
  slug: string
  address?: Address | null
  description?: string | null
  logo?: string | null
  point?: { lat: number; lng: number } | null
  gphc?: string | null
  phone?: string | null
  email?: string | null
  /** Bookable services, for the pharmacy's offer catalogue. */
  services?: Array<{ name: string; path: string; price_pence: number | null; description?: string | null }>
  /** Which public page this is: the booking page or the shop. */
  page?: 'book' | 'shop'
}

export function pharmacyId(slug: string) {
  return `${SITE_URL}/book/${slug}#pharmacy`
}

/** A Pharmacy (LocalBusiness) with address, location and what can be booked there. */
export function pharmacyJsonLd(p: PharmacyLd): Record<string, unknown> {
  return {
    '@type': 'Pharmacy',
    '@id': pharmacyId(p.slug),
    name: p.name,
    url: `${SITE_URL}/${p.page ?? 'book'}/${p.slug}`,
    description: p.description || undefined,
    image: p.logo || undefined,
    logo: p.logo || undefined,
    telephone: p.phone || undefined,
    email: p.email || undefined,
    address: postalAddress(p.address),
    geo: p.point ? { '@type': 'GeoCoordinates', latitude: p.point.lat, longitude: p.point.lng } : undefined,
    identifier: p.gphc ? { '@type': 'PropertyValue', propertyID: 'GPhC premises number', value: p.gphc } : undefined,
    hasOfferCatalog: p.services?.length ? {
      '@type': 'OfferCatalog',
      name: `Services at ${p.name}`,
      itemListElement: p.services.map((service) => ({
        '@type': 'Offer',
        url: `${SITE_URL}${service.path}`,
        price: service.price_pence ? price(service.price_pence) : undefined,
        priceCurrency: service.price_pence ? 'GBP' : undefined,
        itemOffered: { '@type': 'Service', name: service.name, description: service.description || undefined },
      })),
    } : undefined,
  }
}

/** One bookable service at one pharmacy. */
export function serviceJsonLd(s: {
  name: string
  description?: string | null
  path: string
  price_pence?: number | null
  pharmacy: PharmacyLd
  isVideo?: boolean
}): Array<Record<string, unknown>> {
  return [
    pharmacyJsonLd(s.pharmacy),
    {
      '@type': 'Service',
      name: s.name,
      description: s.description || undefined,
      url: `${SITE_URL}${s.path}`,
      serviceType: s.name,
      provider: { '@id': pharmacyId(s.pharmacy.slug) },
      areaServed: s.pharmacy.address?.city || undefined,
      availableChannel: s.isVideo ? { '@type': 'ServiceChannel', name: 'Video consultation' } : undefined,
      offers: s.price_pence ? { '@type': 'Offer', price: price(s.price_pence), priceCurrency: 'GBP', url: `${SITE_URL}${s.path}` } : undefined,
    },
    breadcrumbs([
      { name: 'Book', path: '/book' },
      { name: s.pharmacy.name, path: `/book/${s.pharmacy.slug}` },
      { name: s.name, path: s.path },
    ]),
  ]
}

/** One product from one pharmacy's shop. */
export function productJsonLd(p: {
  name: string
  description?: string | null
  image?: string | null
  path: string
  sku?: string | null
  price_pence: number
  inStock: boolean
  category?: string | null
  pharmacy: PharmacyLd
}): Array<Record<string, unknown>> {
  return [
    { ...pharmacyJsonLd({ ...p.pharmacy, page: 'shop' }), hasOfferCatalog: undefined },
    {
      '@type': 'Product',
      name: p.name,
      description: p.description || undefined,
      image: p.image || undefined,
      sku: p.sku || undefined,
      category: p.category || undefined,
      url: `${SITE_URL}${p.path}`,
      offers: {
        '@type': 'Offer',
        url: `${SITE_URL}${p.path}`,
        price: price(p.price_pence),
        priceCurrency: 'GBP',
        availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@id': pharmacyId(p.pharmacy.slug) },
      },
    },
    breadcrumbs([
      { name: 'Shop', path: '/shop' },
      { name: p.pharmacy.name, path: `/shop/${p.pharmacy.slug}` },
      { name: p.name, path: p.path },
    ]),
  ]
}

export function breadcrumbs(items: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  }
}
