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
  // One code per account: setting two-step sign-in up again (same secret or a
  // new one for the same email) replaces the old entry, which would only
  // give codes that no longer work.
  const label = account.label.trim().toLowerCase()
  const rest = list.filter((a) => a.secret !== account.secret && a.label.trim().toLowerCase() !== label)
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

/** Codes to try for an account, newest first: entries for that email, then the rest. */
export function candidatesFor(list: OtpAccount[], email: string): OtpAccount[] {
  const want = email.trim().toLowerCase()
  const newest = [...list].sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const exact = want ? newest.filter((a) => a.label.trim().toLowerCase() === want) : []
  return [...exact, ...newest.filter((a) => !exact.includes(a))]
}

/** After a code worked, drop older entries for the same email. */
export async function keepOnly(account: OtpAccount): Promise<void> {
  const label = account.label.trim().toLowerCase()
  const list = await loadOtpAccounts()
  const next = list.filter((a) => a.id === account.id || a.label.trim().toLowerCase() !== label)
  if (next.length !== list.length) await save(next)
}
