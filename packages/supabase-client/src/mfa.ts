// ============================================
// Two-step sign-in (TOTP authenticator app) for the person's account.
// Everything runs on the user client: the shared pharmacy login never
// has two-step sign-in.
// ============================================

import { getUserClient } from './index'

export interface TotpFactor {
  id: string
  friendlyName: string | null
  createdAt: string
}

export interface TotpEnrollment {
  factorId: string
  /** SVG data URL of the QR code to scan */
  qrCode: string
  /** The same secret as text, for typing in by hand */
  secret: string
}

/** Verified authenticator apps on the signed-in account. */
export async function listTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await getUserClient().auth.mfa.listFactors()
  if (error) throw error
  return (data?.totp ?? [])
    .filter((f) => f.status === 'verified')
    .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, createdAt: f.created_at }))
}

/** Start adding an authenticator app. Clears any half-finished attempt first. */
export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  const client = getUserClient()
  const { data: factors } = await client.auth.mfa.listFactors()
  for (const f of factors?.all ?? []) {
    if (f.factor_type === 'totp' && f.status === 'unverified') {
      await client.auth.mfa.unenroll({ factorId: f.id })
    }
  }
  const { data, error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator app ${new Date().toISOString().slice(0, 10)}`,
  })
  if (error) throw new Error(mfaErrorMessage(error))
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Plain-English versions of the MFA errors people actually hit. */
export function mfaErrorMessage(err: { message?: string; code?: string } | null | undefined): string {
  const msg = `${err?.code ?? ''} ${err?.message ?? ''}`
  // Turning on two-step sign-in (here or on another device) signs out every
  // other session, so a page left open loses its session.
  if (/session.?missing|session_not_found|not.?authenticated|jwt|refresh.?token/i.test(msg)) {
    return 'You’ve been signed out. This happens when two-step sign-in is turned on from another device. Sign in again, then use the code from your app.'
  }
  if (/factor.*not.?found|mfa_factor_not_found/i.test(msg)) {
    return 'This set-up was replaced from another device. If two-step sign-in is already on, sign in again; otherwise start set-up again.'
  }
  if (/invalid|expired|code/i.test(msg)) {
    return 'That code didn’t work. Check the time on your phone is right, then try the newest code.'
  }
  return err?.message || 'Something went wrong. Try again.'
}

/** Check a 6-digit code. Finishes enrolment, or completes a sign-in. */
export async function verifyTotpCode(factorId: string, code: string) {
  const { error } = await getUserClient().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
  if (error) throw new Error(mfaErrorMessage(error))
}

/** Remove an authenticator app. Needs a two-step session (aal2). */
export async function removeTotpFactor(factorId: string) {
  const { error } = await getUserClient().auth.mfa.unenroll({ factorId })
  if (error) throw error
}

/** Where the current session stands: needsCode is true when the account has
 *  two-step sign-in but this session hasn't entered a code yet. */
export async function getMfaStatus(): Promise<{ needsCode: boolean; factorId: string | null; hasFactor: boolean }> {
  const client = getUserClient()
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  const hasFactor = data.nextLevel === 'aal2'
  const needsCode = hasFactor && data.currentLevel !== 'aal2'
  let factorId: string | null = null
  if (needsCode) {
    const factors = await listTotpFactors()
    factorId = factors[0]?.id ?? null
  }
  return { needsCode, factorId, hasFactor }
}
