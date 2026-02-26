import { create } from 'zustand'
import type {
  DeliveryRound,
  DeliveryRoundPatient,
  DeliveryPatientStatus,
  DeliveryLocationUpdate,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

const DRIVER_ROUND_SELECT = `
  *,
  patients:ps_delivery_round_patients(
    *,
    patient:ps_patients(id, first_name, last_name, phone, address_line_1, address_line_2, city, postcode),
    medications:ps_delivery_patient_medications(*, patient_medication:ps_patient_medications(*))
  )
`

export interface DriverState {
  assignedRounds: DeliveryRound[]
  activeRoute: DeliveryRound | null
  loading: boolean
  error: string | null
  locationWatchId: number | null

  // Fetch
  fetchAssignedRounds: (memberId: string) => Promise<void>
  fetchRoundRoute: (roundId: string) => Promise<void>

  // Actions
  startRound: (roundId: string) => Promise<void>
  updatePatientStatus: (roundPatientId: string, status: DeliveryPatientStatus, signatureData?: string, failureReason?: string) => Promise<void>
  submitSignature: (roundPatientId: string, signatureBase64: string) => Promise<void>
  postLocationUpdate: (roundId: string, driverId: string, lat: number, lng: number) => Promise<void>

  // Location tracking
  startLocationTracking: (roundId: string, driverId: string) => void
  stopLocationTracking: () => void

  // Realtime
  subscribeToRoute: (roundId: string) => () => void

  // UI
  clearError: () => void
}

export const useDriverStore = create<DriverState>((set, get) => ({
  assignedRounds: [],
  activeRoute: null,
  loading: false,
  error: null,
  locationWatchId: null,

  fetchAssignedRounds: async (memberId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_delivery_rounds')
        .select(DRIVER_ROUND_SELECT)
        .eq('driver_id', memberId)
        .in('status', ['draft', 'scheduled', 'in_progress'])
        .order('scheduled_date', { ascending: true })
      if (error) throw error
      set({ assignedRounds: (data ?? []) as DeliveryRound[], loading: false })
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

      // Sort patients by delivery_order
      const round = data as DeliveryRound
      if (round.patients) {
        round.patients.sort((a, b) => a.delivery_order - b.delivery_order)
      }

      set({ activeRoute: round, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  startRound: async (roundId) => {
    const { error } = await getUserClient()
      .from('ps_delivery_rounds')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', roundId)
    if (error) throw error
    set((s) => ({
      activeRoute: s.activeRoute?.id === roundId
        ? { ...s.activeRoute, status: 'in_progress', started_at: new Date().toISOString() }
        : s.activeRoute,
      assignedRounds: s.assignedRounds.map((r) =>
        r.id === roundId ? { ...r, status: 'in_progress' as any, started_at: new Date().toISOString() } : r
      ),
    }))
  },

  updatePatientStatus: async (roundPatientId, status, signatureData, failureReason) => {
    const updates: any = { status }
    if (status === 'delivered') updates.delivered_at = new Date().toISOString()
    if (signatureData) updates.signature_data = signatureData
    if (failureReason) updates.failure_reason = failureReason
    if (status === 'failed') updates.status = 'pending_redelivery'

    const { error } = await getUserClient()
      .from('ps_delivery_round_patients')
      .update(updates)
      .eq('id', roundPatientId)
    if (error) throw error

    // Update local state
    set((s) => {
      if (!s.activeRoute?.patients) return s
      const updatedPatients = s.activeRoute.patients.map((p) =>
        p.id === roundPatientId ? { ...p, ...updates } : p
      )
      // Check if all patients resolved — auto-complete round
      const allResolved = updatedPatients.every((p) =>
        ['delivered', 'failed', 'skipped', 'pending_redelivery', 'moved_to_round', 'returned', 'cancelled'].includes(p.status)
      )
      return {
        activeRoute: {
          ...s.activeRoute,
          patients: updatedPatients,
          ...(allResolved ? { status: 'completed' as any, completed_at: new Date().toISOString() } : {}),
        },
      }
    })

    // If all patients resolved, complete the round
    const route = get().activeRoute
    if (route?.patients) {
      const allResolved = route.patients.every((p) =>
        p.id === roundPatientId
          ? ['delivered', 'failed', 'skipped', 'pending_redelivery'].includes(status)
          : ['delivered', 'failed', 'skipped', 'pending_redelivery', 'moved_to_round', 'returned', 'cancelled'].includes(p.status)
      )
      if (allResolved) {
        await getUserClient()
          .from('ps_delivery_rounds')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', route.id)
      }
    }
  },

  submitSignature: async (roundPatientId, signatureBase64) => {
    const { error } = await getUserClient()
      .from('ps_delivery_round_patients')
      .update({ signature_data: signatureBase64 })
      .eq('id', roundPatientId)
    if (error) throw error
    set((s) => {
      if (!s.activeRoute?.patients) return s
      return {
        activeRoute: {
          ...s.activeRoute,
          patients: s.activeRoute.patients.map((p) =>
            p.id === roundPatientId ? { ...p, signature_data: signatureBase64 } : p
          ),
        },
      }
    })
  },

  postLocationUpdate: async (roundId, driverId, lat, lng) => {
    const { error } = await getUserClient()
      .from('ps_delivery_location_updates')
      .insert({
        round_id: roundId,
        driver_id: driverId,
        latitude: lat,
        longitude: lng,
      })
    if (error) console.error('Failed to post location update:', error)
  },

  startLocationTracking: (roundId, driverId) => {
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        get().postLocationUpdate(roundId, driverId, pos.coords.latitude, pos.coords.longitude)
      },
      (err) => console.error('Geolocation error:', err),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
    )
    set({ locationWatchId: watchId })
  },

  stopLocationTracking: () => {
    const watchId = get().locationWatchId
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      set({ locationWatchId: null })
    }
  },

  subscribeToRoute: (roundId) => {
    const channel = getUserClient()
      .channel(`driver_route_${roundId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ps_delivery_round_patients', filter: `round_id=eq.${roundId}` },
        () => { get().fetchRoundRoute(roundId) }
      )
      .subscribe()

    return () => {
      getUserClient().removeChannel(channel)
    }
  },

  clearError: () => set({ error: null }),
}))
