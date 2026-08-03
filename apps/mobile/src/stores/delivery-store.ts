import { create } from 'zustand'
import * as Location from 'expo-location'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { userClient } from '@/lib/supabase'
import {
  isResolvedStop,
  type DeliveryMethod,
  type DeliveryRound,
  type DeliveryStopStatus,
} from '@/types/deliveries'

const ROUND_SELECT = `
  *,
  patients:ps_delivery_round_patients(
    *,
    patient:ps_patients(id, first_name, last_name, phone, address_line_1, address_line_2, city, postcode),
    medications:ps_delivery_patient_medications(
      id,
      quantity,
      patient_medication:ps_patient_medications(id, drug_name, drug_form, drug_strength, dose)
    )
  )
`

interface CompleteDeliveryOptions {
  signatureData?: string
  deliveryMethod: DeliveryMethod
  recipientName?: string
  evidenceFiles?: Array<{
    uri: string
    mimeType?: string | null
    fileName?: string | null
  }>
}

interface DeliveryState {
  assignedRounds: DeliveryRound[]
  openRounds: DeliveryRound[]
  history: DeliveryRound[]
  activeRound: DeliveryRound | null
  loading: boolean
  saving: boolean
  tracking: boolean
  error: string | null
  locationSubscription: Location.LocationSubscription | null
  realtimeChannel: RealtimeChannel | null

  fetchDashboard: (organisationId: string, memberId: string) => Promise<void>
  fetchHistory: (memberId: string) => Promise<void>
  fetchRound: (roundId: string) => Promise<void>
  claimRound: (roundId: string, memberId: string) => Promise<void>
  startRound: (roundId: string) => Promise<void>
  updateStopStatus: (
    stopId: string,
    status: DeliveryStopStatus,
    failureReason?: string,
  ) => Promise<void>
  completeDelivery: (
    stopId: string,
    options: CompleteDeliveryOptions,
  ) => Promise<void>
  startTracking: (roundId: string, memberId: string) => Promise<void>
  stopTracking: () => void
  subscribeToRound: (roundId: string) => void
  unsubscribeFromRound: () => void
  clearError: () => void
}

function sortStops(round: DeliveryRound): DeliveryRound {
  return {
    ...round,
    patients: [...(round.patients ?? [])].sort(
      (left, right) => left.delivery_order - right.delivery_order,
    ),
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export const useDeliveryStore = create<DeliveryState>((set, get) => ({
  assignedRounds: [],
  openRounds: [],
  history: [],
  activeRound: null,
  loading: false,
  saving: false,
  tracking: false,
  error: null,
  locationSubscription: null,
  realtimeChannel: null,

  fetchDashboard: async (organisationId, memberId) => {
    set({ loading: true, error: null })
    try {
      const [assignedResult, openResult] = await Promise.all([
        userClient
          .from('ps_delivery_rounds')
          .select(ROUND_SELECT)
          .eq('driver_id', memberId)
          .in('status', ['draft', 'scheduled', 'in_progress'])
          .order('scheduled_date', { ascending: true }),
        userClient
          .from('ps_delivery_rounds')
          .select(ROUND_SELECT)
          .eq('organisation_id', organisationId)
          .is('driver_id', null)
          .eq('status', 'scheduled')
          .order('scheduled_date', { ascending: true }),
      ])
      if (assignedResult.error) throw assignedResult.error
      if (openResult.error) throw openResult.error
      set({
        assignedRounds: (assignedResult.data ?? []).map((round) =>
          sortStops(round as DeliveryRound),
        ),
        openRounds: (openResult.data ?? []).map((round) =>
          sortStops(round as DeliveryRound),
        ),
        loading: false,
      })
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
    }
  },

  fetchHistory: async (memberId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_rounds')
        .select(ROUND_SELECT)
        .eq('driver_id', memberId)
        .in('status', ['completed', 'cancelled'])
        .order('completed_at', { ascending: false })
        .limit(50)
      if (error) throw error
      set({
        history: (data ?? []).map((round) =>
          sortStops(round as DeliveryRound),
        ),
        loading: false,
      })
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
    }
  },

  fetchRound: async (roundId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_rounds')
        .select(ROUND_SELECT)
        .eq('id', roundId)
        .single()
      if (error) throw error
      set({ activeRound: sortStops(data as DeliveryRound), loading: false })
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
    }
  },

  claimRound: async (roundId, memberId) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_rounds')
        .update({ driver_id: memberId })
        .eq('id', roundId)
        .is('driver_id', null)
        .eq('status', 'scheduled')
        .select(ROUND_SELECT)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('This delivery was claimed by another driver.')
      const claimed = sortStops(data as DeliveryRound)
      set((state) => ({
        assignedRounds: [...state.assignedRounds, claimed],
        openRounds: state.openRounds.filter((round) => round.id !== roundId),
        saving: false,
      }))
    } catch (error) {
      set({ error: errorMessage(error), saving: false })
      throw error
    }
  },

  startRound: async (roundId) => {
    set({ saving: true, error: null })
    try {
      const startedAt = new Date().toISOString()
      const { error } = await userClient
        .from('ps_delivery_rounds')
        .update({ status: 'in_progress', started_at: startedAt })
        .eq('id', roundId)
      if (error) throw error
      set((state) => ({
        activeRound:
          state.activeRound?.id === roundId
            ? { ...state.activeRound, status: 'in_progress', started_at: startedAt }
            : state.activeRound,
        assignedRounds: state.assignedRounds.map((round) =>
          round.id === roundId
            ? { ...round, status: 'in_progress', started_at: startedAt }
            : round,
        ),
        saving: false,
      }))
    } catch (error) {
      set({ error: errorMessage(error), saving: false })
      throw error
    }
  },

  updateStopStatus: async (stopId, status, failureReason) => {
    set({ saving: true, error: null })
    try {
      const persistedStatus =
        status === 'failed' ? 'pending_redelivery' : status
      const updates: Record<string, string | null> = {
        status: persistedStatus,
      }
      if (failureReason) updates.failure_reason = failureReason
      const { error } = await userClient
        .from('ps_delivery_round_patients')
        .update(updates)
        .eq('id', stopId)
      if (error) throw error

      const activeRound = get().activeRound
      if (!activeRound) {
        set({ saving: false })
        return
      }
      const patients = activeRound.patients.map((stop) =>
        stop.id === stopId
          ? {
              ...stop,
              status: persistedStatus as DeliveryStopStatus,
              failure_reason: failureReason ?? stop.failure_reason,
            }
          : stop,
      )
      const allResolved = patients.length > 0 && patients.every((stop) =>
        isResolvedStop(stop.status),
      )
      if (allResolved) {
        const completedAt = new Date().toISOString()
        const { error: roundError } = await userClient
          .from('ps_delivery_rounds')
          .update({ status: 'completed', completed_at: completedAt })
          .eq('id', activeRound.id)
        if (roundError) throw roundError
        set({
          activeRound: {
            ...activeRound,
            patients,
            status: 'completed',
            completed_at: completedAt,
          },
          saving: false,
        })
        get().stopTracking()
        return
      }
      set({ activeRound: { ...activeRound, patients }, saving: false })
    } catch (error) {
      set({ error: errorMessage(error), saving: false })
      throw error
    }
  },

  completeDelivery: async (stopId, options) => {
    set({ saving: true, error: null })
    const uploadedPaths: string[] = []
    try {
      const activeRound = get().activeRound
      if (!activeRound) throw new Error('The active delivery round is unavailable.')

      for (const [index, file] of (options.evidenceFiles ?? []).entries()) {
        const mimeType = file.mimeType || 'image/jpeg'
        const extension = mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/webp'
            ? 'webp'
            : 'jpg'
        const path = `${activeRound.organisation_id}/${activeRound.id}/${stopId}/${Date.now()}-${index}.${extension}`
        const response = await fetch(file.uri)
        const bytes = await response.arrayBuffer()
        const { error: uploadError } = await userClient.storage
          .from('delivery-evidence')
          .upload(path, bytes, { contentType: mimeType, upsert: false })
        if (uploadError) throw uploadError
        uploadedPaths.push(path)
      }

      const deliveredAt = new Date().toISOString()
      const { error } = await userClient
        .from('ps_delivery_round_patients')
        .update({
          status: 'delivered',
          delivered_at: deliveredAt,
          signature_data: options.signatureData ?? null,
          proof_photo_paths: uploadedPaths,
          delivery_method: options.deliveryMethod,
          delivery_recipient_name: options.recipientName?.trim() || null,
        })
        .eq('id', stopId)
      if (error) throw error

      const patients = activeRound.patients.map((stop) =>
        stop.id === stopId
          ? {
              ...stop,
              status: 'delivered' as const,
              delivered_at: deliveredAt,
              signature_data: options.signatureData ?? null,
              proof_photo_paths: uploadedPaths,
              delivery_method: options.deliveryMethod,
              delivery_recipient_name: options.recipientName?.trim() || null,
            }
          : stop,
      )
      if (patients.every((stop) => isResolvedStop(stop.status))) {
        const completedAt = new Date().toISOString()
        const { error: roundError } = await userClient
          .from('ps_delivery_rounds')
          .update({ status: 'completed', completed_at: completedAt })
          .eq('id', activeRound.id)
        if (roundError) throw roundError
        set({
          activeRound: {
            ...activeRound,
            patients,
            status: 'completed',
            completed_at: completedAt,
          },
          saving: false,
        })
        get().stopTracking()
        return
      }
      set({ activeRound: { ...activeRound, patients }, saving: false })
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await userClient.storage.from('delivery-evidence').remove(uploadedPaths)
      }
      set({ error: errorMessage(error), saving: false })
      throw error
    }
  },

  startTracking: async (roundId, memberId) => {
    if (get().locationSubscription) return
    const permission = await Location.requestForegroundPermissionsAsync()
    if (permission.status !== 'granted') {
      set({ error: 'Location permission is required for live route tracking.' })
      return
    }
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 50,
        timeInterval: 15000,
      },
      async (location) => {
        const { error } = await userClient
          .from('ps_delivery_location_updates')
          .insert({
            round_id: roundId,
            driver_id: memberId,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          })
        if (error) set({ error: 'Live location could not be updated.' })
      },
    )
    set({ locationSubscription: subscription, tracking: true })
  },

  stopTracking: () => {
    get().locationSubscription?.remove()
    set({ locationSubscription: null, tracking: false })
  },

  subscribeToRound: (roundId) => {
    get().unsubscribeFromRound()
    const channel = userClient
      .channel(`mobile_delivery_${roundId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ps_delivery_round_patients',
          filter: `round_id=eq.${roundId}`,
        },
        () => void get().fetchRound(roundId),
      )
      .subscribe()
    set({ realtimeChannel: channel })
  },

  unsubscribeFromRound: () => {
    const channel = get().realtimeChannel
    if (channel) void userClient.removeChannel(channel)
    set({ realtimeChannel: null })
  },

  clearError: () => set({ error: null }),
}))