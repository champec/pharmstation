import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeMarEntryStatus } from '@pharmstation/types'

const administrationStatuses: Array<{ status: CareHomeMarEntryStatus; label: string }> = [
  { status: 'administered', label: 'Administered' },
  { status: 'refused', label: 'Refused' },
  { status: 'omitted', label: 'Omitted' },
  { status: 'not_available', label: 'Not available' },
  { status: 'away', label: 'Away' },
  { status: 'self_administered', label: 'Self-administered' },
]

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function CareHomeMarChartPage() {
  const navigate = useNavigate()
  const { linkId, cycleId } = useParams<{ linkId: string; cycleId: string }>()
  const { organisation, activeUser, permissions } = useAuthStore()
  const { marCycles, marEntries, loading, saving, error, fetchLinks, selectLink, fetchMarEntries, recordAdministration, clearError } = useCareHomeStore()
  const [selectedDate, setSelectedDate] = useState('')
  const cycle = marCycles.find((item) => item.id === cycleId)
  const dates = useMemo(() => Array.from(new Set(marEntries.map((entry) => entry.administration_date))).sort(), [marEntries])
  const selectedEntries = marEntries.filter((entry) => entry.administration_date === (selectedDate || dates[0]))
  const canAdminister = permissions?.care_home_mar_administer === true

  useEffect(() => {
    const load = async () => {
      if (!organisation?.id || !linkId || !cycleId) return
      await fetchLinks(organisation.id, organisation.organisation_type ?? 'pharmacy')
      await selectLink(linkId)
      await fetchMarEntries(cycleId)
    }
    void load()
  }, [organisation?.id, organisation?.organisation_type, linkId, cycleId, fetchLinks, selectLink, fetchMarEntries])

  useEffect(() => {
    if (!selectedDate && dates[0]) setSelectedDate(dates[0])
  }, [dates, selectedDate])

  return (
    <div className="care-home-page care-home-mar-chart-page">
      <div className="page-header care-home-page-header care-home-no-print">
        <div className="breadcrumbs"><a href="/care-homes?view=mar" onClick={(event) => { event.preventDefault(); navigate('/care-homes?view=mar') }}>MAR charts</a><span className="separator">/</span><span>{cycle ? `${cycle.period_start} to ${cycle.period_end}` : 'Chart'}</span></div>
        <div className="care-home-title-row"><div><p className="care-home-eyebrow">Digital medication administration record</p><h1>{cycle?.resident?.patient ? `${cycle.resident.patient.first_name} ${cycle.resident.patient.last_name}` : 'MAR chart'}</h1><p className="care-home-subtitle">{cycle ? `${cycle.period_start} to ${cycle.period_end}` : 'Loading cycle'} · {cycle?.status ?? ''}</p></div><div className="care-home-heading-actions"><button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate('/care-homes?view=mar')}>Back</button><button className="ps-btn ps-btn-primary" type="button" onClick={() => window.print()}>Print chart</button></div></div>
      </div>

      {error && <div className="auth-error care-home-alert care-home-no-print" role="alert"><span>{error}</span><button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button></div>}
      {loading && marEntries.length === 0 ? <div className="care-home-loading">Loading MAR entries...</div> : (
        <>
          <div className="care-home-date-strip care-home-no-print">{dates.map((date) => <button key={date} type="button" className={selectedDate === date ? 'active' : ''} onClick={() => setSelectedDate(date)}><strong>{displayDate(date)}</strong><span>{marEntries.filter((entry) => entry.administration_date === date && entry.status !== 'planned').length}/{marEntries.filter((entry) => entry.administration_date === date).length}</span></button>)}</div>
          <section className="care-home-digital-rounds care-home-no-print">
            <div className="care-home-section-heading"><div><p>Administration round</p><h2>{selectedDate ? displayDate(selectedDate) : 'No dated entries'}</h2></div></div>
            {selectedEntries.length === 0 ? <div className="care-home-inline-empty">No scheduled medicines for this day.</div> : selectedEntries.map((entry) => <article key={entry.id}><div className="care-home-round-time"><strong>{entry.round_time?.slice(0, 5) ?? 'PRN'}</strong><span className={`ps-badge ${entry.status === 'administered' || entry.status === 'self_administered' ? 'ps-badge-success' : entry.status === 'planned' ? 'ps-badge-muted' : 'ps-badge-warning'}`}>{entry.status.replace('_', ' ')}</span></div><div className="care-home-round-medicine"><h3>{entry.medication_schedule?.patient_medication?.drug_name}</h3><p>{entry.dose} · {entry.medication_schedule?.route || 'Route not set'}</p><small>{entry.medication_schedule?.instructions}</small></div>{canAdminister && activeUser?.id && <div className="care-home-round-actions">{administrationStatuses.map((option) => <button key={option.status} type="button" disabled={saving} className={entry.status === option.status ? 'active' : ''} onClick={() => void recordAdministration(entry.id, option.status, activeUser.id)}>{option.label}</button>)}</div>}</article>)}
          </section>

          <section className="care-home-mar-document">
            <header><div><strong>PharmStation MAR</strong><span>Medication administration record</span></div><div><strong>{cycle?.resident?.patient ? `${cycle.resident.patient.first_name} ${cycle.resident.patient.last_name}` : 'Resident'}</strong><span>Room {cycle?.resident?.room_number ?? '-'}</span></div><div><strong>{cycle?.period_start} to {cycle?.period_end}</strong><span>Status: {cycle?.status}</span></div></header>
            <table><thead><tr><th>Date</th><th>Time</th><th>Medicine</th><th>Dose / route</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{marEntries.map((entry) => <tr key={entry.id}><td>{displayDate(entry.administration_date)}</td><td>{entry.round_time?.slice(0, 5) ?? 'PRN'}</td><td>{entry.medication_schedule?.patient_medication?.drug_name}<small>{entry.medication_schedule?.instructions}</small></td><td>{entry.dose}<small>{entry.medication_schedule?.route}</small></td><td>{entry.status.replace('_', ' ')}</td><td>{entry.administered_at ? new Date(entry.administered_at).toLocaleString('en-GB') : '-'}</td></tr>)}</tbody></table>
          </section>
        </>
      )}
    </div>
  )
}