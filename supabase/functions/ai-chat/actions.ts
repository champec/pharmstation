// ============================================
// Genie — locum shift and appointment tools
//
// Read tools answer straight away. Change tools never change anything themselves:
// they check the request, then save a *proposal* (ps_genie_actions) that the app shows
// as a card with Confirm / Cancel. Only when the staff member taps Confirm does
// performAction() carry it out, using that person's own session, so row security and
// their permissions (e.g. approve_locums with two-step sign-in) still apply.
// ============================================

// deno-lint-ignore no-explicit-any
type Db = any

export type ActionContext = {
  orgId: string
  userId: string
  userClient: Db
  supabaseAdmin: Db
  patientData: boolean
  /** Saves a proposal and tells the app to show a confirm card. */
  propose: (proposal: Proposal) => Promise<{ id: string }>
}

export type Proposal = {
  tool: string
  args: Record<string, unknown>
  summary: string
  details: string[]
}

export type ActionOutcome = { ok: boolean; message: string; link?: string }

const MAX_ROWS = 50
const SHIFT_STATUSES = ['open', 'filled', 'completed', 'cancelled'] as const
const APPOINTMENT_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'] as const
const SETTABLE_APPOINTMENT_STATUSES = ['confirmed', 'completed', 'no_show', 'cancelled'] as const

// ---------------------------------------------------------------- arguments

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const uuid = (v: unknown) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const time = (v: unknown) => {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null
const limit = (v: unknown, fallback = 20) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_ROWS) : fallback
}
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const err = (error: string) => JSON.stringify({ error })

// ---------------------------------------------------------------- UK time

const UK_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
const UK_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const UK_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false })

/** UK wall-clock date + time -> UTC ISO string (handles GMT/BST). */
export function ukToIso(d: string, t: string): string {
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, da, h, mi)
  const parts = Object.fromEntries(UK_PARTS.formatToParts(new Date(guess)).map((p) => [p.type, p.value]))
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute))
  return new Date(guess - (shown - guess)).toISOString()
}

const ukDay = (d: string) => UK_DAY.format(new Date(`${d}T12:00:00Z`))
const ukDayOf = (iso: string) => UK_DAY.format(new Date(iso))
const ukTime = (iso: string) => UK_TIME.format(new Date(iso))
const money = (n: number) => `£${n.toFixed(2)}`
const pence = (p: number | null) => (p == null ? null : `£${(p / 100).toFixed(2)}`)

/** UK "today" as YYYY-MM-DD. */
function ukToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
}

// ---------------------------------------------------------------- permissions

async function can(ctx: ActionContext, permission: string): Promise<boolean> {
  const { data, error } = await ctx.userClient.rpc('ps_member_has_permission', {
    p_organisation_id: ctx.orgId,
    p_permission: permission,
  })
  return !error && data === true
}

const NEED_LOCUM_PERMISSION =
  'This user cannot manage locum shifts. It needs the "approve locums" permission (and two-step sign-in). Tell them to ask their pharmacy owner or manager.'

// ---------------------------------------------------------------- tool definitions

export function actionToolDefinitions(patientData: boolean) {
  const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  })
  const tools = [
    fn('list_locum_shifts', 'List this pharmacy\'s locum shifts with any locum applications or bookings. Use before changing a shift to get its shift_id.', {
      status: { type: 'string', enum: [...SHIFT_STATUSES], description: 'Only shifts with this status' },
      date_from: { type: 'string', description: 'First shift date (YYYY-MM-DD). Defaults to today.' },
      date_to: { type: 'string', description: 'Last shift date (YYYY-MM-DD)' },
      limit: { type: 'integer', description: `Max results (default 20, max ${MAX_ROWS})` },
    }),
    fn('create_locum_shift', 'Propose a new locum shift for this pharmacy. The user must confirm it in the app before it is created.', {
      date: { type: 'string', description: 'Shift date (YYYY-MM-DD)' },
      start_time: { type: 'string', description: 'Start time, 24-hour HH:MM UK time' },
      end_time: { type: 'string', description: 'End time, 24-hour HH:MM UK time' },
      rate_per_hour: { type: 'number', description: 'Hourly rate in pounds' },
      booking_mode: { type: 'string', enum: ['manual', 'auto'], description: 'manual = the pharmacy approves applicants (default); auto = first eligible locum is booked instantly' },
      notes: { type: 'string', description: 'Optional notes for locums' },
    }, ['date', 'start_time', 'end_time', 'rate_per_hour']),
    fn('update_locum_shift', 'Propose changes to an open locum shift (date, times, rate, booking mode or notes). The user must confirm.', {
      shift_id: { type: 'string' },
      date: { type: 'string', description: 'New date (YYYY-MM-DD)' },
      start_time: { type: 'string', description: 'New start time HH:MM' },
      end_time: { type: 'string', description: 'New end time HH:MM' },
      rate_per_hour: { type: 'number' },
      booking_mode: { type: 'string', enum: ['manual', 'auto'] },
      notes: { type: 'string' },
    }, ['shift_id']),
    fn('cancel_locum_shift', 'Propose cancelling a locum shift. Any booked or applying locum is told. The user must confirm.', {
      shift_id: { type: 'string' },
      reason: { type: 'string', description: 'Reason shown to the locum' },
    }, ['shift_id']),
    fn('review_locum_application', 'Propose approving or rejecting a locum\'s application for a shift (booking_id from list_locum_shifts). The user must confirm.', {
      booking_id: { type: 'string' },
      decision: { type: 'string', enum: ['approve', 'reject'] },
      reason: { type: 'string', description: 'Optional reason (shown to the locum when rejecting)' },
    }, ['booking_id', 'decision']),
    fn('list_services', 'List the services this pharmacy offers, with duration, price and whether patients can book online.', {}),
    fn('list_appointment_slots', 'List appointment times (slots) and how many places are free.', {
      date_from: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
      date_to: { type: 'string', description: 'YYYY-MM-DD, defaults to 7 days after date_from' },
      service_id: { type: 'string' },
      only_available: { type: 'boolean', description: 'Only slots with a free place' },
    }),
    fn('create_appointment_slots', 'Propose adding bookable appointment times for a service on one day, split into equal slots. The user must confirm.', {
      service_id: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      start_time: { type: 'string', description: 'First slot starts, HH:MM UK time' },
      end_time: { type: 'string', description: 'Last slot ends, HH:MM UK time' },
      slot_minutes: { type: 'integer', description: 'Length of each slot. Defaults to the service duration.' },
      max_bookings: { type: 'integer', description: 'Patients per slot (default 1)' },
    }, ['service_id', 'date', 'start_time', 'end_time']),
    fn('list_appointments', patientData
      ? 'List appointments booked with this pharmacy, with patient names.'
      : 'List appointments booked with this pharmacy. Patient names are hidden; refer to appointments by service and time.', {
      date_from: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
      date_to: { type: 'string', description: 'YYYY-MM-DD, defaults to 7 days after date_from' },
      status: { type: 'string', enum: [...APPOINTMENT_STATUSES] },
      limit: { type: 'integer' },
    }),
    fn('set_appointment_status', 'Propose marking an appointment confirmed, completed, no-show or cancelled. The user must confirm.', {
      appointment_id: { type: 'string' },
      status: { type: 'string', enum: [...SETTABLE_APPOINTMENT_STATUSES] },
    }, ['appointment_id', 'status']),
    fn('reschedule_appointment', 'Propose moving an appointment to another slot (slot_id from list_appointment_slots). The user must confirm.', {
      appointment_id: { type: 'string' },
      slot_id: { type: 'string' },
    }, ['appointment_id', 'slot_id']),
  ]
  if (patientData) {
    tools.push(
      fn('find_patients', 'Find this pharmacy\'s patients by name to get a patient_id.', {
        name: { type: 'string' },
      }, ['name']),
      fn('book_appointment', 'Propose booking a patient into a free slot. The user must confirm.', {
        patient_id: { type: 'string' },
        slot_id: { type: 'string' },
        notes: { type: 'string' },
      }, ['patient_id', 'slot_id']),
    )
  }
  return tools
}

export const ACTION_TOOL_NAMES = new Set([
  'list_locum_shifts', 'create_locum_shift', 'update_locum_shift', 'cancel_locum_shift', 'review_locum_application',
  'list_services', 'list_appointment_slots', 'create_appointment_slots', 'list_appointments',
  'set_appointment_status', 'reschedule_appointment', 'find_patients', 'book_appointment',
])

// ---------------------------------------------------------------- lookups

type ShiftRow = {
  id: string; date: string; start_time: string; end_time: string; rate_per_hour: number
  booking_mode: string; status: string; notes: string | null
}

async function loadShift(ctx: ActionContext, id: string): Promise<ShiftRow | null> {
  const { data } = await ctx.userClient
    .from('ps_locum_shifts')
    .select('id, date, start_time, end_time, rate_per_hour, booking_mode, status, notes')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  return data as ShiftRow | null
}

const shiftLabel = (s: { date: string; start_time: string; end_time: string }) =>
  `${ukDay(s.date)}, ${s.start_time.slice(0, 5)} to ${s.end_time.slice(0, 5)}`

async function namesFor(ctx: ActionContext, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (!userIds.length) return names
  const { data } = await ctx.supabaseAdmin.from('ps_user_profiles').select('id, full_name').in('id', userIds)
  for (const p of (data ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) names.set(p.id, p.full_name)
  return names
}

type AppointmentRow = {
  id: string; status: string; notes: string | null; source: string; service_id: string | null; slot_id: string | null
  service: { name: string } | null
  slot: { start_time: string; end_time: string } | null
  patient?: { first_name: string | null; last_name: string | null } | null
}

async function loadAppointment(ctx: ActionContext, id: string): Promise<AppointmentRow | null> {
  const { data } = await ctx.userClient
    .from('ps_appointments')
    .select('id, status, notes, source, service_id, slot_id, service:ps_services(name), slot:ps_appointment_slots(start_time, end_time)'
      + (ctx.patientData ? ', patient:ps_patients(first_name, last_name)' : ''))
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  return data as AppointmentRow | null
}

const appointmentLabel = (a: AppointmentRow, patientData: boolean) => {
  const who = patientData && a.patient ? `${[a.patient.first_name, a.patient.last_name].filter(Boolean).join(' ')}, ` : ''
  const when = a.slot ? `${ukDayOf(a.slot.start_time)} at ${ukTime(a.slot.start_time)}` : 'no time set'
  return `${who}${a.service?.name ?? 'Appointment'}, ${when}`
}

type SlotRow = { id: string; service_id: string; start_time: string; end_time: string; max_bookings: number; booked_count: number; is_active: boolean }

async function loadSlot(ctx: ActionContext, id: string): Promise<SlotRow | null> {
  const { data } = await ctx.userClient
    .from('ps_appointment_slots')
    .select('id, service_id, start_time, end_time, max_bookings, booked_count, is_active')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  return data as SlotRow | null
}

// ---------------------------------------------------------------- run a tool

const proposed = (id: string, summary: string) =>
  JSON.stringify({
    proposed: true,
    action_id: id,
    summary,
    note: 'Nothing has changed yet. The user now sees a card with Confirm and Cancel buttons. Tell them briefly what will happen and to tap Confirm. Never say it is done.',
  })

/** Runs one of this module's tools. Returns null when the tool is not one of ours. */
export async function executeActionTool(name: string, args: Record<string, unknown>, ctx: ActionContext): Promise<string | null> {
  if (!ACTION_TOOL_NAMES.has(name)) return null
  try {
    switch (name) {
      // ------------------------------------------------ locum shifts
      case 'list_locum_shifts': {
        let q = ctx.userClient
          .from('ps_locum_shifts')
          .select('id, date, start_time, end_time, rate_per_hour, booking_mode, status, notes, bookings:ps_locum_bookings(id, status, locum_id, applied_at)')
          .eq('org_id', ctx.orgId)
          .gte('date', date(args.date_from) ?? ukToday())
          .order('date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(limit(args.limit))
        const to = date(args.date_to)
        if (to) q = q.lte('date', to)
        const status = oneOf(args.status, SHIFT_STATUSES)
        if (status) q = q.eq('status', status)
        const { data, error } = await q
        if (error) return err('Could not load locum shifts.')
        const rows = (data ?? []) as (ShiftRow & { bookings: { id: string; status: string; locum_id: string; applied_at: string }[] })[]
        const locumIds = [...new Set(rows.flatMap((s) => s.bookings.map((b) => b.locum_id)))]
        const { data: profiles } = locumIds.length
          ? await ctx.supabaseAdmin.from('ps_locum_profiles').select('id, user_id').in('id', locumIds)
          : { data: [] }
        const userByLocum = new Map(((profiles ?? []) as { id: string; user_id: string }[]).map((p) => [p.id, p.user_id]))
        const names = await namesFor(ctx, [...new Set([...userByLocum.values()])])
        return JSON.stringify({
          shifts: rows.map((s) => ({
            shift_id: s.id,
            date: s.date,
            start: s.start_time.slice(0, 5),
            end: s.end_time.slice(0, 5),
            rate_per_hour: money(Number(s.rate_per_hour)),
            booking_mode: s.booking_mode,
            status: s.status,
            notes: s.notes,
            locums: s.bookings.map((b) => ({
              booking_id: b.id,
              locum: names.get(userByLocum.get(b.locum_id) ?? '') ?? 'Locum',
              status: b.status,
              applied_at: b.applied_at,
            })),
          })),
          count: rows.length,
        })
      }

      case 'create_locum_shift': {
        if (!(await can(ctx, 'approve_locums'))) return err(NEED_LOCUM_PERMISSION)
        const d = date(args.date)
        const start = time(args.start_time)
        const end = time(args.end_time)
        const rate = Number(args.rate_per_hour)
        if (!d || !start || !end) return err('A date (YYYY-MM-DD), start time and end time (HH:MM) are needed.')
        if (d < ukToday()) return err('That date is in the past.')
        if (minutes(end) <= minutes(start)) return err('The end time must be after the start time.')
        if (!Number.isFinite(rate) || rate <= 0 || rate > 500) return err('Give an hourly rate in pounds, for example 45.')
        const mode = oneOf(args.booking_mode, ['manual', 'auto'] as const) ?? 'manual'
        const notes = str(args.notes, 1000)
        const hours = (minutes(end) - minutes(start)) / 60
        const summary = `Create a locum shift: ${shiftLabel({ date: d, start_time: start, end_time: end })}`
        const { id } = await ctx.propose({
          tool: name,
          args: { date: d, start_time: start, end_time: end, rate_per_hour: Math.round(rate * 100) / 100, booking_mode: mode, notes },
          summary,
          details: [
            `Rate ${money(rate)} an hour (${hours.toFixed(1)} hours, about ${money(rate * hours)})`,
            mode === 'auto' ? 'Instant booking: the first eligible locum is booked' : 'You approve each applicant',
            ...(notes ? [`Notes: ${notes}`] : []),
          ],
        })
        return proposed(id, summary)
      }

      case 'update_locum_shift': {
        if (!(await can(ctx, 'approve_locums'))) return err(NEED_LOCUM_PERMISSION)
        const id = uuid(args.shift_id)
        const shift = id ? await loadShift(ctx, id) : null
        if (!shift) return err('Shift not found. Use list_locum_shifts to find it.')
        if (shift.status !== 'open') return err(`This shift is ${shift.status}, so it cannot be changed. Only open shifts can be edited.`)
        const changes: Record<string, unknown> = {}
        const details: string[] = []
        const d = date(args.date)
        if (d && d !== shift.date) {
          if (d < ukToday()) return err('That date is in the past.')
          changes.date = d
          details.push(`Date: ${ukDay(shift.date)} → ${ukDay(d)}`)
        }
        const start = time(args.start_time) ?? shift.start_time.slice(0, 5)
        const end = time(args.end_time) ?? shift.end_time.slice(0, 5)
        if (minutes(end) <= minutes(start)) return err('The end time must be after the start time.')
        if (start !== shift.start_time.slice(0, 5) || end !== shift.end_time.slice(0, 5)) {
          changes.start_time = start
          changes.end_time = end
          details.push(`Times: ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)} → ${start}–${end}`)
        }
        if (args.rate_per_hour !== undefined) {
          const rate = Number(args.rate_per_hour)
          if (!Number.isFinite(rate) || rate <= 0 || rate > 500) return err('Give an hourly rate in pounds, for example 45.')
          if (rate !== Number(shift.rate_per_hour)) {
            changes.rate_per_hour = Math.round(rate * 100) / 100
            details.push(`Rate: ${money(Number(shift.rate_per_hour))} → ${money(rate)} an hour`)
          }
        }
        const mode = oneOf(args.booking_mode, ['manual', 'auto'] as const)
        if (mode && mode !== shift.booking_mode) {
          changes.booking_mode = mode
          details.push(`Booking: ${mode === 'auto' ? 'instant booking' : 'you approve applicants'}`)
        }
        if (typeof args.notes === 'string' && str(args.notes, 1000) !== (shift.notes ?? '')) {
          changes.notes = str(args.notes, 1000)
          details.push(`Notes: ${str(args.notes, 1000) || '(removed)'}`)
        }
        if (!Object.keys(changes).length) return err('Nothing would change. Ask the user what to change.')
        const summary = `Change the locum shift on ${shiftLabel(shift)}`
        const { id: actionId } = await ctx.propose({ tool: name, args: { shift_id: shift.id, changes }, summary, details })
        return proposed(actionId, summary)
      }

      case 'cancel_locum_shift': {
        if (!(await can(ctx, 'approve_locums'))) return err(NEED_LOCUM_PERMISSION)
        const id = uuid(args.shift_id)
        const shift = id ? await loadShift(ctx, id) : null
        if (!shift) return err('Shift not found. Use list_locum_shifts to find it.')
        if (shift.status === 'cancelled' || shift.status === 'completed') return err(`This shift is already ${shift.status}.`)
        const reason = str(args.reason, 300)
        const summary = `Cancel the locum shift on ${shiftLabel(shift)}`
        const { id: actionId } = await ctx.propose({
          tool: name,
          args: { shift_id: shift.id, reason },
          summary,
          details: [
            shift.status === 'filled' ? 'A locum is booked on this shift. They will be told it is cancelled.' : 'Any applicants will be told.',
            ...(reason ? [`Reason: ${reason}`] : []),
          ],
        })
        return proposed(actionId, summary)
      }

      case 'review_locum_application': {
        if (!(await can(ctx, 'approve_locums'))) return err(NEED_LOCUM_PERMISSION)
        const bookingId = uuid(args.booking_id)
        const decision = oneOf(args.decision, ['approve', 'reject'] as const)
        if (!bookingId || !decision) return err('A booking_id and a decision (approve or reject) are needed.')
        const { data: booking } = await ctx.userClient
          .from('ps_locum_bookings')
          .select('id, status, locum_id, shift:ps_locum_shifts!inner(id, org_id, date, start_time, end_time)')
          .eq('id', bookingId)
          .eq('shift.org_id', ctx.orgId)
          .maybeSingle()
        if (!booking) return err('Application not found. Use list_locum_shifts to find the booking_id.')
        if (booking.status !== 'pending') return err(`This application is already ${booking.status}.`)
        const { data: profile } = await ctx.supabaseAdmin.from('ps_locum_profiles').select('user_id').eq('id', booking.locum_id).maybeSingle()
        const locumName = (await namesFor(ctx, profile?.user_id ? [profile.user_id] : [])).get(profile?.user_id ?? '') ?? 'the locum'
        const reason = str(args.reason, 300)
        const summary = `${decision === 'approve' ? 'Approve' : 'Reject'} ${locumName} for the shift on ${shiftLabel(booking.shift)}`
        const { id: actionId } = await ctx.propose({
          tool: name,
          args: { booking_id: bookingId, decision, reason },
          summary,
          details: decision === 'approve'
            ? ['The locum is booked and told. Other applicants are turned down.']
            : ['The locum is told they were not selected.', ...(reason ? [`Reason: ${reason}`] : [])],
        })
        return proposed(actionId, summary)
      }

      // ------------------------------------------------ services and slots
      case 'list_services': {
        const { data, error } = await ctx.userClient
          .from('ps_services')
          .select('id, name, description, duration_minutes, is_public, is_nhs_service, is_chargeable, price_pence, is_video')
          .eq('org_id', ctx.orgId)
          .eq('is_active', true)
          .is('archived_at', null)
          .order('name')
          .limit(100)
        if (error) return err('Could not load services.')
        return JSON.stringify({
          services: (data ?? []).map((s: Record<string, unknown>) => ({
            service_id: s.id,
            name: s.name,
            description: typeof s.description === 'string' ? s.description.slice(0, 200) : null,
            duration_minutes: s.duration_minutes,
            price: s.is_chargeable ? pence(s.price_pence as number | null) : 'Free',
            nhs: s.is_nhs_service,
            bookable_online: s.is_public,
            video: s.is_video,
          })),
        })
      }

      case 'list_appointment_slots': {
        const from = date(args.date_from) ?? ukToday()
        const to = date(args.date_to) ?? new Date(Date.parse(`${from}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10)
        let q = ctx.userClient
          .from('ps_appointment_slots')
          .select('id, start_time, end_time, max_bookings, booked_count, service:ps_services(id, name)')
          .eq('org_id', ctx.orgId)
          .eq('is_active', true)
          .gte('start_time', ukToIso(from, '00:00'))
          .lt('start_time', ukToIso(to, '23:59'))
          .order('start_time')
          .limit(MAX_ROWS)
        const serviceId = uuid(args.service_id)
        if (serviceId) q = q.eq('service_id', serviceId)
        const { data, error } = await q
        if (error) return err('Could not load appointment slots.')
        let rows = (data ?? []) as (SlotRow & { service: { id: string; name: string } | null })[]
        if (args.only_available === true) rows = rows.filter((s) => s.booked_count < s.max_bookings)
        return JSON.stringify({
          slots: rows.map((s) => ({
            slot_id: s.id,
            service: s.service?.name,
            day: ukDayOf(s.start_time),
            start: ukTime(s.start_time),
            end: ukTime(s.end_time),
            places_free: Math.max(s.max_bookings - s.booked_count, 0),
            places_total: s.max_bookings,
          })),
          count: rows.length,
        })
      }

      case 'create_appointment_slots': {
        const serviceId = uuid(args.service_id)
        const d = date(args.date)
        const start = time(args.start_time)
        const end = time(args.end_time)
        if (!serviceId || !d || !start || !end) return err('A service_id, date, start time and end time are needed.')
        if (d < ukToday()) return err('That date is in the past.')
        const { data: service } = await ctx.userClient
          .from('ps_services')
          .select('id, name, duration_minutes')
          .eq('id', serviceId)
          .eq('org_id', ctx.orgId)
          .maybeSingle()
        if (!service) return err('Service not found. Use list_services to find it.')
        const length = Math.floor(Number(args.slot_minutes)) || service.duration_minutes || 15
        if (length < 5 || length > 480) return err('Slots must be between 5 and 480 minutes long.')
        const perSlot = Math.min(Math.max(Math.floor(Number(args.max_bookings)) || 1, 1), 50)
        const count = Math.floor((minutes(end) - minutes(start)) / length)
        if (count < 1) return err('That window is shorter than one slot.')
        if (count > 60) return err('That would make more than 60 slots. Ask for a shorter window.')
        const summary = `Add ${count} ${service.name} slot${count === 1 ? '' : 's'} on ${ukDay(d)}`
        const { id: actionId } = await ctx.propose({
          tool: name,
          args: { service_id: serviceId, date: d, start_time: start, end_time: end, slot_minutes: length, max_bookings: perSlot },
          summary,
          details: [
            `${start} to ${end}, ${length}-minute slots`,
            `${perSlot} patient${perSlot === 1 ? '' : 's'} per slot`,
          ],
        })
        return proposed(actionId, summary)
      }

      // ------------------------------------------------ appointments
      case 'list_appointments': {
        const from = date(args.date_from) ?? ukToday()
        const to = date(args.date_to) ?? new Date(Date.parse(`${from}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10)
        let q = ctx.userClient
          .from('ps_appointments')
          .select('id, status, source, notes, service:ps_services(name), slot:ps_appointment_slots!inner(start_time, end_time)'
            + (ctx.patientData ? ', patient:ps_patients(first_name, last_name)' : ''))
          .eq('org_id', ctx.orgId)
          .gte('slot.start_time', ukToIso(from, '00:00'))
          .lt('slot.start_time', ukToIso(to, '23:59'))
          .limit(limit(args.limit, 30))
        const status = oneOf(args.status, APPOINTMENT_STATUSES)
        if (status) q = q.eq('status', status)
        const { data, error } = await q
        if (error) return err('Could not load appointments.')
        const rows = ((data ?? []) as AppointmentRow[])
          .filter((a) => a.slot)
          .sort((a, b) => a.slot!.start_time.localeCompare(b.slot!.start_time))
        return JSON.stringify({
          appointments: rows.map((a) => ({
            appointment_id: a.id,
            service: a.service?.name,
            day: ukDayOf(a.slot!.start_time),
            start: ukTime(a.slot!.start_time),
            end: ukTime(a.slot!.end_time),
            status: a.status,
            booked_via: a.source,
            ...(ctx.patientData
              ? { patient: [a.patient?.first_name, a.patient?.last_name].filter(Boolean).join(' ') || 'Not recorded', notes: a.notes }
              : {}),
          })),
          count: rows.length,
          ...(ctx.patientData ? {} : { note: 'Patient details are switched off for Genie in this pharmacy.' }),
        })
      }

      case 'set_appointment_status': {
        const id = uuid(args.appointment_id)
        const status = oneOf(args.status, SETTABLE_APPOINTMENT_STATUSES)
        if (!id || !status) return err('An appointment_id and a status are needed.')
        const appt = await loadAppointment(ctx, id)
        if (!appt) return err('Appointment not found. Use list_appointments to find it.')
        if (appt.status === status) return err(`This appointment is already ${status}.`)
        if (appt.status === 'cancelled') return err('This appointment is cancelled, so its status cannot be changed.')
        const label = { confirmed: 'Confirm', completed: 'Mark as completed', no_show: 'Mark as a no-show', cancelled: 'Cancel' }[status]
        const summary = `${label}: ${appointmentLabel(appt, ctx.patientData)}`
        const { id: actionId } = await ctx.propose({
          tool: name,
          args: { appointment_id: id, status },
          summary,
          details: status === 'cancelled' ? ['The time becomes free for someone else to book.'] : [],
        })
        return proposed(actionId, summary)
      }

      case 'reschedule_appointment': {
        const id = uuid(args.appointment_id)
        const slotId = uuid(args.slot_id)
        if (!id || !slotId) return err('An appointment_id and a slot_id are needed.')
        const appt = await loadAppointment(ctx, id)
        if (!appt) return err('Appointment not found. Use list_appointments to find it.')
        if (appt.status === 'cancelled' || appt.status === 'completed') return err(`This appointment is ${appt.status}, so it cannot be moved.`)
        const slot = await loadSlot(ctx, slotId)
        if (!slot || !slot.is_active) return err('That slot was not found. Use list_appointment_slots to find a free one.')
        if (slot.id === appt.slot_id) return err('The appointment is already at that time.')
        if (slot.booked_count >= slot.max_bookings) return err('That slot is full. Pick another.')
        if (appt.service_id && slot.service_id !== appt.service_id) return err('That slot is for a different service. Pick a slot for the same service.')
        const summary = `Move ${appointmentLabel(appt, ctx.patientData)}`
        const { id: actionId } = await ctx.propose({
          tool: name,
          args: { appointment_id: id, slot_id: slotId },
          summary,
          details: [`New time: ${ukDayOf(slot.start_time)} at ${ukTime(slot.start_time)}`],
        })
        return proposed(actionId, summary)
      }

      case 'find_patients': {
        if (!ctx.patientData) return err('Patient details are switched off for Genie in this pharmacy.')
        const q = str(args.name, 60).replace(/[%_,()\\]/g, ' ').trim()
        if (q.length < 2) return err('Give at least two letters of the name.')
        const parts = q.split(/\s+/).slice(0, 2)
        let query = ctx.userClient
          .from('ps_patients')
          .select('id, first_name, last_name, dob')
          .eq('organisation_id', ctx.orgId)
          .limit(10)
        if (parts.length === 2) query = query.ilike('first_name', `${parts[0]}%`).ilike('last_name', `${parts[1]}%`)
        else query = query.or(`first_name.ilike.${parts[0]}%,last_name.ilike.${parts[0]}%`)
        const { data, error } = await query
        if (error) return err('Could not search patients.')
        return JSON.stringify({
          patients: (data ?? []).map((p: { id: string; first_name: string; last_name: string; dob: string | null }) => ({
            patient_id: p.id, name: `${p.first_name} ${p.last_name}`, date_of_birth: p.dob,
          })),
        })
      }

      case 'book_appointment': {
        if (!ctx.patientData) return err('Patient details are switched off for Genie in this pharmacy.')
        const patientId = uuid(args.patient_id)
        const slotId = uuid(args.slot_id)
        if (!patientId || !slotId) return err('A patient_id and a slot_id are needed.')
        const slot = await loadSlot(ctx, slotId)
        if (!slot || !slot.is_active) return err('That slot was not found. Use list_appointment_slots to find a free one.')
        if (slot.booked_count >= slot.max_bookings) return err('That slot is full. Pick another.')
        const [{ data: patient }, { data: service }] = await Promise.all([
          ctx.userClient.from('ps_patients').select('first_name, last_name').eq('id', patientId).eq('organisation_id', ctx.orgId).maybeSingle(),
          ctx.userClient.from('ps_services').select('name').eq('id', slot.service_id).maybeSingle(),
        ])
        if (!patient) return err('Patient not found. Use find_patients first.')
        const notes = str(args.notes, 500)
        const summary = `Book ${patient.first_name} ${patient.last_name} for ${service?.name ?? 'an appointment'}`
        const { id: actionId } = await ctx.propose({
          tool: name,
          args: { patient_id: patientId, slot_id: slotId, notes },
          summary,
          details: [`${ukDayOf(slot.start_time)} at ${ukTime(slot.start_time)}`, ...(notes ? [`Notes: ${notes}`] : [])],
        })
        return proposed(actionId, summary)
      }
    }
    return null
  } catch (e) {
    console.error('Genie action tool failed', name, e)
    return err('Something went wrong with that request.')
  }
}

// ---------------------------------------------------------------- carry out a confirmed action

const friendly = (e: { message?: string } | null, fallback: string) => {
  const m = e?.message ?? ''
  if (/permission|row-level security|42501/i.test(m)) return 'You do not have permission to do this (it may need two-step sign-in).'
  return m && m.length < 160 && !/violates|syntax|column|relation/i.test(m) ? m : fallback
}

export async function performAction(
  action: { tool: string; args: Record<string, unknown> },
  ctx: { orgId: string; userId: string; userClient: Db },
): Promise<ActionOutcome> {
  const a = action.args
  const db = ctx.userClient
  switch (action.tool) {
    case 'create_locum_shift': {
      const { data, error } = await db
        .from('ps_locum_shifts')
        .insert({
          org_id: ctx.orgId,
          created_by: ctx.userId,
          date: a.date,
          start_time: `${a.start_time}:00`,
          end_time: `${a.end_time}:00`,
          rate_per_hour: a.rate_per_hour,
          booking_mode: a.booking_mode,
          payment_mode: 'external',
          status: 'open',
          notes: a.notes || null,
        })
        .select('id')
        .single()
      if (error) return { ok: false, message: friendly(error, 'The shift could not be created.') }
      return { ok: true, message: 'Shift created and open to locums.', link: `/shifts/${data.id}` }
    }
    case 'update_locum_shift': {
      const changes: Record<string, unknown> = { ...(a.changes as Record<string, unknown>), updated_at: new Date().toISOString() }
      if (typeof changes.start_time === 'string') changes.start_time = `${changes.start_time}:00`
      if (typeof changes.end_time === 'string') changes.end_time = `${changes.end_time}:00`
      if (changes.notes === '') changes.notes = null
      const { data, error } = await db
        .from('ps_locum_shifts')
        .update(changes)
        .eq('id', a.shift_id)
        .eq('org_id', ctx.orgId)
        .eq('status', 'open')
        .select('id')
      if (error) return { ok: false, message: friendly(error, 'The shift could not be changed.') }
      if (!data?.length) return { ok: false, message: 'The shift is no longer open, so it was not changed.' }
      return { ok: true, message: 'Shift updated.', link: `/shifts/${a.shift_id}` }
    }
    case 'cancel_locum_shift': {
      const { error } = await db.rpc('ps_org_cancel_shift', { p_shift_id: a.shift_id, p_reason: a.reason || null })
      if (error) return { ok: false, message: friendly(error, 'The shift could not be cancelled.') }
      return { ok: true, message: 'Shift cancelled.', link: `/shifts/${a.shift_id}` }
    }
    case 'review_locum_application': {
      const { error } = await db.rpc('ps_org_review_booking', {
        p_booking_id: a.booking_id,
        p_action: a.decision,
        p_reason: a.reason || null,
      })
      if (error) return { ok: false, message: friendly(error, 'The application could not be updated.') }
      return { ok: true, message: a.decision === 'approve' ? 'Locum approved and booked.' : 'Application rejected.', link: '/shifts' }
    }
    case 'create_appointment_slots': {
      const d = a.date as string
      const start = minutes(a.start_time as string)
      const end = minutes(a.end_time as string)
      const length = a.slot_minutes as number
      const rows = []
      for (let t = start; t + length <= end; t += length) {
        const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        rows.push({
          org_id: ctx.orgId,
          service_id: a.service_id,
          start_time: ukToIso(d, hhmm(t)),
          end_time: ukToIso(d, hhmm(t + length)),
          max_bookings: a.max_bookings,
          is_active: true,
        })
      }
      const { error } = await db.from('ps_appointment_slots').insert(rows)
      if (error) return { ok: false, message: friendly(error, 'The slots could not be added.') }
      return { ok: true, message: `${rows.length} slot${rows.length === 1 ? '' : 's'} added.`, link: `/appointments/slots/${a.service_id}` }
    }
    case 'set_appointment_status': {
      const { data, error } = await db
        .from('ps_appointments')
        .update({ status: a.status, ...(a.status === 'cancelled' ? { cancelled_by: 'pharmacy' } : {}) })
        .eq('id', a.appointment_id)
        .eq('org_id', ctx.orgId)
        .neq('status', 'cancelled')
        .select('id')
      if (error) return { ok: false, message: friendly(error, 'The appointment could not be updated.') }
      if (!data?.length) return { ok: false, message: 'The appointment was already cancelled, so nothing changed.' }
      return { ok: true, message: 'Appointment updated.', link: `/appointments/${a.appointment_id}` }
    }
    case 'reschedule_appointment': {
      const { error } = await db
        .from('ps_appointments')
        .update({ slot_id: a.slot_id })
        .eq('id', a.appointment_id)
        .eq('org_id', ctx.orgId)
      if (error) return { ok: false, message: friendly(error, 'The appointment could not be moved.') }
      return { ok: true, message: 'Appointment moved.', link: `/appointments/${a.appointment_id}` }
    }
    case 'book_appointment': {
      const { data: slot } = await db.from('ps_appointment_slots').select('service_id').eq('id', a.slot_id).maybeSingle()
      const { data, error } = await db
        .from('ps_appointments')
        .insert({
          org_id: ctx.orgId,
          slot_id: a.slot_id,
          service_id: slot?.service_id ?? null,
          patient_id: a.patient_id,
          status: 'confirmed',
          notes: a.notes || null,
          booked_by_user_id: ctx.userId,
          source: 'staff',
        })
        .select('id')
        .single()
      if (error) return { ok: false, message: friendly(error, 'The appointment could not be booked.') }
      return { ok: true, message: 'Appointment booked.', link: `/appointments/${data.id}` }
    }
  }
  return { ok: false, message: 'Genie does not know how to do that.' }
}
