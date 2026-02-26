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
  type MapLayerMouseEvent,
} from 'react-map-gl/mapbox'
import type { CircleLayer, SymbolLayer } from 'react-map-gl/mapbox'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'

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

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const UK_CENTER: [number, number] = [-1.5, 52.5]
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function buildNhsLookupUrl(odsCode: string) {
  return `${SUPABASE_URL}/functions/v1/nhs-pharmacy-lookup?ods=${encodeURIComponent(odsCode)}`
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

const unclusteredPsLayer: CircleLayer = {
  id: 'unclustered-ps',
  type: 'circle',
  source: 'pharmacies',
  filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'is_on_platform'], true]],
  paint: {
    'circle-radius': 9,
    'circle-color': '#00E5FF',
    'circle-stroke-color': '#006064',
    'circle-stroke-width': 2,
    'circle-opacity': 0.95,
  },
}

const unclusteredNhsLayer: CircleLayer = {
  id: 'unclustered-nhs',
  type: 'circle',
  source: 'pharmacies',
  filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'is_on_platform'], true]],
  paint: {
    'circle-radius': 7,
    'circle-color': '#ffffff',
    'circle-stroke-color': '#546e7a',
    'circle-stroke-width': 1.5,
    'circle-opacity': 0.85,
  },
}

// Cross symbol layer for PharmStation pharmacies
const pharmacyCrossLayer: SymbolLayer = {
  id: 'pharmacy-cross',
  type: 'symbol',
  source: 'pharmacies',
  filter: ['!', ['has', 'point_count']],
  layout: {
    'text-field': '+',
    'text-size': ['case', ['==', ['get', 'is_on_platform'], true], 14, 11],
    'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  },
  paint: {
    'text-color': ['case', ['==', ['get', 'is_on_platform'], true], '#006064', '#37474f'],
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
  onClose,
}: {
  pharmacy: SelectedPharmacy
  isSelected: boolean
  onToggleSelect: () => void
  onMessage: () => void
  onClose: () => void
}) {
  const nhs = pharmacy.nhsData
  const localPhone = (pharmacy.contacts as { Tel?: { OrganisationContactValue?: string }[] } | null)
    ?.Tel?.[0]?.OrganisationContactValue

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
        ) : nhs?.found ? (
          <>
            {(nhs.phone ?? localPhone) && (
              <div className="map-detail-section">
                <div className="map-detail-label">📞 Phone</div>
                <a href={`tel:${nhs.phone ?? localPhone}`} className="map-detail-phone">
                  {nhs.phone ?? localPhone}
                </a>
              </div>
            )}
            {nhs.email && (
              <div className="map-detail-section">
                <div className="map-detail-label">✉ Email</div>
                <a href={`mailto:${nhs.email}`} className="map-detail-phone">{nhs.email}</a>
              </div>
            )}
            {nhs.url && (
              <div className="map-detail-section">
                <div className="map-detail-label">🌐 Website</div>
                <a href={nhs.url} target="_blank" rel="noopener noreferrer" className="map-detail-phone">
                  {nhs.url.replace(/^https?:\/\//, '').slice(0, 40)}
                </a>
              </div>
            )}
            {nhs.regular_hours && Object.keys(nhs.regular_hours).length > 0 && (
              <div className="map-detail-section">
                <div className="map-detail-label">🕐 Opening Hours</div>
                <div className="pharmacy-hours-grid">
                  {renderRegularHours(nhs.regular_hours)}
                </div>
              </div>
            )}
          </>
        ) : localPhone ? (
          <div className="map-detail-section">
            <div className="map-detail-label">📞 Phone</div>
            <a href={`tel:${localPhone}`} className="map-detail-phone">{localPhone}</a>
          </div>
        ) : null}

        {/* Actions */}
        <div className="map-detail-actions">
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

export function PharmacyMapModal({ isOpen, onClose }: Props) {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { myLink, fetchMyLink } = useNetworkStore()

  // Map state
  const mapRef = useRef<MapRef>(null)
  const [viewState, setViewState] = useState({
    longitude: UK_CENTER[0],
    latitude: UK_CENTER[1],
    zoom: 11,
  })
  const [mapLoaded, setMapLoaded] = useState(false)

  // Pharmacy data
  const [pharmacies, setPharmacies] = useState<BoundsPharmacy[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [onlyPlatform, setOnlyPlatform] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const boundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Selection
  const [selectedPharmacy, setSelectedPharmacy] = useState<SelectedPharmacy | null>(null)
  const [pickedOrgIds, setPickedOrgIds] = useState<string[]>([])

  // Fetch link on open
  useEffect(() => {
    if (isOpen && organisation?.id) {
      fetchMyLink(organisation.id)
    }
  }, [isOpen, organisation?.id, fetchMyLink])

  // Center on user's pharmacy once link loaded
  useEffect(() => {
    if (!isOpen || !myLink) return
    const ph = (myLink as { pharmacy?: { latitude?: number; longitude?: number } }).pharmacy
    if (ph?.latitude && ph?.longitude) {
      setViewState((v) => ({ ...v, latitude: ph.latitude!, longitude: ph.longitude!, zoom: 13 }))
    }
  }, [isOpen, myLink])

  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      setSelectedPharmacy(null)
      setPickedOrgIds([])
      setSearchTerm('')
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

  // Load when map first renders
  const handleMapLoad = useCallback(() => {
    setMapLoaded(true)
    const map = mapRef.current
    if (!map) return
    const bounds = map.getBounds()
    if (bounds) loadInBounds(bounds)
  }, [loadInBounds])

  // GeoJSON filtered by search + platform toggle
  const filteredPharmacies = useMemo(() => {
    return pharmacies.filter((p) => {
      if (onlyPlatform && !p.is_on_platform) return false
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
  }, [pharmacies, onlyPlatform, searchTerm])

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
    (e: MapLayerMouseEvent) => {
      const map = mapRef.current
      if (!map) return

      // Check cluster click — zoom in
      const clusterFeatures = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      if (clusterFeatures.length > 0) {
        const clusterId = clusterFeatures[0].properties?.cluster_id
        if (clusterId) {
          const source = map.getSource('pharmacies') as mapboxgl.GeoJSONSource
          source.getClusterExpansionZoom(clusterId).then((zoom: number) => {
            const coords = (clusterFeatures[0].geometry as { coordinates: number[] }).coordinates
            map.easeTo({ center: [coords[0], coords[1]], zoom })
          }).catch(() => {/* ignore */})
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

  if (!MAPBOX_TOKEN) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-dialog" style={{ maxWidth: 400 }}>
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--ps-error)' }}>
            Mapbox token not configured. Add VITE_MAPBOX_TOKEN to .env.local
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
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            {dataLoading && (
              <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>Loading…</span>
            )}
            {!mapLoaded && (
              <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>Initialising map…</span>
            )}
            <div className="pharmacy-map-legend">
              <span className="legend-ps">✦</span> PharmStation
              <span className="legend-nhs" style={{ marginLeft: 8 }}>•</span> NHS Pharmacy
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
            mapboxAccessToken={MAPBOX_TOKEN}
            mapStyle="mapbox://styles/mapbox/light-v11"
            style={{ width: '100%', height: '100%' }}
            cursor="pointer"
            interactiveLayerIds={['clusters', 'unclustered-ps', 'unclustered-nhs']}
          >
            <NavigationControl position="top-right" />
            <GeolocateControl position="top-right" />

            <Source
              id="pharmacies"
              type="geojson"
              data={geojsonData}
              cluster
              clusterMaxZoom={14}
              clusterRadius={50}
            >
              <Layer {...clusterCircleLayer} />
              <Layer {...clusterCountLayer} />
              <Layer {...unclusteredNhsLayer} />
              <Layer {...unclusteredPsLayer} />
              <Layer {...pharmacyCrossLayer} />
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
