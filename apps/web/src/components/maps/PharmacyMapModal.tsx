// ============================================================
// PharmacyMapModal
// Full-screen map of UK pharmacies with NHS live data,
// PharmStation highlighting, and messaging integration.
// ============================================================

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import Map, {
  Source,
  Layer,
  NavigationControl,
  GeolocateControl,
  type MapRef,
  type MapMouseEvent,
} from 'react-map-gl/mapbox'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
type CircleLayer = mapboxgl.CircleLayer
type SymbolLayer = mapboxgl.SymbolLayer
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import { useMapboxToken } from '../../hooks/useMapboxToken'

// ── Types ───────────────────────────────────────────────────

interface BoundsPharmacy {
  pharmacy_id: number
  ods_code: string
  organisation_name: string
  address1: string | null
  address2: string | null
  city: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  contacts: { Tel?: { ContactMethodCode?: string; ContactAvailabilityType?: string; ContactType?: string; OrganisationContactValue?: string }[] } | null
  opening_times: unknown | null
  services: unknown | null
  is_on_platform: boolean
  linked_org_id: string | null
  linked_org_name: string | null
}

interface NhsPharmacyData {
  found: boolean
  name?: string
  phone?: string
  email?: string
  url?: string
  address?: string
  last_updated?: string
  regular_hours?: Record<string, { open: string; close: string; isOpen: boolean }[]>
  special_dates?: { date: string; open: string; close: string; isOpen: boolean }[]
}

interface SelectedPharmacy extends BoundsPharmacy {
  nhsData?: NhsPharmacyData | null
  nhsLoading?: boolean
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onAddToOutreach?: (pharmacy: BoundsPharmacy) => void
  trackedPharmacyIds?: number[]
}

// Recipient shape passed via navigation state to NetworkComposePage
export interface MapRecipient {
  orgId: string
  orgName: string
  pharmacyName: string
  ods: string
  city: string | null
  distanceKm: number | null
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const UK_CENTER: [number, number] = [-1.5, 52.5]
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// Radius (km) → approximate Mapbox zoom level
const RADIUS_ZOOM: Record<number, number> = { 1: 14, 2: 13, 5: 12, 10: 11, 25: 10, 50: 9 }
const RADIUS_OPTIONS = [1, 2, 5, 10, 25, 50]

function buildNhsLookupUrl(odsCode: string) {
  return `${SUPABASE_URL}/functions/v1/nhs-pharmacy-lookup?ods=${encodeURIComponent(odsCode)}`
}

// ── isOpenNow ────────────────────────────────────────────────

function isOpenNow(pharmacy: BoundsPharmacy): boolean {
  type OTRow = { Weekday?: string; OpeningTime?: string | null; ClosingTime?: string | null; IsOpen?: boolean; OpeningTimeType?: string }
  const rows: OTRow[] = Array.isArray(pharmacy.opening_times)
    ? (pharmacy.opening_times as OTRow[])
    : (typeof pharmacy.opening_times === 'string'
        ? (() => { try { return JSON.parse(pharmacy.opening_times as string) } catch { return false } })()
        : [])
  if (!Array.isArray(rows) || rows.length === 0) return false

  // Use UK local time
  const ukNow = new Date(new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }))
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const today = weekdays[ukNow.getDay()]
  const nowMins = ukNow.getHours() * 60 + ukNow.getMinutes()

  const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }

  return rows
    .filter((r) => r.Weekday === today && r.IsOpen === true && (r.OpeningTimeType === 'General' || !r.OpeningTimeType))
    .some((slot) => {
      if (!slot.OpeningTime || !slot.ClosingTime) return false
      return nowMins >= toMins(slot.OpeningTime) && nowMins <= toMins(slot.ClosingTime)
    })
}

// ── GeoJSON builder ─────────────────────────────────────────

function toGeoJson(pharmacies: BoundsPharmacy[]) {
  return {
    type: 'FeatureCollection' as const,
    features: pharmacies
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.longitude!, p.latitude!] },
        properties: { ...p },
      })),
  }
}

// ── Layer styles ─────────────────────────────────────────────

const clusterCircleLayer: CircleLayer = {
  id: 'clusters',
  type: 'circle',
  source: 'pharmacies',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': ['step', ['get', 'point_count'], '#00B4D8', 10, '#0096C7', 50, '#0077B6'],
    'circle-radius': ['step', ['get', 'point_count'], 18, 10, 26, 50, 32],
    'circle-opacity': 0.85,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
}

const clusterCountLayer: SymbolLayer = {
  id: 'cluster-count',
  type: 'symbol',
  source: 'pharmacies',
  filter: ['has', 'point_count'],
  layout: {
    'text-field': '{point_count_abbreviated}',
    'text-size': 13,
    'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
  },
  paint: { 'text-color': '#ffffff' },
}

// SVG sources for custom icons
const PS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <circle cx="18" cy="18" r="16" fill="#00E5FF" stroke="#006064" stroke-width="2.5"/>
  <rect x="16" y="9" width="4" height="18" fill="#006064" rx="1.5"/>
  <rect x="9" y="16" width="18" height="4" fill="#006064" rx="1.5"/>
  <circle cx="18" cy="18" r="3.5" fill="#006064"/>
</svg>`

const NHS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <circle cx="14" cy="14" r="12" fill="white" stroke="#546e7a" stroke-width="2"/>
  <rect x="12.5" y="7" width="3" height="14" fill="#78909C" rx="1"/>
  <rect x="7" y="12.5" width="14" height="3" fill="#78909C" rx="1"/>
</svg>`

const unclusteredPsLayer: SymbolLayer = {
  id: 'unclustered-ps',
  type: 'symbol',
  source: 'pharmacies',
  filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'is_on_platform'], true]],
  layout: {
    'icon-image': 'pharmacy-ps',
    'icon-size': 1,
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    'icon-anchor': 'center',
  },
}

const unclusteredNhsLayer: SymbolLayer = {
  id: 'unclustered-nhs',
  type: 'symbol',
  source: 'pharmacies',
  filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'is_on_platform'], true]],
  layout: {
    'icon-image': 'pharmacy-nhs',
    'icon-size': 1,
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    'icon-anchor': 'center',
  },
}

// ── NHS hours renderer ───────────────────────────────────────

function renderRegularHours(hours: Record<string, { open: string; close: string; isOpen: boolean }[]>) {
  return DAYS.map((day) => {
    const slots = hours[day]
    if (!slots || slots.length === 0) return (
      <div key={day} className="pharmacy-hours-row">
        <span className="pharmacy-hours-day">{day.slice(0, 3)}</span>
        <span className="pharmacy-hours-closed">Closed</span>
      </div>
    )
    const openSlots = slots.filter((s) => s.isOpen)
    if (openSlots.length === 0) return (
      <div key={day} className="pharmacy-hours-row">
        <span className="pharmacy-hours-day">{day.slice(0, 3)}</span>
        <span className="pharmacy-hours-closed">Closed</span>
      </div>
    )
    return (
      <div key={day} className="pharmacy-hours-row">
        <span className="pharmacy-hours-day">{day.slice(0, 3)}</span>
        <span className="pharmacy-hours-time">
          {openSlots.map((s, i) => (
            <span key={i}>{s.open}–{s.close}</span>
          ))}
        </span>
      </div>
    )
  })
}

// ── Detail Panel ─────────────────────────────────────────────

function PharmacyDetailPanel({
  pharmacy,
  isSelected,
  onToggleSelect,
  onMessage,
  onAddToOutreach,
  isTracked,
  onClose,
}: {
  pharmacy: SelectedPharmacy
  isSelected: boolean
  onToggleSelect: () => void
  onMessage: () => void
  onAddToOutreach?: () => void
  isTracked: boolean
  onClose: () => void
}) {
  const nhs = pharmacy.nhsData
  // DB schema: contacts is a flat array of { ContactMethodType, ContactValue, ... }
  type ContactRow = { ContactMethodType?: string; ContactValue?: string }
  const contactRows: ContactRow[] = Array.isArray(pharmacy.contacts)
    ? (pharmacy.contacts as ContactRow[])
    : (typeof pharmacy.contacts === 'string'
        ? (() => { try { return JSON.parse(pharmacy.contacts as string) } catch { return [] } })()
        : [])
  const localPhone = contactRows.find((c) => c.ContactMethodType === 'Telephone')?.ContactValue ?? null
  const localEmail = contactRows.find((c) => c.ContactMethodType === 'Email')?.ContactValue ?? null
  const localWebsite = contactRows.find((c) => c.ContactMethodType === 'Website')?.ContactValue ?? null

  return (
    <div className="map-detail-panel">
      <div className="map-detail-header">
        <div>
          <h3 className="map-detail-name">{pharmacy.organisation_name}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', marginTop: 2 }}>
            <span className="ps-badge ps-badge-blue" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
              {pharmacy.ods_code}
            </span>
            {pharmacy.is_on_platform && (
              <span className="ps-badge ps-badge-cyan">✦ PharmStation</span>
            )}
          </div>
        </div>
        <button className="ps-btn ps-btn-ghost" onClick={onClose} style={{ padding: '4px 8px' }}>✕</button>
      </div>

      <div className="map-detail-body">
        {/* Address */}
        <div className="map-detail-section">
          <div className="map-detail-label">📍 Address</div>
          <div className="map-detail-value">
            {[pharmacy.address1, pharmacy.address2, pharmacy.city, pharmacy.postcode]
              .filter(Boolean).join(', ')}
          </div>
        </div>

        {/* Contact */}
        {pharmacy.nhsLoading ? (
          <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', textAlign: 'center', padding: '8px 0' }}>
            Loading NHS data…
          </div>
        ) : (() => {
          // Merge NHS data with local contacts — NHS data is authoritative if present
          const phone = nhs?.phone ?? localPhone
          const email = nhs?.email ?? localEmail
          const url = nhs?.url ?? localWebsite
          const hasHours = nhs?.regular_hours && Object.keys(nhs.regular_hours).length > 0

          // DB opening_times is a flat array: { Weekday, OpeningTime, ClosingTime, IsOpen }
          type OTRow = { Weekday?: string; OpeningTime?: string | null; ClosingTime?: string | null; IsOpen?: boolean; OpeningTimeType?: string }
          const localHoursRaw: OTRow[] = Array.isArray(pharmacy.opening_times)
            ? (pharmacy.opening_times as OTRow[])
            : (typeof pharmacy.opening_times === 'string'
                ? (() => { try { return JSON.parse(pharmacy.opening_times as string) } catch { return [] } })()
                : [])
          // Only General opening times, grouped/deduped
          const localHours = localHoursRaw.filter((r) => r.OpeningTimeType === 'General' || !r.OpeningTimeType)

          return (
            <>
              {phone && (
                <div className="map-detail-section">
                  <div className="map-detail-label">📞 Phone</div>
                  <a href={`tel:${phone}`} className="map-detail-phone">{phone}</a>
                </div>
              )}
              {email && (
                <div className="map-detail-section">
                  <div className="map-detail-label">✉ Email</div>
                  <a href={`mailto:${email}`} className="map-detail-phone">{email}</a>
                </div>
              )}
              {url && (
                <div className="map-detail-section">
                  <div className="map-detail-label">🌐 Website</div>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="map-detail-phone">
                    {url.replace(/^https?:\/\//, '').slice(0, 42)}
                  </a>
                </div>
              )}
              {hasHours && (
                <div className="map-detail-section">
                  <div className="map-detail-label">🕐 Opening Hours</div>
                  <div className="pharmacy-hours-grid">
                    {renderRegularHours(nhs!.regular_hours!)}
                  </div>
                </div>
              )}
              {!hasHours && localHours && localHours.length > 0 && (
                <div className="map-detail-section">
                  <div className="map-detail-label">🕐 Opening Hours</div>
                  <div className="pharmacy-hours-grid">
                    {localHours.map((slot, i) => (
                      <div key={i} className="pharmacy-hours-row">
                        <span className="pharmacy-hours-day">{(slot.Weekday ?? '').slice(0, 3)}</span>
                        {slot.IsOpen === false ? (
                          <span className="pharmacy-hours-closed">Closed</span>
                        ) : (
                          <span className="pharmacy-hours-time">
                            <span>{slot.OpeningTime ?? '?'}–{slot.ClosingTime ?? '?'}</span>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!phone && !email && !url && !hasHours && (!localHours || localHours.length === 0) && (
                <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)', padding: '4px 0' }}>
                  No contact details available from NHS records.
                </div>
              )}
            </>
          )
        })()}

        {/* Actions */}
        <div className="map-detail-actions">
          {onAddToOutreach && (
            <button className="ps-btn ps-btn-primary" onClick={onAddToOutreach}>
              {isTracked ? 'Open outreach profile' : 'Add to outreach'}
            </button>
          )}
          {/* Get directions — works on mobile (native maps app) and desktop (Google Maps) */}
          {pharmacy.latitude != null && pharmacy.longitude != null && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${pharmacy.latitude},${pharmacy.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ps-btn ps-btn-secondary"
              style={{ textDecoration: 'none', textAlign: 'center' }}
            >
              🧭 Get Directions
            </a>
          )}
          {pharmacy.is_on_platform && pharmacy.linked_org_id && (
            <>
              <button
                className={`ps-btn ${isSelected ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                onClick={onToggleSelect}
              >
                {isSelected ? '✓ Selected' : 'Select'}
              </button>
              <button className="ps-btn ps-btn-primary" onClick={onMessage}>
                Send Message
              </button>
            </>
          )}
          {!pharmacy.is_on_platform && (
            <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', textAlign: 'center' }}>
              This pharmacy is not on PharmStation. You can view their details only.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Modal ───────────────────────────────────────────────

export function PharmacyMapModal({ isOpen, onClose, onAddToOutreach, trackedPharmacyIds = [] }: Props) {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { myLink, fetchMyLink } = useNetworkStore()
  const { token: mapboxToken, loading: mapboxTokenLoading, error: mapboxTokenError } = useMapboxToken(isOpen)

  // Map state
  const mapRef = useRef<MapRef>(null)
  const [viewState, setViewState] = useState({
    longitude: UK_CENTER[0],
    latitude: UK_CENTER[1],
    zoom: 11,
  })
  const [mapLoaded, setMapLoaded] = useState(false)
  const [myPharmacyCoords, setMyPharmacyCoords] = useState<{ lng: number; lat: number } | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')

  // Pharmacy data
  const [pharmacies, setPharmacies] = useState<BoundsPharmacy[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [onlyPlatform, setOnlyPlatform] = useState(false)
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [radiusKm, setRadiusKm] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const boundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Selection
  const [selectedPharmacy, setSelectedPharmacy] = useState<SelectedPharmacy | null>(null)
  const [pickedOrgIds, setPickedOrgIds] = useState<string[]>([])

  // Auto-request browser location on open (public users / no org pharmacy coords)
  useEffect(() => {
    if (!isOpen) return
    // Org users already get centered on their pharmacy — skip
    if (myPharmacyCoords) return
    if (!navigator.geolocation) return

    setLocationStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords
        setLocationStatus('granted')
        setViewState((v) => ({ ...v, longitude, latitude, zoom: 14 }))
        // If map is already loaded fly to it, otherwise viewState change handles it
        mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 14, duration: 1000 })
      },
      () => {
        setLocationStatus('denied')
      },
      { timeout: 8000, maximumAge: 60000 }
    )
  // Only run once when the modal first opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Fetch link on open
  useEffect(() => {
    if (isOpen && organisation?.id) {
      fetchMyLink(organisation.id)
    }
  }, [isOpen, organisation?.id, fetchMyLink])
  useEffect(() => {
    if (!isOpen || !myLink) return
    const ph = (myLink as { pharmacy?: { latitude?: number; longitude?: number } }).pharmacy
    if (ph?.latitude && ph?.longitude) {
      setMyPharmacyCoords({ lng: ph.longitude!, lat: ph.latitude! })
      setViewState((v) => ({ ...v, latitude: ph.latitude!, longitude: ph.longitude!, zoom: 15 }))
    }
  }, [isOpen, myLink])

  const flyToMyPharmacy = useCallback(() => {
    if (!myPharmacyCoords || !mapRef.current) return
    mapRef.current.flyTo({ center: [myPharmacyCoords.lng, myPharmacyCoords.lat], zoom: 14, duration: 1200 })
  }, [myPharmacyCoords])

  // Fly to zoom level matching selected radius
  useEffect(() => {
    if (!radiusKm || !mapRef.current) return
    const center: [number, number] = myPharmacyCoords
      ? [myPharmacyCoords.lng, myPharmacyCoords.lat]
      : [viewState.longitude, viewState.latitude]
    mapRef.current.flyTo({ center, zoom: RADIUS_ZOOM[radiusKm] ?? 12, duration: 900 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm])

  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      setSelectedPharmacy(null)
      setPickedOrgIds([])
      setSearchTerm('')
      setOnlyOpen(false)
      setRadiusKm(null)
      setLocationStatus('idle')
    }
  }, [isOpen])

  // Load pharmacies in current viewport bounds
  const loadInBounds = useCallback(async (bounds: mapboxgl.LngLatBounds) => {
    if (!mapRef.current) return
    setDataLoading(true)
    try {
      const { data, error } = await getUserClient().rpc('get_pharmacies_in_bounds', {
        p_min_lat: bounds.getSouth(),
        p_max_lat: bounds.getNorth(),
        p_min_lng: bounds.getWest(),
        p_max_lng: bounds.getEast(),
        p_org_id: organisation?.id ?? null,
      })
      if (error) throw error
      setPharmacies(data as BoundsPharmacy[])
    } catch (e) {
      console.error('[PharmacyMap] loadInBounds:', e)
    } finally {
      setDataLoading(false)
    }
  }, [organisation?.id])

  // Debounced viewport change handler
  const handleMoveEnd = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    if (boundsTimer.current) clearTimeout(boundsTimer.current)
    boundsTimer.current = setTimeout(() => {
      const bounds = map.getBounds()
      if (bounds) loadInBounds(bounds)
    }, 300)
  }, [loadInBounds])

  // Load custom SVG icons then fetch pharmacies
  const handleMapLoad = useCallback(() => {
    setMapLoaded(true)
    const map = mapRef.current
    if (!map) return

    const loadSvgIcon = (id: string, svg: string, size: number): Promise<void> =>
      new Promise((resolve) => {
        const img = new Image(size, size)
        img.onload = () => {
          if (!map.hasImage(id)) map.addImage(id, img)
          resolve()
        }
        img.onerror = () => resolve() // fallback gracefully
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      })

    Promise.all([
      loadSvgIcon('pharmacy-ps', PS_SVG, 36),
      loadSvgIcon('pharmacy-nhs', NHS_SVG, 28),
    ]).then(() => {
      const bounds = map.getBounds()
      if (bounds) loadInBounds(bounds)
    }).catch(() => {
      const bounds = map.getBounds()
      if (bounds) loadInBounds(bounds)
    })
  }, [loadInBounds])

  // GeoJSON filtered by search + platform toggle + open now
  const filteredPharmacies = useMemo(() => {
    return pharmacies.filter((p) => {
      if (onlyPlatform && !p.is_on_platform) return false
      if (onlyOpen && !isOpenNow(p)) return false
      if (searchTerm) {
        const q = searchTerm.toLowerCase()
        return (
          p.organisation_name.toLowerCase().includes(q) ||
          (p.postcode ?? '').toLowerCase().includes(q) ||
          p.ods_code.toLowerCase().includes(q) ||
          (p.city ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [pharmacies, onlyPlatform, onlyOpen, searchTerm])

  const geojsonData = useMemo(() => toGeoJson(filteredPharmacies), [filteredPharmacies])

  // Fetch NHS data for selected pharmacy
  const fetchNhsData = useCallback(async (odsCode: string) => {
    try {
      const res = await fetch(buildNhsLookupUrl(odsCode), {
        headers: { apikey: SUPABASE_ANON_KEY },
      })
      if (!res.ok) return null
      return (await res.json()) as NhsPharmacyData
    } catch {
      return null
    }
  }, [])

  // Handle click on map feature
  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      const map = mapRef.current
      if (!map) return

      // Check cluster click — zoom in
      const clusterFeatures = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      if (clusterFeatures.length > 0) {
        const clusterId = clusterFeatures[0].properties?.cluster_id
        if (clusterId) {
          const source = map.getSource('pharmacies') as mapboxgl.GeoJSONSource
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err || zoom == null) return
            const coords = (clusterFeatures[0].geometry as { coordinates: number[] }).coordinates
            map.easeTo({ center: [coords[0], coords[1]], zoom })
          })
        }
        return
      }

      // Check individual pharmacy click
      const pharmFeatures = map.queryRenderedFeatures(e.point, {
        layers: ['unclustered-ps', 'unclustered-nhs'],
      })
      if (pharmFeatures.length === 0) return

      const props = pharmFeatures[0].properties as BoundsPharmacy & { contacts: string; opening_times: string; services: string }
      // PostGIS JSON properties come as strings — parse them
      const parsed: SelectedPharmacy = {
        ...props,
        contacts: typeof props.contacts === 'string' ? JSON.parse(props.contacts) : props.contacts,
        opening_times: typeof props.opening_times === 'string' ? JSON.parse(props.opening_times) : props.opening_times,
        services: typeof props.services === 'string' ? JSON.parse(props.services) : props.services,
        nhsLoading: true,
        nhsData: null,
      }

      setSelectedPharmacy(parsed)

      // Load NHS data async
      fetchNhsData(props.ods_code).then((data) => {
        setSelectedPharmacy((prev) =>
          prev?.ods_code === props.ods_code
            ? { ...prev, nhsData: data, nhsLoading: false }
            : prev
        )
      })
    },
    [fetchNhsData]
  )

  // Toggle selection
  const togglePick = useCallback((orgId: string) => {
    setPickedOrgIds((ids) =>
      ids.includes(orgId) ? ids.filter((i) => i !== orgId) : [...ids, orgId]
    )
  }, [])

  // Build a MapRecipient from a BoundsPharmacy
  function toRecipient(p: BoundsPharmacy): MapRecipient | null {
    if (!p.linked_org_id) return null
    return {
      orgId: p.linked_org_id,
      orgName: p.linked_org_name ?? p.organisation_name,
      pharmacyName: p.organisation_name,
      ods: p.ods_code,
      city: p.city,
      distanceKm: null,
    }
  }

  const handleMessage = useCallback(
    (pharmacy: BoundsPharmacy) => {
      const r = toRecipient(pharmacy)
      if (!r) return
      navigate('/messaging/network/compose', { state: { mapRecipients: [r] } })
      onClose()
    },
    [navigate, onClose]
  )

  const handleMessageSelected = useCallback(() => {
    const recipients = filteredPharmacies
      .filter((p) => p.linked_org_id && pickedOrgIds.includes(p.linked_org_id))
      .map(toRecipient)
      .filter(Boolean) as MapRecipient[]
    if (recipients.length === 0) return
    navigate('/messaging/network/compose', { state: { mapRecipients: recipients } })
    onClose()
  }, [filteredPharmacies, pickedOrgIds, navigate, onClose])

  if (!isOpen) return null

  if (mapboxTokenLoading) {
    return (
      <div className="modal-backdrop">
        <div className="modal-dialog" style={{ maxWidth: 400 }}>
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--ps-slate)' }}>
            Loading map…
          </p>
        </div>
      </div>
    )
  }

  if (!mapboxToken) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-dialog" style={{ maxWidth: 400 }}>
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--ps-error)' }}>
            {mapboxTokenError ?? 'Map configuration is unavailable. Please try again later.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="pharmacy-map-modal" role="dialog" aria-modal="true" aria-label="Pharmacy Map">
        {/* Header toolbar */}
        <div className="pharmacy-map-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', flex: 1 }}>
            <span style={{ fontWeight: 700, fontSize: 'var(--ps-font-md)', color: 'var(--ps-deep-blue)', whiteSpace: 'nowrap' }}>
              🗺 Pharmacy Map
            </span>
            <input
              className="ps-input"
              placeholder="Search by name, postcode or ODS…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ flex: 1, maxWidth: 320 }}
            />
            <label className="pharmacy-map-toggle">
              <input
                type="checkbox"
                checked={onlyPlatform}
                onChange={(e) => setOnlyPlatform(e.target.checked)}
              />
              <span>PharmStation only</span>
            </label>
            <label className="pharmacy-map-toggle">
              <input
                type="checkbox"
                checked={onlyOpen}
                onChange={(e) => setOnlyOpen(e.target.checked)}
              />
              <span>Open now</span>
            </label>
            <select
              className="ps-input"
              style={{ width: 'auto', paddingRight: 28 }}
              value={radiusKm ?? ''}
              onChange={(e) => setRadiusKm(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Any radius</option>
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>{r} km</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            {dataLoading && (
              <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>Loading…</span>
            )}
            {locationStatus === 'requesting' && (
              <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>📍 Getting your location…</span>
            )}
            {locationStatus === 'denied' && (
              <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }} title="Enable location in your browser to start near you">📍 Location not available</span>
            )}
            {!mapLoaded && (
              <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>Initialising map…</span>
            )}
            <div className="pharmacy-map-legend">
              <span style={{ display:'inline-block', width:14, height:14, borderRadius:'50%', background:'#00E5FF', border:'2px solid #006064', verticalAlign:'middle', marginRight:4 }} />
              PharmStation
              <span style={{ display:'inline-block', width:12, height:12, borderRadius:'50%', background:'white', border:'2px solid #546e7a', verticalAlign:'middle', margin:'0 4px 0 10px' }} />
              NHS Pharmacy
            </div>

            {pickedOrgIds.length > 0 && (
              <button className="ps-btn ps-btn-primary" onClick={handleMessageSelected}>
                Message {pickedOrgIds.length} selected
              </button>
            )}
            <button className="ps-btn ps-btn-ghost" onClick={onClose} aria-label="Close map">✕</button>
          </div>
        </div>

        {/* Map + panel layout */}
        <div className="pharmacy-map-body">
          <Map
            ref={mapRef}
            {...viewState}
            onMove={(e) => setViewState(e.viewState)}
            onMoveEnd={handleMoveEnd}
            onLoad={handleMapLoad}
            onClick={handleMapClick}
            mapboxAccessToken={mapboxToken}
            mapStyle="mapbox://styles/mapbox/light-v11"
            style={{ width: '100%', height: '100%' }}
            cursor="pointer"
            interactiveLayerIds={['clusters', 'unclustered-ps', 'unclustered-nhs']}
          >
            <NavigationControl position="top-right" />
            <GeolocateControl position="top-right" />
            {myPharmacyCoords && (
              <div
                style={{
                  position: 'absolute',
                  top: 175,
                  right: 10,
                }}
              >
                <button
                  onClick={flyToMyPharmacy}
                  title="Return to my pharmacy"
                  style={{
                    background: 'white',
                    border: '1px solid rgba(0,0,0,0.2)',
                    borderRadius: 4,
                    width: 29,
                    height: 29,
                    cursor: 'pointer',
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 0 2px rgba(0,0,0,.1)',
                  }}
                >
                  🏠
                </button>
              </div>
            )}

            <Source
              id="pharmacies"
              type="geojson"
              data={geojsonData}
              cluster
              clusterMaxZoom={12}
              clusterRadius={50}
            >
              <Layer {...clusterCircleLayer} />
              <Layer {...clusterCountLayer} />
              <Layer {...unclusteredNhsLayer} />
              <Layer {...unclusteredPsLayer} />
            </Source>
          </Map>

          {/* Detail panel slides in from right */}
          {selectedPharmacy && (
            <PharmacyDetailPanel
              pharmacy={selectedPharmacy}
              isSelected={
                selectedPharmacy.linked_org_id
                  ? pickedOrgIds.includes(selectedPharmacy.linked_org_id)
                  : false
              }
              onToggleSelect={() => {
                if (selectedPharmacy.linked_org_id) togglePick(selectedPharmacy.linked_org_id)
              }}
              onMessage={() => handleMessage(selectedPharmacy)}
              onAddToOutreach={onAddToOutreach ? () => onAddToOutreach(selectedPharmacy) : undefined}
              isTracked={trackedPharmacyIds.includes(selectedPharmacy.pharmacy_id)}
              onClose={() => setSelectedPharmacy(null)}
            />
          )}
        </div>

        {/* Footer stats */}
        <div className="pharmacy-map-footer">
          <span>
            {onlyPlatform
              ? `${filteredPharmacies.length} PharmStation pharmacies in view`
              : `${filteredPharmacies.length} pharmacies in view (${filteredPharmacies.filter((p) => p.is_on_platform).length} on PharmStation)`}
          </span>
          <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>
            Data: NHS Digital & PharmStation registry
          </span>
        </div>
      </div>
    </>
  )
}

// Re-export for convenience
export type { BoundsPharmacy, NhsPharmacyData }
