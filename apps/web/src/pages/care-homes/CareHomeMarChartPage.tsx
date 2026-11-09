import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeMarEntryStatus } from '@pharmstation/types'
import { chLabel, chRange } from './careHomeLabels'

const administrationStatuses: Array<{ status: CareHomeMarEntryStatus; label: string }> = [
  { status: 'administered', label: 'Given' },
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
  const { marCycles, marEntries, loading, saving, error, fetchLinks, selectLink, fetchMarEntries, recordAdministration, publishMarCycle, clearError } = useCareHomeStore()
  const [selectedDate, setSelectedDate] = useState('')
  const cycle = marCycles.find((item) => item.id === cycleId)
  const dates = useMemo(() => Array.from(new Set(marEntries.map((entry) => entry.administration_date))).sort(), [marEntries])
  const selectedEntries = marEntries.filter((entry) => entry.administration_date === (selectedDate || dates[0]))
  const canPublish = organisation?.organisation_type !== 'carehome' && permissions?.care_home_mar_prepare === true && (cycle?.status === 'prepared' || cycle?.status === 'draft')
  // Doses are recorded only on a chart the pharmacy has published.
  const canAdminister = permissions?.care_home_mar_administer === true && cycle?.status === 'published'

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
    // Scopes the care-home print styles in app.css to this page only.
    document.body.setAttribute('data-print-mode', 'care-home')
    return () => {
      document.body.removeAttribute('data-print-mode')
    }
  }, [])

  useEffect(() => {
    if (!selectedDate && dates[0]) setSelectedDate(dates[0])
  }, [dates, selectedDate])

  return (
    <div className="care-home-page care-home-mar-chart-page">
      <div className="page-header care-home-page-header care-home-no-print">
        <div className="breadcrumbs"><a href={`/care-homes?view=mar&link=${linkId}`} onClick={(event) => { event.preventDefault(); navigate(`/care-homes?view=mar&link=${linkId}`) }}>MAR charts</a><span className="separator">/</span><span>{cycle ? chRange(cycle.period_start, cycle.period_end) : 'Chart'}</span></div>
        <div className="care-home-title-row"><div><p className="care-home-eyebrow">Digital medication administration record</p><h1>{cycle?.resident?.patient ? `${cycle.resident.patient.first_name} ${cycle.resident.patient.last_name}` : 'MAR chart'}</h1><p className="care-home-subtitle">{cycle ? chRange(cycle.period_start, cycle.period_end) : 'Loading chart'}{cycle ? ` · ${chLabel('marCycleStatus', cycle.status)}` : ''}</p></div><div className="care-home-heading-actions"><button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/care-homes?view=mar&link=${linkId}`)}>Back</button>{canPublish && activeUser?.id && <button className="ps-btn ps-btn-secondary" type="button" disabled={saving} onClick={() => void publishMarCycle(cycle!.id, activeUser.id)}>Publish to care home</button>}<button className="ps-btn ps-btn-primary" type="button" onClick={() => window.print()}>Print chart</button></div></div>
      </div>

      {error && <div className="auth-error care-home-alert care-home-no-print" role="alert"><span>{error}</span><button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button></div>}
      {loading && marEntries.length === 0 ? <div className="care-home-loading">Loading MAR entries...</div> : (
        <>
          {cycle && cycle.status !== 'published' && <p className="care-home-help care-home-no-print">{cycle.status === 'archived' ? 'This chart is archived and read only.' : 'Doses can be recorded once the pharmacy publishes this chart to the care home.'}</p>}<div className="care-home-date-strip care-home-no-print">{dates.map((date) => <button key={date} type="button" className={selectedDate === date ? 'active' : ''} onClick={() => setSelectedDate(date)}><strong>{displayDate(date)}</strong><span>{marEntries.filter((entry) => entry.administration_date === date && entry.status !== 'planned').length}/{marEntries.filter((entry) => entry.administration_date === date).length}</span></button>)}</div>
          <section className="care-home-digital-rounds care-home-no-print">
            <div className="care-home-section-heading"><div><p>Administration round</p><h2>{selectedDate ? displayDate(selectedDate) : 'No dated entries'}</h2></div></div>
            {selectedEntries.length === 0 ? <div className="care-home-inline-empty">No scheduled medicines for this day.</div> : selectedEntries.map((entry) => <article key={entry.id}><div className="care-home-round-time"><strong>{entry.round_time?.slice(0, 5) ?? 'PRN'}</strong><span className={`ps-badge ${entry.status === 'administered' || entry.status === 'self_administered' ? 'ps-badge-success' : entry.status === 'planned' ? 'ps-badge-muted' : 'ps-badge-warning'}`}>{chLabel('marEntryStatus', entry.status)}</span></div><div className="care-home-round-medicine"><h3>{entry.medication_schedule?.patient_medication?.drug_name}</h3><p>{entry.dose} · {entry.medication_schedule?.route || 'Route not set'}</p><small>{entry.medication_schedule?.instructions}</small></div>{canAdminister && activeUser?.id && <div className="care-home-round-actions">{administrationStatuses.map((option) => <button key={option.status} type="button" disabled={saving} className={entry.status === option.status ? 'active' : ''} onClick={() => void recordAdministration(entry.id, option.status, activeUser.id)}>{option.label}</button>)}</div>}</article>)}
          </section>

          <section className="care-home-mar-document">
            <header><div><strong>PharmStation MAR</strong><span>Medication administration record</span></div><div><strong>{cycle?.resident?.patient ? `${cycle.resident.patient.first_name} ${cycle.resident.patient.last_name}` : 'Resident'}</strong><span>Room {cycle?.resident?.room_number ?? '-'}</span></div><div><strong>{chRange(cycle?.period_start, cycle?.period_end)}</strong><span>Status: {chLabel('marCycleStatus', cycle?.status)}</span></div></header>
            <table><thead><tr><th>Date</th><th>Time</th><th>Medicine</th><th>Dose / route</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{marEntries.map((entry) => <tr key={entry.id}><td>{displayDate(entry.administration_date)}</td><td>{entry.round_time?.slice(0, 5) ?? 'PRN'}</td><td>{entry.medication_schedule?.patient_medication?.drug_name}<small>{entry.medication_schedule?.instructions}</small></td><td>{entry.dose}<small>{entry.medication_schedule?.route}</small></td><td>{chLabel('marEntryStatus', entry.status)}</td><td>{entry.administered_at ? new Date(entry.administered_at).toLocaleString('en-GB') : '-'}</td></tr>)}</tbody></table>
          </section>
        </>
      )}
    </div>
  )
}