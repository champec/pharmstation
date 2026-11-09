// ============================================
// Pharmacy logs (mobile): UK dates, today's checks and saving entries.
// Mirrors apps/web/src/pages/logs/logUtils.ts and the web log store. Entries
// are append-only and saved only through ps_log_save_entry.
// ============================================

import { userClient } from '@/lib/supabase'

export type FieldType =
  | 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date' | 'textarea' | 'signature' | 'canvas'
  | 'heading' | 'info' | string

export interface LogField {
  id: string
  template_id: string
  label: string
  field_key: string
  field_type: FieldType
  options: unknown
  is_required: boolean
  display_order: number
}

export interface LogTemplate {
  id: string
  title: string
  description: string
  category: string
  schedule_type: 'daily' | 'custom_days' | 'sporadic'
  required_days: number[] | null
}

export interface LogSubscription {
  id: string
  org_id: string
  template_id: string
  custom_title: string | null
  is_active: boolean
  template: LogTemplate | null
}

export interface LogEntry {
  id: string
  subscription_id: string
  entry_date: string
  data: Record<string, unknown>
  created_at: string
  root_id: string
  edit_reason: string | null
  voided_at: string | null
  entered_by_profile?: { full_name: string | null } | null
}

export const HANDOVER_TEMPLATE_ID = '00000000-0000-0000-0001-000000000006'

/** Ionicons per log category (no emoji, see design rules). */
export const CATEGORY_ICON: Record<string, string> = {
  fridge: 'thermometer-outline',
  cleaning: 'sparkles-outline',
  cd: 'medkit-outline',
  visitor: 'person-outline',
  date_check: 'calendar-outline',
  custom: 'clipboard-outline',
}

/* ---- UK dates ---- */

let isoFormatter: Intl.DateTimeFormat | null = null
try {
  isoFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
} catch {
  isoFormatter = null
}

/** yyyy-mm-dd in UK time (falls back to the phone's own time zone). */
export function ukDate(d: Date = new Date()): string {
  if (isoFormatter) {
    const s = isoFormatter.format(d)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function relativeDay(iso: string, today = ukDate()): string {
  if (iso === today) return 'Today'
  if (iso === addDays(today, -1)) return 'Yesterday'
  return formatDay(iso)
}

/* ---- Schedules and fields ---- */

export function isRequiredOn(t: LogTemplate | null | undefined, iso: string): boolean {
  if (!t) return false
  if (t.schedule_type === 'daily') return true
  if (t.schedule_type === 'custom_days') return (t.required_days ?? []).includes(dayOfWeek(iso))
  return false
}

export function dataFields(fields: LogField[]): LogField[] {
  return fields
    .filter((f) => f.field_type !== 'heading' && f.field_type !== 'info')
    .sort((a, b) => a.display_order - b.display_order)
}

export interface FieldRange { min?: number; max?: number; unit?: string }

export function fieldRange(f: LogField): FieldRange | null {
  if (f.field_type !== 'number') return null
  const o = f.options
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    const { min, max, unit } = o as Record<string, unknown>
    if (typeof min === 'number' || typeof max === 'number') {
      return {
        min: typeof min === 'number' ? min : undefined,
        max: typeof max === 'number' ? max : undefined,
        unit: typeof unit === 'string' ? unit : undefined,
      }
    }
  }
  return null
}

export function fieldChoices(f: LogField): string[] {
  return Array.isArray(f.options) ? (f.options as unknown[]).map(String) : []
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

export function isOutOfRange(f: LogField, v: unknown): boolean {
  const r = fieldRange(f)
  if (!r || isEmptyValue(v)) return false
  const n = Number(v)
  if (Number.isNaN(n)) return false
  return (r.min !== undefined && n < r.min) || (r.max !== undefined && n > r.max)
}

export function isActionField(f: LogField): boolean {
  return /action|comment|note/i.test(f.field_key) && (f.field_type === 'textarea' || f.field_type === 'text')
}

/** "Checked by", "Cleaned by" and similar: filled in with the user's name. */
export function isPersonField(f: LogField): boolean {
  return f.field_type === 'text' && /(_by$|^by$|checked|cleaned|signed_off|recorded)/i.test(f.field_key)
}

/** Fields the phone can't capture (drawn signatures). */
export function isWebOnlyField(f: LogField): boolean {
  return f.field_type === 'canvas' || f.field_type === 'signature'
}

export function validateEntry(fields: LogField[], data: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}
  const fs = dataFields(fields)
  for (const f of fs) if (f.is_required && isEmptyValue(data[f.field_key])) errors[f.field_key] = 'Required'
  if (fs.some((f) => isOutOfRange(f, data[f.field_key]))) {
    const action = fs.find(isActionField)
    if (action && isEmptyValue(data[action.field_key])) {
      errors[action.field_key] = 'A reading is out of range. Say what you did about it.'
    }
  }
  return errors
}

export function displayValue(f: LogField, v: unknown): string {
  if (isEmptyValue(v)) return '—'
  if (f.field_type === 'boolean') return v ? 'Yes' : 'No'
  if (f.field_type === 'date' && typeof v === 'string') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }
  if (Array.isArray(v)) return v.join(', ')
  const r = fieldRange(f)
  if (r?.unit && v !== '') return `${v} ${r.unit}`
  return String(v)
}

export function logErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err)
  if (msg.startsWith('ALREADY_LOGGED')) return 'Someone has already logged this today.'
  if (msg.includes('CONFLICT')) return 'Someone else changed this at the same moment. Pull down to refresh and try again.'
  if (/Could not find the function/i.test(msg)) return 'Logs need a database update before they work here.'
  return msg
}

/* ---- Data ---- */

const ENTRY_COLS =
  'id, subscription_id, entry_date, data, created_at, root_id, edit_reason, voided_at, entered_by_profile:ps_user_profiles!entered_by_user_id(full_name)'

export async function fetchSubscriptions(orgId: string): Promise<LogSubscription[]> {
  const { data, error } = await userClient
    .from('ps_log_subscriptions')
    .select('id, org_id, template_id, custom_title, is_active, template:ps_log_templates(id, title, description, category, schedule_type, required_days)')
    .eq('org_id', orgId)
    .eq('is_active', true)
  if (error) throw error
  return (data ?? []) as unknown as LogSubscription[]
}

export async function fetchFields(templateId: string): Promise<LogField[]> {
  const { data, error } = await userClient
    .from('ps_log_fields')
    .select('id, template_id, label, field_key, field_type, options, is_required, display_order')
    .eq('template_id', templateId)
    .order('display_order')
  if (error) throw error
  return (data ?? []) as LogField[]
}

export async function fetchEntries(subscriptionIds: string[], sinceDate: string, limit = 200): Promise<LogEntry[]> {
  if (!subscriptionIds.length) return []
  const { data, error } = await userClient
    .from('ps_log_entries')
    .select(ENTRY_COLS)
    .in('subscription_id', subscriptionIds)
    .gte('entry_date', sinceDate)
    .is('superseded_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as LogEntry[]
}

export async function saveEntry(subscriptionId: string, data: Record<string, unknown>, entryDate: string | null = null) {
  const { data: row, error } = await userClient.rpc('ps_log_save_entry', {
    p_subscription_id: subscriptionId,
    p_entry_date: entryDate,
    p_data: data,
    p_replaces_id: null,
    p_edit_reason: null,
  })
  if (error) throw new Error(error.message)
  return row as LogEntry
}

/** Finds (or adds) this pharmacy's subscription to a library log. */
export async function ensureLibrarySubscription(orgId: string, templateId: string): Promise<LogSubscription | null> {
  const { data: tpl } = await userClient.from('ps_log_templates').select('id').eq('id', templateId).maybeSingle()
  if (!tpl) return null
  const { data, error } = await userClient
    .from('ps_log_subscriptions')
    .upsert({ org_id: orgId, template_id: templateId, is_active: true }, { onConflict: 'org_id,template_id' })
    .select('id, org_id, template_id, custom_title, is_active, template:ps_log_templates(id, title, description, category, schedule_type, required_days)')
    .single()
  if (error) throw error
  return data as unknown as LogSubscription
}

export async function handoverTemplateExists(): Promise<boolean> {
  const { data } = await userClient.from('ps_log_templates').select('id').eq('id', HANDOVER_TEMPLATE_ID).maybeSingle()
  return !!data
}
