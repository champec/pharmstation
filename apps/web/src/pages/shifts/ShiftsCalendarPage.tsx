import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type { EventClickArg } from '@fullcalendar/core'

interface ShiftEvent {
  id: string
  date: string
  start_time: string
  end_time: string
  rate_per_hour: number
  status: string
  booking_mode: string
  notes: string | null
}

const STATUS_COLOURS: Record<string, string> = {
  draft: '#94a3b8',
  open: '#22c55e',
  confirmed: '#3b82f6',
  completed: '#6b7280',
  cancelled: '#ef4444',
}

const STATUS_OPTIONS = ['draft', 'open', 'confirmed', 'completed', 'cancelled']

export function ShiftsCalendarPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()

  const [shifts, setShifts] = useState<ShiftEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')

  const load = useCallback(async () => {
    if (!organisation?.id) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await getUserClient()
        .from('ps_locum_shifts')
        .select('id, date, start_time, end_time, rate_per_hour, status, booking_mode, notes')
        .eq('org_id', organisation.id)
        .order('date')
        .order('start_time')
      if (qErr) throw qErr
      setShifts((data as ShiftEvent[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shifts')
    } finally {
      setLoading(false)
    }
  }, [organisation?.id])

  useEffect(() => { load() }, [load])

  const calendarEvents = useMemo(() => {
    const filtered = filterStatus ? shifts.filter((s) => s.status === filterStatus) : shifts
    return filtered.map((shift) => {
      const start = `${shift.date}T${shift.start_time}`
      const end = `${shift.date}T${shift.end_time}`
      const colour = STATUS_COLOURS[shift.status] ?? '#6b7280'
      const hours = (
        (new Date(end).getTime() - new Date(start).getTime()) / 3600000
      ).toFixed(1)
      return {
        id: shift.id,
        title: `£${Number(shift.rate_per_hour).toFixed(0)}/hr · ${hours}h · ${shift.status}`,
        start,
        end,
        backgroundColor: colour,
        borderColor: colour,
        textColor: '#ffffff',
        extendedProps: { shift },
      }
    })
  }, [shifts, filterStatus])

  const handleEventClick = (info: EventClickArg) => {
    const shift = info.event.extendedProps.shift as ShiftEvent
    navigate(`/shifts/${shift.id}`)
  }

  const handleDateClick = (info: { dateStr: string }) => {
    navigate(`/shifts/new?date=${info.dateStr}`)
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shift Calendar</h1>
          <p className="page-subtitle">All shifts for {organisation?.name ?? 'your pharmacy'}</p>
        </div>
        <div className="page-header-actions">
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>
            Refresh
          </button>
          <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => navigate('/shifts/new')}>
            + Post Shift
          </button>
        </div>
      </div>

      {error && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>
      )}

      {/* Filter */}
      <div style={{ marginBottom: '1rem' }}>
        <select
          className="ps-input"
          style={{ width: 'auto', minWidth: 160 }}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {loading && shifts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--ps-slate)' }}>
          Loading shifts…
        </div>
      )}

      <div className="ps-card" style={{ padding: '1rem' }}>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          events={calendarEvents}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          selectable={true}
          nowIndicator={true}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          height="auto"
          eventDisplay="block"
        />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap', fontSize: 'var(--ps-font-sm)' }}>
        {Object.entries(STATUS_COLOURS).map(([status, colour]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: colour }} />
            <span style={{ textTransform: 'capitalize', color: 'var(--ps-slate)' }}>{status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
