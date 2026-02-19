import { create } from 'zustand'
import type {
  AppointmentSlot,
  Appointment,
  AppointmentStatus,
  Patient,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface AppointmentState {
  // Data
  slots: AppointmentSlot[]
  appointments: Appointment[]
  patients: Patient[]
  activeAppointment: Appointment | null
  activePatient: Patient | null
  calendarView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'
  loading: boolean
  error: string | null

  // Slot actions
  fetchSlots: (orgId: string, range?: { start: string; end: string }) => Promise<void>
  createSlot: (slot: Partial<AppointmentSlot>) => Promise<AppointmentSlot>
  updateSlot: (slotId: string, updates: Partial<AppointmentSlot>) => Promise<void>
  deleteSlot: (slotId: string) => Promise<void>

  // Appointment actions
  fetchAppointments: (orgId: string, range?: { start: string; end: string }) => Promise<void>
  fetchAppointmentDetail: (appointmentId: string) => Promise<void>
  bookAppointment: (appointment: Partial<Appointment>) => Promise<Appointment>
  updateAppointment: (appointmentId: string, updates: Partial<Appointment>) => Promise<void>
  updateStatus: (appointmentId: string, status: AppointmentStatus) => Promise<void>
  cancelAppointment: (appointmentId: string) => Promise<void>

  // Patient actions
  fetchPatients: (orgId: string) => Promise<void>
  fetchPatientDetail: (patientId: string) => Promise<void>
  createPatient: (patient: Partial<Patient>) => Promise<Patient>
  updatePatient: (patientId: string, updates: Partial<Patient>) => Promise<void>
  searchPatients: (orgId: string, query: string) => Promise<Patient[]>

  // Public slot fetching (anon)
  fetchPublicSlots: (orgSlug: string, serviceId: string) => Promise<AppointmentSlot[]>

  // UI
  setCalendarView: (view: AppointmentState['calendarView']) => void
  clearError: () => void
}

export const useAppointmentStore = create<AppointmentState>((set, get) => ({
  slots: [],
  appointments: [],
  patients: [],
  activeAppointment: null,
  activePatient: null,
  calendarView: 'timeGridWeek',
  loading: false,
  error: null,

  // --- Slots ---

  fetchSlots: async (orgId, range) => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_appointment_slots')
        .select('*, service:ps_services(id, name, duration_minutes)')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('start_time')

      if (range) {
        query = query.gte('start_time', range.start).lte('end_time', range.end)
      }

      const { data, error } = await query
      if (error) throw error
      set({ slots: (data ?? []) as AppointmentSlot[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createSlot: async (slot) => {
    const { data, error } = await getUserClient()
      .from('ps_appointment_slots')
      .insert(slot)
      .select()
      .single()
    if (error) throw error
    const created = data as AppointmentSlot
    set((s) => ({ slots: [...s.slots, created] }))
    return created
  },

  updateSlot: async (slotId, updates) => {
    const { error } = await getUserClient()
      .from('ps_appointment_slots')
      .update(updates)
      .eq('id', slotId)
    if (error) throw error
    set((s) => ({
      slots: s.slots.map((slot) =>
        slot.id === slotId ? { ...slot, ...updates } : slot
      ),
    }))
  },

  deleteSlot: async (slotId) => {
    const { error } = await getUserClient()
      .from('ps_appointment_slots')
      .update({ is_active: false })
      .eq('id', slotId)
    if (error) throw error
    set((s) => ({ slots: s.slots.filter((slot) => slot.id !== slotId) }))
  },

  // --- Appointments ---

  fetchAppointments: async (orgId, range) => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_appointments')
        .select(`
          *,
          patient:ps_patients(id, first_name, last_name, phone, email),
          service:ps_services(id, name, duration_minutes),
          slot:ps_appointment_slots(id, start_time, end_time)
        `)
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      if (range) {
        // Filter by slot time range via a nested filter
        query = query
          .not('slot', 'is', null)
          .gte('slot.start_time', range.start)
          .lte('slot.end_time', range.end)
      }

      const { data, error } = await query
      if (error) throw error
      set({ appointments: (data ?? []) as Appointment[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchAppointmentDetail: async (appointmentId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_appointments')
        .select(`
          *,
          patient:ps_patients(*),
          service:ps_services(*),
          slot:ps_appointment_slots(*),
          form:ps_service_forms(*)
        `)
        .eq('id', appointmentId)
        .single()
      if (error) throw error
      set({ activeAppointment: data as Appointment, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  bookAppointment: async (appointment) => {
    const { data, error } = await getUserClient()
      .from('ps_appointments')
      .insert(appointment)
      .select()
      .single()
    if (error) throw error
    const created = data as Appointment
    set((s) => ({ appointments: [created, ...s.appointments] }))
    return created
  },

  updateAppointment: async (appointmentId, updates) => {
    const { error } = await getUserClient()
      .from('ps_appointments')
      .update(updates)
      .eq('id', appointmentId)
    if (error) throw error
    set((s) => ({
      appointments: s.appointments.map((a) =>
        a.id === appointmentId ? { ...a, ...updates } : a
      ),
      activeAppointment:
        s.activeAppointment?.id === appointmentId
          ? { ...s.activeAppointment, ...updates }
          : s.activeAppointment,
    }))
  },

  updateStatus: async (appointmentId, status) => {
    const { error } = await getUserClient()
      .from('ps_appointments')
      .update({ status })
      .eq('id', appointmentId)
    if (error) throw error
    set((s) => ({
      appointments: s.appointments.map((a) =>
        a.id === appointmentId ? { ...a, status } : a
      ),
      activeAppointment:
        s.activeAppointment?.id === appointmentId
          ? { ...s.activeAppointment, status }
          : s.activeAppointment,
    }))
  },

  cancelAppointment: async (appointmentId) => {
    await get().updateStatus(appointmentId, 'cancelled')
  },

  // --- Patients ---

  fetchPatients: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_patients')
        .select('*')
        .eq('organisation_id', orgId)
        .order('last_name')
      if (error) throw error
      set({ patients: (data ?? []) as Patient[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchPatientDetail: async (patientId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_patients')
        .select('*')
        .eq('id', patientId)
        .single()
      if (error) throw error
      set({ activePatient: data as Patient, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createPatient: async (patient) => {
    const { data, error } = await getUserClient()
      .from('ps_patients')
      .insert(patient)
      .select()
      .single()
    if (error) throw error
    const created = data as Patient
    set((s) => ({ patients: [...s.patients, created] }))
    return created
  },

  updatePatient: async (patientId, updates) => {
    const { error } = await getUserClient()
      .from('ps_patients')
      .update(updates)
      .eq('id', patientId)
    if (error) throw error
    set((s) => ({
      patients: s.patients.map((p) =>
        p.id === patientId ? { ...p, ...updates } : p
      ),
      activePatient:
        s.activePatient?.id === patientId
          ? { ...s.activePatient, ...updates }
          : s.activePatient,
    }))
  },

  searchPatients: async (orgId, query) => {
    const { data, error } = await getUserClient()
      .from('ps_patients')
      .select('*')
      .eq('organisation_id', orgId)
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,nhs_number.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(20)
    if (error) throw error
    return (data ?? []) as Patient[]
  },

  // --- Public ---

  fetchPublicSlots: async (_orgSlug, serviceId) => {
    // Uses anon-accessible read — no auth needed
    const { data, error } = await getUserClient()
      .from('ps_appointment_slots')
      .select('id, start_time, end_time, max_bookings, booked_count')
      .eq('service_id', serviceId)
      .eq('is_active', true)
      .gt('start_time', new Date().toISOString())
      .order('start_time')
    if (error) throw error
    return (data ?? []) as AppointmentSlot[]
  },

  // --- UI ---

  setCalendarView: (view) => set({ calendarView: view }),
  clearError: () => set({ error: null }),
}))
