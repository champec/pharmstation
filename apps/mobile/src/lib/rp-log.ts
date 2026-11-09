// ============================================
// Responsible Pharmacist log (mobile). Mirrors apps/web/src/lib/rpLog.ts.
//
// The RP log is append-only. Each time a pharmacist becomes RP there is one
// "normal" record (the session). Sign-outs and corrections are "correction"
// records pointing back at it; a session's current state is its newest
// record. Absences live in ps_rp_absences, keyed by the original record.
// All changes go through server functions (ps_rp_*), which take the time
// from the server clock and the name and GPhC number from the profile.
// ============================================

import { userClient } from '@/lib/supabase'

export interface RpEntry {
  id: string
  ledger_id: string
  organisation_id: string
  entry_number: number
  entry_type: 'normal' | 'correction' | string
  date_of_transaction: string
  notes: string | null
  corrects_entry_id: string | null
  correction_reason: string | null
  pharmacist_name: string | null
  gphc_number: string | null
  rp_signed_in_at: string | null
  rp_signed_out_at: string | null
  entered_at: string
}

export interface RpAbsence {
  id: string
  organisation_id: string
  rp_entry_id: string
  absent_from: string
  returned_at: string | null
  reason: string | null
}

export interface RpSession {
  root: RpEntry
  current: RpEntry
  versions: RpEntry[]
  /** Corrections that changed details (not just the sign-out) */
  edits: RpEntry[]
  absences: RpAbsence[]
  isOpen: boolean
  date: string
}

export const MAX_ABSENCE_MINUTES = 120
const SIGN_OUT_PREFIX = 'Signed out'

export function isSignOutRecord(e: RpEntry): boolean {
  return e.entry_type === 'correction' && (e.correction_reason ?? '').startsWith(SIGN_OUT_PREFIX)
}

export function buildSessions(entries: RpEntry[], absences: RpAbsence[] = []): RpSession[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const rootOf = (e: RpEntry): string => {
    let cur: RpEntry | undefined = e
    let guard = 0
    while (cur && cur.entry_type === 'correction' && cur.corrects_entry_id && guard < 100) {
      const next = byId.get(cur.corrects_entry_id)
      if (!next) return cur.corrects_entry_id
      cur = next
      guard++
    }
    return cur?.id ?? e.id
  }

  const groups = new Map<string, RpEntry[]>()
  for (const e of entries) {
    if (e.entry_type !== 'normal' && e.entry_type !== 'correction') continue
    const r = rootOf(e)
    groups.set(r, [...(groups.get(r) ?? []), e])
  }
  const absByRoot = new Map<string, RpAbsence[]>()
  for (const a of absences) absByRoot.set(a.rp_entry_id, [...(absByRoot.get(a.rp_entry_id) ?? []), a])

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

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m ? `${h}h ${m}m` : `${h}h`
}

export function rpErrorMessage(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err)
  if (msg.startsWith('RP_ON_DUTY:')) return msg.replace('RP_ON_DUTY:', '').trim() + '.'
  if (msg.includes('CONFLICT')) return 'Someone else updated the RP log at the same moment. Please try again.'
  if (/Could not find the function/i.test(msg)) return 'The RP log needs a database update before it works here.'
  return msg
}

export interface RpData {
  entries: RpEntry[]
  absences: RpAbsence[]
  hasLedger: boolean
}

export async function loadRpData(organisationId: string, sinceDate: string): Promise<RpData> {
  const { data: ledger, error: ledgerErr } = await userClient
    .from('ps_register_ledgers')
    .select('id')
    .eq('organisation_id', organisationId)
    .eq('register_type', 'RP')
    .is('drug_id', null)
    .maybeSingle()
  if (ledgerErr) throw ledgerErr
  if (!ledger) return { entries: [], absences: [], hasLedger: false }

  const cols =
    'id, ledger_id, organisation_id, entry_number, entry_type, date_of_transaction, notes, corrects_entry_id, correction_reason, pharmacist_name, gphc_number, rp_signed_in_at, rp_signed_out_at, entered_at'
  const { data, error } = await userClient
    .from('ps_register_entries')
    .select(cols)
    .eq('ledger_id', (ledger as { id: string }).id)
    .gte('date_of_transaction', sinceDate)
    .order('entry_number', { ascending: true })
  if (error) throw error
  const list = ((data ?? []) as RpEntry[]).slice()

  // Corrections can point at sessions that started before the window.
  const known = new Set(list.map((e) => e.id))
  const missing = Array.from(
    new Set(list.map((e) => e.corrects_entry_id).filter((id): id is string => !!id && !known.has(id))),
  )
  if (missing.length) {
    const { data: extra } = await userClient.from('ps_register_entries').select(cols).in('id', missing)
    list.push(...((extra ?? []) as RpEntry[]))
  }

  const { data: absences } = await userClient
    .from('ps_rp_absences')
    .select('id, organisation_id, rp_entry_id, absent_from, returned_at, reason')
    .eq('organisation_id', organisationId)
    .gte('absent_from', `${sinceDate}T00:00:00Z`)
    .order('absent_from')

  return { entries: list, absences: (absences ?? []) as RpAbsence[], hasLedger: true }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await userClient.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const rpSignIn = (organisationId: string, takeOver = false) =>
  rpc<RpEntry>('ps_rp_sign_in', { p_organisation_id: organisationId, p_take_over: takeOver, p_notes: null })

export const rpSignOut = (entryId: string) =>
  rpc<RpEntry>('ps_rp_sign_out', { p_entry_id: entryId, p_at: null, p_reason: null })

export const rpStartAbsence = (entryId: string, reason: string | null) =>
  rpc<RpAbsence>('ps_rp_start_absence', { p_entry_id: entryId, p_reason: reason, p_at: null })

export const rpEndAbsence = (absenceId: string) =>
  rpc<RpAbsence>('ps_rp_end_absence', { p_absence_id: absenceId, p_at: null })
