import { useCallback, useEffect, useState } from 'react'
import {
  cancelAccountDeletion,
  myDeletionRequest,
  requestAccountDeletion,
  type DeletionRequest,
} from '@pharmstation/supabase-client'

/** Ask PharmStation to delete this account. A person reviews each request,
 *  because some records (CD register, RP log) must legally be kept. */
export function DeleteAccountCard() {
  const [request, setRequest] = useState<DeletionRequest | null>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    myDeletionRequest().then(setRequest)
  }, [])
  useEffect(load, [load])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await requestAccountDeletion(reason)
      setOpen(false)
      setReason('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    try {
      await cancelAccountDeletion()
      load()
    } finally {
      setBusy(false)
    }
  }

  const pending = request?.status === 'pending'

  return (
    <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
      <div className="ps-card-header"><h2 className="ps-card-title">Delete my account</h2></div>
      <div className="ps-card-body">
        {pending ? (
          <>
            <div className="ps-alert ps-alert-info" style={{ marginBottom: '0.75rem' }}>
              You asked us to delete your account on {new Date(request.created_at).toLocaleDateString('en-GB')}. We&rsquo;ll
              email you when it&rsquo;s done, usually within 30 days.
            </div>
            <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={cancel} disabled={busy}>
              Cancel my request
            </button>
          </>
        ) : open ? (
          <>
            <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              We&rsquo;ll remove your account and personal details. By law, entries you made in controlled drug
              registers, the RP log and similar records stay with the pharmacy, under your name.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="delete-reason">Anything you&rsquo;d like to tell us? (optional)</label>
              <textarea id="delete-reason" className="form-input" rows={3} maxLength={1000}
                value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="ps-btn ps-btn-danger ps-btn-sm" onClick={submit} disabled={busy}>
                {busy ? 'Sending…' : 'Ask to delete my account'}
              </button>
              <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setOpen(false)}>
                Keep my account
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              {request?.status === 'declined' && request.admin_note
                ? `Your last request wasn't completed: ${request.admin_note}`
                : 'Ask PharmStation to delete your account and personal details.'}
            </p>
            <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setOpen(true)}>
              Delete my account…
            </button>
          </>
        )}
      </div>
    </div>
  )
}
