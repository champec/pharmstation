/** Where each kind of account signs in, so the reset pages can send people
 *  back to the right place. */
export const RESET_RETURN = {
  org: { to: '/login/org', label: 'pharmacy sign in', account: 'pharmacy login' },
  staff: { to: '/login/user', label: 'staff sign in', account: 'staff account' },
  me: { to: '/me/login', label: 'personal sign in', account: 'personal account' },
  patient: { to: '/patient/login', label: 'patient sign in', account: 'patient account' },
} as const

export type ResetReturn = keyof typeof RESET_RETURN

export function resetReturn(value: string | undefined | null): ResetReturn {
  return value && value in RESET_RETURN ? (value as ResetReturn) : 'me'
}
