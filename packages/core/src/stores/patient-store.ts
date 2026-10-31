import { create } from 'zustand'
import type { Patient } from '@pharmstation/types'
import {
  getPatientClient,
  patientSignIn,
  patientSignUp,
  patientSignOut,
  fetchPatientProfile,
} from '@pharmstation/supabase-client'
import { useAuthStore } from './auth-store'

export interface PatientState {
  patient: Patient | null
  loading: boolean
  isLoggedIn: boolean

  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, metadata: {
    first_name: string
    last_name: string
    organisation_id: string
  }) => Promise<void>
  logout: () => Promise<void>
}

export const usePatientStore = create<PatientState>((set) => ({
  patient: null,
  loading: true,
  isLoggedIn: false,

  initialize: async () => {
    try {
      const { data: { session } } = await getPatientClient().auth.getSession()
      if (session?.user) {
        const profile = await fetchPatientProfile(session.user.id)
        set({ patient: profile as Patient, isLoggedIn: true, loading: false })
      } else {
        set({ loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  login: async (email, password) => {
    const data = await patientSignIn(email, password)
    if (data.user) {
      const profile = await fetchPatientProfile(data.user.id)
      // Patient is a role on the user account — keep the main auth store in sync
      await useAuthStore.getState().refreshUserLayer()
      set({ patient: profile as Patient, isLoggedIn: true, loading: false })
    }
  },

  register: async (email, password, metadata) => {
    await patientSignUp(email, password, { ...metadata, account_type: 'patient' })
    // After signup, auto-login
    const data = await patientSignIn(email, password)
    if (data.user) {
      const profile = await fetchPatientProfile(data.user.id)
      await useAuthStore.getState().refreshUserLayer()
      set({ patient: profile as Patient, isLoggedIn: true, loading: false })
    }
  },

  logout: async () => {
    await patientSignOut()
    await useAuthStore.getState().refreshUserLayer()
    set({ patient: null, isLoggedIn: false, loading: false })
  },
}))
