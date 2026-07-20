import { create } from 'zustand'
import type {
  DeliveryRound,
  DeliveryRoundStatus,
  DeliveryRoundPatient,
  DeliveryPatientMedication,
  DeliveryRoundTemplate,
  DeliveryRoundTemplatePatient,
  OrganisationMember,
  PatientMedication,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

// ── Helpers ──

const ROUND_SELECT = `
  *,
  driver:ps_organisation_members(id, user_id, role, user_profile:ps_user_profiles!user_id(id, full_name)),
  patients:ps_delivery_round_patients(
    *,
    patient:ps_patients(id, first_name, last_name, phone, address_line_1, address_line_2, city, postcode),
    medications:ps_delivery_patient_medications(*, patient_medication:ps_patient_medications(*))
  )
`

const TEMPLATE_SELECT = `
  *,
  patients:ps_delivery_round_template_patients(
    *,
    patient:ps_patients(id, first_name, last_name, phone, address_line_1, address_line_2, city, postcode),
    medications:ps_delivery_round_template_medications(*, patient_medication:ps_patient_medications(*))
  )
`

// ── State ──

export interface DeliveryRoundState {
  // Data
  rounds: DeliveryRound[]
  activeRound: DeliveryRound | null
  redeliveryQueue: DeliveryRoundPatient[]
  templates: DeliveryRoundTemplate[]
  activeTemplate: DeliveryRoundTemplate | null
  availableDrivers: OrganisationMember[]
  loading: boolean
  error: string | null

  // Round CRUD
  fetchRounds: (orgId: string, filters?: { status?: DeliveryRoundStatus; driverId?: string }) => Promise<void>
  fetchRound: (id: string) => Promise<void>
  createRound: (data: Partial<DeliveryRound>) => Promise<DeliveryRound>
  updateRound: (id: string, updates: Partial<DeliveryRound>) => Promise<void>
  deleteRound: (id: string) => Promise<void>

  // Round lifecycle
  scheduleRound: (id: string, date: string, timeStart?: string, timeEnd?: string) => Promise<void>
  startRound: (id: string) => Promise<void>
  completeRound: (id: string) => Promise<void>
  cancelRound: (id: string) => Promise<void>

  // Patients in round
  addPatientToRound: (roundId: string, orgId: string, patientId: string, deliveryOrder: number, medications: { patient_medication_id: string; quantity?: number }[], addressOverride?: { line1?: string; line2?: string; city?: string; postcode?: string }, notes?: string) => Promise<void>
  removePatientFromRound: (roundPatientId: string) => Promise<void>
  updatePatientOrder: (roundPatientId: string, newOrder: number) => Promise<void>

  // Per-patient medicines within a round
  addMedicationToRoundPatient: (roundId: string, roundPatientId: string, patientMedicationId: string, quantity?: number, notes?: string) => Promise<void>
  removeMedicationFromRoundPatient: (roundId: string, deliveryMedicationId: string) => Promise<void>

  // Driver
  assignDriver: (roundId: string, driverId: string | null) => Promise<void>
  fetchAvailableDrivers: (orgId: string) => Promise<void>

  // Redelivery queue
  fetchRedeliveryQueue: (orgId: string) => Promise<void>
  movePatientToRound: (failedPatientId: string, targetRoundId: string, orgId: string) => Promise<void>
  createRedeliveryRound: (orgId: string, createdBy: string, failedPatientIds: string[]) => Promise<DeliveryRound>
  markReturned: (roundPatientId: string) => Promise<void>
  cancelRedelivery: (roundPatientId: string) => Promise<void>

  // Templates
  fetchTemplates: (orgId: string) => Promise<void>
  fetchTemplate: (id: string) => Promise<void>
  saveAsTemplate: (roundId: string, name: string, orgId: string, createdBy: string) => Promise<DeliveryRoundTemplate>
  createTemplate: (data: { organisation_id: string; name: string; notes?: string; created_by: string }) => Promise<DeliveryRoundTemplate>
  updateTemplate: (id: string, updates: Partial<DeliveryRoundTemplate>) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  createRoundFromTemplate: (templateId: string, orgId: string, createdBy: string) => Promise<DeliveryRound>

  // Repeat round
  repeatRound: (roundId: string, orgId: string, createdBy: string) => Promise<DeliveryRound>

  // Notifications
  sendRoundNotifications: (roundId: string, orgId: string, message?: string) => Promise<{ sent: number; failed: number }>

  // Realtime
  subscribeToRound: (roundId: string) => () => void

  // UI
  clearError: () => void
}

export const useDeliveryRoundStore = create<DeliveryRoundState>((set, get) => ({
  rounds: [],
  activeRound: null,
  redeliveryQueue: [],
  templates: [],
  activeTemplate: null,
  availableDrivers: [],
  loading: false,
  error: null,

  // ── Round CRUD ──

  fetchRounds: async (orgId, filters) => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_delivery_rounds')
        .select(ROUND_SELECT)
        .eq('organisation_id', orgId)
        .order('created_at', { ascending: false })

      if (filters?.status) query = query.eq('status', filters.status)
      if (filters?.driverId) query = query.eq('driver_id', filters.driverId)

      const { data, error } = await query
      if (error) throw error
      set({ rounds: (data ?? []) as DeliveryRound[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchRound: async (id) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_delivery_rounds')
        .select(ROUND_SELECT)
        .eq('id', id)
        .single()
      if (error) throw error
      set({ activeRound: data as DeliveryRound, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createRound: async (data) => {
    const { data: created, error } = await getUserClient()
      .from('ps_delivery_rounds')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    const round = created as DeliveryRound
    set((s) => ({ rounds: [round, ...s.rounds] }))
    return round
  },

  updateRound: async (id, updates) => {
    const { error } = await getUserClient()
      .from('ps_delivery_rounds')
      .update(updates)
      .eq('id', id)
    if (error) throw error
    set((s) => ({
      rounds: s.rounds.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      activeRound: s.activeRound?.id === id ? { ...s.activeRound, ...updates } : s.activeRound,
    }))
  },

  deleteRound: async (id) => {
    const { error } = await getUserClient()
      .from('ps_delivery_rounds')
      .delete()
      .eq('id', id)
    if (error) throw error
    set((s) => ({
      rounds: s.rounds.filter((r) => r.id !== id),
      activeRound: s.activeRound?.id === id ? null : s.activeRound,
    }))
  },

  // ── Round Lifecycle ──

  scheduleRound: async (id, date, timeStart, timeEnd) => {
    const updates: any = { status: 'scheduled', scheduled_date: date }
    if (timeStart) updates.scheduled_time_start = timeStart
    if (timeEnd) updates.scheduled_time_end = timeEnd
    await get().updateRound(id, updates)
  },

  startRound: async (id) => {
    await get().updateRound(id, { status: 'in_progress' as DeliveryRoundStatus, started_at: new Date().toISOString() })
  },

  completeRound: async (id) => {
    await get().updateRound(id, { status: 'completed' as DeliveryRoundStatus, completed_at: new Date().toISOString() })
  },

  cancelRound: async (id) => {
    await get().updateRound(id, { status: 'cancelled' as DeliveryRoundStatus })
  },

  // ── Patients in Round ──

  addPatientToRound: async (roundId, orgId, patientId, deliveryOrder, medications, addressOverride, notes) => {
    // Insert round patient
    const patientData: any = {
      round_id: roundId,
      patient_id: patientId,
      organisation_id: orgId,
      delivery_order: deliveryOrder,
    }
    if (addressOverride?.line1) patientData.delivery_address_line_1 = addressOverride.line1
    if (addressOverride?.line2) patientData.delivery_address_line_2 = addressOverride.line2
    if (addressOverride?.city) patientData.delivery_city = addressOverride.city
    if (addressOverride?.postcode) patientData.delivery_postcode = addressOverride.postcode
    if (notes) patientData.notes = notes

    const { data: rpData, error: rpError } = await getUserClient()
      .from('ps_delivery_round_patients')
      .insert(patientData)
      .select()
      .single()
    if (rpError) throw rpError

    // Insert medications for this round patient
    if (medications.length > 0) {
      const medRows = medications.map((m) => ({
        delivery_round_patient_id: rpData.id,
        patient_medication_id: m.patient_medication_id,
        quantity: m.quantity ?? null,
      }))
      const { error: medError } = await getUserClient()
        .from('ps_delivery_patient_medications')
        .insert(medRows)
      if (medError) throw medError
    }

    // Refresh the round
    await get().fetchRound(roundId)
  },

  removePatientFromRound: async (roundPatientId) => {
    const { error } = await getUserClient()
      .from('ps_delivery_round_patients')
      .delete()
      .eq('id', roundPatientId)
    if (error) throw error

    const activeRound = get().activeRound
    if (activeRound) {
      set({
        activeRound: {
          ...activeRound,
          patients: activeRound.patients?.filter((p) => p.id !== roundPatientId),
        },
      })
    }
  },

  updatePatientOrder: async (roundPatientId, newOrder) => {
    const { error } = await getUserClient()
      .from('ps_delivery_round_patients')
      .update({ delivery_order: newOrder })
      .eq('id', roundPatientId)
    if (error) throw error
  },

  // ── Per-patient medicines within a round ──

  addMedicationToRoundPatient: async (roundId, roundPatientId, patientMedicationId, quantity, notes) => {
    const { error } = await getUserClient()
      .from('ps_delivery_patient_medications')
      .insert({
        delivery_round_patient_id: roundPatientId,
        patient_medication_id: patientMedicationId,
        quantity: quantity ?? null,
        notes: notes ?? null,
      })
    if (error) throw error
    await get().fetchRound(roundId)
  },

  removeMedicationFromRoundPatient: async (roundId, deliveryMedicationId) => {
    const { error } = await getUserClient()
      .from('ps_delivery_patient_medications')
      .delete()
      .eq('id', deliveryMedicationId)
    if (error) throw error
    await get().fetchRound(roundId)
  },

  // ── Driver ──

  assignDriver: async (roundId, driverId) => {
    await get().updateRound(roundId, { driver_id: driverId } as any)
  },

  fetchAvailableDrivers: async (orgId) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_organisation_members')
        .select('*, user_profile:ps_user_profiles!user_id(id, full_name)')
        .eq('organisation_id', orgId)
        .eq('status', 'active')
      if (error) throw error
      // Filter client-side for members with delivery_drive permission
      // (permissions are resolved client-side via resolvePermissions)
      set({ availableDrivers: (data ?? []) as OrganisationMember[] })
    } catch (e: any) {
      set({ error: e.message })
    }
  },

  // ── Redelivery Queue ──

  fetchRedeliveryQueue: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_delivery_round_patients')
        .select(`
          *,
          patient:ps_patients(id, first_name, last_name, phone, address_line_1, address_line_2, city, postcode),
          medications:ps_delivery_patient_medications(*, patient_medication:ps_patient_medications(*)),
          round:ps_delivery_rounds(id, title, scheduled_date)
        `)
        .eq('organisation_id', orgId)
        .eq('status', 'pending_redelivery')
        .order('updated_at', { ascending: false })
      if (error) throw error
      set({ redeliveryQueue: (data ?? []) as DeliveryRoundPatient[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  movePatientToRound: async (failedPatientId, targetRoundId, orgId) => {
    // Get the failed patient record with meds
    const { data: failedRp, error: fetchErr } = await getUserClient()
      .from('ps_delivery_round_patients')
      .select('*, medications:ps_delivery_patient_medications(*)')
      .eq('id', failedPatientId)
      .single()
    if (fetchErr) throw fetchErr

    // Get max delivery_order in target round
    const { data: existingPatients } = await getUserClient()
      .from('ps_delivery_round_patients')
      .select('delivery_order')
      .eq('round_id', targetRoundId)
      .order('delivery_order', { ascending: false })
      .limit(1)
    const nextOrder = existingPatients && existingPatients.length > 0
      ? (existingPatients[0] as any).delivery_order + 1
      : 1

    // Create new round patient in target round
    const { data: newRp, error: insertErr } = await getUserClient()
      .from('ps_delivery_round_patients')
      .insert({
        round_id: targetRoundId,
        patient_id: failedRp.patient_id,
        organisation_id: orgId,
        delivery_order: nextOrder,
        status: 'pending',
        delivery_address_line_1: failedRp.delivery_address_line_1,
        delivery_address_line_2: failedRp.delivery_address_line_2,
        delivery_city: failedRp.delivery_city,
        delivery_postcode: failedRp.delivery_postcode,
        notes: failedRp.notes,
        original_round_patient_id: failedPatientId,
      })
      .select()
      .single()
    if (insertErr) throw insertErr

    // Copy medications to new round patient
    const meds = (failedRp as any).medications ?? []
    if (meds.length > 0) {
      const medRows = meds.map((m: any) => ({
        delivery_round_patient_id: newRp.id,
        patient_medication_id: m.patient_medication_id,
        quantity: m.quantity,
      }))
      await getUserClient().from('ps_delivery_patient_medications').insert(medRows)
    }

    // Update original failed patient status to moved_to_round
    await getUserClient()
      .from('ps_delivery_round_patients')
      .update({ status: 'moved_to_round', moved_to_round_patient_id: newRp.id })
      .eq('id', failedPatientId)

    // Refresh redelivery queue
    set((s) => ({
      redeliveryQueue: s.redeliveryQueue.filter((rp) => rp.id !== failedPatientId),
    }))
  },

  createRedeliveryRound: async (orgId, createdBy, failedPatientIds) => {
    // Create a new draft round
    const round = await get().createRound({
      organisation_id: orgId,
      title: `Redelivery — ${new Date().toLocaleDateString('en-GB')}`,
      status: 'draft',
      created_by: createdBy,
    })

    // Move each failed patient into the new round
    for (let i = 0; i < failedPatientIds.length; i++) {
      await get().movePatientToRound(failedPatientIds[i], round.id, orgId)
    }

    return round
  },

  markReturned: async (roundPatientId) => {
    const { error } = await getUserClient()
      .from('ps_delivery_round_patients')
      .update({ status: 'returned' })
      .eq('id', roundPatientId)
    if (error) throw error
    set((s) => ({
      redeliveryQueue: s.redeliveryQueue.filter((rp) => rp.id !== roundPatientId),
    }))
  },

  cancelRedelivery: async (roundPatientId) => {
    const { error } = await getUserClient()
      .from('ps_delivery_round_patients')
      .update({ status: 'cancelled' })
      .eq('id', roundPatientId)
    if (error) throw error
    set((s) => ({
      redeliveryQueue: s.redeliveryQueue.filter((rp) => rp.id !== roundPatientId),
    }))
  },

  // ── Templates ──

  fetchTemplates: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_delivery_round_templates')
        .select('*, patients:ps_delivery_round_template_patients(count)')
        .eq('organisation_id', orgId)
        .order('name')
      if (error) throw error
      set({ templates: (data ?? []) as DeliveryRoundTemplate[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchTemplate: async (id) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_delivery_round_templates')
        .select(TEMPLATE_SELECT)
        .eq('id', id)
        .single()
      if (error) throw error
      set({ activeTemplate: data as DeliveryRoundTemplate, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  saveAsTemplate: async (roundId, name, orgId, createdBy) => {
    // Fetch round with patients + meds
    const { data: round, error: roundErr } = await getUserClient()
      .from('ps_delivery_rounds')
      .select(`
        *,
        patients:ps_delivery_round_patients(
          *,
          medications:ps_delivery_patient_medications(*)
        )
      `)
      .eq('id', roundId)
      .single()
    if (roundErr) throw roundErr

    // Create template
    const { data: template, error: tplErr } = await getUserClient()
      .from('ps_delivery_round_templates')
      .insert({ organisation_id: orgId, name, created_by: createdBy })
      .select()
      .single()
    if (tplErr) throw tplErr

    // Create template patients
    const patients = (round as any).patients ?? []
    for (const rp of patients) {
      const { data: tp, error: tpErr } = await getUserClient()
        .from('ps_delivery_round_template_patients')
        .insert({
          template_id: template.id,
          patient_id: rp.patient_id,
          delivery_order: rp.delivery_order,
          delivery_address_line_1: rp.delivery_address_line_1,
          delivery_address_line_2: rp.delivery_address_line_2,
          delivery_city: rp.delivery_city,
          delivery_postcode: rp.delivery_postcode,
          notes: rp.notes,
          include_all_active_meds: true,
        })
        .select()
        .single()
      if (tpErr) throw tpErr

      // Copy specific meds to template
      const meds = rp.medications ?? []
      if (meds.length > 0) {
        const tmRows = meds.map((m: any) => ({
          template_patient_id: tp.id,
          patient_medication_id: m.patient_medication_id,
          default_quantity: m.quantity,
        }))
        await getUserClient().from('ps_delivery_round_template_medications').insert(tmRows)
      }
    }

    const tpl = template as DeliveryRoundTemplate
    set((s) => ({ templates: [...s.templates, tpl] }))
    return tpl
  },

  createTemplate: async (data) => {
    const { data: created, error } = await getUserClient()
      .from('ps_delivery_round_templates')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    const tpl = created as DeliveryRoundTemplate
    set((s) => ({ templates: [...s.templates, tpl] }))
    return tpl
  },

  updateTemplate: async (id, updates) => {
    const { error } = await getUserClient()
      .from('ps_delivery_round_templates')
      .update(updates)
      .eq('id', id)
    if (error) throw error
    set((s) => ({
      templates: s.templates.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      activeTemplate: s.activeTemplate?.id === id ? { ...s.activeTemplate, ...updates } : s.activeTemplate,
    }))
  },

  deleteTemplate: async (id) => {
    const { error } = await getUserClient()
      .from('ps_delivery_round_templates')
      .delete()
      .eq('id', id)
    if (error) throw error
    set((s) => ({
      templates: s.templates.filter((t) => t.id !== id),
      activeTemplate: s.activeTemplate?.id === id ? null : s.activeTemplate,
    }))
  },

  createRoundFromTemplate: async (templateId, orgId, createdBy) => {
    // Fetch full template with patients + meds
    const { data: tpl, error: tplErr } = await getUserClient()
      .from('ps_delivery_round_templates')
      .select(TEMPLATE_SELECT)
      .eq('id', templateId)
      .single()
    if (tplErr) throw tplErr

    // Create draft round
    const round = await get().createRound({
      organisation_id: orgId,
      title: (tpl as any).name,
      status: 'draft',
      template_id: templateId,
      created_by: createdBy,
    })

    // Add template patients to round
    const patients = (tpl as any).patients ?? []
    for (const tp of patients) {
      // Determine medications — if include_all_active_meds, fetch active meds for this patient
      let meds: { patient_medication_id: string; quantity?: number }[] = []

      if (tp.include_all_active_meds) {
        const { data: activeMeds } = await getUserClient()
          .from('ps_patient_medications')
          .select('id, quantity')
          .eq('patient_id', tp.patient_id)
          .eq('is_active', true)
        meds = (activeMeds ?? []).map((m: any) => ({
          patient_medication_id: m.id,
          quantity: m.quantity,
        }))
      } else {
        meds = (tp.medications ?? []).map((m: any) => ({
          patient_medication_id: m.patient_medication_id,
          quantity: m.default_quantity,
        }))
      }

      await get().addPatientToRound(
        round.id,
        orgId,
        tp.patient_id,
        tp.delivery_order,
        meds,
        {
          line1: tp.delivery_address_line_1,
          line2: tp.delivery_address_line_2,
          city: tp.delivery_city,
          postcode: tp.delivery_postcode,
        },
        tp.notes,
      )
    }

    return round
  },

  // ── Repeat Round ──

  repeatRound: async (roundId, orgId, createdBy) => {
    // Fetch the source round
    const { data: source, error: srcErr } = await getUserClient()
      .from('ps_delivery_rounds')
      .select(`
        *,
        patients:ps_delivery_round_patients(
          *,
          medications:ps_delivery_patient_medications(*)
        )
      `)
      .eq('id', roundId)
      .single()
    if (srcErr) throw srcErr

    // Create new draft round
    const round = await get().createRound({
      organisation_id: orgId,
      title: (source as any).title ? `${(source as any).title} (repeat)` : 'Repeat Round',
      status: 'draft',
      template_id: (source as any).template_id,
      created_by: createdBy,
    })

    // Clone patients + meds
    const patients = (source as any).patients ?? []
    for (const rp of patients) {
      const meds = (rp.medications ?? []).map((m: any) => ({
        patient_medication_id: m.patient_medication_id,
        quantity: m.quantity,
      }))

      await get().addPatientToRound(
        round.id,
        orgId,
        rp.patient_id,
        rp.delivery_order,
        meds,
        {
          line1: rp.delivery_address_line_1,
          line2: rp.delivery_address_line_2,
          city: rp.delivery_city,
          postcode: rp.delivery_postcode,
        },
        rp.notes,
      )
    }

    return round
  },

  // ── Notifications (provider-aware: SMS Works / NHS Notify) ──

  sendRoundNotifications: async (roundId, orgId, message) => {
    // Fetch round with patients to get phone numbers
    const { data: round, error: fetchErr } = await getUserClient()
      .from('ps_delivery_rounds')
      .select(`
        id, title, scheduled_date, time_window,
        patients:ps_delivery_round_patients(
          patient:ps_patients(id, first_name, last_name, phone)
        )
      `)
      .eq('id', roundId)
      .single()

    if (fetchErr || !round) throw new Error('Failed to load round for notifications')

    const patients = (round.patients as any[]) || []
    let sent = 0
    let failed = 0

    // Route through the messaging store's provider-aware notify seam
    // (SMS Works for most pharmacies; NHS Notify for NHS-affiliated orgs).
    const { useMessagingStore } = await import('./messaging-store')
    const notify = useMessagingStore.getState().notify

    for (const rp of patients) {
      const patient = (rp as any).patient
      if (!patient?.phone) { failed++; continue }

      const dateStr = round.scheduled_date
        ? new Date(round.scheduled_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
        : 'soon'

      const body = message || `Hello ${patient.first_name}, your pharmacy will be delivering your medication ${dateStr}.${round.time_window ? ` Expected time: ${round.time_window}.` : ''} If you have any questions, please contact the pharmacy.`

      try {
        await notify({
          org_id: orgId,
          channel: 'sms',
          to: patient.phone,
          patient_id: patient.id,
          body,
          feature: 'delivery',
          reference: `delivery_round_${roundId}`,
        })
        sent++
      } catch {
        failed++
      }
    }

    return { sent, failed }
  },

  // ── Realtime ──

  subscribeToRound: (roundId) => {
    const channel = getUserClient()
      .channel(`delivery_round_${roundId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ps_delivery_round_patients', filter: `round_id=eq.${roundId}` },
        () => { get().fetchRound(roundId) }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ps_delivery_rounds', filter: `id=eq.${roundId}` },
        () => { get().fetchRound(roundId) }
      )
      .subscribe()

    return () => {
      getUserClient().removeChannel(channel)
    }
  },

  // ── UI ──

  clearError: () => set({ error: null }),
}))
