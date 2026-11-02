// ============================================================
// Prepaid SMS credits (ps_sms_credit_ledger). 1 credit = 1 SMS segment.
// Checks only run when SMS_CREDITS_ENFORCED=true, so sending keeps working
// exactly as before until billing for texts is switched on.
// ============================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

export class OutOfCreditsError extends Error {
  constructor() {
    super('Out of text message credits. Buy more in Settings → Plan & billing.')
    this.name = 'OutOfCreditsError'
  }
}

export function creditsEnforced(): boolean {
  return Deno.env.get('SMS_CREDITS_ENFORCED') === 'true'
}

/** Take credits before a send. Throws OutOfCreditsError if the balance is too low. */
export async function spendCredits(
  admin: SupabaseClient,
  orgId: string,
  credits: number,
  messageId: string | null = null,
): Promise<void> {
  if (!creditsEnforced() || credits <= 0) return
  const { data, error } = await admin.rpc('ps_sms_spend_credits', {
    p_org_id: orgId,
    p_credits: credits,
    p_message_id: messageId,
  })
  // Fail closed: if credits can't be checked, don't send a text we can't bill.
  if (error) throw new Error(`Could not check text credits: ${error.message}`)
  if (data !== true) throw new OutOfCreditsError()
}

/**
 * Settle after a send attempt. `charged` is what spendCredits took;
 * `actual` is what SMS Works billed (0 if the send failed).
 */
export async function settleCredits(
  admin: SupabaseClient,
  orgId: string,
  charged: number,
  actual: number,
  messageId: string | null = null,
): Promise<void> {
  if (!creditsEnforced()) return
  const diff = charged - actual
  if (diff === 0) return
  // Positive diff gives credits back; negative takes the extra segments.
  // Best-effort: a failure here must not turn a sent text into an error.
  await admin.rpc('ps_sms_add_credits', {
    p_org_id: orgId,
    p_credits: diff,
    p_reason: diff > 0 ? 'refund' : 'send',
    p_message_id: messageId,
    p_note: diff > 0 ? 'Unused credits returned' : 'Extra message segments',
  }).then(({ error }) => {
    if (error) console.error('settleCredits failed', error.message)
  })
}
