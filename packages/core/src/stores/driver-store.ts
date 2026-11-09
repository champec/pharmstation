import { create } from 'zustand'
import type {
  DeliveryRound,
  DeliveryMethod,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'
import { shouldSendLocation } from '../deliveries'

const DRIVER_ROUND_SELECT = `
  *,
  patients:ps_delivery_round_patients(
    *,
    patient:ps_patients(id, first_name, last_name, phone, address_line_1, address_line_2, city, postcode),
    medications:ps_delivery_patient_medications(*, patient_medication:ps_patient_medications(*))
  )
`

export interface CompleteDeliveryOptions {
  deliveryMethod: DeliveryMethod
  recipientName?: string
  /** PNG data URL from the signature pad, or undefined when nobody signed. */
  signatureData?: string
  /** Optional photos of the hand-over or safe place. */
  photos?: File[]
}

export interface DriverState {
  assignedRounds: DeliveryRound[]
  openRounds: DeliveryRound[]
  /** The driver's finished rounds from the last 30 days, newest first. */
  recentRounds: DeliveryRound[]
  activeRoute: DeliveryRound | null
  loading: boolean
  saving: boolean
  error: string | null
  locationWatchId: number | null
  /** Why location sharing isn't working, for a banner on the route page. */
  locationError: string | null

  // Fetch
  fetchAssignedRounds: (memberId: string, orgId?: string) => Promise<void>
  fetchRoundRoute: (roundId: string) => Promise<void>

  // Actions
  claimRound: (roundId: string, memberId: string) => Promise<void>
  startRound: (roundId: string) => Promise<void>
  completeDelivery: (stopId: string, options: CompleteDeliveryOptions) => Promise<void>
  failDelivery: (stopId: string, reason: string) => Promise<void>
  skipDelivery: (stopId: string, reason: string) => Promise<void>
  postLocationUpdate: (roundId: string, driverId: string, lat: number, lng: number) => Promise<void>

  // Location tracking
  startLocationTracking: (roundId: string, driverId: string) => void
  stopLocationTracking: () => void

  // Realtime
  subscribeToRoute: (roundId: string) => () => void

  // UI
  clearError: () => void
}

function sortStops(round: DeliveryRound): DeliveryRound {
  if (round.patients) round.patients.sort((a, b) => a.delivery_order - b.delivery_order)
  return round
}

let lastFix: { lat: number; lng: number; at: number } | null = null

export const useDriverStore = create<DriverState>((set, get) => {
  /** Update one stop and reload the route (the server may complete the round). */
  const updateStop = async (stopId: string, updates: Record<string, unknown>) => {
    const { data, error } = await getUserClient()
      .from('ps_delivery_round_patients')
      .update(updates)
      .eq('id', stopId)
      .select('id, round_id')
    if (error) throw error
    if (!data?.length) throw new Error('This stop could not be updated. Is the round assigned to you and started?')
    await get().fetchRoundRoute(data[0].round_id as string)
  }

  return {
    assignedRounds: [],
    openRounds: [],
    recentRounds: [],
    activeRoute: null,
    loading: false,
    saving: false,
    error: null,
    locationWatchId: null,
    locationError: null,

    fetchAssignedRounds: async (memberId, orgId) => {
      set({ loading: true, error: null })
      try {
        const client = getUserClient()
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
        const [assigned, open, recent] = await Promise.all([
          client
            .from('ps_delivery_rounds')
            .select(DRIVER_ROUND_SELECT)
            .eq('driver_id', memberId)
            .in('status', ['draft', 'scheduled', 'in_progress'])
            .order('scheduled_date', { ascending: true }),
          orgId
            ? client
                .from('ps_delivery_rounds')
                .select(DRIVER_ROUND_SELECT)
                .eq('organisation_id', orgId)
                .is('driver_id', null)
                .eq('status', 'scheduled')
                .order('scheduled_date', { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          client
            .from('ps_delivery_rounds')
            .select('*, patients:ps_delivery_round_patients(id, status)')
            .eq('driver_id', memberId)
            .eq('status', 'completed')
            .gte('completed_at', since)
            .order('completed_at', { ascending: false })
            .limit(20),
        ])
        if (assigned.error) throw assigned.error
        if (open.error) throw open.error
        if (recent.error) throw recent.error
        set({
          recentRounds: (recent.data ?? []) as DeliveryRound[],
          assignedRounds: ((assigned.data ?? []) as DeliveryRound[]).map(sortStops),
          openRounds: ((open.data ?? []) as DeliveryRound[]).map(sortStops),
          loading: false,
        })
      } catch (e: any) {
        set({ error: e.message, loading: false })
      }
    },

    fetchRoundRoute: async (roundId) => {
      set({ loading: true, error: null })
      try {
        const { data, error } = await getUserClient()
          .from('ps_delivery_rounds')
          .select(DRIVER_ROUND_SELECT)
          .eq('id', roundId)
          .single()
        if (error) throw error
        set({ activeRoute: sortStops(data as DeliveryRound), loading: false })
      } catch (e: any) {
        set({ error: e.message, loading: false })
      }
    },

    claimRound: async (roundId, memberId) => {
      const { data, error } = await getUserClient()
        .from('ps_delivery_rounds')
        .update({ driver_id: memberId })
        .eq('id', roundId)
        .is('driver_id', null)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Another driver has already taken this round.')
      const round = get().openRounds.find((r) => r.id === roundId)
      set((s) => ({
        openRounds: s.openRounds.filter((r) => r.id !== roundId),
        assignedRounds: round ? [...s.assignedRounds, { ...round, driver_id: memberId }] : s.assignedRounds,
      }))
    },

    startRound: async (roundId) => {
      const { data, error } = await getUserClient()
        .from('ps_delivery_rounds')
        .update({ status: 'in_progress' })
        .eq('id', roundId)
        .select('status, started_at')
      if (error) throw error
      if (!data?.length) throw new Error('This round could not be started. Is it assigned to you?')
      const saved = data[0] as Pick<DeliveryRound, 'status' | 'started_at'>
      set((s) => ({
        activeRoute: s.activeRoute?.id === roundId ? { ...s.activeRoute, ...saved } : s.activeRoute,
        assignedRounds: s.assignedRounds.map((r) => (r.id === roundId ? { ...r, ...saved } : r)),
      }))
    },

    completeDelivery: async (stopId, options) => {
      const route = get().activeRoute
      if (!route) throw new Error('The delivery round is not loaded.')
      set({ saving: true, error: null })
      const client = getUserClient()
      const uploaded: string[] = []
      try {
        for (const [index, file] of (options.photos ?? []).entries()) {
          const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
          const path = `${route.organisation_id}/${route.id}/${stopId}/${Date.now()}-${index}.${ext}`
          const { error: upErr } = await client.storage
            .from('delivery-evidence')
            .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
          if (upErr) throw upErr
          uploaded.push(path)
        }
        await updateStop(stopId, {
          status: 'delivered',
          delivery_method: options.deliveryMethod,
          delivery_recipient_name: options.recipientName?.trim() || null,
          signature_data: options.signatureData ?? null,
          proof_photo_paths: uploaded,
        })
        set({ saving: false })
      } catch (e: any) {
        if (uploaded.length) await client.storage.from('delivery-evidence').remove(uploaded)
        set({ saving: false, error: e.message })
        throw e
      }
    },

    failDelivery: async (stopId, reason) => {
      if (!reason.trim()) throw new Error('Choose a reason')
      set({ saving: true, error: null })
      try {
        // Failed stops go straight to the redelivery queue.
        await updateStop(stopId, { status: 'pending_redelivery', failure_reason: reason.trim() })
      } finally {
        set({ saving: false })
      }
    },

    skipDelivery: async (stopId, reason) => {
      if (!reason.trim()) throw new Error('Give a reason for skipping')
      set({ saving: true, error: null })
      try {
        await updateStop(stopId, { status: 'skipped', failure_reason: reason.trim() })
      } finally {
        set({ saving: false })
      }
    },

    postLocationUpdate: async (roundId, driverId, lat, lng) => {
      const { error } = await getUserClient()
        .from('ps_delivery_location_updates')
        .insert({ round_id: roundId, driver_id: driverId, latitude: lat, longitude: lng })
      if (error) console.error('Failed to post location update:', error)
    },

    startLocationTracking: (roundId, driverId) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        set({ locationError: 'This browser can’t share your location, so the pharmacy can’t see where you are.' })
        return
      }
      if (get().locationWatchId !== null) return
      lastFix = null
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (get().locationError) set({ locationError: null })
          const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() }
          // Every 15 seconds or 50 metres, not every fix the browser gives.
          if (!shouldSendLocation(lastFix, fix)) return
          lastFix = fix
          void get().postLocationUpdate(roundId, driverId, fix.lat, fix.lng)
        },
        (err) => {
          set({
            locationError: err.code === 1
              ? 'Location is off for this site, so the pharmacy can’t see where you are. Allow location in your browser settings to share it.'
              : 'Your location can’t be found right now, so the pharmacy can’t see where you are. It will try again.',
          })
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
      )
      set({ locationWatchId: watchId })
    },

    stopLocationTracking: () => {
      const watchId = get().locationWatchId
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
        set({ locationWatchId: null })
      }
      set({ locationError: null })
      lastFix = null
    },

    subscribeToRoute: (roundId) => {
      const channel = getUserClient()
        .channel(`driver_route_${roundId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'ps_delivery_round_patients', filter: `round_id=eq.${roundId}` },
          () => { void get().fetchRoundRoute(roundId) },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'ps_delivery_rounds', filter: `id=eq.${roundId}` },
          () => { void get().fetchRoundRoute(roundId) },
        )
        .subscribe()

      return () => {
        getUserClient().removeChannel(channel)
      }
    },

    clearError: () => set({ error: null }),
  }
})
