import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { confirmDialog, promptDialog } from '../../components/ui/dialog'

// PharmStation platform admins check each locum's GPhC registration, indemnity
// and documents before they can book shifts (ps_locum_book_shift requires
// compliance_status = 'approved'). Access is enforced in the database: the
// ps_admin_* functions check ps_platform_admins, not this page.

type Doc = {
  id: string
  doc_type: string
  label: string | null
  file_url: string
  expiry_date: string | null
  uploaded_at: string
}

type Row = {
  id: string
  user_id: string
  full_name: string | null
  email: string | null
  phone: string | null
  gphc_number: string | null
  gphc_expiry: string | null
  indemnity_provider: string | null
  indemnity_expiry: string | null
  dbs_number: string | null
  dbs_expiry: string | null
  smart_card_held: boolean | null
  postcode: string | null
  compliance_status: 'pending' | 'approved' | 'rejected' | 'suspended'
  compliance_review_notes: string | null
  compliance_reviewed_at: string | null
  created_at: string
  latest_document_at: string | null
  documents: Doc[]
}

const STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const

const DOC_LABELS: Record<string, string> = {
  gphc_certificate: 'GPhC certificate',
  indemnity_certificate: 'Indemnity insurance',
  dbs_certificate: 'DBS certificate',
  proof_of_id: 'Proof of identity',
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB') : null)
const isPast = (d: string | null) => !!d && new Date(d) < new Date(new Date().toDateString())

function Expiry({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted">no expiry given</span>
  return (
    <span style={isPast(date) ? { color: 'var(--ps-red, #c0392b)', fontWeight: 600 } : undefined}>
      {isPast(date) ? 'expired ' : 'expires '}{fmt(date)}
    </span>
  )
}

export function LocumApprovalsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>('pending')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openingDoc, setOpeningDoc] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await getUserClient().rpc('ps_admin_list_locums', { p_status: filter })
    if (error) {
      setError(error.message === 'Forbidden' ? 'Only PharmStation admins can see this page.' : error.message)
      setRows([])
    } else {
      setRows((data ?? []) as Row[])
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  const openDoc = async (doc: Doc) => {
    setOpeningDoc(doc.id)
    const { data, error } = await getUserClient().storage.from('locum-documents').createSignedUrl(doc.file_url, 600)
    setOpeningDoc(null)
    if (error || !data?.signedUrl) setError(`Couldn't open that document: ${error?.message ?? 'no link returned'}`)
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const setStatus = async (row: Row, status: Row['compliance_status']) => {
    let notes: string | null = null
    const who = row.full_name ?? row.email ?? 'this locum'
    if (status === 'approved') {
      if (!await confirmDialog(
        `Approve ${who}?\n\nOnly do this after finding GPhC ${row.gphc_number ?? '(none given)'} on the GPhC register as a current pharmacist, and checking their indemnity and documents.`,
      )) return
      notes = await promptDialog('Note for the locum (optional):', '') ?? ''
    }
    if (status === 'rejected') {
      notes = await promptDialog('Reason (the locum sees this):', 'We couldn’t verify your GPhC registration. Please check your details and documents.')
      if (notes === null) return
      if (!notes.trim()) { setError('Give the locum a reason when rejecting.'); return }
    }
    if (status === 'suspended') {
      notes = await promptDialog('Reason for suspending (the locum sees this). Their upcoming bookings will be cancelled:', '')
      if (notes === null) return
      if (!notes.trim()) { setError('Give the locum a reason when suspending.'); return }
    }
    setBusyId(row.id)
    const { error } = await getUserClient().rpc('ps_admin_set_locum_compliance', {
      p_locum_id: row.id, p_status: status, p_notes: notes,
    })
    setBusyId(null)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="page-container" style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1rem' }}>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/me" onClick={(e) => { e.preventDefault(); navigate('/me') }}>My Account</a>
          <span className="separator">/</span>
          <span>Review locums</span>
        </div>
        <h1>Review locums</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Check each GPhC number on the{' '}
          <a href="https://www.pharmacyregulation.org/registers" target="_blank" rel="noopener noreferrer">GPhC register</a>{' '}
          and open their documents before approving. Locums can't book shifts until they're approved.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`ps-btn ps-btn-sm ${filter === s ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
            onClick={() => setFilter(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}
      {loading && <p>Loading…</p>}
      {!loading && !error && rows.length === 0 && <p className="text-muted">No {filter} locums.</p>}

      {rows.map((row) => {
        const updatedSinceReview = row.compliance_status === 'rejected' && row.compliance_reviewed_at && row.latest_document_at
          && new Date(row.latest_document_at) > new Date(row.compliance_reviewed_at)
        return (
          <div key={row.id} className="ps-card" style={{ marginBottom: 'var(--ps-space-sm)', padding: 'var(--ps-space-md, 16px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                <strong>{row.full_name ?? 'No name given'}</strong>{' '}
                <span className="ps-badge">GPhC {row.gphc_number ?? 'not given'}</span>
                {updatedSinceReview && <> <span className="ps-badge ps-badge-amber">New documents since rejection</span></>}
                <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 4, overflowWrap: 'anywhere' }}>
                  {row.email ?? 'no email'}{row.phone && <> · {row.phone}</>}{row.postcode && <> · {row.postcode}</>}
                  {' '}· signed up {fmt(row.created_at)}
                </div>
                <div style={{ fontSize: 'var(--ps-font-sm)', marginTop: 6, display: 'grid', gap: 2 }}>
                  <div>GPhC registration: <Expiry date={row.gphc_expiry} /></div>
                  <div>
                    Indemnity: {row.indemnity_provider ?? <span className="text-muted">provider not given</span>}
                    {' '}· <Expiry date={row.indemnity_expiry} />
                  </div>
                  <div>
                    DBS: {row.dbs_number ?? <span className="text-muted">not given</span>}
                    {row.dbs_expiry && <> · <Expiry date={row.dbs_expiry} /></>}
                    {' '}· Smartcard {row.smart_card_held ? 'held' : 'not held'}
                  </div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {row.documents.length === 0 && <span className="text-muted" style={{ fontSize: 'var(--ps-font-sm)' }}>No documents uploaded</span>}
                  {row.documents.map((d) => (
                    <button
                      key={d.id}
                      className="ps-btn ps-btn-ghost ps-btn-sm"
                      disabled={openingDoc === d.id}
                      onClick={() => openDoc(d)}
                      title={`Uploaded ${fmt(d.uploaded_at)}${d.expiry_date ? `, expires ${fmt(d.expiry_date)}` : ''}`}
                    >
                      {d.label || DOC_LABELS[d.doc_type] || d.doc_type}
                      {isPast(d.expiry_date) && ' (expired)'}
                    </button>
                  ))}
                </div>
                {row.compliance_review_notes && (
                  <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 6 }}>
                    Note to locum: {row.compliance_review_notes}
                    {row.compliance_reviewed_at && <> ({fmt(row.compliance_reviewed_at)})</>}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--ps-space-xs, 4px)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {row.compliance_status !== 'approved' && (
                  <button className="ps-btn ps-btn-primary ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'approved')}>
                    Approve
                  </button>
                )}
                {row.compliance_status === 'approved' && (
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'suspended')}>
                    Suspend
                  </button>
                )}
                {(row.compliance_status === 'pending' || row.compliance_status === 'suspended') && (
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'rejected')}>
                    Reject
                  </button>
                )}
                {row.compliance_status !== 'pending' && (
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'pending')}>
                    Back to pending
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
