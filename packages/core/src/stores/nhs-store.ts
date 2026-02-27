import { create } from 'zustand'
import { getUserClient } from '@pharmstation/supabase-client'
import type {
  NHSServiceType,
  NHSClaimSubmission,
  NHSClaimStatus,
  NHSSubmissionAttempt,
  NHSClaimPayload,
  PDSPatient,
} from '@pharmstation/types'

// ============================================================
// NHS Settings — stored in ps_organisations columns
// ============================================================

export interface NHSSettings {
  odsCode: string | null
  bsaEnvironment: 'staging' | 'production'
  ipWhitelistRegistered: boolean
}

// ============================================================
// State interface
// ============================================================

export interface NHSState {
  // Data
  settings: NHSSettings
  claims: NHSClaimSubmission[]
  activeClaim: NHSClaimSubmission | null
  activeAttempts: NHSSubmissionAttempt[]
  pdsPatient: PDSPatient | null
  loading: boolean
  submitting: boolean
  error: string | null

  // Settings
  fetchSettings: (orgId: string) => Promise<void>
  saveSettings: (orgId: string, updates: Partial<NHSSettings>) => Promise<void>

  // Claims
  fetchClaims: (orgId: string) => Promise<void>
  fetchClaimDetail: (claimId: string) => Promise<void>
  createClaim: (params: {
    orgId: string
    serviceType: NHSServiceType
    patientId?: string
    serviceDeliveryId?: string
    payload: Record<string, unknown>
    claimYearMonth: string
    createdBy?: string
  }) => Promise<NHSClaimSubmission>
  submitClaim: (claimId: string, serviceType: NHSServiceType) => Promise<void>

  // PDS
  lookupPDS: (orgId: string, nhsNumber: string) => Promise<PDSPatient | null>
  clearPDS: () => void

  // GP Search
  searchGP: (query: string) => Promise<GPSearchResult[]>
  lookupGPByOds: (odsCode: string) => Promise<GPSearchResult | null>

  clearError: () => void
}

export interface GPSearchResult {
  odsCode: string
  name: string
  address: string
  city: string
  postcode: string
  status: string
}

// ============================================================
// Generate the platform deposit ID
// ============================================================

function generateDepositId(orgId: string): string {
  const ts = Date.now().toString(36).toUpperCase()
  const shortOrg = orgId.substring(0, 8)
  return `PSN-TEST-${shortOrg}-${ts}`
}

// ============================================================
// Store
// ============================================================

export const useNHSStore = create<NHSState>((set, get) => ({
  settings: { odsCode: null, bsaEnvironment: 'staging', ipWhitelistRegistered: false },
  claims: [],
  activeClaim: null,
  activeAttempts: [],
  pdsPatient: null,
  loading: false,
  submitting: false,
  error: null,

  // ── Settings ──────────────────────────────────────────────

  fetchSettings: async (orgId) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_organisations')
        .select('ods_code, nhs_bsa_environment, nhs_ip_whitelist_registered')
        .eq('id', orgId)
        .single()
      if (error) throw error
      if (data) {
        set({
          settings: {
            odsCode: (data as any).ods_code ?? null,
            bsaEnvironment: (data as any).nhs_bsa_environment ?? 'staging',
            ipWhitelistRegistered: (data as any).nhs_ip_whitelist_registered ?? false,
          },
        })
      }
    } catch (e: any) {
      set({ error: e.message })
    }
  },

  saveSettings: async (orgId, updates) => {
    set({ loading: true, error: null })
    try {
      const dbUpdates: Record<string, unknown> = {}
      if (updates.odsCode !== undefined) dbUpdates.ods_code = updates.odsCode
      if (updates.bsaEnvironment !== undefined) dbUpdates.nhs_bsa_environment = updates.bsaEnvironment
      if (updates.ipWhitelistRegistered !== undefined) dbUpdates.nhs_ip_whitelist_registered = updates.ipWhitelistRegistered

      const { error } = await getUserClient()
        .from('ps_organisations')
        .update(dbUpdates)
        .eq('id', orgId)
      if (error) throw error

      // Re-fetch to sync
      await get().fetchSettings(orgId)
      set({ loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  // ── Claims ────────────────────────────────────────────────

  fetchClaims: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_nhs_claim_submissions')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      set({ claims: (data as NHSClaimSubmission[]) ?? [], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchClaimDetail: async (claimId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const [claimRes, attemptsRes] = await Promise.all([
        client.from('ps_nhs_claim_submissions').select('*').eq('id', claimId).single(),
        client.from('ps_nhs_submission_attempts').select('*').eq('submission_id', claimId).order('attempt_number'),
      ])
      if (claimRes.error) throw claimRes.error
      set({
        activeClaim: claimRes.data as NHSClaimSubmission,
        activeAttempts: (attemptsRes.data as NHSSubmissionAttempt[]) ?? [],
        loading: false,
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createClaim: async ({ orgId, serviceType, patientId, serviceDeliveryId, payload, claimYearMonth, createdBy }) => {
    set({ submitting: true, error: null })
    try {
      const depositId = generateDepositId(orgId)
      const row = {
        org_id: orgId,
        service_type: serviceType,
        patient_id: patientId ?? null,
        service_delivery_id: serviceDeliveryId ?? null,
        platform_deposit_id: depositId,
        claim_year_month: claimYearMonth,
        status: 'pending' as NHSClaimStatus,
        payload: { ...payload, PLATFORM_DEPOSIT_ID: depositId },
        created_by: createdBy ?? null,
      }
      const { data, error } = await getUserClient()
        .from('ps_nhs_claim_submissions')
        .insert(row)
        .select()
        .single()
      if (error) throw error
      const claim = data as NHSClaimSubmission
      // Add to local list
      set((s) => ({ claims: [claim, ...s.claims], submitting: false }))
      return claim
    } catch (e: any) {
      set({ error: e.message, submitting: false })
      throw e
    }
  },

  submitClaim: async (claimId, serviceType) => {
    set({ submitting: true, error: null })
    try {
      // Determine which edge function to call
      const CPCS_TYPES: NHSServiceType[] = ['cpcs_emg_med', 'cpcs_min_ill', 'cpcs_emg_uec', 'cpcs_min_ill_uec', 'cpcs_ccs', 'flu_vac', 'covid_vac', 'gp_covid_vac']
      let functionName: string
      if (CPCS_TYPES.includes(serviceType)) functionName = 'nhs-claim-cpcs'
      else if (serviceType === 'nms') functionName = 'nhs-claim-nms'
      else if (serviceType === 'scs') functionName = 'nhs-claim-scs'
      else if (serviceType === 'cvd_hypertension') functionName = 'nhs-claim-cvd'
      else if (serviceType === 'contraception') functionName = 'nhs-claim-contraception'
      else throw new Error(`Unknown service type: ${serviceType}`)

      const { data, error } = await getUserClient().functions.invoke(functionName, {
        body: { action: 'submit', submissionId: claimId },
      })
      if (error) throw error

      // Re-fetch claim detail to get updated status
      await get().fetchClaimDetail(claimId)
      set({ submitting: false })
    } catch (e: any) {
      set({ error: e.message, submitting: false })
      throw e
    }
  },

  // ── PDS Lookup ────────────────────────────────────────────

  lookupPDS: async (orgId, nhsNumber) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient().functions.invoke('nhs-pds-lookup', {
        body: { action: 'lookup', org_id: orgId, nhs_number: nhsNumber },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      const patient = data?.patient as PDSPatient | null
      set({ pdsPatient: patient, loading: false })
      return patient
    } catch (e: any) {
      set({ error: e.message, loading: false })
      return null
    }
  },

  clearPDS: () => set({ pdsPatient: null }),

  // ── GP Search ────────────────────────────────────────────

  searchGP: async (query) => {
    try {
      const { data, error } = await getUserClient().functions.invoke('nhs-gp-search', {
        body: { action: 'search', query },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return (data?.results ?? []) as GPSearchResult[]
    } catch (e: any) {
      console.error('GP search error:', e.message)
      return []
    }
  },

  lookupGPByOds: async (odsCode) => {
    try {
      const { data, error } = await getUserClient().functions.invoke('nhs-gp-search', {
        body: { action: 'lookup_ods', ods_code: odsCode },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data as GPSearchResult
    } catch (e: any) {
      console.error('GP ODS lookup error:', e.message)
      return null
    }
  },

  clearError: () => set({ error: null }),
}))
