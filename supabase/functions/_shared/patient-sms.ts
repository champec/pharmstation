// ============================================================
// System-sent patient texts (booking confirmations, reminders, cancellations).
//
// Staff-sent texts go through the sms-works function, which needs a staff
// session. These are sent by the platform on the pharmacy's behalf (from the
// public booking flow, the Stripe webhook and the reminder job), so they log
// to ps_messages with no staff author but otherwise follow the same rules:
// the pharmacy's sender ID and signature, prepaid credits when enforced, and
// the monthly usage ledger.
//
// Never throws: a text that can't be sent must not break a booking.
// ============================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'
import { spendCredits, settleCredits } from './sms-credits.ts'

const SMSWORKS_API_BASE = 'https://api.thesmsworks.co.uk/v1'

function platformJwt(): string | null {
  const jwt = Deno.env.get('SMSWORKS_JWT')
  if (!jwt) return null
  return `JWT ${jwt.trim().replace(/^(JWT|Bearer)\s+/i, '')}`
}

/** UK number → SMS Works format (447700900000). Null if not a usable number. */
export function smsDestination(raw: string | null | undefined): string | null {
  let n = (raw || '').replace(/[^\d+]/g, '')
  if (n.startsWith('+')) n = n.slice(1)
  else if (n.startsWith('00')) n = n.slice(2)
  else if (n.startsWith('0')) n = `44${n.slice(1)}`
  else if (n.startsWith('7') && n.length === 10) n = `44${n}`
  return /^\d{8,15}$/.test(n) ? n : null
}

function segments(content: string): number {
  // Close enough for credit reservation; SMS Works returns the real count.
  // deno-lint-ignore no-control-regex
  const gsm = /^[\x0A\x0D\x20-\x7E£€]*$/.test(content)
  const len = [...content].length
  if (gsm) return len <= 160 ? 1 : Math.ceil(len / 153)
  return len <= 70 ? 1 : Math.ceil(len / 67)
}

function period(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export type PatientSmsResult = { sent: boolean; reason?: string; message_id?: string }

export async function sendPatientSms(
  admin: SupabaseClient,
  args: {
    org_id: string
    patient_id: string | null
    phone: string | null | undefined
    body: string
    feature: string
    reference: string
  },
): Promise<PatientSmsResult> {
  try {
    const destination = smsDestination(args.phone)
    if (!destination) return { sent: false, reason: 'no_mobile' }
    const auth = platformJwt()
    if (!auth) return { sent: false, reason: 'sms_not_configured' }

    const { data: settings } = await admin.from('ps_sms_settings')
      .select('sender_type, sender_id, reply_number, reply_enabled, signature, is_active')
      .eq('org_id', args.org_id).maybeSingle()
    if (!settings || !settings.is_active) return { sent: false, reason: 'pharmacy_sms_off' }

    const sender = settings.sender_type === 'number'
      ? (settings.reply_number ?? '').replace(/[^\d]/g, '')
      : (settings.sender_id ?? '').trim()
    if (!sender) return { sent: false, reason: 'no_sender' }

    const sig = (settings.signature ?? '').trim()
    const content = sig && !args.body.includes(sig) ? `${args.body.trim()}\n${sig}` : args.body.trim()

    const { data: row, error: insErr } = await admin.from('ps_messages').insert({
      provider: 'smsworks',
      channel: 'sms',
      status: 'pending',
      org_id: args.org_id,
      patient_id: args.patient_id,
      recipient_phone: args.phone,
      recipient_phone_normalized: destination,
      body: content,
      personalisation: { body: content },
      sms_sender: sender,
      reply_number: settings.reply_enabled ? settings.reply_number : null,
      reference: args.reference,
      feature: args.feature,
      created_by_user_id: null,
    }).select('id').single()
    if (insErr || !row) return { sent: false, reason: `log_failed: ${insErr?.message}` }

    const est = segments(content)
    try {
      await spendCredits(admin, args.org_id, est, row.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No text credits'
      await admin.from('ps_messages').update({
        status: 'failed', failed_at: new Date().toISOString(), failure_reason: msg, updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      return { sent: false, reason: 'no_credits', message_id: row.id }
    }

    const res = await fetch(`${SMSWORKS_API_BASE}/message/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        sender,
        destination,
        content,
        tag: args.feature,
        metadata: [
          { key: 'org_id', value: args.org_id },
          { key: 'message_id', value: row.id },
          ...(args.patient_id ? [{ key: 'patient_id', value: args.patient_id }] : []),
        ],
      }),
    })
    const result = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) {
      const msg = `SMS Works: ${(result.message as string) ?? `HTTP ${res.status}`}`
      await admin.from('ps_messages').update({
        status: 'failed', failed_at: new Date().toISOString(), failure_reason: msg, updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      await settleCredits(admin, args.org_id, est, 0, row.id)
      return { sent: false, reason: msg, message_id: row.id }
    }

    const credits = typeof result.credits === 'number' ? result.credits : est
    const parts = typeof result.messageparts === 'number' ? result.messageparts : est
    await admin.from('ps_messages').update({
      status: 'sent',
      notify_message_id: (result.messageid as string) ?? null,
      credits,
      segments: parts,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    await settleCredits(admin, args.org_id, est, credits, row.id)
    await admin.rpc('ps_sms_record_usage', {
      p_org_id: args.org_id, p_period: period(),
      p_outbound: 1, p_credits: credits, p_segments: parts, p_inbound: 0,
    })
    return { sent: true, message_id: row.id }
  } catch (e) {
    console.error('sendPatientSms failed', e)
    return { sent: false, reason: e instanceof Error ? e.message : 'send_failed' }
  }
}
