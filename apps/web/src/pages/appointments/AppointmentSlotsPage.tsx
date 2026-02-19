import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppointmentStore, useServiceStore } from '@pharmstation/core'
import type { Service } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

export function AppointmentSlotsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    slots,
    loading,
    error,
    fetchSlots,
    createSlot,
    updateSlot,
    deleteSlot,
    clearError,
  } = useAppointmentStore()
  const { services, fetchServices } = useServiceStore()

  const [showModal, setShowModal] = useState(false)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null)

  // Form state
  const [formServiceId, setFormServiceId] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formStartTime, setFormStartTime] = useState('09:00')
  const [formEndTime, setFormEndTime] = useState('09:30')
  const [formMaxBookings, setFormMaxBookings] = useState(1)
  const [formIsRecurring, setFormIsRecurring] = useState(false)
  const [formRecurrenceRule, setFormRecurrenceRule] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Filters
  const [filterService, setFilterService] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const load = useCallback(() => {
    if (organisation?.id) {
      fetchSlots(organisation.id)
      fetchServices(organisation.id)
    }
  }, [organisation?.id, fetchSlots, fetchServices])

  useEffect(() => { load() }, [load])

  const resetForm = () => {
    setFormServiceId('')
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
    if (!organisation?.id || !formServiceId || !formDate) return
    setSaving(true)
    setFormError(null)
    try {
      const startTime = new Date(`${formDate}T${formStartTime}`).toISOString()
      const endTime = new Date(`${formDate}T${formEndTime}`).toISOString()

      if (editingSlotId) {
        await updateSlot(editingSlotId, {
          service_id: formServiceId,
          start_time: startTime,
          end_time: endTime,
          max_bookings: formMaxBookings,
          is_recurring: formIsRecurring,
          recurrence_rule: formIsRecurring ? formRecurrenceRule : null,
        })
      } else {
        await createSlot({
          org_id: organisation.id,
          service_id: formServiceId,
          start_time: startTime,
          end_time: endTime,
          max_bookings: formMaxBookings,
          is_recurring: formIsRecurring,
          recurrence_rule: formIsRecurring ? formRecurrenceRule : null,
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

  const openEdit = (slot: any) => {
    const start = new Date(slot.start_time)
    const end = new Date(slot.end_time)
    setEditingSlotId(slot.id)
    setFormServiceId(slot.service_id)
    setFormDate(start.toISOString().split('T')[0])
    setFormStartTime(start.toTimeString().slice(0, 5))
    setFormEndTime(end.toTimeString().slice(0, 5))
    setFormMaxBookings(slot.max_bookings)
    setFormIsRecurring(slot.is_recurring)
    setFormRecurrenceRule(slot.recurrence_rule || '')
    setFormError(null)
    setShowModal(true)
  }

  const filteredSlots = slots.filter((s) => {
    if (filterService && s.service_id !== filterService) return false
    return true
  })

  const formatDateTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/appointments" onClick={(e) => { e.preventDefault(); navigate('/appointments') }}>Appointments</a>
          <span className="separator">/</span>
          <span>Slots</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>⏰ Appointment Slots</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => { resetForm(); setShowModal(true) }}>
            + Create Slot
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)', alignItems: 'center' }}>
        <select
          className="ps-input"
          style={{ width: 'auto', minWidth: 180 }}
          value={filterService}
          onChange={(e) => setFilterService(e.target.value)}
        >
          <option value="">All Services</option>
          {services.map((s: Service) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && slots.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading slots…</div>
      )}

      {/* Empty state */}
      {!loading && filteredSlots.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>⏰</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No slots defined</h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)', maxWidth: 400, margin: '0 auto var(--ps-space-lg)' }}>
            Create availability slots so patients can book appointments for your services.
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => { resetForm(); setShowModal(true) }}>
            + Create Slot
          </button>
        </div>
      )}

      {/* Slots table */}
      {filteredSlots.length > 0 && (
        <div className="ps-card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--ps-off-white)' }}>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>Service</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>Start</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>End</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center', color: 'var(--ps-slate)' }}>Max</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center', color: 'var(--ps-slate)' }}>Booked</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center', color: 'var(--ps-slate)' }}>Recurring</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right', color: 'var(--ps-slate)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSlots.map((slot) => {
                const serviceName = (slot as any).service?.name || services.find((s) => s.id === slot.service_id)?.name || '—'
                return (
                  <tr key={slot.id} style={{ borderBottom: '1px solid var(--ps-off-white)' }}>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 500 }}>{serviceName}</td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>{formatDateTime(slot.start_time)}</td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>{formatDateTime(slot.end_time)}</td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>{slot.max_bookings}</td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                      <span className={`ps-badge ${slot.booked_count >= slot.max_bookings ? 'ps-badge-red' : 'ps-badge-green'}`}>
                        {slot.booked_count}/{slot.max_bookings}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                      {slot.is_recurring ? '✓' : '—'}
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
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Slot Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); resetForm() }}
        title={editingSlotId ? 'Edit Slot' : 'Create Availability Slot'}
      >
        <div>
          {formError && (
            <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{formError}</div>
          )}

          <div className="form-group">
            <label>Service *</label>
            <select
              className="ps-input"
              value={formServiceId}
              onChange={(e) => setFormServiceId(e.target.value)}
            >
              <option value="">Select a service…</option>
              {services.filter((s) => s.is_active).map((s: Service) => (
                <option key={s.id} value={s.id}>{s.name} ({s.duration_minutes} min)</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Date *</label>
            <input
              className="ps-input"
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
            <div className="form-group">
              <label>Start Time *</label>
              <input
                className="ps-input"
                type="time"
                value={formStartTime}
                onChange={(e) => setFormStartTime(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>End Time *</label>
              <input
                className="ps-input"
                type="time"
                value={formEndTime}
                onChange={(e) => setFormEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Max Bookings</label>
            <input
              className="ps-input"
              type="number"
              min={1}
              max={100}
              value={formMaxBookings}
              onChange={(e) => setFormMaxBookings(Number(e.target.value))}
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={formIsRecurring}
                onChange={(e) => setFormIsRecurring(e.target.checked)}
              />
              Recurring slot
            </label>
          </div>

          {formIsRecurring && (
            <div className="form-group">
              <label>Recurrence Rule (RRULE)</label>
              <select
                className="ps-input"
                value={formRecurrenceRule}
                onChange={(e) => setFormRecurrenceRule(e.target.value)}
              >
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
                placeholder="Or enter custom RRULE…"
              />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => { setShowModal(false); resetForm() }} disabled={saving}>
              Cancel
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={handleSave}
              disabled={saving || !formServiceId || !formDate}
            >
              {saving ? 'Saving…' : editingSlotId ? 'Update Slot' : 'Create Slot'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
