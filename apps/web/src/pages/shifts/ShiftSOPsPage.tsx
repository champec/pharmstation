import { useCallback, useEffect, useRef, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, canManageLocumSOPs } from '@pharmstation/core'
import { confirmDialog } from '../../components/ui/dialog'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

function checkFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return 'Please choose a PDF, JPEG or PNG file.'
  if (file.size > MAX_FILE_BYTES) return 'That file is over 20 MB.'
  return null
}

function storagePathFor(orgId: string, title: string, file: File): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'sop'
  const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
  return `${orgId}/${slug}/${Date.now()}.${ext}`
}

interface SopDoc {
  id: string
  title: string
  description: string | null
  file_url: string | null
  version: number
  is_required: boolean
  is_active: boolean
  uploaded_by: string | null
  created_at: string
}

interface Signoff {
  id: string
  locum_id: string
  signed_at: string
  sop_version: number
  locum_name?: string
}

export function ShiftSOPsPage() {
  const { organisation, activeUser, membership } = useAuthStore()
  const orgId = organisation?.id
  const isManager = canManageLocumSOPs(membership)
  const newVersionInput = useRef<HTMLInputElement>(null)
  const [newVersionFor, setNewVersionFor] = useState<SopDoc | null>(null)
  const [uploadingVersion, setUploadingVersion] = useState<string | null>(null)
  const [sops, setSops] = useState<SopDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [signoffMap, setSignoffMap] = useState<Record<string, Signoff[]>>({})
  const [loadingSignoffs, setLoadingSignoffs] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)

  /* Add form */
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isRequired, setIsRequired] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    const { data, error: qErr } = await getUserClient()
      .from('ps_locum_sop_documents')
      .select('*')
      .eq('org_id', orgId)
      .order('is_active', { ascending: false })
      .order('title')
    if (qErr) setError(qErr.message)
    else setSops((data ?? []) as SopDoc[])
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function loadSignoffs(sop: SopDoc) {
    if (expandedId === sop.id) { setExpandedId(null); return }
    setExpandedId(sop.id)
    if (signoffMap[sop.id]) return
    setLoadingSignoffs(sop.id)
    const client = getUserClient()
    const { data: signoffsData } = await client
      .from('ps_locum_sop_signoffs')
      .select('id, locum_id, signed_at, sop_version')
      .eq('sop_id', sop.id)
      .order('signed_at', { ascending: false })

    const signoffs = (signoffsData ?? []) as Signoff[]
    const locumIds = [...new Set(signoffs.map((s) => s.locum_id))]
    if (locumIds.length > 0) {
      const { data: locums } = await client.rpc('ps_org_shift_locums', { p_org_id: orgId, p_locum_ids: locumIds })
      const nameMap = new Map(((locums ?? []) as { locum_id: string; full_name: string }[]).map((l) => [l.locum_id, l.full_name]))
      for (const s of signoffs) s.locum_name = nameMap.get(s.locum_id) ?? 'Unknown'
    }

    setSignoffMap((prev) => ({ ...prev, [sop.id]: signoffs }))
    setLoadingSignoffs(null)
  }

  async function addSop() {
    if (!title.trim() || !orgId) return
    if (!selectedFile) { setError('Choose the SOP file to upload.'); return }
    const fileProblem = checkFile(selectedFile)
    if (fileProblem) { setError(fileProblem); return }
    setError(null)
    setSaving(true)
    setUploadProgress('Saving…')
    try {
      let storagePath: string | null = null

      if (selectedFile) {
        setUploadProgress('Uploading file…')
        const path = storagePathFor(orgId, title, selectedFile)
        const { error: upErr } = await getUserClient()
          .storage.from('sop-pdfs')
          .upload(path, selectedFile, { upsert: false })
        if (upErr) throw upErr
        storagePath = path
        setUploadProgress('Creating record…')
      }

      const { error: iErr } = await getUserClient().from('ps_locum_sop_documents').insert({
        org_id: orgId,
        title: title.trim(),
        description: description.trim() || null,
        file_url: storagePath,
        version: 1,
        is_required: isRequired,
        is_active: true,
        uploaded_by: activeUser?.id ?? null,
      })
      if (iErr) throw iErr

      setTitle(''); setDescription(''); setSelectedFile(null); setIsRequired(false)
      setShowAddForm(false)
      await load()
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to create SOP')
    } finally {
      setSaving(false)
      setUploadProgress(null)
    }
  }

  async function handleViewSop(sop: SopDoc) {
    if (!sop.file_url) return
    setLoadingUrl(sop.id)
    try {
      const { data, error } = await getUserClient()
        .storage.from('sop-pdfs')
        .createSignedUrl(sop.file_url, 3600)
      if (error) throw error
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch {
      window.open(sop.file_url, '_blank', 'noopener,noreferrer')
    } finally {
      setLoadingUrl(null)
    }
  }

  async function toggleActive(sop: SopDoc) {
    setError(null)
    const { data, error: uErr } = await getUserClient()
      .from('ps_locum_sop_documents')
      .update({ is_active: !sop.is_active })
      .eq('id', sop.id)
      .select('id')
    if (uErr || !data?.length) { setError(uErr?.message ?? 'You do not have permission to change this SOP.'); return }
    setSops((prev) => prev.map((s) => s.id === sop.id ? { ...s, is_active: !s.is_active } : s))
  }

  // Upload a new version: the database bumps the version number and keeps the
  // old file on record, and locums are asked to sign again.
  async function uploadNewVersion(sop: SopDoc, file: File) {
    if (!orgId) return
    const fileProblem = checkFile(file)
    if (fileProblem) { setError(fileProblem); return }
    if (!await confirmDialog(`Upload this file as version ${sop.version + 1} of "${sop.title}"? Locums will need to read and sign it again. The old version and its sign-offs are kept.`)) return
    setError(null)
    setUploadingVersion(sop.id)
    try {
      const path = storagePathFor(orgId, sop.title, file)
      const { error: upErr } = await getUserClient().storage.from('sop-pdfs').upload(path, file, { upsert: false })
      if (upErr) throw upErr
      const { data, error: uErr } = await getUserClient()
        .from('ps_locum_sop_documents')
        .update({ file_url: path })
        .eq('id', sop.id)
        .select('*')
        .single()
      if (uErr) {
        await getUserClient().storage.from('sop-pdfs').remove([path])
        throw uErr
      }
      setSops((prev) => prev.map((s) => (s.id === sop.id ? (data as SopDoc) : s)))
      setSignoffMap((prev) => { const next = { ...prev }; delete next[sop.id]; return next })
      if (expandedId === sop.id) setExpandedId(null)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to upload the new version')
    } finally {
      setUploadingVersion(null)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">SOP Documents</h1>
          <p className="page-subtitle">Standard operating procedures locums must read and sign</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>Refresh</button>
          {isManager && (
            <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? 'Cancel' : '+ Add SOP'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <input
        ref={newVersionInput}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file && newVersionFor) uploadNewVersion(newVersionFor, file)
          setNewVersionFor(null)
        }}
      />

      {showAddForm && (
        <div className="ps-card" style={{ marginBottom: '1.5rem' }}>
          <div className="ps-card-header"><h2 className="ps-card-title">New SOP Document</h2></div>
          <div className="ps-card-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Title <span className="required">*</span></label>
                <input className="form-input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Controlled Drug Handling SOP" />
              </div>
              <div className="form-group">
                  <label className="form-label">PDF / Document File <span className="required">*</span></label>
                  <input
                    className="form-input"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  />
                  {selectedFile && <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', marginTop: '0.25rem' }}>{selectedFile.name}</div>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-input" style={{ minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <label className="ps-checkbox-label">
              <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
              Required — locums must sign before their first shift
            </label>
            <div style={{ marginTop: '1rem' }}>
              <button className="ps-btn ps-btn-primary" onClick={addSop} disabled={saving || !title.trim() || !selectedFile}>
                {saving ? 'Saving…' : 'Add SOP'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-indicator" style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>
      ) : sops.length === 0 ? (
        <div className="ps-card">
          <div className="ps-card-body" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="text-muted">No SOPs uploaded yet. Add your first SOP above.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {sops.map((sop) => (
            <div key={sop.id} className="ps-card">
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0.75rem', alignItems: 'center', padding: '1rem', cursor: 'pointer' }}
                onClick={() => loadSignoffs(sop)}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.2rem' }}>
                    {sop.title}
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--ps-slate)' }}>v{sop.version}</span>
                  </div>
                  {sop.description && <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>{sop.description}</div>}
                </div>
                {sop.is_required && <span className="ps-badge ps-badge-warning">Required</span>}
                <span className={sop.is_active ? 'ps-badge ps-badge-success' : 'ps-badge ps-badge-default'}>
                  {sop.is_active ? 'Active' : 'Inactive'}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {sop.file_url && (
                    <a
                      href="#"
                      className="ps-btn ps-btn-ghost ps-btn-xs"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleViewSop(sop) }}
                    >
                      {loadingUrl === sop.id ? '…' : 'View'}
                    </a>
                  )}
                  {isManager && (
                    <button
                      className="ps-btn ps-btn-ghost ps-btn-xs"
                      disabled={uploadingVersion === sop.id}
                      onClick={(e) => { e.stopPropagation(); setNewVersionFor(sop); newVersionInput.current?.click() }}
                    >
                      {uploadingVersion === sop.id ? 'Uploading…' : 'New version'}
                    </button>
                  )}
                  {isManager && (
                    <button
                      className="ps-btn ps-btn-ghost ps-btn-xs"
                      onClick={(e) => { e.stopPropagation(); toggleActive(sop) }}
                    >
                      {sop.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                  <span style={{ fontSize: '0.75rem', color: 'var(--ps-slate)' }}>{expandedId === sop.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedId === sop.id && (
                <div style={{ borderTop: '1px solid var(--ps-border)', padding: '1rem' }}>
                  <h4 style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ps-slate)', marginBottom: '0.75rem' }}>Sign-offs</h4>
                  {loadingSignoffs === sop.id ? (
                    <p className="text-muted" style={{ fontSize: '0.875rem' }}>Loading…</p>
                  ) : !signoffMap[sop.id]?.length ? (
                    <p className="text-muted" style={{ fontSize: '0.875rem' }}>No locums have signed this document yet.</p>
                  ) : (
                    <table className="ps-table" style={{ margin: 0 }}>
                      <thead>
                        <tr><th>Locum</th><th>Doc Version</th><th>Signed At</th></tr>
                      </thead>
                      <tbody>
                        {signoffMap[sop.id].map((s) => (
                          <tr key={s.id}>
                            <td>{s.locum_name ?? s.locum_id}
                            {s.sop_version < sop.version && (
                              <span className="ps-badge ps-badge-warning" style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>Outdated version</span>
                            )}
                            </td>
                            <td>v{s.sop_version}</td>
                            <td>{new Date(s.signed_at).toLocaleString('en-GB')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
