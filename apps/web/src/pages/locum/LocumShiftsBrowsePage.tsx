import { useCallback, useEffect, useMemo, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

interface ShiftWithCriteria {
  id: string
  org_id: string
  date: string
  start_time: string
  end_time: string
  rate_per_hour: number
  booking_mode: string
  status: string
  notes: string | null
  criteria: {
    required_service_ids: string[] | null
    references_required: boolean
    sop_required: boolean
  } | null
}

interface OrgName {
  id: string
  name: string
}

type EligibilityStatus = 'eligible' | 'ineligible' | 'sop_required' | 'applied' | 'clashes'

function fmt(time: string) { return time.slice(0, 5) }
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  eligible: 'Eligible',
  ineligible: 'Ineligible',
  sop_required: 'SOP Review needed',
  applied: 'Applied',
  clashes: 'Clashes',
}

const ELIGIBILITY_BADGE: Record<EligibilityStatus, string> = {
  eligible: 'ps-badge ps-badge-success',
  ineligible: 'ps-badge ps-badge-danger',
  sop_required: 'ps-badge ps-badge-warning',
  applied: 'ps-badge ps-badge-primary',
  clashes: 'ps-badge ps-badge-danger',
}

export function LocumShiftsBrowsePage() {
  const { locumProfile } = useAuthStore()

  const [shifts, setShifts] = useState<ShiftWithCriteria[]>([])
  const [orgNames, setOrgNames] = useState<Record<string, string>>({})
  const [locumServiceIds, setLocumServiceIds] = useState<string[]>([])
  const [appliedShiftIds, setAppliedShiftIds] = useState<string[]>([])
  const [clashingShiftIds, setClashingShiftIds] = useState<string[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  /* Filters */
  const [filterEligible, setFilterEligible] = useState(false)
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterRateMin, setFilterRateMin] = useState('')

  const load = useCallback(async () => {
    if (!locumProfile) return
    const client = getUserClient()
    setLoading(true)
    setError(null)
    const today = new Date().toISOString().split('T')[0]

    try {
      // 1. Locum services
      const { data: svcs } = await client
        .from('ps_locum_services')
        .select('service_library_id')
        .eq('locum_id', locumProfile.id)
      setLocumServiceIds((svcs ?? []).map((s: { service_library_id: string }) => s.service_library_id))

      // 2. Open shifts
      const { data: rawShifts, error: sErr } = await client
        .from('ps_locum_shifts')
        .select('id, org_id, date, start_time, end_time, rate_per_hour, booking_mode, status, notes')
        .eq('status', 'open')
        .gte('date', today)
        .order('date')
        .order('start_time')
      if (sErr) throw sErr

      const shiftList = (rawShifts ?? []) as Omit<ShiftWithCriteria, 'criteria'>[]

      // 3. Criteria for these shifts
      const shiftIds = shiftList.map((s) => s.id)
      let criteriaMap: Record<string, ShiftWithCriteria['criteria']> = {}
      if (shiftIds.length > 0) {
        const { data: crits } = await client
          .from('ps_locum_shift_criteria')
          .select('shift_id, required_service_ids, references_required, sop_required')
          .in('shift_id', shiftIds)
        for (const c of crits ?? []) {
          criteriaMap[c.shift_id] = {
            required_service_ids: c.required_service_ids,
            references_required: c.references_required,
            sop_required: c.sop_required,
          }
        }
      }

      const enriched: ShiftWithCriteria[] = shiftList.map((s) => ({
        ...s,
        criteria: criteriaMap[s.id] ?? null,
      }))
      setShifts(enriched)

      // 4. Already-applied shifts
      const { data: bookings } = await client
        .from('ps_locum_bookings')
        .select('shift_id')
        .eq('locum_id', locumProfile.id)
        .in('shift_id', shiftIds)
        .in('status', ['pending', 'confirmed'])
      setAppliedShiftIds((bookings ?? []).map((b: { shift_id: string }) => b.shift_id))

      // 5. Org names
      const orgIds = [...new Set(shiftList.map((s) => s.org_id))]
      if (orgIds.length > 0) {
        const { data: orgs } = await client
          .from('ps_organisations')
          .select('id, name')
          .in('id', orgIds)
        const map: Record<string, string> = {}
        for (const o of (orgs ?? []) as OrgName[]) map[o.id] = o.name
        setOrgNames(map)
      }

      // 6. Clash detection (batch check for each open shift)
      // We use the RPC function for clash detection
      const clashes: string[] = []
      for (const s of shiftList) {
        const { data: clashResult } = await client.rpc('ps_get_locum_booking_clashes', {
          p_locum_id: locumProfile.id,
          p_date: s.date,
          p_start_time: s.start_time,
          p_end_time: s.end_time,
        })
        if (clashResult && Array.isArray(clashResult) && clashResult.length > 0) {
          clashes.push(s.id)
        }
      }
      setClashingShiftIds(clashes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shifts')
    } finally {
      setLoading(false)
    }
  }, [locumProfile])

  useEffect(() => { load() }, [load])

  /* Eligibility check */
  function getEligibility(shift: ShiftWithCriteria): EligibilityStatus {
    if (appliedShiftIds.includes(shift.id)) return 'applied'
    if (clashingShiftIds.includes(shift.id)) return 'clashes'
    const c = shift.criteria
    if (c?.required_service_ids && c.required_service_ids.length > 0) {
      const hasAll = c.required_service_ids.every((id) => locumServiceIds.includes(id))
      if (!hasAll) return 'ineligible'
    }
    if (c?.sop_required) return 'sop_required'
    return 'eligible'
  }

  /* Filtered shifts */
  const filteredShifts = useMemo(() => {
    let list = shifts
    if (filterDateFrom) list = list.filter((s) => s.date >= filterDateFrom)
    if (filterDateTo) list = list.filter((s) => s.date <= filterDateTo)
    if (filterRateMin) list = list.filter((s) => Number(s.rate_per_hour) >= parseFloat(filterRateMin))
    if (filterEligible) list = list.filter((s) => {
      const e = getEligibility(s)
      return e === 'eligible' || e === 'applied'
    })
    return list
  }, [shifts, filterDateFrom, filterDateTo, filterRateMin, filterEligible, appliedShiftIds, clashingShiftIds, locumServiceIds])

  async function handleApply(shift: ShiftWithCriteria) {
    if (!locumProfile) return
    setApplying(shift.id)
    setApplyError(null)
    try {
      const { error } = await getUserClient().from('ps_locum_bookings').insert({
        shift_id: shift.id,
        locum_id: locumProfile.id,
        status: 'pending',
        applied_at: new Date().toISOString(),
      })
      if (error) throw error
      setAppliedShiftIds((prev) => [...prev, shift.id])
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply')
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Browse Shifts</h1>
          <p className="page-subtitle">Available locum shifts across the network</p>
        </div>
        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {applyError && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{applyError}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="ps-checkbox-label">
          <input type="checkbox" checked={filterEligible} onChange={(e) => setFilterEligible(e.target.checked)} />
          Eligible shifts only
        </label>
        <input className="form-input" type="date" style={{ width: 160 }} value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} placeholder="From date" title="From date" />
        <input className="form-input" type="date" style={{ width: 160 }} value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} placeholder="To date" title="To date" />
        <input className="form-input" type="number" style={{ width: 110 }} value={filterRateMin} onChange={(e) => setFilterRateMin(e.target.value)} placeholder="Min £/hr" title="Minimum rate" min={0} />
        {(filterDateFrom || filterDateTo || filterRateMin || filterEligible) && (
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterRateMin(''); setFilterEligible(false) }}>
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-indicator" style={{ textAlign: 'center', padding: '3rem' }}>Loading shifts…</div>
      ) : filteredShifts.length === 0 ? (
        <div className="empty-state" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">No shifts match your filters.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {filteredShifts.map((shift) => {
            const elig = getEligibility(shift)
            const canApply = elig === 'eligible' || elig === 'sop_required'
            const [sh, sm] = shift.start_time.split(':').map(Number)
            const [eh, em] = shift.end_time.split(':').map(Number)
            const hours = ((eh * 60 + em) - (sh * 60 + sm)) / 60
            const total = (hours * Number(shift.rate_per_hour)).toFixed(2)

            return (
              <div key={shift.id} className="ps-card" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                    <strong>{fmtDate(shift.date)}</strong>
                    <span className="text-muted">·</span>
                    <span>{fmt(shift.start_time)} – {fmt(shift.end_time)}</span>
                    <span className="text-muted">({hours.toFixed(1)}h)</span>
                    <span className={ELIGIBILITY_BADGE[elig]}>{ELIGIBILITY_LABELS[elig]}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--ps-slate)', flexWrap: 'wrap' }}>
                    <span>£{Number(shift.rate_per_hour).toFixed(2)}/hr · £{total} total</span>
                    {orgNames[shift.org_id] && <span>{orgNames[shift.org_id]}</span>}
                    <span className="ps-badge">{shift.booking_mode}</span>
                    {shift.criteria?.references_required && <span className="ps-badge ps-badge-warning">References req.</span>}
                    {shift.criteria?.sop_required && <span className="ps-badge ps-badge-warning">SOP sign-off req.</span>}
                  </div>
                  {shift.notes && (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: 'var(--ps-text-muted)' }}>{shift.notes}</p>
                  )}
                </div>
                <div>
                  {elig === 'applied' ? (
                    <span className="ps-badge ps-badge-primary">Applied</span>
                  ) : canApply ? (
                    <button
                      className="ps-btn ps-btn-primary ps-btn-sm"
                      disabled={applying === shift.id}
                      onClick={() => handleApply(shift)}
                    >
                      {applying === shift.id ? 'Applying…' : 'Apply'}
                    </button>
                  ) : elig === 'clashes' ? (
                    <span className="ps-badge ps-badge-danger">Clash</span>
                  ) : (
                    <span className="ps-badge ps-badge-danger">Not eligible</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
