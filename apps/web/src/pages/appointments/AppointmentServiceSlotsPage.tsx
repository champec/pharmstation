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
    setFormError(null)
    setEditingSlotId(null)
  }

  const handleSave = async () => {
    if (!organisation?.id || !serviceId || !formDate) return
    setSaving(true)
    setFormError(null)
    try {
      const startTime = new Date(`${formDate}T${formStartTime}`).toISOString()
      const endTime = new Date(`${formDate}T${formEndTime}`).toISOString()

      if (editingSlotId) {
        await updateSlot(editingSlotId, {
          service_id: serviceId,
          start_time: startTime,
          end_time: endTime,
          max_bookings: formMaxBookings,
          is_recurring: formIsRecurring,
          recurrence_rule: formIsRecurring ? formRecurrenceRule : null,
        })
      } else if (formIsRecurring && formRecurrenceRule) {
        const now = new Date()
        const occurrences = expandRecurrenceDates(new Date(`${formDate}T00:00:00`), formRecurrenceRule)
        const rows = occurrences
          .map((day) => {
            const dateStr = toLocalDateString(day)
            return {
              org_id: organisation.id,
              service_id: serviceId,
              start_time: new Date(`${dateStr}T${formStartTime}`),
              end_time: new Date(`${dateStr}T${formEndTime}`),
            }
          })
          .filter((row) => row.start_time > now)
          .map((row) => ({
            org_id: row.org_id,
            service_id: row.service_id,
            start_time: row.start_time.toISOString(),
            end_time: row.end_time.toISOString(),
            max_bookings: formMaxBookings,
            is_recurring: true,
            recurrence_rule: formRecurrenceRule,
          }))
        if (rows.length === 0) {
          throw new Error('All occurrences would be in the past — check the date and start time.')
        }
        await createSlotsBulk(rows)
      } else {
        if (new Date(startTime) <= new Date()) {
          throw new Error('Start time is in the past — patients can only book future slots.')
        }
        await createSlot({
          org_id: organisation.id,
          service_id: serviceId,
          start_time: startTime,
          end_time: endTime,
          max_bookings: formMaxBookings,
          is_recurring: false,
          recurrence_rule: null,
        })
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
      .filter((slot) => showRecurring || !slot.is_recurring)
      .filter((slot) => {
        const start = new Date(slot.start_time)
        if (fromDate && start < fromDate) return false
        if (toDate && start > toDate) return false
        return true
      })
      .sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime())
  }, [filterFromDate, filterToDate, serviceId, showRecurring, slots])

  const allServiceSlots = useMemo(() => {
    return slots.filter((slot) => slot.service_id === serviceId)
  }, [serviceId, slots])

  const recurringCount = allServiceSlots.filter((slot) => slot.is_recurring).length

  const slotRows = useMemo<SlotRow[]>(() => {
    const singles: SlotRow[] = []
    const recurringGroups = new Map<string, AppointmentSlot[]>()

    for (const slot of serviceSlots) {
      if (!slot.is_recurring || !slot.recurrence_rule) {
        singles.push({ kind: 'single', slot })
        continue
      }

      const groupKey = `${slot.recurrence_rule}::${slot.max_bookings}`
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
                        <span className="ps-badge" style={{ marginRight: 'var(--ps-space-sm)' }}>
                          {row.slots.length} slots
                        </span>
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
          </div>

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

          <div className="form-group">
            <label>Max Bookings</label>
            <input className="ps-input" type="number" min={1} max={100} value={formMaxBookings} onChange={(e) => setFormMaxBookings(Number(e.target.value))} />
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer' }}>
              <input type="checkbox" checked={formIsRecurring} onChange={(e) => setFormIsRecurring(e.target.checked)} disabled={!!editingSlotId} />
              Recurring slot
            </label>
            {editingSlotId && (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)', margin: '4px 0 0' }}>
                Editing only changes this occurrence.
              </p>
            )}
          </div>

          {formIsRecurring && !editingSlotId && (
            <div className="form-group">
              <label>Recurrence Rule (RRULE)</label>
              <select className="ps-input" value={formRecurrenceRule} onChange={(e) => setFormRecurrenceRule(e.target.value)}>
                <option value="">Select pattern…</option>
                <option value="FREQ=DAILY">Daily</option>
                <option value="FREQ=WEEKLY">Weekly</option>
                <option value="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR">Weekdays (Mon–Fri)</option>
                <option value="FREQ=MONTHLY">Monthly</option>
              </select>
              <input
                className="ps-input"
                style={{ marginTop: 'var(--ps-space-xs)' }}
                value={formRecurrenceRule}
                onChange={(e) => setFormRecurrenceRule(e.target.value)}
                placeholder="Or enter custom RRULE..."
              />
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
    </div>
  )
}