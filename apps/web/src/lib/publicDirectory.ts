import { useEffect, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'

/** A bookable service as listed in the public pharmacy directory. */
export interface DirectoryService {
  id: string
  slug: string | null
  name: string
  price_pence: number | null
  duration_minutes: number
  is_video: boolean
}

/** One public pharmacy and what a patient can do there. */
export interface DirectoryPharmacy {
  org_id: string
  name: string
  slug: string | null
  address: Record<string, string> | null
  public_logo_url: string | null
  public_description: string | null
  distance_km: number | null
  latitude: number | null
  longitude: number | null
  shop_enabled: boolean
  delivery_enabled: boolean
  product_count: number
  services: DirectoryService[]
}

export interface LatLng { lat: number; lng: number }

/** Path segment for a pharmacy: its slug, or its id for older rows. */
export const orgPath = (org: { slug?: string | null; org_id?: string; id?: string }) =>
  org.slug || org.org_id || org.id || ''

export { slugify, slugMap, findBySlug } from './slugs'
import { slugMap } from './slugs'

export const formatAddress = (address: Record<string, string> | null | undefined) =>
  [address?.line_1, address?.city, address?.postcode].filter(Boolean).join(', ')

export const formatPounds = (pence: number) => `£${(pence / 100).toFixed(2)}`

/** Looks up a UK postcode (postcodes.io). Null when it isn't a real postcode. */
export async function geocodePostcode(postcode: string): Promise<LatLng | null> {
  const clean = postcode.trim().replace(/\s+/g, '')
  if (!clean) return null
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`)
    if (!response.ok) return null
    const json = await response.json()
    return json?.result?.latitude != null ? { lat: json.result.latitude, lng: json.result.longitude } : null
  } catch {
    return null
  }
}

/** Browser location, or null if the visitor says no or it times out. */
export function currentLocation(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(null),
      { timeout: 10000 },
    )
  })
}

// Anonymous visitors may only read these columns (column grants on ps_organisations).
const PUBLIC_ORG_COLUMNS = 'id, name, slug, address, public_description, public_logo_url, geolocation'

/** Reads a PostGIS point that PostgREST returns as hex EWKB ("0101000020E6100000" + x + y). */
export function parseEwkbPoint(hex: unknown): LatLng | null {
  if (typeof hex !== 'string' || !/^[0-9a-f]+$/i.test(hex) || hex.length < 50) return null
  const bytes = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)))
  const view = new DataView(bytes.buffer)
  const little = bytes[0] === 1
  const type = view.getUint32(1, little)
  const offset = 5 + (type & 0x20000000 ? 4 : 0)
  if (bytes.length < offset + 16) return null
  const lng = view.getFloat64(offset, little)
  const lat = view.getFloat64(offset + 8, little)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

/** Straight-line distance in km. */
export function distanceKm(a: LatLng, b: LatLng) {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

// Built only from reads anon already has: public pharmacy columns, public services (RLS)
// and the shop list RPC. No extra database function is needed.
async function loadDirectory(location: LatLng | null): Promise<DirectoryPharmacy[]> {
  const client = getUserClient()
  const [orgsRes, servicesRes, shopsRes] = await Promise.all([
    client.from('ps_organisations').select(PUBLIC_ORG_COLUMNS).eq('is_public', true).eq('is_active', true).order('name'),
    client.from('ps_services').select('*').eq('is_public', true).eq('is_active', true).order('name'),
    client.rpc('ps_shop_list_orgs', { p_lat: null, p_lng: null }),
  ])
  if (orgsRes.error) throw orgsRes.error
  const shops = new Map(((shopsRes.data ?? []) as any[]).map((shop) => [shop.org_id, shop]))
  const services = ((servicesRes.data ?? []) as any[]).filter((service) => !service.archived_at)

  const rows: DirectoryPharmacy[] = ((orgsRes.data ?? []) as any[]).map((org) => {
    const point = parseEwkbPoint(org.geolocation)
    const shop = shops.get(org.id)
    const orgServices = services.filter((service) => service.org_id === org.id)
    const slugs = slugMap(orgServices)
    return {
      org_id: org.id,
      name: org.name,
      slug: org.slug,
      address: org.address,
      public_logo_url: org.public_logo_url,
      public_description: org.public_description,
      distance_km: point && location ? distanceKm(location, point) : null,
      latitude: point?.lat ?? null,
      longitude: point?.lng ?? null,
      shop_enabled: !!shop,
      delivery_enabled: !!shop?.delivery_enabled,
      product_count: 0,
      services: orgServices
        .map((service) => ({
          id: service.id,
          slug: slugs.get(service.id) ?? null,
          name: service.name,
          price_pence: service.is_chargeable && service.price_pence > 0 ? service.price_pence : null,
          duration_minutes: service.duration_minutes,
          is_video: !!service.is_video,
        })),
    }
  })
  return location
    ? rows.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity))
    : rows
}

/** Public pharmacies, nearest first once a location is set. */
export function usePharmacyDirectory(location: LatLng | null) {
  const [pharmacies, setPharmacies] = useState<DirectoryPharmacy[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadDirectory(location)
      .then((rows) => { if (!cancelled) setPharmacies(rows) })
      .catch(() => { if (!cancelled) setPharmacies([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [location?.lat, location?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  return { pharmacies, loading }
}

/** Does a free-text search match this service? Matches every word, in any order. */
export function matchesQuery(text: string, query: string) {
  const haystack = text.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word))
}
