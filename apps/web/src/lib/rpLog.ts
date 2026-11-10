// ============================================
// Responsible Pharmacist log: data access and session grouping.
//
// The RP log is append-only. Each time a pharmacist becomes RP there is one
// "normal" record (the session). Sign-outs and corrections are "correction"
// records pointing back at it. A session's current state is its newest record.
// Absences live in ps_rp_absences, keyed by the session's original record.
// ============================================

import { getUserClient } from '@pharmstation/supabase-client'
import { ukDate } from '../pages/logs/logUtils'
import type { RegisterEntry, RegisterLedger, RpAbsence } from '@pharmstation/types'

export interface RpSession {
  /** Original record: the moment this pharmacist became RP */
  root: RegisterEntry
  /** Newest version (after sign-out and corrections) */
  current: RegisterEntry
  /** Every record for this session, oldest first */
  versions: RegisterEntry[]
  /** Corrections that changed details (not just the sign-out) */
  edits: RegisterEntry[]
  absences: RpAbsence[]
  isOpen: boolean
  /** UK calendar date the session started on */
  date: string
}

export const MAX_ABSENCE_MINUTES = 120

const SIGN_OUT_PREFIX = 'Signed out'

export function isSignOutRecord(entry: RegisterEntry): boolean {
  return entry.entry_type === 'correction' && (entry.correction_reason ?? '').startsWith(SIGN_OUT_PREFIX)
}

/** Groups RP records into sessions (handles corrections of corrections). */
export function buildSessions(entries: RegisterEntry[], absences: RpAbsence[] = []): RpSession[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const rootOf = (e: RegisterEntry): string => {
    let cur: RegisterEntry | undefined = e
    let guard = 0
    while (cur && cur.entry_type === 'correction' && cur.corrects_entry_id && guard < 100) {
      const next = byId.get(cur.corrects_entry_id)
      if (!next) return cur.corrects_entry_id
      cur = next
      guard++
    }
    return cur?.id ?? e.id
  }

  const groups = new Map<string, RegisterEntry[]>()
  for (const e of entries) {
    if (e.entry_type !== 'normal' && e.entry_type !== 'correction') continue
    const root = rootOf(e)
    const list = groups.get(root) ?? []
    list.push(e)
    groups.set(root, list)
  }

  const absByRoot = new Map<string, RpAbsence[]>()
  for (const a of absences) {
    const list = absByRoot.get(a.rp_entry_id) ?? []
    list.push(a)
    absByRoot.set(a.rp_entry_id, list)
  }

  const sessions: RpSession[] = []
  for (const [rootId, list] of groups) {
    const root = byId.get(rootId)
    if (!root || root.entry_type !== 'normal') continue
    const versions = [...list].sort((a, b) => a.entry_number - b.entry_number)
    const current = versions[versions.length - 1]
    sessions.push({
      root,
      current,
      versions,
      edits: versions.filter((v) => v.entry_type === 'correction' && !isSignOutRecord(v)),
      absences: (absByRoot.get(rootId) ?? []).sort((a, b) => a.absent_from.localeCompare(b.absent_from)),
      isOpen: !!current.rp_signed_in_at && !current.rp_signed_out_at,
      date: current.date_of_transaction,
    })
  }
  return sessions.sort((a, b) => (b.current.rp_signed_in_at ?? '').localeCompare(a.current.rp_signed_in_at ?? ''))
}

export function openAbsence(session: RpSession | null | undefined): RpAbsence | null {
  return session?.absences.find((a) => !a.returned_at) ?? null
}

export function minutesBetween(from: string, to: string | null | undefined, now = Date.now()): number {
  const end = to ? new Date(to).getTime() : now
  return Math.max(0, Math.round((end - new Date(from).getTime()) / 60000))
}

/** A session left open too long: over 12 hours, or over 8 hours across midnight (UK).
 *  Mirrors ps_rp_is_stale on the server, which refuses a take over from one. */
export function isStaleSession(signedInAt: string | null | undefined, now = Date.now()): boolean {
  if (!signedInAt) return false
  const mins = minutesBetween(signedInAt, null, now)
  if (mins > 12 * 60) return true
  return mins > 8 * 60 && ukDate(new Date(signedInAt)) < ukDate(new Date(now))
}

/** "Mon 9 Nov, 17:56" style label for when a session started. */
export function formatSince(ts: string): string {
  const d = new Date(ts)
  const sameDay = ukDate(d) === ukDate()
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  if (sameDay) return time
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })
  return `${day}, ${time}`
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Database errors turned into plain English. */
export function rpErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  if (msg.startsWith('RP_STALE:')) return msg.replace('RP_STALE:', '').trim()
  if (msg.startsWith('RP_ON_DUTY:')) return msg.replace('RP_ON_DUTY:', '').trim() + '.'
  if (msg.includes('CONFLICT')) return 'Someone else updated the RP log at the same moment. Please try again.'
  if (/permission/i.test(msg) && /rp/i.test(msg)) return 'Only pharmacists can sign the RP log.'
  return msg
}

/* ---- Data access ---- */

export interface RpData {
  ledger: RegisterLedger | null
  entries: RegisterEntry[]
  absences: RpAbsence[]
}

export async function loadRpData(organisationId: string, sinceDate?: string): Promise<RpData> {
  const client = getUserClient()
  const { data: ledger, error: ledgerErr } = await client
    .from('ps_register_ledgers')
    .select('*')
    .eq('organisation_id', organisationId)
    .eq('register_type', 'RP')
    .is('drug_id', null)
    .maybeSingle()
  if (ledgerErr) throw ledgerErr
  if (!ledger) return { ledger: null, entries: [], absences: [] }

  let q = client.from('ps_register_entries').select('*').eq('ledger_id', (ledger as RegisterLedger).id)
  if (sinceDate) q = q.gte('date_of_transaction', sinceDate)
  const { data: entries, error } = await q.order('entry_number', { ascending: true })
  if (error) throw error

  // Corrections may point at sessions that started before the window: fetch those roots too.
  const list = (entries as RegisterEntry[]) ?? []
  const known = new Set(list.map((e) => e.id))
  const missing = Array.from(new Set(list.map((e) => e.corrects_entry_id).filter((id): id is string => !!id && !known.has(id))))
  if (missing.length) {
    const { data: extra } = await client.from('ps_register_entries').select('*').in('id', missing)
    list.push(...((extra as RegisterEntry[]) ?? []))
  }

  let absQ = client.from('ps_rp_absences').select('*').eq('organisation_id', organisationId)
  if (sinceDate) absQ = absQ.gte('absent_from', `${sinceDate}T00:00:00Z`)
  const { data: absences, error: absErr } = await absQ.order('absent_from')
  // The absences table arrives with the logs migration; until then, carry on without it.
  return {
    ledger: ledger as RegisterLedger,
    entries: list,
    absences: absErr ? [] : ((absences as RpAbsence[]) ?? []),
  }
}

export async function rpSignIn(organisationId: string, takeOver = false, notes?: string): Promise<RegisterEntry> {
  const { data, error } = await getUserClient().rpc('ps_rp_sign_in', {
    p_organisation_id: organisationId,
    p_take_over: takeOver,
    p_notes: notes ?? null,
  })
  if (error) throw new Error(error.message)
  return data as RegisterEntry
}

export async function rpSignOut(entryId: string, at?: string | null, reason?: string | null): Promise<RegisterEntry> {
  const { data, error } = await getUserClient().rpc('ps_rp_sign_out', {
    p_entry_id: entryId,
    p_at: at ?? null,
    p_reason: reason ? `${SIGN_OUT_PREFIX} (${reason})` : null,
  })
  if (error) throw new Error(error.message)
  return data as RegisterEntry
}

export async function rpStartAbsence(entryId: string, reason?: string | null): Promise<RpAbsence> {
  const { data, error } = await getUserClient().rpc('ps_rp_start_absence', {
    p_entry_id: entryId,
    p_reason: reason ?? null,
    p_at: null,
  })
  if (error) throw new Error(error.message)
  return data as RpAbsence
}

export async function rpEndAbsence(absenceId: string): Promise<RpAbsence> {
  const { data, error } = await getUserClient().rpc('ps_rp_end_absence', { p_absence_id: absenceId, p_at: null })
  if (error) throw new Error(error.message)
  return data as RpAbsence
}

export async function rpLedger(organisationId: string): Promise<RegisterLedger> {
  const { data, error } = await getUserClient().rpc('ps_rp_ledger', { p_organisation_id: organisationId })
  if (error) throw new Error(error.message)
  return data as RegisterLedger
}

/** A missed session, recorded afterwards in the signed-in pharmacist's own name. */
export async function rpRecordLate(params: {
  organisationId: string
  signedInAt: string
  signedOutAt: string
  reason: string
  notes: string | null
}): Promise<RegisterEntry> {
  const { data, error } = await getUserClient().rpc('ps_rp_record_late', {
    p_organisation_id: params.organisationId,
    p_signed_in_at: params.signedInAt,
    p_signed_out_at: params.signedOutAt,
    p_reason: params.reason,
    p_notes: params.notes,
  })
  if (error) throw new Error(error.message)
  return data as RegisterEntry
}

/** A correction to an RP session. The original record is kept. */
export async function rpCorrect(params: {
  entryId: string
  signedInAt: string
  signedOutAt: string | null
  pharmacistName: string
  gphcNumber: string
  notes: string | null
  reason: string
}): Promise<RegisterEntry> {
  const { data, error } = await getUserClient().rpc('ps_rp_correct', {
    p_entry_id: params.entryId,
    p_signed_in_at: params.signedInAt,
    p_signed_out_at: params.signedOutAt,
    p_pharmacist_name: params.pharmacistName,
    p_gphc_number: params.gphcNumber,
    p_notes: params.notes,
    p_reason: params.reason,
  })
  if (error) throw new Error(error.message)
  return data as RegisterEntry
}
