import { create } from 'zustand'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

export interface LocumShift {
  id: string
  org_id: string
  date: string
  start_time: string
  end_time: string
  rate_per_hour: number
  booking_mode: 'auto' | 'manual'
  status: string
  notes: string | null
  org_name: string
  org_address: string
  required_service_ids: string[]
  references_required: boolean
  sop_required: boolean
}

export interface LocumSignIn {
  id: string
  booking_id: string
  signed_in_at: string
  signed_out_at: string | null
  duration_minutes: number | null
}

export interface LocumBooking {
  id: string
  shift_id: string
  status: string
  applied_at: string
  cancellation_reason: string | null
  shift: LocumShift | null
  sign_in: LocumSignIn | null
}

interface LocumState {
  shifts: LocumShift[]
  bookings: LocumBooking[]
  serviceIds: string[]
  clashIds: string[]
  loading: boolean
  actionId: string | null
  error: string | null
  loadedFor: string | null
  load: (force?: boolean) => Promise<void>
  book: (shift: LocumShift) => Promise<void>
  withdraw: (bookingId: string) => Promise<void>
  clockIn: (booking: LocumBooking) => Promise<void>
  clockOut: (booking: LocumBooking) => Promise<void>
  clearError: () => void
}

type RawShift = Omit<
  LocumShift,
  | 'org_name'
  | 'org_address'
  | 'required_service_ids'
  | 'references_required'
  | 'sop_required'
>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function addressLine(address: unknown): string {
  if (!address || typeof address !== 'object') return ''
  const value = address as Record<string, unknown>
  return [value.line_1, value.city, value.postcode]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(', ')
}

export const useLocumStore = create<LocumState>((set, get) => ({
  shifts: [],
  bookings: [],
  serviceIds: [],
  clashIds: [],
  loading: false,
  actionId: null,
  error: null,
  loadedFor: null,

  load: async (force = false) => {
    const locum = useAuthStore.getState().locumProfile
    if (!locum || get().loading) return
    if (!force && get().loadedFor === locum.id) return

    set({ loading: true, error: null })
    try {
      const today = new Date().toISOString().slice(0, 10)
      const [servicesResult, shiftsResult, bookingsResult] = await Promise.all([
        userClient
          .from('ps_locum_services')
          .select('service_library_id')
          .eq('locum_id', locum.id),
        userClient
          .from('ps_locum_shifts')
          .select('id, org_id, date, start_time, end_time, rate_per_hour, booking_mode, status, notes')
          .eq('status', 'open')
          .gte('date', today)
          .order('date')
          .order('start_time'),
        userClient
          .from('ps_locum_bookings')
          .select('id, shift_id, status, applied_at, cancellation_reason, shift:ps_locum_shifts(id, org_id, date, start_time, end_time, rate_per_hour, booking_mode, status, notes)')
          .eq('locum_id', locum.id)
          .order('applied_at', { ascending: false }),
      ])

      if (servicesResult.error) throw servicesResult.error
      if (shiftsResult.error) throw shiftsResult.error
      if (bookingsResult.error) throw bookingsResult.error

      const openShifts = (shiftsResult.data ?? []) as RawShift[]
      const rawBookings = (bookingsResult.data ?? []) as unknown as Array<
        Omit<LocumBooking, 'shift' | 'sign_in'> & { shift: RawShift | null }
      >
      const allRawShifts = [
        ...openShifts,
        ...rawBookings.flatMap((booking) => (booking.shift ? [booking.shift] : [])),
      ]
      const shiftIds = [...new Set(allRawShifts.map((shift) => shift.id))]
      const orgIds = [...new Set(allRawShifts.map((shift) => shift.org_id))]
      const bookingIds = rawBookings.map((booking) => booking.id)

      const [criteriaResult, orgResult, signInResult] = await Promise.all([
        shiftIds.length
          ? userClient
              .from('ps_locum_shift_criteria')
              .select('shift_id, required_service_ids, references_required, sop_required')
              .in('shift_id', shiftIds)
          : Promise.resolve({ data: [], error: null }),
        orgIds.length
          ? userClient.from('ps_organisations').select('id, name, address').in('id', orgIds)
          : Promise.resolve({ data: [], error: null }),
        bookingIds.length
          ? userClient
              .from('ps_locum_sign_ins')
              .select('id, booking_id, signed_in_at, signed_out_at, duration_minutes')
              .in('booking_id', bookingIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (criteriaResult.error) throw criteriaResult.error
      if (orgResult.error) throw orgResult.error
      if (signInResult.error) throw signInResult.error

      const criteria = new Map(
        (criteriaResult.data ?? []).map((row) => [row.shift_id, row]),
      )
      const orgs = new Map(
        (orgResult.data ?? []).map((row) => [
          row.id,
          { name: row.name as string, address: addressLine(row.address) },
        ]),
      )
      const signIns = new Map(
        ((signInResult.data ?? []) as LocumSignIn[]).map((row) => [row.booking_id, row]),
      )

      const enrich = (shift: RawShift): LocumShift => {
        const requirement = criteria.get(shift.id)
        const org = orgs.get(shift.org_id)
        return {
          ...shift,
          org_name: org?.name ?? 'Pharmacy',
          org_address: org?.address ?? '',
          required_service_ids: requirement?.required_service_ids ?? [],
          references_required: requirement?.references_required ?? false,
          sop_required: requirement?.sop_required ?? false,
        }
      }

      const enrichedShifts = openShifts.map(enrich)
      const clashes = await Promise.all(
        enrichedShifts.map(async (shift) => {
          const { data } = await userClient.rpc('ps_get_locum_booking_clashes', {
            p_locum_id: locum.id,
            p_date: shift.date,
            p_start: shift.start_time,
            p_end: shift.end_time,
          })
          return Array.isArray(data) && data.length > 0 ? shift.id : null
        }),
      )

      set({
        shifts: enrichedShifts,
        bookings: rawBookings.map((booking) => ({
          ...booking,
          shift: booking.shift ? enrich(booking.shift) : null,
          sign_in: signIns.get(booking.id) ?? null,
        })),
        serviceIds: (servicesResult.data ?? []).map((row) => row.service_library_id),
        clashIds: clashes.filter((id): id is string => id !== null),
        loadedFor: locum.id,
      })
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ loading: false })
    }
  },

  book: async (shift) => {
    const locum = useAuthStore.getState().locumProfile
    if (!locum) return
    set({ actionId: shift.id, error: null })
    try {
      const { error } = await userClient.rpc('ps_locum_book_shift', {
        p_shift_id: shift.id,
      })
      if (error) throw error
      set({ loadedFor: null })
      await get().load(true)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ actionId: null })
    }
  },

  withdraw: async (bookingId) => {
    set({ actionId: bookingId, error: null })
    try {
      const { error } = await userClient.rpc('ps_locum_cancel_booking', {
        p_booking_id: bookingId,
      })
      if (error) throw error
      set({ loadedFor: null })
      await get().load(true)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ actionId: null })
    }
  },

  clockIn: async (booking) => {
    const locum = useAuthStore.getState().locumProfile
    if (!locum || !booking.shift) return
    set({ actionId: booking.id, error: null })
    try {
      const { error } = await userClient.from('ps_locum_sign_ins').insert({
        booking_id: booking.id,
        locum_id: locum.id,
        org_id: booking.shift.org_id,
        signed_in_at: new Date().toISOString(),
      })
      if (error) throw error
      set({ loadedFor: null })
      await get().load(true)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ actionId: null })
    }
  },

  clockOut: async (booking) => {
    if (!booking.sign_in) return
    set({ actionId: booking.id, error: null })
    try {
      const signedOutAt = new Date()
      const durationMinutes = Math.max(
        0,
        Math.round(
          (signedOutAt.getTime() - new Date(booking.sign_in.signed_in_at).getTime()) /
            60000,
        ),
      )
      const { error } = await userClient
        .from('ps_locum_sign_ins')
        .update({
          signed_out_at: signedOutAt.toISOString(),
          duration_minutes: durationMinutes,
        })
        .eq('id', booking.sign_in.id)
      if (error) throw error
      set({ loadedFor: null })
      await get().load(true)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ actionId: null })
    }
  },

  clearError: () => set({ error: null }),
}))

export function shiftHours(shift: Pick<LocumShift, 'start_time' | 'end_time'>) {
  const [startHour, startMinute] = shift.start_time.split(':').map(Number)
  const [endHour, endMinute] = shift.end_time.split(':').map(Number)
  return Math.max(0, (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60)
}

export function shiftTotal(shift: LocumShift) {
  return shiftHours(shift) * Number(shift.rate_per_hour)
}