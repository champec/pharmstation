import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useAppointmentStore, useServiceStore } from '@pharmstation/core'
import type { AppointmentSlot } from '@pharmstation/types'
import { Modal } from '../../components/Modal'
import { expandRecurrenceDates, toLocalDateString, RECURRENCE_HORIZON_DAYS } from '../../lib/recurrence'

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function parseDateStart(value: string) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

function parseDateEnd(value: string) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day, 23, 59, 59, 999)
}

interface TimeRange { id: string; start: string; end: string; duration: number; gap: number }
interface ListTimeEntry { id: string; start: string; end: string }

const DAY_OPTIONS: { code: string; label: string }[] = [
  { code: 'MO', label: 'Mon' },
  { code: 'TU', label: 'Tue' },
  { code: 'WE', label: 'Wed' },
  { code: 'TH', label: 'Thu' },
  { code: 'FR', label: 'Fri' },
  { code: 'SA', label: 'Sat' },
  { code: 'SU', label: 'Sun' },
]

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

function toMinutes(time: string) {
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function fromMinutes(mins: number) {
  const h = Math.floor(mins / 60) % 24
  const m = ((mins % 60) + 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function buildRuleFromStructured(freq: 'DAILY' | 'WEEKLY' | 'MONTHLY', interval: number, days: string[]) {
  let rule = `FREQ=${freq}`
  if (interval > 1) rule += `;INTERVAL=${interval}`
  if (freq === 'WEEKLY' && days.length > 0) rule += `;BYDAY=${days.join(',')}`
  return rule
}

/** Grouping key for a recurring series — includes time-of-day so multiple daily series (e.g. a 9am series and a 2pm series) don't collapse into one row. */
function seriesKeyForSlot(slot: AppointmentSlot) {
  const timeOfDay = new Date(slot.start_time).toTimeString().slice(0, 5)
  return `${slot.recurrence_rule}::${slot.max_bookings}::${timeOfDay}`
}

type SlotRow =
  | { kind: 'single'; slot: AppointmentSlot }
  | {
      kind: 'recurring-group'
      key: string
      label: string
      slots: AppointmentSlot[]
      expanded: boolean
    }

export function AppointmentServiceSlotsPage() {
  const { serviceId } = useParams<{ serviceId: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    slots,
    loading,
    error,
    fetchSlots,
    createSlot,
    createSlotsBulk,
    updateSlot,
    deleteSlot,
    clearError,
  } = useAppointmentStore()
  const { services, fetchServices } = useServiceStore()

  const [showModal, setShowModal] = useState(false)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null)
  const [formDate, setFormDate] = useState('')
  const [formStartTime, setFormStartTime] = useState('09:00')
  const [formEndTime, setFormEndTime] = useState('09:30')
  const [formMaxBookings, setFormMaxBookings] = useState(1)
  const [formIsRecurring, setFormIsRecurring] = useState(false)
  const [formRecurrenceRule, setFormRecurrenceRule] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [filterFromDate, setFilterFromDate] = useState(() => toDateInputValue(new Date()))
  const [filterToDate, setFilterToDate] = useState('')
  const [showRecurring, setShowRecurring] = useState(false)

  const [formFrequency, setFormFrequency] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY')
  const [formInterval, setFormInterval] = useState(1)
  const [formSelectedDays, setFormSelectedDays] = useState<string[]>([])
  const [formRuleOverride, setFormRuleOverride] = useState('')
  const [formTimeMode, setFormTimeMode] = useState<'single' | 'interval' | 'list'>('single')
  const [timeRanges, setTimeRanges] = useState<TimeRange[]>([{ id: makeId(), start: '09:00', end: '17:00', duration: 30, gap: 0 }])
  const [listTimes, setListTimes] = useState<ListTimeEntry[]>([{ id: makeId(), start: '09:00', end: '09:30' }])

  const [showSeriesModal, setShowSeriesModal] = useState(false)
  const [editingSeriesKey, setEditingSeriesKey] = useState<string | null>(null)
  const [seriesStartTime, setSeriesStartTime] = useState('09:00')
  const [seriesEndTime, setSeriesEndTime] = useState('09:30')
  const [seriesMaxBookings, setSeriesMaxBookings] = useState(1)
  const [seriesFutureOnly, setSeriesFutureOnly] = useState(true)
  const [seriesSaving, setSeriesSaving] = useState(false)
  const [seriesFormError, setSeriesFormError] = useState<string | null>(null)
  const [seriesOccurrenceCount, setSeriesOccurrenceCount] = useState(0)

  const load = useCallback(() => {
    if (organisation?.id) {
      fetchSlots(organisation.id)
      fetchServices(organisation.id)
    }
  }, [organisation?.id, fetchSlots, fetchServices])

  useEffect(() => { load() }, [load])

  const service = services.find((item) => item.id === serviceId)

  const resetForm = () => {
    setFormDate('')
    setFormStartTime('09:00')
    setFormEndTime('09:30')
    setFormMaxBookings(1)
    setFormIsRecurring(false)
    setFormRecurrenceRule('')
    setFormFrequency('WEEKLY')
    setFormInterval(1)
    setFormSelectedDays([])
    setFormRuleOverride('')
    setFormTimeMode('single')
    setTimeRanges([{ id: makeId(), start: '09:00', end: '17:00', duration: 30, gap: 0 }])
    setListTimes([{ id: makeId(), start: '09:00', end: '09:30' }])
    setFormError(null)
    setEditingSlotId(null)
  }

  const toggleFormDay = (code: string) => {
    setFormSelectedDays((prev) => (prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]))
  }

  const addTimeRange = () => setTimeRanges((prev) => [...prev, { id: makeId(), start: '09:00', end: '17:00', duration: 30, gap: 0 }])
  const removeTimeRange = (id: string) => setTimeRanges((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev))
  const updateTimeRange = (id: string, patch: Partial<TimeRange>) => setTimeRanges((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const addListTime = () => setListTimes((prev) => [...prev, { id: makeId(), start: '09:00', end: '09:30' }])
  const removeListTime = (id: string) => setListTimes((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev))
  const updateListTime = (id: string, patch: Partial<ListTimeEntry>) => setListTimes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const generateDailyTimes = useCallback((): { start: string; end: string }[] => {
    if (formTimeMode === 'single') {
      return [{ start: formStartTime, end: formEndTime }]
    }
    if (formTimeMode === 'interval') {
      const out: { start: string; end: string }[] = []
      for (const range of timeRanges) {
        const startMin = toMinutes(range.start)
        const endMin = toMinutes(range.end)
        const duration = Math.max(1, range.duration || 0)
        const gap = Math.max(0, range.gap || 0)
        let cur = startMin
        while (cur + duration <= endMin) {
          out.push({ start: fromMinutes(cur), end: fromMinutes(cur + duration) })
          cur += duration + gap
        }
      }
      return out
    }
    return listTimes.map((entry) => ({ start: entry.start, end: entry.end }))
  }, [formTimeMode, formStartTime, formEndTime, timeRanges, listTimes])

  const handleSave = async () => {
    if (!organisation?.id || !serviceId || !formDate) return
    setSaving(true)
    setFormError(null)
    try {
      if (editingSlotId) {
        const startTime = new Date(`${formDate}T${formStartTime}`).toISOString()
        const endTime = new Date(`${formDate}T${formEndTime}`).toISOString()
        await updateSlot(editingSlotId, {
          service_id: serviceId,
          start_time: startTime,
          end_time: endTime,
          max_bookings: formMaxBookings,
          is_recurring: formIsRecurring,
          recurrence_rule: formIsRecurring ? formRecurrenceRule : null,
        })
      } else {
        const now = new Date()
        const dailyTimes = generateDailyTimes()
        if (dailyTimes.length === 0) {
          throw new Error('Add at least one time slot.')
        }
        for (const t of dailyTimes) {
          if (t.end <= t.start) {
            throw new Error('Each time slot must end after it starts.')
          }
        }

        const effectiveRule = formIsRecurring
          ? (formRuleOverride.trim() || buildRuleFromStructured(formFrequency, formInterval, formSelectedDays))
          : null
        const dates = formIsRecurring && effectiveRule
          ? expandRecurrenceDates(new Date(`${formDate}T00:00:00`), effectiveRule)
          : [new Date(`${formDate}T00:00:00`)]

        const rows = dates
          .flatMap((day) => {
            const dateStr = toLocalDateString(day)
            return dailyTimes.map((t) => ({
              org_id: organisation.id,
              service_id: serviceId,
              start_time: new Date(`${dateStr}T${t.start}`),
              end_time: new Date(`${dateStr}T${t.end}`),
            }))
          })
          .filter((row) => row.start_time > now)
          .map((row) => ({
            org_id: row.org_id,
            service_id: row.service_id,
            start_time: row.start_time.toISOString(),
            end_time: row.end_time.toISOString(),
            max_bookings: formMaxBookings,
            is_recurring: formIsRecurring,
            recurrence_rule: effectiveRule,
          }))

        if (rows.length === 0) {
          throw new Error('All occurrences would be in the past — check the date and times.')
        }
        if (rows.length === 1) {
          await createSlot(rows[0])
        } else {
          await createSlotsBulk(rows)
        }
      }
      setShowModal(false)
      resetForm()
      fetchSlots(organisation.id)
    } catch (e: any) {
      setFormError(e.message)
    }
    setSaving(false)
  }

  const handleDeactivate = async (slotId: string) => {
    if (!confirm('Deactivate this slot? It will no longer accept bookings.')) return
    try {
      await deleteSlot(slotId)
    } catch (e: any) {
      alert(e.message)
    }
  }

  const openEdit = (slot: AppointmentSlot) => {
    const start = new Date(slot.start_time)
    const end = new Date(slot.end_time)
    setEditingSlotId(slot.id)
    setFormDate(start.toISOString().split('T')[0])
    setFormStartTime(start.toTimeString().slice(0, 5))
    setFormEndTime(end.toTimeString().slice(0, 5))
    setFormMaxBookings(slot.max_bookings)
    setFormIsRecurring(slot.is_recurring)
    setFormRecurrenceRule(slot.recurrence_rule || '')
    setFormError(null)
    setShowModal(true)
  }

  const serviceSlots = useMemo(() => {
    const fromDate = parseDateStart(filterFromDate)
    const toDate = parseDateEnd(filterToDate)

    return slots
      .filter((slot) => slot.service_id === serviceId)
      .filter((slot) => {
        const start = new Date(slot.start_time)
        if (fromDate && start < fromDate) return false
        if (toDate && start > toDate) return false
        return true
      })
      .sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime())
  }, [filterFromDate, filterToDate, serviceId, slots])

  const allServiceSlots = useMemo(() => {
    return slots.filter((slot) => slot.service_id === serviceId)
  }, [serviceId, slots])

  const getSeriesSlots = useCallback((groupKey: string) => {
    return allServiceSlots
      .filter((slot) => slot.is_recurring && slot.recurrence_rule && seriesKeyForSlot(slot) === groupKey)
      .sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime())
  }, [allServiceSlots])

  const openEditSeries = (groupKey: string) => {
    const seriesSlots = getSeriesSlots(groupKey)
    const first = seriesSlots[0]
    if (!first) return
    const start = new Date(first.start_time)
    const end = new Date(first.end_time)
    setEditingSeriesKey(groupKey)
    setSeriesStartTime(start.toTimeString().slice(0, 5))
    setSeriesEndTime(end.toTimeString().slice(0, 5))
    setSeriesMaxBookings(first.max_bookings)
    setSeriesFutureOnly(true)
    setSeriesOccurrenceCount(seriesSlots.length)
    setSeriesFormError(null)
    setShowSeriesModal(true)
  }

  const resetSeriesForm = () => {
    setEditingSeriesKey(null)
    setSeriesStartTime('09:00')
    setSeriesEndTime('09:30')
    setSeriesMaxBookings(1)
    setSeriesFutureOnly(true)
    setSeriesFormError(null)
    setSeriesOccurrenceCount(0)
  }

  const handleSaveSeries = async () => {
    if (!editingSeriesKey || !organisation?.id) return
    setSeriesSaving(true)
    setSeriesFormError(null)
    try {
      const now = new Date()
      let seriesSlots = getSeriesSlots(editingSeriesKey)
      if (seriesFutureOnly) {
        seriesSlots = seriesSlots.filter((slot) => new Date(slot.start_time) > now)
      }
      if (seriesSlots.length === 0) {
        throw new Error('No matching occurrences to update.')
      }
      await Promise.all(seriesSlots.map((slot) => {
        const dateStr = toLocalDateString(new Date(slot.start_time))
        const newStart = new Date(`${dateStr}T${seriesStartTime}`)
        const newEnd = new Date(`${dateStr}T${seriesEndTime}`)
        return updateSlot(slot.id, {
          start_time: newStart.toISOString(),
          end_time: newEnd.toISOString(),
          max_bookings: seriesMaxBookings,
        })
      }))
      setShowSeriesModal(false)
      resetSeriesForm()
      fetchSlots(organisation.id)
    } catch (e: any) {
      setSeriesFormError(e.message)
    }
    setSeriesSaving(false)
  }

  const recurringCount = allServiceSlots.filter((slot) => slot.is_recurring).length

  const slotRows = useMemo<SlotRow[]>(() => {
    const singles: SlotRow[] = []
    const recurringGroups = new Map<string, AppointmentSlot[]>()

    for (const slot of serviceSlots) {
      if (!slot.is_recurring || !slot.recurrence_rule) {
        singles.push({ kind: 'single', slot })
        continue
      }

      const groupKey = seriesKeyForSlot(slot)
      const group = recurringGroups.get(groupKey) || []
      group.push(slot)
      recurringGroups.set(groupKey, group)
    }

    const rows: SlotRow[] = [...singles]

    for (const [key, slotsInGroup] of recurringGroups.entries()) {
      const sortedSlots = slotsInGroup.slice().sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime())
      const first = sortedSlots[0]
      const summaryStart = first ? formatDateTime(first.start_time) : 'Recurring slots'
      const summaryEnd = first ? formatDateTime(first.end_time) : ''
      rows.push({
        kind: 'recurring-group',
        key,
        label: `${summaryStart}${summaryEnd ? ` - ${summaryEnd}` : ''}`,
        slots: sortedSlots,
        expanded: showRecurring,
      })
    }

    return rows.sort((left, right) => {
      const leftDate = left.kind === 'single' ? left.slot.start_time : left.slots[0]?.start_time || ''
      const rightDate = right.kind === 'single' ? right.slot.start_time : right.slots[0]?.start_time || ''
      return new Date(leftDate).getTime() - new Date(rightDate).getTime()
    })
  }, [serviceSlots, showRecurring])

  if (!loading && !service) {
    return (
      <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
        <h2>Service not found</h2>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments/slots')}>Back to Services</button>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/appointments" onClick={(e) => { e.preventDefault(); navigate('/appointments') }}>Appointments</a>
          <span className="separator">/</span>
          <a href="/appointments/slots" onClick={(e) => { e.preventDefault(); navigate('/appointments/slots') }}>Slots</a>
          <span className="separator">/</span>
          <span>{service?.name || 'Service'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>⏰ {service?.name || 'Service'} Slots</h1>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              Focus on one service at a time. Recurring slots collapse into a series row and expand into their individual occurrences.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments/slots')}>
              All Services
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => { resetForm(); setShowModal(true) }}>
              + Create Slot
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)' }}>
          <div><strong>{allServiceSlots.length}</strong><div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>total slots</div></div>
          <div><strong>{recurringCount}</strong><div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>recurring</div></div>
          <div><strong>{allServiceSlots.length - recurringCount}</strong><div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>one-off</div></div>
          <div><strong>{serviceSlots.length}</strong><div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>shown now</div></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--ps-space-sm)', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            <span>From date</span>
            <input className="ps-input" type="date" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 6, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            <span>To date</span>
            <input className="ps-input" type="date" value={filterToDate} onChange={(e) => setFilterToDate(e.target.value)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', paddingBottom: 'var(--ps-space-xs)' }}>
            <input type="checkbox" checked={showRecurring} onChange={(e) => setShowRecurring(e.target.checked)} />
            Expand recurring slots
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-ghost" onClick={() => { setFilterFromDate(toDateInputValue(new Date())); setFilterToDate(''); setShowRecurring(false) }}>
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {loading && allServiceSlots.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading slots...</div>
      )}

      {!loading && slotRows.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>⏰</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No slots in this view</h2>
          <p style={{ color: 'var(--ps-slate)', margin: '0 auto var(--ps-space-lg)', maxWidth: 460 }}>
            Try widening the date range or turn on recurring occurrences if you want to inspect those specific generated slots.
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => { resetForm(); setShowModal(true) }}>
            + Create Slot
          </button>
        </div>
      )}

      {slotRows.length > 0 && (
        <div className="ps-card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--ps-off-white)' }}>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>Start</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>End</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center', color: 'var(--ps-slate)' }}>Max</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center', color: 'var(--ps-slate)' }}>Booked</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center', color: 'var(--ps-slate)' }}>Type</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right', color: 'var(--ps-slate)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {slotRows.map((row) => {
                if (row.kind === 'single') {
                  const slot = row.slot
                  return (
                    <tr key={slot.id} style={{ borderBottom: '1px solid var(--ps-off-white)' }}>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>{formatDateTime(slot.start_time)}</td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>{formatDateTime(slot.end_time)}</td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>{slot.max_bookings}</td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                        <span className={`ps-badge ${slot.booked_count >= slot.max_bookings ? 'ps-badge-red' : 'ps-badge-green'}`}>
                          {slot.booked_count}/{slot.max_bookings}
                        </span>
                      </td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                        One-off
                      </td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', justifyContent: 'flex-end' }}>
                          <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => openEdit(slot)}>
                            ✏️ Edit
                          </button>
                          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => handleDeactivate(slot.id)} style={{ color: 'var(--ps-error)' }}>
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                return (
                  <>
                    <tr
                      key={row.key}
                      style={{ borderBottom: '1px solid var(--ps-off-white)', background: row.expanded ? 'rgba(37, 123, 180, 0.06)' : 'transparent' }}
                    >
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 600 }}>
                        {row.label}
                        <div style={{ color: 'var(--ps-slate)', fontWeight: 400, fontSize: 'var(--ps-font-xs)' }}>
                          {row.slots.length} recurring occurrences
                        </div>
                      </td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                        {row.slots[0] ? formatDateTime(row.slots[0].end_time) : '—'}
                      </td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>{row.slots[0]?.max_bookings || 0}</td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                        <span className="ps-badge ps-badge-blue">Recurring</span>
                      </td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                        {row.expanded ? 'Expanded' : 'Collapsed'}
                      </td>
                      <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', justifyContent: 'flex-end', alignItems: 'center' }}>
                          <span className="ps-badge">
                            {row.slots.length} slots
                          </span>
                          <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => openEditSeries(row.key)}>
                            ✏️ Edit Series
                          </button>
                        </div>
                      </td>
                    </tr>
                    {row.expanded && row.slots.map((slot) => (
                      <tr key={slot.id} style={{ borderBottom: '1px solid var(--ps-off-white)', background: 'rgba(37, 123, 180, 0.03)' }}>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', paddingLeft: 'var(--ps-space-xl)' }}>
                          {formatDateTime(slot.start_time)}
                          <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>Occurrence</div>
                        </td>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>{formatDateTime(slot.end_time)}</td>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>{slot.max_bookings}</td>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                          <span className={`ps-badge ${slot.booked_count >= slot.max_bookings ? 'ps-badge-red' : 'ps-badge-green'}`}>
                            {slot.booked_count}/{slot.max_bookings}
                          </span>
                        </td>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                          <span className="ps-badge ps-badge-blue">Recurring</span>
                        </td>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', justifyContent: 'flex-end' }}>
                            <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => openEdit(slot)}>
                              ✏️ Edit
                            </button>
                            <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => handleDeactivate(slot.id)} style={{ color: 'var(--ps-error)' }}>
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); resetForm() }}
        title={editingSlotId ? 'Edit Slot' : `Create ${service?.name || ''} Slot`}
      >
        <div>
          {formError && (
            <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{formError}</div>
          )}

          <div className="form-group">
            <label>Service</label>
            <div className="ps-input" style={{ display: 'flex', alignItems: 'center', minHeight: 42, background: 'var(--ps-off-white)' }}>
              {service?.name || 'Selected service'}
            </div>
          </div>

          <div className="form-group">
            <label>Date *</label>
            <input className="ps-input" type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
            {formIsRecurring && !editingSlotId && (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)', margin: '4px 0 0' }}>
                Used as the start date for the repeat pattern below.
              </p>
            )}
          </div>

          {editingSlotId ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
              <div className="form-group">
                <label>Start Time *</label>
                <input className="ps-input" type="time" value={formStartTime} onChange={(e) => setFormStartTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label>End Time *</label>
                <input className="ps-input" type="time" value={formEndTime} onChange={(e) => setFormEndTime(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label>Time Pattern</label>
              <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
                <button type="button" className={`ps-btn ps-btn-sm ${formTimeMode === 'single' ? 'ps-btn-primary' : 'ps-btn-secondary'}`} onClick={() => setFormTimeMode('single')}>
                  Single time
                </button>
                <button type="button" className={`ps-btn ps-btn-sm ${formTimeMode === 'interval' ? 'ps-btn-primary' : 'ps-btn-secondary'}`} onClick={() => setFormTimeMode('interval')}>
                  Repeat every N mins
                </button>
                <button type="button" className={`ps-btn ps-btn-sm ${formTimeMode === 'list' ? 'ps-btn-primary' : 'ps-btn-secondary'}`} onClick={() => setFormTimeMode('list')}>
                  List specific times
                </button>
              </div>

              {formTimeMode === 'single' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Start Time *</label>
                    <input className="ps-input" type="time" value={formStartTime} onChange={(e) => setFormStartTime(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>End Time *</label>
                    <input className="ps-input" type="time" value={formEndTime} onChange={(e) => setFormEndTime(e.target.value)} />
                  </div>
                </div>
              )}

              {formTimeMode === 'interval' && (
                <div>
                  {timeRanges.map((range) => (
                    <div key={range.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px 90px 28px', gap: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-xs)', alignItems: 'end' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>From</label>
                        <input className="ps-input" type="time" value={range.start} onChange={(e) => updateTimeRange(range.id, { start: e.target.value })} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>To</label>
                        <input className="ps-input" type="time" value={range.end} onChange={(e) => updateTimeRange(range.id, { end: e.target.value })} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Length (min)</label>
                        <input className="ps-input" type="number" min={5} max={480} value={range.duration} onChange={(e) => updateTimeRange(range.id, { duration: Number(e.target.value) })} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Gap (min)</label>
                        <input className="ps-input" type="number" min={0} max={480} value={range.gap} onChange={(e) => updateTimeRange(range.id, { gap: Number(e.target.value) })} />
                      </div>
                      <button
                        type="button"
                        className="ps-btn ps-btn-ghost ps-btn-sm"
                        onClick={() => removeTimeRange(range.id)}
                        disabled={timeRanges.length <= 1}
                        style={{ color: 'var(--ps-error)' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={addTimeRange}>
                    + Add another time range
                  </button>
                  <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)', margin: '4px 0 0' }}>
                    Add a second range (e.g. 13:00–17:00) to skip a lunch break.
                  </p>
                </div>
              )}

              {formTimeMode === 'list' && (
                <div>
                  {listTimes.map((entry) => (
                    <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 28px', gap: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-xs)', alignItems: 'end' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Start</label>
                        <input className="ps-input" type="time" value={entry.start} onChange={(e) => updateListTime(entry.id, { start: e.target.value })} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>End</label>
                        <input className="ps-input" type="time" value={entry.end} onChange={(e) => updateListTime(entry.id, { end: e.target.value })} />
                      </div>
                      <button
                        type="button"
                        className="ps-btn ps-btn-ghost ps-btn-sm"
                        onClick={() => removeListTime(entry.id)}
                        disabled={listTimes.length <= 1}
                        style={{ color: 'var(--ps-error)' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={addListTime}>
                    + Add another time
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <label>Max Bookings</label>
            <input className="ps-input" type="number" min={1} max={100} value={formMaxBookings} onChange={(e) => setFormMaxBookings(Number(e.target.value))} />
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer' }}>
              <input type="checkbox" checked={formIsRecurring} onChange={(e) => setFormIsRecurring(e.target.checked)} disabled={!!editingSlotId} />
              Repeat across multiple days
            </label>
            {editingSlotId && (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)', margin: '4px 0 0' }}>
                Editing only changes this occurrence.
              </p>
            )}
          </div>

          {formIsRecurring && !editingSlotId && (
            <div className="form-group">
              <label>Repeat Pattern</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-sm)' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Frequency</label>
                  <select className="ps-input" value={formFrequency} onChange={(e) => setFormFrequency(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')}>
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Every</label>
                  <input
                    className="ps-input"
                    type="number"
                    min={1}
                    max={52}
                    value={formInterval}
                    onChange={(e) => setFormInterval(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
              </div>

              {formFrequency === 'WEEKLY' && (
                <div style={{ marginBottom: 'var(--ps-space-sm)' }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--ps-space-xs)', flexWrap: 'wrap' }}>
                    {DAY_OPTIONS.map((day) => (
                      <button
                        type="button"
                        key={day.code}
                        className={`ps-btn ps-btn-sm ${formSelectedDays.includes(day.code) ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                        onClick={() => toggleFormDay(day.code)}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', flexWrap: 'wrap' }}>
                    <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setFormSelectedDays(['MO', 'TU', 'WE', 'TH', 'FR'])}>
                      Weekdays
                    </button>
                    <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setFormSelectedDays(['SA', 'SU'])}>
                      Weekends
                    </button>
                    <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setFormSelectedDays(DAY_OPTIONS.map((d) => d.code))}>
                      Every day
                    </button>
                    <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setFormSelectedDays([])}>
                      Clear (same weekday only)
                    </button>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Advanced RRULE override (optional)</label>
                <input
                  className="ps-input"
                  value={formRuleOverride}
                  onChange={(e) => setFormRuleOverride(e.target.value)}
                  placeholder="Leave blank to use the pattern above, or enter a custom RRULE..."
                />
              </div>

              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)', margin: '4px 0 0' }}>
                Individual bookable slots will be created for the next {RECURRENCE_HORIZON_DAYS / 7} weeks
                (past occurrences are skipped).
              </p>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => { setShowModal(false); resetForm() }} disabled={saving}>
              Cancel
            </button>
            <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving || !formDate}>
              {saving ? 'Saving…' : editingSlotId ? 'Update Slot' : 'Create Slot'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showSeriesModal}
        onClose={() => { setShowSeriesModal(false); resetSeriesForm() }}
        title="Edit Recurring Series"
      >
        <div>
          {seriesFormError && (
            <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{seriesFormError}</div>
          )}

          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', margin: '0 0 var(--ps-space-md)' }}>
            This updates the time and capacity for every occurrence in this recurring series ({seriesOccurrenceCount} total occurrence{seriesOccurrenceCount === 1 ? '' : 's'}). Dates stay the same — only the time of day and max bookings change.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
            <div className="form-group">
              <label>Start Time *</label>
              <input className="ps-input" type="time" value={seriesStartTime} onChange={(e) => setSeriesStartTime(e.target.value)} />
            </div>
            <div className="form-group">
              <label>End Time *</label>
              <input className="ps-input" type="time" value={seriesEndTime} onChange={(e) => setSeriesEndTime(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>Max Bookings</label>
            <input className="ps-input" type="number" min={1} max={100} value={seriesMaxBookings} onChange={(e) => setSeriesMaxBookings(Number(e.target.value))} />
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer' }}>
              <input type="checkbox" checked={seriesFutureOnly} onChange={(e) => setSeriesFutureOnly(e.target.checked)} />
              Only apply to upcoming occurrences
            </label>
            <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)', margin: '4px 0 0' }}>
              Leave this checked to avoid rewriting occurrences that have already passed.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => { setShowSeriesModal(false); resetSeriesForm() }} disabled={seriesSaving}>
              Cancel
            </button>
            <button className="ps-btn ps-btn-primary" onClick={handleSaveSeries} disabled={seriesSaving}>
              {seriesSaving ? 'Saving…' : 'Update Series'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}