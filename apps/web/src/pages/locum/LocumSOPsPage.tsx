import { useCallback, useEffect, useState } from 'react'
import { getLocumClient } from '@pharmstation/supabase-client'
import { useLocumAuthStore } from '@pharmstation/core'

interface SopDoc {
  id: string
  title: string
  description: string | null
  file_url: string | null
  version: number
  is_required: boolean
  org_id: string
  org_name?: string
}

interface SignoffRecord {
  sop_id: string
  sop_version: number
  signed_at: string
}

export function LocumSOPsPage() {
  const { locumProfile } = useLocumAuthStore()

  const [sops, setSops] = useState<SopDoc[]>([])
  const [signoffs, setSignoffs] = useState<SignoffRecord[]>([])
  const [orgNames, setOrgNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-SOP sign UI state
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [signing, setSigning] = useState<string | null>(null)
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!locumProfile?.id) return
    setLoading(true)
    setError(null)
    const client = getLocumClient()

    try {
      // 1. Confirmed upcoming bookings → unique org_ids
      const { data: bookings, error: bErr } = await client
        .from('ps_locum_bookings')
        .select('org_id, shift:ps_locum_shifts(date)')
        .eq('locum_id', locumProfile.id)
        .in('status', ['confirmed', 'completed'])
      if (bErr) throw bErr

      const orgIds = [...new Set(
        ((bookings ?? []) as { org_id: string }[]).map((b) => b.org_id)
      )]

      if (orgIds.length === 0) {
        setSops([]); setSignoffs([]); setLoading(false); return
      }

      // 2. Active SOPs for those orgs + existing signoffs (parallel)
      const [sopRes, signoffRes, orgRes] = await Promise.all([
        client
          .from('ps_locum_sop_documents')
          .select('id, title, description, file_url, version, is_required, org_id')
          .in('org_id', orgIds)
          .eq('is_active', true)
          .order('org_id')
          .order('title'),
        client
          .from('ps_locum_sop_signoffs')
          .select('sop_id, sop_version, signed_at')
          .eq('locum_id', locumProfile.id),
        client.from('ps_organisations').select('id, name').in('id', orgIds),
      ])

      if (sopRes.error) throw sopRes.error

      const orgMap: Record<string, string> = {}
      for (const o of (orgRes.data ?? []) as { id: string; name: string }[]) {
        orgMap[o.id] = o.name
      }
      setOrgNames(orgMap)
      setSops((sopRes.data ?? []) as SopDoc[])
      setSignoffs((signoffRes.data ?? []) as SignoffRecord[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SOPs')
    } finally {
      setLoading(false)
    }
  }, [locumProfile?.id])

  useEffect(() => { load() }, [load])

  function signedRecord(sop: SopDoc): SignoffRecord | undefined {
    return signoffs.find((s) => s.sop_id === sop.id && s.sop_version === sop.version)
  }

  async function handleViewSop(sop: SopDoc) {
    if (!sop.file_url) return
    setLoadingUrl(sop.id)
    try {
      // file_url stores the storage path relative to bucket root
      const { data, error } = await getLocumClient()
        .storage.from('sop-pdfs')
        .createSignedUrl(sop.file_url, 3600)
      if (error) throw error
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch {
      // Fallback — maybe it's already a full URL (old data)
      window.open(sop.file_url!, '_blank', 'noopener,noreferrer')
    } finally {
      setLoadingUrl(null)
    }
  }

  async function handleSign(sop: SopDoc) {
    if (!locumProfile?.id) return
    setSigning(sop.id)
    try {
      const { error } = await getLocumClient()
        .from('ps_locum_sop_signoffs')
        .insert({
          sop_id: sop.id,
          locum_id: locumProfile.id,
          sop_version: sop.version,
          signed_at: new Date().toISOString(),
        })
      if (error) throw error
      setSignoffs((prev) => [
        ...prev,
        { sop_id: sop.id, sop_version: sop.version, signed_at: new Date().toISOString() },
      ])
      setConfirmed((prev) => ({ ...prev, [sop.id]: false }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign failed')
    } finally {
      setSigning(null)
    }
  }

  // Group by org
  const byOrg = sops.reduce<Record<string, SopDoc[]>>((acc, s) => {
    if (!acc[s.org_id]) acc[s.org_id] = []
    acc[s.org_id].push(s)
    return acc
  }, {})

  const pendingCount = sops.filter((s) => !signedRecord(s)).length

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">SOP Sign-off</h1>
          <p className="page-subtitle">Standard operating procedures you are required to read and acknowledge</p>
        </div>
        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {pendingCount > 0 && (
        <div className="ps-alert ps-alert-warning" style={{ marginBottom: '1.5rem' }}>
          <strong>{pendingCount} SOP{pendingCount !== 1 ? 's' : ''} pending sign-off.</strong> Please read and acknowledge all required documents before your next shift.
        </div>
      )}

      {loading ? (
        <div className="loading-indicator" style={{ padding: '3rem', textAlign: 'center' }}>Loading…</div>
      ) : sops.length === 0 ? (
        <div className="ps-card">
          <div className="ps-card-body" style={{ padding: '2.5rem', textAlign: 'center' }}>
            <p className="text-muted">No SOPs to sign. SOPs will appear here once you have confirmed bookings.</p>
          </div>
        </div>
      ) : (
        Object.entries(byOrg).map(([orgId, orgSops]) => (
          <div key={orgId} style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ps-slate)', marginBottom: '0.75rem' }}>
              {orgNames[orgId] ?? 'Pharmacy'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {orgSops.map((sop) => {
                const rec = signedRecord(sop)
                const isSigned = !!rec
                const isConfirmed = confirmed[sop.id] ?? false

                return (
                  <div key={sop.id} className="ps-card">
                    <div className="ps-card-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.75rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                            <span style={{ fontWeight: 600 }}>{sop.title}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--ps-slate)' }}>v{sop.version}</span>
                            {sop.is_required && <span className="ps-badge ps-badge-warning">Required</span>}
                            {isSigned
                              ? <span className="ps-badge ps-badge-success">Signed</span>
                              : <span className="ps-badge ps-badge-danger">Unsigned</span>
                            }
                          </div>
                          {sop.description && (
                            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--ps-slate)' }}>{sop.description}</p>
                          )}
                          {isSigned && rec && (
                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                              Signed: {new Date(rec.signed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                          {sop.file_url && (
                            <button
                              className="ps-btn ps-btn-ghost ps-btn-sm"
                              onClick={() => handleViewSop(sop)}
                              disabled={loadingUrl === sop.id}
                            >
                              {loadingUrl === sop.id ? 'Loading…' : 'View Document'}
                            </button>
                          )}
                        </div>
                      </div>

                      {!isSigned && (
                        <div style={{ borderTop: '1px solid var(--ps-border)', paddingTop: '0.75rem' }}>
                          <label className="ps-checkbox-label" style={{ marginBottom: '0.75rem' }}>
                            <input
                              type="checkbox"
                              checked={isConfirmed}
                              onChange={(e) => setConfirmed((prev) => ({ ...prev, [sop.id]: e.target.checked }))}
                            />
                            I confirm that I have read, understood, and will comply with this Standard Operating Procedure (v{sop.version}).
                          </label>
                          <button
                            className="ps-btn ps-btn-primary ps-btn-sm"
                            onClick={() => handleSign(sop)}
                            disabled={!isConfirmed || signing === sop.id}
                          >
                            {signing === sop.id ? 'Signing…' : 'Sign & Acknowledge'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
