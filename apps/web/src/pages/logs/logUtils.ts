import { CalendarCheck, ClipboardList, Pill, SprayCan, Thermometer, UserRound, type LucideIcon } from 'lucide-react'
import type { LogCategory, LogEntry, LogField, LogScheduleType, LogTemplate } from '@pharmstation/types'

/* ---- Category look and feel ---- */

export const CATEGORY_CONFIG: Record<LogCategory, { label: string; icon: LucideIcon; color: string; tint: string; cta: string }> = {
  fridge: { label: 'Fridge', icon: Thermometer, color: 'var(--ps-deep-blue)', tint: 'var(--log-info-bg)', cta: 'Log temperatures' },
  cleaning: { label: 'Cleaning', icon: SprayCan, color: 'var(--ps-deep-blue)', tint: 'var(--log-info-bg)', cta: 'Log a clean' },
  cd: { label: 'CD', icon: Pill, color: 'var(--ps-deep-blue)', tint: 'var(--log-info-bg)', cta: 'Add entry' },
  visitor: { label: 'Visitor', icon: UserRound, color: 'var(--ps-deep-blue)', tint: 'var(--log-info-bg)', cta: 'Sign a visitor in' },
  date_check: { label: 'Date check', icon: CalendarCheck, color: 'var(--ps-deep-blue)', tint: 'var(--log-info-bg)', cta: 'Log a date check' },
  custom: { label: 'Custom', icon: ClipboardList, color: 'var(--ps-deep-blue)', tint: 'var(--log-info-bg)', cta: 'Add entry' },
}

export function categoryOf(template?: Pick<LogTemplate, 'category'> | null) {
  const cat = (template?.category || 'custom') as LogCategory
  return CATEGORY_CONFIG[cat] ?? CATEGORY_CONFIG.custom
}

/** Library "Shift Handover" log (notes for the next shift, also used by the mobile app) */
export const HANDOVER_TEMPLATE_ID = '00000000-0000-0000-0001-000000000006'

/* ---- UK dates (the pharmacy's day, not UTC) ---- */

const UK_TZ = 'Europe/London'
const isoFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: UK_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** yyyy-mm-dd for the given moment in UK time. */
export function ukDate(d: Date = new Date()): string {
  return isoFormatter.format(d)
}

/** Adds days to a yyyy-mm-dd date (calendar arithmetic, no time zone drift). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** 0 = Sunday … 6 = Saturday, for a yyyy-mm-dd date. */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Inclusive list of dates, newest first. */
export function dateList(start: string, end: string): string[] {
  const out: string[] = []
  let cur = end
  let guard = 0
  while (cur >= start && guard < 400) {
    out.push(cur)
    cur = addDays(cur, -1)
    guard++
  }
  return out
}

export function formatDay(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })
}

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: UK_TZ })
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: UK_TZ,
  })
}

export function relativeDay(iso: string, today = ukDate()): string {
  if (iso === today) return 'Today'
  if (iso === addDays(today, -1)) return 'Yesterday'
  return formatDay(iso)
}

/* ---- Schedules ---- */

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function isScheduled(template: Pick<LogTemplate, 'schedule_type' | 'required_days'> | null | undefined): boolean {
  return template?.schedule_type === 'daily' || template?.schedule_type === 'custom_days'
}

export function isRequiredOn(template: Pick<LogTemplate, 'schedule_type' | 'required_days'> | null | undefined, iso: string): boolean {
  if (!template) return false
  if (template.schedule_type === 'daily') return true
  if (template.schedule_type === 'custom_days') return (template.required_days || []).includes(dayOfWeek(iso))
  return false
}

export function scheduleLabel(type: LogScheduleType | undefined, days?: number[] | null): string {
  if (type === 'daily') return 'Every day'
  if (type === 'sporadic' || !type) return 'As needed'
  if (type === 'custom_days' && days?.length) {
    if (days.length === 7) return 'Every day'
    const sorted = [...days].sort()
    if (sorted.join() === '1,2,3,4,5') return 'Mon to Fri'
    if (sorted.join() === '1,2,3,4,5,6') return 'Mon to Sat'
    return sorted.map((d) => DAY_ABBR[d]).join(', ')
  }
  return 'As needed'
}

/**
 * Consecutive required days logged, counting back from today. Today only
 * breaks the streak once it is over (an unlogged today does not reset it).
 */
export function computeStreak(
  template: Pick<LogTemplate, 'schedule_type' | 'required_days'> | null | undefined,
  loggedDates: Set<string>,
  today = ukDate(),
  maxDays = 365,
): number {
  if (!isScheduled(template)) return 0
  let streak = 0
  for (let i = 0; i < maxDays; i++) {
    const d = addDays(today, -i)
    if (!isRequiredOn(template, d)) continue
    if (loggedDates.has(d)) streak++
    else if (d === today) continue
    else break
  }
  return streak
}

/** Required days in the window (excluding today) that have no entry. */
export function missedDays(
  template: Pick<LogTemplate, 'schedule_type' | 'required_days'> | null | undefined,
  loggedDates: Set<string>,
  start: string,
  today = ukDate(),
  /** First day the log was in use (yyyy-mm-dd); days before it are never "missed" */
  startedOn?: string | null,
): string[] {
  if (!isScheduled(template)) return []
  const from = startedOn && startedOn > start ? startedOn : start
  if (from > addDays(today, -1)) return []
  return dateList(from, addDays(today, -1)).filter((d) => isRequiredOn(template, d) && !loggedDates.has(d))
}

/* ---- Fields, ranges and validation ---- */

export interface FieldRange { min?: number; max?: number; unit?: string }

export function fieldRange(field: LogField): FieldRange | null {
  if (field.field_type !== 'number') return null
  const opts = field.options
  if (opts && !Array.isArray(opts) && typeof opts === 'object') {
    const { min, max, unit } = opts as Record<string, unknown>
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

export function isOutOfRange(field: LogField, value: unknown): boolean {
  const range = fieldRange(field)
  if (!range || value === null || value === undefined || value === '') return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return (range.min !== undefined && n < range.min) || (range.max !== undefined && n > range.max)
}

export function rangeLabel(range: FieldRange): string {
  const unit = range.unit ?? ''
  if (range.min !== undefined && range.max !== undefined) return `${range.min} to ${range.max}${unit ? ' ' + unit : ''}`
  if (range.min !== undefined) return `at least ${range.min}${unit ? ' ' + unit : ''}`
  return `up to ${range.max}${unit ? ' ' + unit : ''}`
}

export function isActionField(field: LogField): boolean {
  return /action|comment|note/i.test(field.field_key) && (field.field_type === 'textarea' || field.field_type === 'text')
}

/** "Checked by", "Cleaned by" and similar fields get the signed-in user's name. */
export function isPersonField(field: LogField): boolean {
  return field.field_type === 'text' && /(_by$|^by$|checked|cleaned|signed_off|recorded)/i.test(field.field_key)
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

export function dataFields(fields: LogField[]): LogField[] {
  return [...fields]
    .filter((f) => f.field_type !== 'heading' && f.field_type !== 'info')
    .sort((a, b) => a.display_order - b.display_order)
}

/** Returns a message per field key that blocks saving. */
export function validateEntry(fields: LogField[], data: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}
  const fs = dataFields(fields)
  for (const f of fs) {
    if (f.is_required && isEmptyValue(data[f.field_key])) errors[f.field_key] = 'Required'
  }
  const outOfRange = fs.some((f) => isOutOfRange(f, data[f.field_key]))
  if (outOfRange) {
    const action = fs.find(isActionField)
    if (action && isEmptyValue(data[action.field_key])) {
      errors[action.field_key] = 'A reading is out of range. Say what you did about it.'
    }
  }
  return errors
}

export function entryHasWarning(fields: LogField[], entry: LogEntry | null | undefined): boolean {
  if (!entry) return false
  return dataFields(fields).some((f) => isOutOfRange(f, entry.data?.[f.field_key]))
}

export function displayValue(field: LogField, val: unknown): string {
  if (isEmptyValue(val)) return '—'
  if (field.field_type === 'boolean') return val ? 'Yes' : 'No'
  if (field.field_type === 'date' && typeof val === 'string') {
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return formatDateTime(d.toISOString())
  }
  if (Array.isArray(val)) return val.join(', ')
  const range = fieldRange(field)
  if (range?.unit && typeof val === 'number') return `${val} ${range.unit}`
  return String(val)
}

/** Ready-to-use encouragement after saving. */
const CHEERS = ['Nice one!', 'Logged!', 'All done!', 'Great work!', 'Sorted!', 'Ticked off!']
export function cheer(): string {
  return CHEERS[Math.floor(Math.random() * CHEERS.length)]
}
