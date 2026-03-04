import { useCallback, useEffect, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

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
  const { organisation, activeUser } = useAuthStore()
  const orgId = organisation?.id
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
      const { data: profiles } = await client
        .from('ps_locum_profiles')
        .select('id, user_id')
        .in('id', locumIds)
      const userIds = ((profiles ?? []) as { id: string; user_id: string }[]).map((p) => p.user_id)
      const { data: users } = await client.from('ps_user_profiles').select('id, full_name').in('id', userIds)
      const userMap = new Map(((users ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]))
      const profileMap = new Map(((profiles ?? []) as { id: string; user_id: string }[]).map((p) => [p.id, p.user_id]))
      for (const s of signoffs) s.locum_name = userMap.get(profileMap.get(s.locum_id) ?? '') ?? 'Unknown'
    }

    setSignoffMap((prev) => ({ ...prev, [sop.id]: signoffs }))
    setLoadingSignoffs(null)
  }

  async function addSop() {
    if (!title.trim() || !orgId) return
    setSaving(true)
    setUploadProgress('Saving…')
    try {
      let storagePath: string | null = null

      if (selectedFile) {
        setUploadProgress('Uploading file…')
        const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
        const ext = selectedFile.name.split('.').pop() ?? 'pdf'
        const path = `${orgId}/${slug}/${Date.now()}.${ext}`
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
      setError(err instanceof Error ? err.message : 'Failed to create SOP')
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
    await getUserClient().from('ps_locum_sop_documents').update({ is_active: !sop.is_active, updated_at: new Date().toISOString() }).eq('id', sop.id)
    setSops((prev) => prev.map((s) => s.id === sop.id ? { ...s, is_active: !s.is_active } : s))
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
          <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? 'Cancel' : '+ Add SOP'}
          </button>
        </div>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

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
                  <label className="form-label">PDF / Document File</label>
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
              <button className="ps-btn ps-btn-primary" onClick={addSop} disabled={saving || !title.trim()}>
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
                  <button
                    className="ps-btn ps-btn-ghost ps-btn-xs"
                    onClick={(e) => { e.stopPropagation(); toggleActive(sop) }}
                  >
                    {sop.is_active ? 'Deactivate' : 'Activate'}
                  </button>
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
