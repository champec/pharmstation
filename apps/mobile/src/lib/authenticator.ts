// ============================================
// Built-in authenticator: the two-step sign-in secrets this phone holds.
// Kept in the Keychain / Keystore through the same chunked secure storage
// as the sign-in session. Never sent anywhere.
// ============================================

import { secureSessionStorage } from '@/lib/secure-session-storage'
import type { OtpAccount } from '@/lib/totp'

const KEY = 'ps-authenticator-accounts'

export async function loadOtpAccounts(): Promise<OtpAccount[]> {
  try {
    const raw = await secureSessionStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as OtpAccount[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function save(list: OtpAccount[]) {
  await secureSessionStorage.setItem(KEY, JSON.stringify(list))
}

export async function addOtpAccount(account: Omit<OtpAccount, 'id' | 'addedAt'>): Promise<OtpAccount[]> {
  const list = await loadOtpAccounts()
  // Re-scanning the same secret replaces the old entry rather than duplicating it.
  const rest = list.filter((a) => a.secret !== account.secret)
  const next = [
    ...rest,
    { ...account, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, addedAt: new Date().toISOString() },
  ]
  await save(next)
  return next
}

export async function removeOtpAccount(id: string): Promise<OtpAccount[]> {
  const next = (await loadOtpAccounts()).filter((a) => a.id !== id)
  await save(next)
  return next
}
