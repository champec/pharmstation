import { create } from 'zustand'
import { getUserClient } from '@pharmstation/supabase-client'
import type {
  CareHomeAuditEvent,
  CareHomeGroupMember,
  CareHomeGroupState,
  CareHomeGroupType,
  CareHomeLink,
  CareHomeGpRequest,
  CareHomeMarCycle,
  CareHomeMarEntry,
  CareHomeMarEntryStatus,
  CareHomeMedicationSchedule,
  CareHomeMedicationScheduleType,
  CareHomeMedicationRequest,
  CareHomeMedicationRequestStatus,
  CareHomeMedicationRequestType,
  CareHomeMedicationEvent,
  CareHomeResident,
  CareHomeResidentStatus,
  CareHomeResidentNote,
  CareHomeResidentNoteType,
  CareHomeSupplyBatch,
  CareHomeSupplyPackage,
  CareHomeSupplyScope,
  CareHomeUnit,
  Patient,
  PatientMedication,
} from '@pharmstation/types'

interface CreateCareHomeInput {
  pharmacyOrganisationId: string
  name: string
  address?: Record<string, string>
  contactName?: string
  contactEmail?: string
  contactPhone?: string
}

interface CreateMedicationRequestInput {
  linkId: string
  residentId: string
  patientMedicationId?: string
  requestType: CareHomeMedicationRequestType
  medicineName: string
  quantity?: number
  neededBy?: string
  notes?: string
  requestedBy: string
  requestSource: 'care_home' | 'pharmacy_manual'
}

interface AddResidentInput {
  linkId: string
  patientId: string
  unitId?: string
  roomNumber?: string
  gpName?: string
  gpPractice?: string
  allergies?: string
  specialInstructions?: string
  createdBy: string
}

interface AddMedicationScheduleInput {
  residentId: string
  patientMedicationId: string
  scheduleType: CareHomeMedicationScheduleType
  dose: string
  route?: string
  instructions?: string
  roundTime?: string
  administrationDays: number[]
  startDate: string
  endDate?: string
  createdBy: string
}

interface CreateSupplyBatchInput {
  linkId: string
  title: string
  periodStart: string
  periodEnd: string
  deliveryDate?: string
  supplyScope: CareHomeSupplyScope
  groupId?: string
}

interface CreateGroupInput {
  linkId: string
  name: string
  groupType?: CareHomeGroupType
  cycleDay?: number
  notes?: string
}

export interface CareHomeState {
  links: CareHomeLink[]
  residents: CareHomeResident[]
  requests: CareHomeMedicationRequest[]
  gpRequests: CareHomeGpRequest[]
  activeGpRequest: CareHomeGpRequest | null
  marCycles: CareHomeMarCycle[]
  marEntries: CareHomeMarEntry[]
  history: CareHomeAuditEvent[]
  patientSearchResults: Patient[]
  residentMedications: PatientMedication[]
  medicationSchedules: CareHomeMedicationSchedule[]
  units: CareHomeUnit[]
  supplyBatches: CareHomeSupplyBatch[]
  activeSupplyBatch: CareHomeSupplyBatch | null
  residentSupplyPackages: CareHomeSupplyPackage[]
  residentNotes: CareHomeResidentNote[]
  medicationEvents: CareHomeMedicationEvent[]
  selectedLinkId: string | null
  loading: boolean
  saving: boolean
  error: string | null
  fetchLinks: (organisationId: string, organisationType: 'pharmacy' | 'carehome') => Promise<void>
  selectLink: (linkId: string) => Promise<void>
  createCareHome: (input: CreateCareHomeInput) => Promise<string>
  createMedicationRequest: (input: CreateMedicationRequestInput) => Promise<void>
  updateRequestStatus: (requestId: string, status: CareHomeMedicationRequestStatus, reviewedBy: string) => Promise<void>
  searchPatients: (organisationId: string, query: string) => Promise<void>
  addResident: (input: AddResidentInput) => Promise<void>
  updateResidentStatus: (residentId: string, status: CareHomeResidentStatus) => Promise<void>
  updateResidentDetails: (residentId: string, updates: { unit_id?: string | null; room_number?: string | null; gp_name?: string | null; gp_practice?: string | null; allergies?: string | null; special_instructions?: string | null }) => Promise<void>
  fetchResidentMedicationWorkspace: (residentId: string) => Promise<void>
  addMedicationSchedule: (input: AddMedicationScheduleInput) => Promise<void>
  prepareMarCycle: (residentId: string, periodStart: string, periodEnd: string) => Promise<string>
  publishMarCycle: (cycleId: string, publishedBy: string) => Promise<void>
  fetchMarEntries: (cycleId: string) => Promise<void>
  recordAdministration: (entryId: string, status: CareHomeMarEntryStatus, userId: string, notes?: string) => Promise<void>
  inviteCareHomeUser: (linkId: string, email: string, fullName: string) => Promise<void>
  addResidentNote: (residentId: string, noteType: CareHomeResidentNoteType, noteDate: string, noteText: string, createdBy: string) => Promise<void>
  stopMedicationSchedule: (scheduleId: string, reason: string, completed?: boolean) => Promise<void>
  prepareGpRequest: (linkId: string, surgeryName: string, title: string, cycleStart: string, cycleEnd: string) => Promise<string>
  fetchGpRequest: (requestId: string) => Promise<void>
  markGpRequestSent: (requestId: string) => Promise<void>
  reconcilePrescriptionLine: (lineId: string, outcome: 'received' | 'part_received' | 'refused' | 'not_required', quantityReceived?: number, reason?: string) => Promise<void>
  createUnit: (linkId: string, name: string, floorName?: string) => Promise<void>
  assignResidentUnit: (residentId: string, unitId: string | null) => Promise<void>
  // Group lifecycle
  groups: CareHomeUnit[]
  selectedGroupId: string | null
  activeGroup: CareHomeUnit | null
  createGroup: (input: CreateGroupInput) => Promise<string>
  setGroupState: (groupId: string, state: CareHomeGroupState) => Promise<void>
  startGroupPreparation: (groupId: string, input: Omit<CreateSupplyBatchInput, 'linkId' | 'groupId'>) => Promise<string>
  markGroupReady: (groupId: string) => Promise<string>
  returnGroupToIdle: (groupId: string) => Promise<void>
  addResidentToGroup: (groupId: string, residentId: string, createdBy: string) => Promise<void>
  removeResidentFromGroup: (groupId: string, residentId: string) => Promise<void>
  fetchGroup: (groupId: string) => Promise<void>
  selectGroup: (groupId: string | null) => void
  updateGroup: (groupId: string, updates: { name?: string; floor_name?: string | null; group_type?: CareHomeGroupType; cycle_day?: number | null; notes?: string | null; is_active?: boolean }) => Promise<void>
  updateCareHomeLink: (linkId: string, updates: { service_name?: string | null; contact_name?: string | null; contact_email?: string | null; contact_phone?: string | null; cycle_day?: number | null; default_cycle_length_days?: number; notes?: string | null }) => Promise<void>
  // Bags (per-patient packages inside a group round)
  activeBag: CareHomeSupplyPackage | null
  fetchBag: (bagId: string) => Promise<void>
  packBagLine: (lineId: string, quantity: number, omissionReason?: string) => Promise<void>
  receiveBagLine: (lineId: string, quantity: number, notes?: string) => Promise<void>
  addBagLine: (packageId: string, input: { patientMedicationId: string; medicationScheduleId?: string | null; supplyType: CareHomeMedicationScheduleType; medicineName: string; form?: string | null; strength?: string | null; dose?: string | null; quantityExpected: number }) => Promise<void>
  updateBagLine: (lineId: string, updates: { quantity_expected?: number; dose?: string | null }) => Promise<void>
  removeBagLine: (lineId: string) => Promise<void>
  fetchSupplyBatches: (linkId: string) => Promise<void>
  fetchSupplyBatch: (batchId: string) => Promise<void>
  createSupplyBatch: (input: CreateSupplyBatchInput) => Promise<string>
  packSupplyLine: (lineId: string, quantity: number, omissionReason?: string) => Promise<void>
  generateDeliveryRound: (batchId: string) => Promise<string>
  receiveSupplyLine: (lineId: string, quantity: number, notes?: string) => Promise<void>
  clearError: () => void
}

const linkSelect = `
  *,
  pharmacy_organisation:ps_organisations!ps_care_home_links_pharmacy_organisation_id_fkey(id,name,address,organisation_type),
  care_home_organisation:ps_organisations!ps_care_home_links_care_home_organisation_id_fkey(id,name,address,organisation_type)
`

export const useCareHomeStore = create<CareHomeState>((set, get) => ({
  links: [],
  residents: [],
  requests: [],
  gpRequests: [],
  activeGpRequest: null,
  marCycles: [],
  marEntries: [],
  history: [],
  patientSearchResults: [],
  residentMedications: [],
  medicationSchedules: [],
  units: [],
  supplyBatches: [],
  activeSupplyBatch: null,
  residentSupplyPackages: [],
  residentNotes: [],
  medicationEvents: [],
  selectedLinkId: null,
  groups: [],
  selectedGroupId: null,
  activeGroup: null,
  activeBag: null,
  loading: false,
  saving: false,
  error: null,

  fetchLinks: async (organisationId, organisationType) => {
    set({ loading: true, error: null })
    try {
      const column = organisationType === 'carehome'
        ? 'care_home_organisation_id'
        : 'pharmacy_organisation_id'
      const { data, error } = await getUserClient()
        .from('ps_care_home_links')
        .select(linkSelect)
        .eq(column, organisationId)
        .neq('status', 'ended')
        .order('created_at', { ascending: false })
      if (error) throw error

      const links = (data ?? []) as unknown as CareHomeLink[]
      set({ links, loading: false })
      if (links.length > 0) {
        const current = get().selectedLinkId
        await get().selectLink(current && links.some((link) => link.id === current) ? current : links[0].id)
      } else {
        set({ selectedLinkId: null, residents: [], requests: [], marCycles: [], marEntries: [], history: [] })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to load care homes.', loading: false })
    }
  },

  selectLink: async (linkId) => {
    set({ selectedLinkId: linkId, loading: true, error: null })
    try {
      const client = getUserClient()
      const [residentsResult, requestsResult, gpRequestsResult, cyclesResult, historyResult, unitsResult, batchesResult] = await Promise.all([
        client.from('ps_care_home_residents').select('*, patient:ps_patients(*), unit:ps_care_home_units(*), group_memberships:ps_care_home_group_members(*)').eq('care_home_link_id', linkId).order('room_number'),
        client.from('ps_care_home_medication_requests').select('*, resident:ps_care_home_residents(*, patient:ps_patients(*))').eq('care_home_link_id', linkId).order('requested_at', { ascending: false }),
        client.from('ps_care_home_gp_requests').select('*, lines:ps_care_home_medication_requests(*, resident:ps_care_home_residents(*, patient:ps_patients(*)))').eq('care_home_link_id', linkId).order('created_at', { ascending: false }),
        client.from('ps_care_home_mar_cycles').select('*, resident:ps_care_home_residents!inner(*, patient:ps_patients(*))').eq('resident.care_home_link_id', linkId).order('period_start', { ascending: false }),
        client.from('ps_care_home_audit_events').select('*').eq('care_home_link_id', linkId).order('created_at', { ascending: false }).limit(100),
        client.from('ps_care_home_units').select('*').eq('care_home_link_id', linkId).eq('is_active', true).order('sort_order').order('name'),
        client.from('ps_care_home_supply_batches').select('*').eq('care_home_link_id', linkId).order('created_at', { ascending: false }),
      ])

      const firstError = residentsResult.error || requestsResult.error || gpRequestsResult.error || cyclesResult.error || historyResult.error || unitsResult.error || batchesResult.error
      if (firstError) throw firstError
      const units = (unitsResult.data ?? []) as CareHomeUnit[]
      set({
        residents: (residentsResult.data ?? []) as unknown as CareHomeResident[],
        requests: (requestsResult.data ?? []) as unknown as CareHomeMedicationRequest[],
        gpRequests: (gpRequestsResult.data ?? []) as unknown as CareHomeGpRequest[],
        marCycles: (cyclesResult.data ?? []) as unknown as CareHomeMarCycle[],
        history: (historyResult.data ?? []) as CareHomeAuditEvent[],
        units,
        groups: units,
        supplyBatches: (batchesResult.data ?? []) as CareHomeSupplyBatch[],
        loading: false,
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to load the care home workspace.', loading: false })
    }
  },

  createCareHome: async (input) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient().rpc('ps_create_care_home', {
        target_pharmacy_organisation_id: input.pharmacyOrganisationId,
        care_home_name: input.name,
        care_home_address: input.address ?? {},
        care_home_contact_name: input.contactName || null,
        care_home_contact_email: input.contactEmail || null,
        care_home_contact_phone: input.contactPhone || null,
      })
      if (error) throw error
      set({ saving: false })
      return data as string
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to create the care home.', saving: false })
      throw error
    }
  },

  createMedicationRequest: async (input) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_care_home_medication_requests')
        .insert({
          care_home_link_id: input.linkId,
          care_home_resident_id: input.residentId,
          patient_medication_id: input.patientMedicationId || null,
          request_type: input.requestType,
          medicine_name: input.medicineName.trim(),
          quantity: input.quantity || null,
          needed_by: input.neededBy || null,
          request_notes: input.notes?.trim() || null,
          requested_by: input.requestedBy,
          request_source: input.requestSource,
        })
        .select('*, resident:ps_care_home_residents(*, patient:ps_patients(*))')
        .single()
      if (error) throw error
      set((state) => ({ requests: [data as unknown as CareHomeMedicationRequest, ...state.requests], saving: false }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to submit the medication request.', saving: false })
      throw error
    }
  },

  updateRequestStatus: async (requestId, status, reviewedBy) => {
    set({ saving: true, error: null })
    try {
      const now = new Date().toISOString()
      const updates: Record<string, string> = { status, reviewed_by: reviewedBy, reviewed_at: now, updated_at: now }
      if (status === 'completed') updates.completed_at = now
      const { error } = await getUserClient().from('ps_care_home_medication_requests').update(updates).eq('id', requestId)
      if (error) throw error
      set((state) => ({
        requests: state.requests.map((request) => request.id === requestId ? { ...request, ...updates, status } : request),
        saving: false,
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to update the request.', saving: false })
    }
  },

  searchPatients: async (organisationId, query) => {
    if (query.trim().length < 2) {
      set({ patientSearchResults: [] })
      return
    }
    const safeQuery = query.trim().replace(/[,%()]/g, '')
    const { data, error } = await getUserClient()
      .from('ps_patients')
      .select('*')
      .eq('organisation_id', organisationId)
      .or(`first_name.ilike.%${safeQuery}%,last_name.ilike.%${safeQuery}%,nhs_number.ilike.%${safeQuery}%`)
      .order('last_name')
      .limit(20)
    if (error) {
      set({ error: error.message })
      return
    }
    set({ patientSearchResults: (data ?? []) as Patient[] })
  },

  addResident: async (input) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_care_home_residents')
        .insert({
          care_home_link_id: input.linkId,
          patient_id: input.patientId,
          unit_id: input.unitId || null,
          room_number: input.roomNumber?.trim() || null,
          gp_name: input.gpName?.trim() || null,
          gp_practice: input.gpPractice?.trim() || null,
          allergies: input.allergies?.trim() || null,
          special_instructions: input.specialInstructions?.trim() || null,
          created_by: input.createdBy,
        })
        .select('*, patient:ps_patients(*)')
        .single()
      if (error) throw error
      set((state) => ({
        residents: [...state.residents, data as unknown as CareHomeResident],
        patientSearchResults: [],
        saving: false,
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to add the resident.', saving: false })
      throw error
    }
  },

  updateResidentStatus: async (residentId, status) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().from('ps_care_home_residents').update({ status, updated_at: new Date().toISOString() }).eq('id', residentId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    set((state) => ({ residents: state.residents.map((resident) => resident.id === residentId ? { ...resident, status } : resident), saving: false }))
  },

  updateResidentDetails: async (residentId, updates) => {
    set({ saving: true, error: null })
    const cleanUpdates = Object.fromEntries(Object.entries(updates).map(([key, value]) => [key, typeof value === 'string' ? value.trim() || null : value]))
    const { error } = await getUserClient().from('ps_care_home_residents').update({ ...cleanUpdates, updated_at: new Date().toISOString() }).eq('id', residentId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const unit = get().units.find((item) => item.id === cleanUpdates.unit_id)
    set((state) => ({ residents: state.residents.map((resident) => resident.id === residentId ? { ...resident, ...cleanUpdates, unit } as CareHomeResident : resident), saving: false }))
  },

  fetchResidentMedicationWorkspace: async (residentId) => {
    const resident = get().residents.find((item) => item.id === residentId)
    if (!resident) return
    set({ loading: true, error: null })
    const [medicationsResult, schedulesResult, packagesResult, notesResult, eventsResult] = await Promise.all([
      getUserClient().from('ps_patient_medications').select('*').eq('patient_id', resident.patient_id).eq('is_active', true).order('drug_name'),
      getUserClient().from('ps_care_home_medication_schedules').select('*, patient_medication:ps_patient_medications(*)').eq('care_home_resident_id', residentId).order('round_time'),
      getUserClient().from('ps_care_home_supply_packages').select('*, unit:ps_care_home_units(*), lines:ps_care_home_supply_lines(*), batch:ps_care_home_supply_batches(*)').eq('care_home_resident_id', residentId).order('created_at', { ascending: false }),
      getUserClient().from('ps_care_home_resident_notes').select('*').eq('care_home_resident_id', residentId).order('note_date', { ascending: false }).order('created_at', { ascending: false }),
      getUserClient().from('ps_care_home_medication_events').select('*').eq('care_home_resident_id', residentId).order('event_date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    const firstError = medicationsResult.error || schedulesResult.error || packagesResult.error || notesResult.error || eventsResult.error
    if (firstError) {
      set({ error: firstError.message, loading: false })
      return
    }
    set({
      residentMedications: (medicationsResult.data ?? []) as PatientMedication[],
      medicationSchedules: (schedulesResult.data ?? []) as unknown as CareHomeMedicationSchedule[],
      residentSupplyPackages: (packagesResult.data ?? []) as unknown as CareHomeSupplyPackage[],
      residentNotes: (notesResult.data ?? []) as CareHomeResidentNote[],
      medicationEvents: (eventsResult.data ?? []) as CareHomeMedicationEvent[],
      loading: false,
    })
  },

  addMedicationSchedule: async (input) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_care_home_medication_schedules')
        .insert({
          care_home_resident_id: input.residentId,
          patient_medication_id: input.patientMedicationId,
          schedule_type: input.scheduleType,
          dose: input.dose.trim(),
          route: input.route?.trim() || null,
          instructions: input.instructions?.trim() || null,
          round_time: input.scheduleType === 'prn' ? null : input.roundTime || null,
          administration_days: input.administrationDays,
          start_date: input.startDate,
          end_date: input.endDate || null,
          created_by: input.createdBy,
        })
        .select('*, patient_medication:ps_patient_medications(*)')
        .single()
      if (error) throw error
      set((state) => ({
        medicationSchedules: [...state.medicationSchedules, data as unknown as CareHomeMedicationSchedule],
        saving: false,
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to add the medication round.', saving: false })
      throw error
    }
  },

  prepareMarCycle: async (residentId, periodStart, periodEnd) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient().rpc('ps_prepare_care_home_mar_cycle', {
        target_resident_id: residentId,
        target_period_start: periodStart,
        target_period_end: periodEnd,
      })
      if (error) throw error
      const linkId = get().selectedLinkId
      if (linkId) await get().selectLink(linkId)
      set({ saving: false })
      return data as string
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to prepare the MAR cycle.', saving: false })
      throw error
    }
  },

  publishMarCycle: async (cycleId, publishedBy) => {
    const now = new Date().toISOString()
    const { error } = await getUserClient().from('ps_care_home_mar_cycles').update({ status: 'published', published_by: publishedBy, published_at: now, updated_at: now }).eq('id', cycleId)
    if (error) {
      set({ error: error.message })
      return
    }
    set((state) => ({ marCycles: state.marCycles.map((cycle) => cycle.id === cycleId ? { ...cycle, status: 'published', published_by: publishedBy, published_at: now } : cycle) }))
  },

  fetchMarEntries: async (cycleId) => {
    set({ loading: true, error: null })
    const { data, error } = await getUserClient()
      .from('ps_care_home_mar_entries')
      .select('*, medication_schedule:ps_care_home_medication_schedules(*, patient_medication:ps_patient_medications(*))')
      .eq('mar_cycle_id', cycleId)
      .order('administration_date')
      .order('round_time')
    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ marEntries: (data ?? []) as unknown as CareHomeMarEntry[], loading: false })
  },

  recordAdministration: async (entryId, status, userId, notes) => {
    set({ saving: true, error: null })
    const now = new Date().toISOString()
    const { error } = await getUserClient()
      .from('ps_care_home_mar_entries')
      .update({ status, notes: notes?.trim() || null, administered_by: userId, administered_at: now, updated_at: now })
      .eq('id', entryId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    set((state) => ({ marEntries: state.marEntries.map((entry) => entry.id === entryId ? { ...entry, status, notes: notes?.trim() || null, administered_by: userId, administered_at: now } : entry), saving: false }))
  },

  inviteCareHomeUser: async (linkId, email, fullName) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().functions.invoke('care-home-invite', {
      body: { care_home_link_id: linkId, email: email.trim(), full_name: fullName.trim() },
    })
    if (error) {
      set({ error: error.message, saving: false })
      throw error
    }
    set({ saving: false })
  },

  addResidentNote: async (residentId, noteType, noteDate, noteText, createdBy) => {
    set({ saving: true, error: null })
    const { data, error } = await getUserClient().from('ps_care_home_resident_notes').insert({ care_home_resident_id: residentId, note_type: noteType, note_date: noteDate, note_text: noteText.trim(), created_by: createdBy }).select().single()
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    set((state) => ({ residentNotes: [data as CareHomeResidentNote, ...state.residentNotes], saving: false }))
  },

  stopMedicationSchedule: async (scheduleId, reason, completed = false) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().rpc('ps_stop_care_home_medication_schedule', { target_schedule_id: scheduleId, target_reason: reason.trim(), target_completed: completed })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const residentId = get().medicationSchedules.find((schedule) => schedule.id === scheduleId)?.care_home_resident_id
    if (residentId) await get().fetchResidentMedicationWorkspace(residentId)
    set({ saving: false })
  },

  prepareGpRequest: async (linkId, surgeryName, title, cycleStart, cycleEnd) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient().rpc('ps_prepare_care_home_gp_request', { target_link_id: linkId, target_surgery_name: surgeryName.trim(), target_title: title.trim(), target_cycle_start: cycleStart, target_cycle_end: cycleEnd })
      if (error) throw error
      await get().selectLink(linkId)
      set({ saving: false })
      return data as string
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to prepare the GP request.', saving: false })
      throw error
    }
  },

  fetchGpRequest: async (requestId) => {
    set({ loading: true, error: null })
    const { data, error } = await getUserClient().from('ps_care_home_gp_requests').select('*, lines:ps_care_home_medication_requests(*, resident:ps_care_home_residents(*, patient:ps_patients(*)))').eq('id', requestId).single()
    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ activeGpRequest: data as unknown as CareHomeGpRequest, loading: false })
  },

  markGpRequestSent: async (requestId) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().rpc('ps_mark_care_home_gp_request_sent', { target_gp_request_id: requestId })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    await get().fetchGpRequest(requestId)
    set({ saving: false })
  },

  reconcilePrescriptionLine: async (lineId, outcome, quantityReceived, reason) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().rpc('ps_reconcile_care_home_prescription_line', { target_request_line_id: lineId, target_outcome: outcome, target_quantity_received: quantityReceived ?? null, target_reason: reason?.trim() || null })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const requestId = get().activeGpRequest?.id
    if (requestId) await get().fetchGpRequest(requestId)
    set({ saving: false })
  },

  createUnit: async (linkId, name, floorName) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_care_home_units')
        .insert({ care_home_link_id: linkId, name: name.trim(), floor_name: floorName?.trim() || null })
        .select()
        .single()
      if (error) throw error
      set((state) => ({ units: [...state.units, data as CareHomeUnit], saving: false }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to create the unit.', saving: false })
      throw error
    }
  },

  assignResidentUnit: async (residentId, unitId) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().from('ps_care_home_residents').update({ unit_id: unitId, updated_at: new Date().toISOString() }).eq('id', residentId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const unit = get().units.find((item) => item.id === unitId)
    set((state) => ({ residents: state.residents.map((resident) => resident.id === residentId ? { ...resident, unit_id: unitId, unit } : resident), saving: false }))
  },

  // ── Group lifecycle ──────────────────────────────────────────────

  createGroup: async (input) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_care_home_units')
        .insert({
          care_home_link_id: input.linkId,
          name: input.name.trim(),
          group_type: input.groupType ?? 'monthly',
          cycle_day: input.cycleDay ?? null,
          notes: input.notes?.trim() || null,
        })
        .select()
        .single()
      if (error) throw error
      const group = data as CareHomeUnit
      set((state) => ({ units: [...state.units, group], groups: [...state.groups, group], saving: false }))
      return group.id
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to create the group.', saving: false })
      throw error
    }
  },

  setGroupState: async (groupId, state) => {
    set({ saving: true, error: null })
    const now = new Date().toISOString()
    const { error } = await getUserClient()
      .from('ps_care_home_units')
      .update({ group_state: state, state_changed_at: now, updated_at: now })
      .eq('id', groupId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    set((s) => ({
      units: s.units.map((u) => u.id === groupId ? { ...u, group_state: state, state_changed_at: now } : u),
      groups: s.groups.map((u) => u.id === groupId ? { ...u, group_state: state, state_changed_at: now } : u),
      activeGroup: s.activeGroup?.id === groupId ? { ...s.activeGroup, group_state: state, state_changed_at: now } : s.activeGroup,
      saving: false,
    }))
  },

  startGroupPreparation: async (groupId, input) => {
    set({ saving: true, error: null })
    try {
      const group = get().groups.find((g) => g.id === groupId)
      if (!group) throw new Error('Group not found')
      const batchId = await get().createSupplyBatch({ ...input, linkId: group.care_home_link_id, groupId })
      const now = new Date().toISOString()
      const { error } = await getUserClient()
        .from('ps_care_home_units')
        .update({ group_state: 'preparing', active_batch_id: batchId, state_changed_at: now, updated_at: now })
        .eq('id', groupId)
      if (error) throw error
      set((s) => ({
        units: s.units.map((u) => u.id === groupId ? { ...u, group_state: 'preparing' as CareHomeGroupState, active_batch_id: batchId, state_changed_at: now } : u),
        groups: s.groups.map((u) => u.id === groupId ? { ...u, group_state: 'preparing' as CareHomeGroupState, active_batch_id: batchId, state_changed_at: now } : u),
        saving: false,
      }))
      return batchId
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to start preparation.', saving: false })
      throw error
    }
  },

  markGroupReady: async (groupId) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient().rpc('ps_generate_delivery_round_from_care_home_group', { target_group_id: groupId })
      if (error) throw error
      const roundId = data as string
      const linkId = get().selectedLinkId
      if (linkId) await get().selectLink(linkId)
      set({ saving: false })
      return roundId
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to mark group ready.', saving: false })
      throw error
    }
  },

  returnGroupToIdle: async (groupId) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().rpc('ps_set_care_home_group_idle', { target_group_id: groupId })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const linkId = get().selectedLinkId
    if (linkId) await get().selectLink(linkId)
    set({ saving: false })
  },

  addResidentToGroup: async (groupId, residentId, createdBy) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient()
      .from('ps_care_home_group_members')
      .upsert({ group_id: groupId, care_home_resident_id: residentId, created_by: createdBy }, { onConflict: 'group_id,care_home_resident_id' })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    await get().fetchGroup(groupId)
    set({ saving: false })
  },

  removeResidentFromGroup: async (groupId, residentId) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient()
      .from('ps_care_home_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('care_home_resident_id', residentId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    await get().fetchGroup(groupId)
    set({ saving: false })
  },

  fetchGroup: async (groupId) => {
    set({ loading: true, error: null })
    const { data, error } = await getUserClient()
      .from('ps_care_home_units')
      .select('*, members:ps_care_home_group_members(*, resident:ps_care_home_residents(*, patient:ps_patients(*))), active_batch:ps_care_home_supply_batches!ps_care_home_units_active_batch_id_fkey(*, packages:ps_care_home_supply_packages(*, resident:ps_care_home_residents(*, patient:ps_patients(*)), lines:ps_care_home_supply_lines(*)))')
      .eq('id', groupId)
      .single()
    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    const group = data as unknown as CareHomeUnit
    set((s) => ({
      activeGroup: group,
      groups: s.groups.map((g) => g.id === groupId ? group : g),
      units: s.units.map((g) => g.id === groupId ? group : g),
      loading: false,
    }))
  },

  selectGroup: (groupId) => set({ selectedGroupId: groupId, activeGroup: null }),

  fetchBag: async (bagId) => {
    set({ loading: true, error: null })
    const { data, error } = await getUserClient()
      .from('ps_care_home_supply_packages')
      .select('*, resident:ps_care_home_residents(*, patient:ps_patients(*)), lines:ps_care_home_supply_lines(*), batch:ps_care_home_supply_batches!ps_care_home_supply_packages_batch_id_fkey(*), unit:ps_care_home_units!ps_care_home_supply_packages_unit_id_fkey(*)')
      .eq('id', bagId)
      .single()
    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ activeBag: data as unknown as CareHomeSupplyPackage, loading: false })
  },

  packBagLine: async (lineId, quantity, omissionReason) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().rpc('ps_pack_care_home_supply_line', {
      target_line_id: lineId,
      packed_quantity: quantity,
      target_omission_reason: omissionReason?.trim() || null,
    })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const bagId = get().activeBag?.id
    if (bagId) await get().fetchBag(bagId)
    set({ saving: false })
  },

  receiveBagLine: async (lineId, quantity, notes) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().rpc('ps_receive_care_home_supply_line', {
      target_line_id: lineId,
      received_quantity: quantity,
      target_notes: notes?.trim() || null,
    })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const bagId = get().activeBag?.id
    if (bagId) await get().fetchBag(bagId)
    set({ saving: false })
  },

  addBagLine: async (packageId, input) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().from('ps_care_home_supply_lines').insert({
      package_id: packageId,
      patient_medication_id: input.patientMedicationId,
      medication_schedule_id: input.medicationScheduleId ?? null,
      supply_type: input.supplyType,
      medicine_name: input.medicineName,
      form: input.form ?? null,
      strength: input.strength ?? null,
      dose: input.dose ?? null,
      quantity_expected: input.quantityExpected,
    })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const bagId = get().activeBag?.id
    if (bagId) await get().fetchBag(bagId)
    set({ saving: false })
  },

  updateBagLine: async (lineId, updates) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().from('ps_care_home_supply_lines').update(updates).eq('id', lineId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const bagId = get().activeBag?.id
    if (bagId) await get().fetchBag(bagId)
    set({ saving: false })
  },

  removeBagLine: async (lineId) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().from('ps_care_home_supply_lines').delete().eq('id', lineId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const bagId = get().activeBag?.id
    if (bagId) await get().fetchBag(bagId)
    set({ saving: false })
  },

  updateGroup: async (groupId, updates) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().from('ps_care_home_units').update(updates).eq('id', groupId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    set((state) => ({
      saving: false,
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, ...updates } : g)),
      units: state.units.map((g) => (g.id === groupId ? { ...g, ...updates } : g)),
      activeGroup: state.activeGroup?.id === groupId ? { ...state.activeGroup, ...updates } : state.activeGroup,
    }))
  },

  updateCareHomeLink: async (linkId, updates) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().from('ps_care_home_links').update(updates).eq('id', linkId)
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    set((state) => ({
      saving: false,
      links: state.links.map((l) => (l.id === linkId ? { ...l, ...updates } : l)),
    }))
  },

  fetchSupplyBatches: async (linkId) => {
    set({ loading: true, error: null })
    const { data, error } = await getUserClient().from('ps_care_home_supply_batches').select('*').eq('care_home_link_id', linkId).order('created_at', { ascending: false })
    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ supplyBatches: (data ?? []) as CareHomeSupplyBatch[], loading: false })
  },

  fetchSupplyBatch: async (batchId) => {
    set({ loading: true, error: null })
    const { data, error } = await getUserClient()
      .from('ps_care_home_supply_batches')
      .select(`
        *,
        packages:ps_care_home_supply_packages(
          *,
          resident:ps_care_home_residents(*, patient:ps_patients(*)),
          unit:ps_care_home_units(*),
          lines:ps_care_home_supply_lines(*)
        )
      `)
      .eq('id', batchId)
      .single()
    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ activeSupplyBatch: data as unknown as CareHomeSupplyBatch, loading: false })
  },

  createSupplyBatch: async (input) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient().rpc('ps_create_care_home_supply_batch', {
        target_link_id: input.linkId,
        target_title: input.title.trim(),
        target_period_start: input.periodStart,
        target_period_end: input.periodEnd,
        target_delivery_date: input.deliveryDate || null,
        target_supply_scope: input.supplyScope,
      })
      if (error) throw error
      if (input.groupId) {
        await getUserClient().from('ps_care_home_supply_batches').update({ group_id: input.groupId }).eq('id', data as string)
      }
      await get().fetchSupplyBatches(input.linkId)
      set({ saving: false })
      return data as string
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to create the supply batch.', saving: false })
      throw error
    }
  },

  packSupplyLine: async (lineId, quantity, omissionReason) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().rpc('ps_pack_care_home_supply_line', {
      target_line_id: lineId,
      packed_quantity: quantity,
      target_omission_reason: omissionReason?.trim() || null,
    })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const batchId = get().activeSupplyBatch?.id
    if (batchId) await get().fetchSupplyBatch(batchId)
    set({ saving: false })
  },

  generateDeliveryRound: async (batchId) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await getUserClient().rpc('ps_generate_delivery_round_from_care_home_batch', { target_batch_id: batchId })
      if (error) throw error
      await get().fetchSupplyBatch(batchId)
      set({ saving: false })
      return data as string
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to generate the delivery round.', saving: false })
      throw error
    }
  },

  receiveSupplyLine: async (lineId, quantity, notes) => {
    set({ saving: true, error: null })
    const { error } = await getUserClient().rpc('ps_receive_care_home_supply_line', {
      target_line_id: lineId,
      received_quantity: quantity,
      target_notes: notes?.trim() || null,
    })
    if (error) {
      set({ error: error.message, saving: false })
      return
    }
    const batchId = get().activeSupplyBatch?.id
    if (batchId) await get().fetchSupplyBatch(batchId)
    set({ saving: false })
  },

  clearError: () => set({ error: null }),
}))