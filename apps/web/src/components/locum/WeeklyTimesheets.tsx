import { useCallback, useEffect, useMemo, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { CalendarClock } from 'lucide-react'
import { EmptyState } from '../ui'

/**
 * Weekly timesheets for locum shifts (Mon–Sun). One sheet per pharmacy (locum
 * view) or per locum (pharmacy view), listing completed shifts with the
 * booked hours, the actual sign-in/out times and the amount due at the agreed
 * rate. While pharmacies pay locums directly, this is what the locum sends
 * with their invoice and what the pharmacy checks it against. Print saves a
 * PDF.
 */

type Mode = { kind: 'locum'; locumId: string } | { kind: 'org'; orgId: string }

interface Row {
  booking_id: string
  locum_id: string
  org_id: string
  date: string
  start_time: string
  end_time: string
  rate_per_hour: number
  signed_in_at: string | null
  signed_out_at: string | null
}

interface Sheet {
  key: string
  title: string
  subtitle: string
  rows: Row[]
}

function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = (x.getUTCDay() + 6) % 7
  x.setUTCDate(x.getUTCDate() - dow)
  return x
}
function iso(d: Date) { return d.toISOString().slice(0, 10) }
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x }
function fmtDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
function fmtLong(date: Date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function fmtClock(ts: string | null) {
  return ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—'
}
/** Booked hours; a shift ending at or before its start runs past midnight. */
function bookedHours(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) mins += 24 * 60
  return mins / 60
}
function actualHours(r: Row) {
  if (!r.signed_in_at || !r.signed_out_at) return null
  return (new Date(r.signed_out_at).getTime() - new Date(r.signed_in_at).getTime()) / 3_600_000
}
function money(n: number) { return `£${n.toFixed(2)}` }

export function WeeklyTimesheets({ mode }: { mode: Mode }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = getUserClient()
    try {
      let query = client
        .from('ps_locum_bookings')
        .select('id, locum_id, status, shift:ps_locum_shifts!inner(org_id, date, start_time, end_time, rate_per_hour), sign_in:ps_locum_sign_ins(signed_in_at, signed_out_at)')
        .eq('status', 'completed')
        .gte('shift.date', iso(weekStart))
        .lte('shift.date', iso(weekEnd))
      query = mode.kind === 'locum' ? query.eq('locum_id', mode.locumId) : query.eq('shift.org_id', mode.orgId)
      const { data, error: qErr } = await query
      if (qErr) throw qErr

      type Raw = {
        id: string; locum_id: string
        shift: Record<string, unknown> | Record<string, unknown>[]
        sign_in: { signed_in_at: string; signed_out_at: string | null } | { signed_in_at: string; signed_out_at: string | null }[] | null
      }
      const rows: Row[] = ((data ?? []) as Raw[]).map((b) => {
        const s = (Array.isArray(b.shift) ? b.shift[0] : b.shift) as Record<string, unknown>
        const si = Array.isArray(b.sign_in) ? b.sign_in[0] ?? null : b.sign_in
        return {
          booking_id: b.id,
          locum_id: b.locum_id,
          org_id: s.org_id as string,
          date: s.date as string,
          start_time: s.start_time as string,
          end_time: s.end_time as string,
          rate_per_hour: Number(s.rate_per_hour),
          signed_in_at: si?.signed_in_at ?? null,
          signed_out_at: si?.signed_out_at ?? null,
        }
      }).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))

      const groups = new Map<string, Row[]>()
      for (const r of rows) {
        const k = mode.kind === 'locum' ? r.org_id : r.locum_id
        groups.set(k, [...(groups.get(k) ?? []), r])
      }
      const keys = [...groups.keys()]
      const names = new Map<string, { title: string; subtitle: string }>()
      if (keys.length > 0) {
        if (mode.kind === 'locum') {
          const { data: orgs } = await client.rpc('ps_locum_shift_orgs', { p_org_ids: keys })
          for (const o of (orgs ?? []) as { id: string; name: string; address: Record<string, string> | null }[]) {
            const a = o.address ?? {}
            names.set(o.id, { title: o.name, subtitle: [a.line_1 ?? a.line1, a.city ?? a.town, a.postcode].filter(Boolean).join(', ') })
          }
        } else {
          const { data: locums } = await client.rpc('ps_org_shift_locums', { p_org_id: mode.orgId, p_locum_ids: keys })
          for (const l of (locums ?? []) as { locum_id: string; full_name: string; gphc_number: string | null }[]) {
            names.set(l.locum_id, { title: l.full_name, subtitle: l.gphc_number ? `GPhC ${l.gphc_number}` : '' })
          }
        }
      }
      setSheets(keys.map((k) => ({
        key: k,
        title: names.get(k)?.title ?? (mode.kind === 'locum' ? 'Pharmacy' : 'Locum'),
        subtitle: names.get(k)?.subtitle ?? '',
        rows: groups.get(k)!,
      })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load timesheets')
    } finally {
      setLoading(false)
    }
  }, [mode.kind, mode.kind === 'locum' ? mode.locumId : mode.orgId, weekStart, weekEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  return (
    <div className="timesheets">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .timesheets, .timesheets * { visibility: visible; }
          .timesheets { position: absolute; left: 0; top: 0; width: 100%; }
          .timesheets .no-print { display: none !important; }
          .timesheet-sheet { break-inside: avoid; page-break-after: always; border: none !important; }
        }
      `}</style>

      <div className="no-print" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Previous week</button>
        <strong>{fmtLong(weekStart)} – {fmtLong(weekEnd)}</strong>
        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week →</button>
        <span style={{ flex: 1 }} />
        {sheets.length > 0 && (
          <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => window.print()}>Print or save as PDF</button>
        )}
      </div>

      {error && <div className="ps-alert ps-alert-error no-print">{error}</div>}
      {loading && <div className="loading-indicator no-print">Loading…</div>}
      {!loading && !error && sheets.length === 0 && (
        <div className="no-print">
          <EmptyState icon={CalendarClock} title="No completed shifts this week">
            Shifts appear here once the locum signs out or the pharmacy confirms the shift was worked.
          </EmptyState>
        </div>
      )}

      {sheets.map((sheet) => {
        const total = sheet.rows.reduce((sum, r) => sum + bookedHours(r.start_time, r.end_time) * r.rate_per_hour, 0)
        const hours = sheet.rows.reduce((sum, r) => sum + bookedHours(r.start_time, r.end_time), 0)
        return (
          <div key={sheet.key} className="ps-card timesheet-sheet" style={{ marginBottom: '1.5rem' }}>
            <div className="ps-card-header" style={{ display: 'block' }}>
              <h2 className="ps-card-title" style={{ marginBottom: 2 }}>Timesheet: {sheet.title}</h2>
              <div className="text-muted" style={{ fontSize: '0.875rem' }}>
                {sheet.subtitle && <>{sheet.subtitle} · </>}Week {fmtLong(weekStart)} – {fmtLong(weekEnd)}
              </div>
            </div>
            <table className="ps-table ps-table-stack">
              <thead>
                <tr>
                  <th>Date</th><th>Booked</th><th>Signed in</th><th>Signed out</th>
                  <th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => {
                  const h = bookedHours(r.start_time, r.end_time)
                  const actual = actualHours(r)
                  return (
                    <tr key={r.booking_id}>
                      <td>{fmtDay(r.date)}</td>
                      <td>{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</td>
                      <td>{fmtClock(r.signed_in_at)}</td>
                      <td>{fmtClock(r.signed_out_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {h.toFixed(2)}
                        {actual !== null && Math.abs(actual - h) >= 0.25 && (
                          <div className="text-muted" style={{ fontSize: '0.75rem' }}>on site {actual.toFixed(2)}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{money(r.rate_per_hour)}</td>
                      <td style={{ textAlign: 'right' }}>{money(h * r.rate_per_hour)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>Total</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{hours.toFixed(2)}</strong></td>
                  <td />
                  <td style={{ textAlign: 'right' }}><strong>{money(total)}</strong></td>
                </tr>
              </tfoot>
            </table>
            <div className="ps-card-body text-muted" style={{ fontSize: '0.75rem' }}>
              Amounts use the booked hours at the agreed rate. Sign-in and sign-out times are recorded by PharmStation. The pharmacy pays the locum directly.
            </div>
          </div>
        )
      })}
    </div>
  )
}
