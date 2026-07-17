import { useEffect, useRef, useState, useCallback } from 'react'
import MapGL, { Marker, NavigationControl, type MapRef } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { DeliveryRoundPatient, DeliveryLocationUpdate } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'
import { useMapboxToken } from '../../hooks/useMapboxToken'

// UK default center
const DEFAULT_CENTER = { latitude: 53.5, longitude: -1.5, zoom: 6 }

const STATUS_COLORS: Record<string, string> = {
  pending: '#94a3b8',
  in_transit: '#3b82f6',
  arrived: '#f59e0b',
  delivered: '#22c55e',
  failed: '#ef4444',
  pending_redelivery: '#ef4444',
  skipped: '#94a3b8',
  moved_to_round: '#3b82f6',
  returned: '#94a3b8',
  cancelled: '#ef4444',
}

interface DeliveryRouteMapProps {
  patients: DeliveryRoundPatient[]
  roundId: string
  driverId?: string | null
  height?: string | number
  showDriverLocation?: boolean
}

// Geocode a UK postcode using free postcodes.io API
async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const clean = postcode.replace(/\s+/g, '').toUpperCase()
    const res = await fetch(`https://api.postcodes.io/postcodes/${clean}`)
    const data = await res.json()
    if (data.status === 200 && data.result) {
      return { lat: data.result.latitude, lng: data.result.longitude }
    }
  } catch {}
  return null
}

export function DeliveryRouteMap({ patients, roundId, driverId, height = 400, showDriverLocation = false }: DeliveryRouteMapProps) {
  const mapRef = useRef<MapRef>(null)
  const [patientCoords, setPatientCoords] = useState<Map<string, { lat: number; lng: number }>>(new Map())
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const { token: mapboxToken, loading: mapboxTokenLoading, error: mapboxTokenError } = useMapboxToken()

  // Geocode all patient postcodes
  useEffect(() => {
    let cancelled = false

    async function geocodeAll() {
      setLoading(true)
      const coords = new Map<string, { lat: number; lng: number }>()

      // Batch geocode using postcodes.io bulk API
      const postcodes = patients
        .map((p) => ({ id: p.id, postcode: p.delivery_postcode || (p.patient as any)?.postcode }))
        .filter((p) => p.postcode)

      if (postcodes.length > 0) {
        try {
          const res = await fetch('https://api.postcodes.io/postcodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postcodes: postcodes.map((p) => p.postcode) }),
          })
          const data = await res.json()
          if (data.status === 200 && data.result) {
            data.result.forEach((r: any, idx: number) => {
              if (r.result) {
                coords.set(postcodes[idx].id, { lat: r.result.latitude, lng: r.result.longitude })
              }
            })
          }
        } catch {
          // Fallback: geocode individually
          for (const p of postcodes) {
            if (cancelled) break
            const coord = await geocodePostcode(p.postcode)
            if (coord) coords.set(p.id, coord)
          }
        }
      }

      if (!cancelled) {
        setPatientCoords(coords)
        setLoading(false)

        // Fit map to bounds
        if (coords.size > 0 && mapRef.current) {
          const lats = Array.from(coords.values()).map((c) => c.lat)
          const lngs = Array.from(coords.values()).map((c) => c.lng)
          const sw = { lng: Math.min(...lngs) - 0.01, lat: Math.min(...lats) - 0.01 }
          const ne = { lng: Math.max(...lngs) + 0.01, lat: Math.max(...lats) + 0.01 }
          mapRef.current.fitBounds([sw, ne], { padding: 60, maxZoom: 14 })
        }
      }
    }

    geocodeAll()
    return () => { cancelled = true }
  }, [patients])

  // Subscribe to driver location updates
  useEffect(() => {
    if (!showDriverLocation || !driverId || !roundId) return

    // Fetch latest location
    const fetchLatest = async () => {
      const { data } = await getUserClient()
        .from('ps_delivery_location_updates')
        .select('latitude, longitude')
        .eq('round_id', roundId)
        .eq('driver_id', driverId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) setDriverLocation({ lat: data.latitude, lng: data.longitude })
    }
    fetchLatest()

    // Realtime subscription
    const channel = getUserClient()
      .channel(`driver_location_${roundId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ps_delivery_location_updates',
          filter: `round_id=eq.${roundId}`,
        },
        (payload: any) => {
          if (payload.new) {
            setDriverLocation({ lat: payload.new.latitude, lng: payload.new.longitude })
          }
        }
      )
      .subscribe()

    return () => {
      getUserClient().removeChannel(channel)
    }
  }, [showDriverLocation, driverId, roundId])

  if (mapboxTokenLoading) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', color: 'var(--ps-slate)' }}>
        Loading map…
      </div>
    )
  }

  if (!mapboxToken) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', color: 'var(--ps-slate)' }}>
        {mapboxTokenError ?? 'Map configuration is unavailable. Please try again later.'}
      </div>
    )
  }

  return (
    <div style={{ height, borderRadius: 'var(--ps-radius-md)', overflow: 'hidden', position: 'relative' }}>
      {loading && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, background: 'rgba(255,255,255,0.9)', padding: '4px 12px', borderRadius: 4, fontSize: 'var(--ps-font-sm)' }}>
          Geocoding addresses…
        </div>
      )}
      <MapGL
        ref={mapRef}
        initialViewState={DEFAULT_CENTER}
        mapboxAccessToken={mapboxToken}
        mapStyle="mapbox://styles/mapbox/light-v11"
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" />

        {/* Patient markers */}
        {patients.map((p) => {
          const coord = patientCoords.get(p.id)
          if (!coord) return null
          const pat = p.patient as any
          const color = STATUS_COLORS[p.status] || STATUS_COLORS.pending

          return (
            <Marker key={p.id} latitude={coord.lat} longitude={coord.lng} anchor="center">
              <div
                title={`#${p.delivery_order} ${pat?.first_name} ${pat?.last_name} — ${p.status}`}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: color,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  border: '2px solid #fff',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                  cursor: 'pointer',
                }}
              >
                {p.delivery_order}
              </div>
            </Marker>
          )
        })}

        {/* Driver location */}
        {driverLocation && (
          <Marker latitude={driverLocation.lat} longitude={driverLocation.lng} anchor="center">
            <div
              title="Driver location"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: '#6366f1',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
                border: '3px solid #fff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              🚗
            </div>
          </Marker>
        )}
      </MapGL>
    </div>
  )
}
