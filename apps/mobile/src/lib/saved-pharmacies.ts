// ============================================
// Pharmacies this phone has connected to, so reconnecting is one tap.
//
// The pharmacy login only opens the pharmacy's workspace for someone who is
// already signed in with their own account (and two-step code) and is a
// member there, so it's kept in the Keychain / Keystore without asking for
// a fingerprint each time. "Forget" on the connect screen removes it.
// ============================================

import { secureSessionStorage } from '@/lib/secure-session-storage'

export interface SavedPharmacy {
  email: string
  password: string
  name: string
  savedAt: string
}

const KEY = 'ps-saved-pharmacies'

export async function loadSavedPharmacies(): Promise<SavedPharmacy[]> {
  try {
    const raw = await secureSessionStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as SavedPharmacy[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function save(list: SavedPharmacy[]) {
  try {
    await secureSessionStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Only a convenience.
  }
}

export async function savePharmacy(email: string, password: string, name: string): Promise<void> {
  const key = email.trim().toLowerCase()
  const rest = (await loadSavedPharmacies()).filter((p) => p.email.toLowerCase() !== key)
  await save([{ email: email.trim(), password, name, savedAt: new Date().toISOString() }, ...rest].slice(0, 5))
}

export async function forgetPharmacy(email: string): Promise<SavedPharmacy[]> {
  const key = email.trim().toLowerCase()
  const next = (await loadSavedPharmacies()).filter((p) => p.email.toLowerCase() !== key)
  await save(next)
  return next
}
