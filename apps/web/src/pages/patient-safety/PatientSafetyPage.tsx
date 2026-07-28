import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '@pharmstation/core'
import {
  createPatientSafetyReport,
  deletePatientSafetyReport,
  listPatientSafetyReports,
  savePatientSafetyReport,
  type PatientSafetyReport,
  type PatientSafetyReportData,
  type ReportStatus,
} from './patientSafetyRepository'

const steps = ['Event', 'People', 'Impact', 'Context', 'Learning', 'Review']

const eventTypes = [
  ['medication', 'Medication', 'Prescribing, dispensing, supply or administration'],
  ['care', 'Care delivery', 'A process, treatment or handover did not go as planned'],
  ['equipment', 'Equipment or device', 'A device, system or environment contributed'],
  ['information', 'Information', 'Communication, records or identification'],
  ['staffing', 'Staffing or workflow', 'Capacity, workload or ways of working'],
  ['other', 'Something else', 'Capture an event that does not fit these groups'],
]

const harmOptions = [
  ['none', 'No harm', 'The event reached someone but caused no harm'],
  ['low', 'Low', 'Extra observation or minor treatment was needed'],
  ['moderate', 'Moderate', 'Significant but not permanent harm'],
  ['severe', 'Severe', 'Permanent or life-changing harm'],
  ['death', 'Death', 'The event may have contributed to death'],
  ['near-miss', 'Prevented / near miss', 'The event was caught before reaching someone'],
]

const factorOptions = [
  'Communication', 'Workload or staffing', 'Training or experience', 'Policy or procedure',
  'Equipment or technology', 'Environment', 'Medicines supply', 'Patient factors', 'Other',
]

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ChoiceGrid({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: string[][]
  value: string
  onChange: (value: string) => void
  compact?: boolean
}) {
  return <div className={`safety-choice-grid ${compact ? 'is-compact' : ''}`}>
    {options.map(([key, label, detail]) => <button
      key={key}
      type="button"
      className={value === key ? 'selected' : ''}
      onClick={() => onChange(key)}
    >
      <span className="safety-choice-mark">{value === key ? '✓' : ''}</span>
      <strong>{label}</strong>
      {detail && <small>{detail}</small>}
    </button>)}
  </div>
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="safety-summary-row"><span>{label}</span><strong>{value || 'Not provided'}</strong></div>
}

export function PatientSafetyPage() {
  const { organisation, activeUser } = useAuthStore()
  const [reports, setReports] = useState<PatientSafetyReport[]>([])
  const [activeReport, setActiveReport] = useState<PatientSafetyReport | null>(null)
  const [form, setForm] = useState<PatientSafetyReportData | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)

  useEffect(() => {
    if (!organisation?.id) return
    setLoading(true)
    listPatientSafetyReports(organisation.id)
      .then(setReports)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load reports'))
      .finally(() => setLoading(false))
  }, [organisation?.id])

  const filteredReports = useMemo(() => reports.filter((report) => {
    const matchesStatus = statusFilter === 'all' || report.status === statusFilter
    const haystack = `${report.reference} ${report.title} ${report.event_type ?? ''}`.toLowerCase()
    return matchesStatus && haystack.includes(search.toLowerCase())
  }), [reports, search, statusFilter])

  const counts = useMemo(() => ({
    total: reports.length,
    drafts: reports.filter((report) => report.status === 'draft').length,
    ready: reports.filter((report) => report.status === 'ready').length,
  }), [reports])

  const startReport = async () => {
    if (!organisation?.id || !activeUser?.id) return
    setError(null)
    try {
      const report = await createPatientSafetyReport(organisation.id, activeUser.id)
      setReports((current) => [report, ...current])
      setActiveReport(report)
      setForm(report.report_data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start a report')
    }
  }

  const openReport = (report: PatientSafetyReport) => {
    setActiveReport(report)
    setForm(report.report_data)
    setSavedNotice(false)
  }

  const update = <Key extends keyof PatientSafetyReportData>(key: Key, value: PatientSafetyReportData[Key]) => {
    setForm((current) => current ? { ...current, [key]: value } : current)
    setSavedNotice(false)
  }

  const persist = async (nextForm: PatientSafetyReportData, status: ReportStatus = 'draft') => {
    if (!activeReport) return null
    setSaving(true)
    setError(null)
    try {
      const saved = await savePatientSafetyReport(activeReport.id, nextForm, status)
      setActiveReport(saved)
      setForm(saved.report_data)
      setReports((current) => current.map((report) => report.id === saved.id ? saved : report))
      setSavedNotice(true)
      return saved
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this report')
      return null
    } finally {
      setSaving(false)
    }
  }

  const moveStep = async (direction: -1 | 1) => {
    if (!form) return
    const nextForm = { ...form, step: Math.min(steps.length - 1, Math.max(0, form.step + direction)) }
    await persist(nextForm)
  }

  const removeReport = async (report: PatientSafetyReport) => {
    if (!window.confirm(`Delete draft ${report.reference}? This cannot be undone.`)) return
    try {
      await deletePatientSafetyReport(report.id)
      setReports((current) => current.filter((item) => item.id !== report.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete this draft')
    }
  }

  if (activeReport && form) {
    const progress = ((form.step + 1) / steps.length) * 100
    return <div className="safety-page safety-wizard-page">
      <header className="safety-wizard-header">
        <button type="button" className="safety-back" onClick={() => { setActiveReport(null); setForm(null) }}>← All reports</button>
        <div><span>{activeReport.reference}</span><strong>{activeReport.status === 'ready' ? 'Ready for submission' : 'Draft in progress'}</strong></div>
        <button type="button" className="ps-btn ps-btn-secondary" disabled={saving} onClick={() => persist(form)}>{saving ? 'Saving…' : 'Save draft'}</button>
      </header>

      <div className="safety-progress"><i style={{ width: `${progress}%` }} /></div>
      <div className="safety-wizard-layout">
        <aside className="safety-step-rail">
          <p>Patient safety report</p>
          {steps.map((step, index) => <button key={step} type="button" className={index === form.step ? 'active' : index < form.step ? 'complete' : ''} onClick={() => persist({ ...form, step: index })}>
            <span>{index < form.step ? '✓' : index + 1}</span><b>{step}</b>
          </button>)}
          <div className="safety-local-note"><strong>Stored securely</strong><span>Saved to your organisation in PharmStation. Nothing is sent to LFPSE yet.</span></div>
        </aside>

        <main className="safety-question-stage">
          {savedNotice && <div className="safety-saved-notice">✓ Draft saved</div>}
          {error && <div className="auth-error">{error}</div>}

          {form.step === 0 && <section className="safety-question">
            <span className="safety-kicker">01 · The event</span>
            <h1>Start with what happened</h1>
            <p>Use clear, factual language. You can add context and learning later.</p>
            <label className="safety-field"><span>Which area best describes the event?</span><ChoiceGrid options={eventTypes} value={form.eventType} onChange={(value) => update('eventType', value)} /></label>
            <label className="safety-field"><span>What happened?</span><textarea value={form.description} onChange={(event) => update('description', event.target.value)} rows={6} placeholder="Describe the sequence of events in your own words…" /><small>{form.description.length} characters</small></label>
            <div className="safety-two-column"><label className="safety-field"><span>Date and time</span><input type="datetime-local" value={form.eventTime} onChange={(event) => update('eventTime', event.target.value)} /></label><label className="safety-field"><span>How certain is the date?</span><select value={form.dateCertainty} onChange={(event) => update('dateCertainty', event.target.value as PatientSafetyReportData['dateCertainty'])}><option value="">Select one</option><option value="exact">Exact</option><option value="estimated">Estimated</option><option value="unknown">Not known</option></select></label></div>
            <div className="safety-two-column"><label className="safety-field"><span>Where did it happen?</span><input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="e.g. consultation room" /></label><label className="safety-field"><span>Service or activity</span><input value={form.serviceArea} onChange={(event) => update('serviceArea', event.target.value)} placeholder="e.g. dispensing" /></label></div>
          </section>}

          {form.step === 1 && <section className="safety-question">
            <span className="safety-kicker">02 · People involved</span><h1>Who was affected?</h1><p>Use a local reference rather than a name where practical.</p>
            <ChoiceGrid compact options={[["patient","A patient",""],["staff","A staff member",""],["visitor","A visitor or carer",""],["multiple","More than one person",""],["none","No one — near miss",""]]} value={form.peopleAffected} onChange={(value) => update('peopleAffected', value as PatientSafetyReportData['peopleAffected'])} />
            {(form.peopleAffected === 'patient' || form.peopleAffected === 'multiple') && <div className="safety-detail-band"><div className="safety-two-column"><label className="safety-field"><span>Patient reference</span><input value={form.patientReference} onChange={(event) => update('patientReference', event.target.value)} placeholder="Local ID, initials or NHS number" /></label><label className="safety-field"><span>Age at the time</span><input value={form.patientAge} onChange={(event) => update('patientAge', event.target.value)} placeholder="e.g. 68" inputMode="numeric" /></label></div></div>}
            <label className="safety-field"><span>What was done immediately?</span><textarea value={form.immediateActions} onChange={(event) => update('immediateActions', event.target.value)} rows={5} placeholder="Include clinical action, escalation, contact with the patient or steps taken to make the situation safe…" /></label>
          </section>}

          {form.step === 2 && <section className="safety-question">
            <span className="safety-kicker">03 · Impact</span><h1>What was the outcome?</h1><p>Choose the best current assessment. It can be updated as more becomes known.</p>
            <label className="safety-field"><span>Physical harm</span><ChoiceGrid options={harmOptions} value={form.physicalHarm} onChange={(value) => update('physicalHarm', value)} /></label>
            <div className="safety-two-column"><label className="safety-field"><span>Psychological harm</span><select value={form.psychologicalHarm} onChange={(event) => update('psychologicalHarm', event.target.value)}><option value="">Select one</option><option value="none">No psychological harm</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="severe">Severe</option><option value="unknown">Not yet known</option></select></label><label className="safety-field"><span>Current ongoing risk</span><select value={form.currentRisk} onChange={(event) => update('currentRisk', event.target.value as PatientSafetyReportData['currentRisk'])}><option value="">Select one</option><option value="none">None</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High — further action needed</option></select></label></div>
          </section>}

          {form.step === 3 && <section className="safety-question">
            <span className="safety-kicker">04 · Context</span><h1>What may have contributed?</h1><p>This is about understanding the system, not assigning blame.</p>
            <div className="safety-factor-grid">{factorOptions.map((factor) => <label key={factor} className={form.factors.includes(factor) ? 'selected' : ''}><input type="checkbox" checked={form.factors.includes(factor)} onChange={() => update('factors', form.factors.includes(factor) ? form.factors.filter((item) => item !== factor) : [...form.factors, factor])} /><span>{factor}</span></label>)}</div>
            <label className="safety-field"><span>Tell us more about those factors</span><textarea value={form.factorDetails} onChange={(event) => update('factorDetails', event.target.value)} rows={6} placeholder="What conditions made this event more likely?" /></label>
          </section>}

          {form.step === 4 && <section className="safety-question">
            <span className="safety-kicker">05 · Learning</span><h1>Turn the event into learning</h1><p>Capture strengths as well as opportunities to improve.</p>
            <label className="safety-field"><span>What went well?</span><textarea value={form.wentWell} onChange={(event) => update('wentWell', event.target.value)} rows={4} placeholder="What helped reduce harm or supported a good response?" /></label>
            <label className="safety-field"><span>What could prevent this happening again?</span><textarea value={form.learning} onChange={(event) => update('learning', event.target.value)} rows={5} placeholder="Actions, changes, conversations or further review…" /></label>
            <div className="safety-two-column"><label className="safety-field"><span>Follow-up owner</span><input value={form.followUpOwner} onChange={(event) => update('followUpOwner', event.target.value)} placeholder="Person or team" /></label><label className="safety-field"><span>Your role</span><input value={form.reporterRole} onChange={(event) => update('reporterRole', event.target.value)} placeholder="e.g. Pharmacist" /></label></div>
            <div className="safety-two-column"><label className="safety-field"><span>Contact for follow-up</span><input value={form.reporterContact} onChange={(event) => update('reporterContact', event.target.value)} placeholder="Email or telephone" /></label><label className="safety-field"><span>Existing local reference</span><input value={form.localReference} onChange={(event) => update('localReference', event.target.value)} placeholder="Optional" /></label></div>
          </section>}

          {form.step === 5 && <section className="safety-question">
            <span className="safety-kicker">06 · Review</span><h1>Review the whole picture</h1><p>Marking this ready keeps it in PharmStation’s submission queue. It will not be sent to NHS England until the integration is approved and connected.</p>
            <div className="safety-review-sheet">
              <div><span>Report reference</span><strong>{activeReport.reference}</strong></div>
              <SummaryRow label="Event" value={eventTypes.find(([key]) => key === form.eventType)?.[1] ?? ''} />
              <SummaryRow label="What happened" value={form.description} />
              <SummaryRow label="When" value={form.eventTime ? formatDate(form.eventTime) : form.dateCertainty === 'unknown' ? 'Not known' : ''} />
              <SummaryRow label="Who was affected" value={form.peopleAffected} />
              <SummaryRow label="Physical harm" value={harmOptions.find(([key]) => key === form.physicalHarm)?.[1] ?? ''} />
              <SummaryRow label="Contributing factors" value={form.factors.join(', ')} />
              <SummaryRow label="Learning" value={form.learning} />
            </div>
            <div className="safety-ready-panel"><div><strong>Ready for the future LFPSE connection</strong><span>You can still reopen and amend this report after marking it ready.</span></div><button type="button" className="ps-btn ps-btn-primary" disabled={saving || !form.description || !form.eventType} onClick={() => persist(form, 'ready')}>Mark ready</button></div>
          </section>}

          <footer className="safety-wizard-actions">
            <button type="button" className="ps-btn ps-btn-secondary" disabled={saving || form.step === 0} onClick={() => moveStep(-1)}>← Previous</button>
            {form.step < steps.length - 1 && <button type="button" className="ps-btn ps-btn-primary" disabled={saving} onClick={() => moveStep(1)}>{saving ? 'Saving…' : 'Save & continue →'}</button>}
          </footer>
        </main>
      </div>
    </div>
  }

  return <div className="safety-page">
    <header className="safety-hero">
      <div><span className="safety-kicker">Learn from patient safety events</span><h1>Safer care starts with a clear story.</h1><p>Record events, near misses and good catches in a calm, guided space. Reports stay securely in PharmStation while the national LFPSE connection is being approved.</p><button type="button" className="safety-primary-action" onClick={startReport}>＋ Start a patient safety report</button></div>
      <div className="safety-hero-signal" aria-hidden="true"><i /><i /><i /><i /><span>LEARN<br />IMPROVE<br />SHARE</span></div>
    </header>

    {error && <div className="auth-error safety-error">{error}</div>}
    <section className="safety-stat-strip"><div><strong>{counts.total}</strong><span>All reports</span></div><div><strong>{counts.drafts}</strong><span>Drafts in progress</span></div><div><strong>{counts.ready}</strong><span>Ready for connection</span></div><div className="safety-connection"><i /><span><b>LFPSE connection</b>Awaiting API approval</span></div></section>

    <section className="safety-library">
      <div className="safety-library-heading"><div><span className="safety-kicker">Reporting workspace</span><h2>Your patient safety reports</h2></div><div className="safety-library-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports…" aria-label="Search reports" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="draft">Drafts</option><option value="ready">Ready</option><option value="submitted">Submitted</option><option value="submission_failed">Needs attention</option></select></div></div>
      {loading ? <div className="safety-empty"><strong>Loading reports…</strong></div> : filteredReports.length === 0 ? <div className="safety-empty"><span>◇</span><strong>{reports.length ? 'No reports match this view' : 'A quiet reporting space, ready when you need it'}</strong><p>{reports.length ? 'Try another search or status.' : 'Start a report now, or return when there is an event or near miss to record.'}</p>{!reports.length && <button type="button" onClick={startReport}>Start first report</button>}</div> : <div className="safety-report-list">{filteredReports.map((report) => <article key={report.id}>
        <button type="button" className="safety-report-main" onClick={() => openReport(report)}><span className={`safety-report-status is-${report.status}`}>{report.status === 'ready' ? 'Ready' : report.status === 'submitted' ? 'Submitted' : report.status === 'submission_failed' ? 'Needs attention' : 'Draft'}</span><div><strong>{report.title}</strong><span>{report.reference} · Updated {formatDate(report.updated_at)}</span></div><b>Continue →</b></button>
        {report.status === 'draft' && <button type="button" className="safety-delete" title="Delete draft" aria-label={`Delete ${report.reference}`} onClick={() => removeReport(report)}>×</button>}
      </article>)}</div>}
    </section>
  </div>
}