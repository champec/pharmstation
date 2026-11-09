import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import { PageHeader } from '../../../components/ui/PageHeader'

interface OdsPharmacy {
  id: number
  ods_code: string
  organisation_name: string
  address1: string | null
  address2: string | null
  city: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
}

export function NetworkOnboardingPage() {
  const navigate = useNavigate()
  const { organisation, permissions } = useAuthStore()
  const { myLink, fetchMyLink, linkPharmacy, unlinkPharmacy, disputeLink, loading, error, clearError } = useNetworkStore()
  const canManage = permissions?.org_settings === true

  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults]       = useState<OdsPharmacy[]>([])
  const [searching, setSearching]   = useState(false)
  const [unlinking, setUnlinking]   = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [takenIds, setTakenIds]     = useState<Set<number>>(new Set())
  const [disputing, setDisputing]   = useState<OdsPharmacy | null>(null)
  const [disputeText, setDisputeText] = useState('')
  const [disputeRef, setDisputeRef] = useState<string | null>(null)
  const [disputeBusy, setDisputeBusy] = useState(false)
  const verification = organisation?.verification_status
  const canLink = verification === undefined || verification === 'verified'

  useEffect(() => {
    if (organisation?.id) fetchMyLink(organisation.id)
  }, [organisation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(async () => {
    if (!searchTerm.trim()) return
    setSearching(true)
    setSearchError(null)
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('pharmacies')
        .select('id, ods_code, organisation_name, address1, address2, city, postcode, latitude, longitude')
        .or(`organisation_name.ilike.%${searchTerm}%,postcode.ilike.%${searchTerm}%,ods_code.ilike.%${searchTerm}%`)
        .order('organisation_name')
        .limit(20)
      if (error) throw error
      const found = (data ?? []) as OdsPharmacy[]
      setResults(found)
      // Pharmacies another PharmStation account has already linked can't be claimed again.
      if (found.length) {
        const { data: links } = await client
          .from('ps_org_pharmacy_link').select('pharmacy_id, org_id')
          .in('pharmacy_id', found.map((p) => p.id))
        setTakenIds(new Set((links ?? []).filter((l) => l.org_id !== organisation?.id).map((l) => l.pharmacy_id as number)))
      } else {
        setTakenIds(new Set())
      }
    } catch (e: unknown) {
      setSearchError((e as Error).message)
    } finally {
      setSearching(false)
    }
  }, [searchTerm, organisation?.id])

  async function handleLink(pharmacy: OdsPharmacy) {
    if (!organisation?.id) return
    try {
      await linkPharmacy(organisation.id, pharmacy.id)
      navigate('/messaging/network')
    } catch {
      // shown via the store's error banner
    }
  }

  async function handleUnlink() {
    if (!organisation?.id) return
    if (!window.confirm('Unlink this pharmacy? Other pharmacies will no longer be able to find you.')) return
    setUnlinking(true)
    await unlinkPharmacy(organisation.id)
    setUnlinking(false)
  }

  async function handleDispute() {
    if (!organisation?.id || !disputing) return
    setDisputeBusy(true)
    setSearchError(null)
    try {
      const ref = await disputeLink(organisation.id, disputing.id, disputeText)
      setDisputeRef(ref)
      setDisputing(null)
      setDisputeText('')
    } catch (e: unknown) {
      setSearchError((e as Error).message)
    } finally {
      setDisputeBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Messaging', to: '/messaging' }, { label: 'Pharmacy Network', to: '/messaging/network' }, { label: 'Link pharmacy' }]}
        title="Link your pharmacy"
        subtitle="Choose your NHS pharmacy record once so other pharmacies can find and message you."
      />

      {(error || searchError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error ?? searchError}</span>
          <button className="ps-btn ps-btn-ghost" onClick={() => { clearError(); setSearchError(null) }}>✕</button>
        </div>
      )}

      {!canManage && (
        <div className="ps-alert ps-alert-info" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>Only owners and managers can link or change your pharmacy. Ask one of them to do this.</span>
        </div>
      )}

      {disputeRef && (
        <div className="ps-alert ps-alert-success" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>Thanks. We&rsquo;ve opened case <strong>{disputeRef}</strong> and will check who owns this pharmacy, usually within one working day.</span>
        </div>
      )}

      {/* Intro */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)', background: 'var(--ps-off-white)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Why link?</h3>
        <p style={{ margin: 0, color: 'var(--ps-slate)', lineHeight: 1.7 }}>
          Linking your PharmStation account to your NHS ODS (Organisation Data Service) entry lets other pharmacies on the platform find you by name, postcode, or ODS code.
          It also powers distance-based search using your pharmacy's registered location. You only need to do this once.
        </p>
      </div>

      {/* Current link */}
      {myLink && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)', border: '2px solid var(--ps-electric-cyan)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 4 }}>
                Currently linked{' '}
                {myLink.is_verified
                  ? <span className="ps-badge ps-badge-green">Confirmed</span>
                  : <span className="ps-badge" title="Your address didn't match the NHS record, so our team will confirm it">Being checked</span>}
              </div>
              <div style={{ fontWeight: 600 }}>
                {myLink.pharmacy?.organisation_name ?? `Pharmacy #${myLink.pharmacy_id}`}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
                ODS: {myLink.pharmacy?.ods_code ?? '—'}
                {myLink.pharmacy?.postcode && ` · ${myLink.pharmacy.postcode}`}
                {myLink.pharmacy?.city && ` · ${myLink.pharmacy.city}`}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', marginTop: 4 }}>
                Linked {new Date(myLink.linked_at).toLocaleDateString('en-GB')}
              </div>
            </div>
            {canManage && (
              <button
                className="ps-btn ps-btn-ghost"
                style={{ color: 'var(--ps-red, crimson)' }}
                onClick={handleUnlink}
                disabled={unlinking}
              >
                {unlinking ? 'Removing…' : 'Unlink'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>
          {myLink ? 'Change your linked pharmacy' : 'Find your pharmacy'}
        </h3>
        <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }}>
          Search by pharmacy name, postcode, or ODS code. If your address on PharmStation matches the NHS record the link is
          confirmed straight away; otherwise our team checks it first.
        </p>

        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)' }}>
          <input
            className="ps-input"
            placeholder="e.g. Boots, SW1A 1AA, FQ123…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            style={{ flex: 1 }}
          />
          <button className="ps-btn ps-btn-primary" onClick={doSearch} disabled={searching || !searchTerm.trim()}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {searching ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-lg)' }}>
            <div className="loading-spinner" />
          </div>
        ) : results.length > 0 ? (
          <div>
            {results.map((ph) => {
              const isCurrent = myLink?.pharmacy_id === ph.id
              return (
                <div key={ph.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--ps-space-sm) var(--ps-space-md)',
                  borderBottom: '1px solid var(--ps-off-white)',
                  gap: 'var(--ps-space-md)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{ph.organisation_name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                      ODS: {ph.ods_code}
                      {ph.address1 && ` · ${ph.address1}`}
                      {ph.city && `, ${ph.city}`}
                      {ph.postcode && ` ${ph.postcode}`}
                    </div>
                  </div>
                  {isCurrent ? (
                    <span className="ps-badge ps-badge-green">Current</span>
                  ) : takenIds.has(ph.id) ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', flexShrink: 0 }}>
                      <span className="ps-badge" title="Another PharmStation account has linked this pharmacy">Already on PharmStation</span>
                      <button className="ps-btn ps-btn-ghost" onClick={() => { setDisputing(ph); setDisputeRef(null) }}>
                        This is ours
                      </button>
                    </span>
                  ) : !canManage ? (
                    <span className="ps-badge" title="Only owners and managers can link the pharmacy">Owners and managers only</span>
                  ) : !canLink ? (
                    <span className="ps-badge" title="Available once your pharmacy is verified">Awaiting verification</span>
                  ) : (
                    <button
                      className="ps-btn ps-btn-secondary"
                      style={{ flexShrink: 0 }}
                      onClick={() => handleLink(ph)}
                      disabled={loading}
                    >
                      {loading ? 'Linking…' : 'Link'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : searchTerm && !searching ? (
          <p style={{ color: 'var(--ps-slate)', textAlign: 'center', padding: 'var(--ps-space-lg)' }}>
            No pharmacies found for "{searchTerm}". Try a different search.
          </p>
        ) : null}
      </div>

      {disputing && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginTop: 'var(--ps-space-lg)' }}>
          <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Claim {disputing.organisation_name}</h3>
          <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }}>
            Another PharmStation account has linked this pharmacy. Tell us why it&rsquo;s yours (for example your GPhC premises
            number) and our team will check the register and move it to the right account.
          </p>
          <textarea
            className="ps-input"
            rows={3}
            value={disputeText}
            onChange={(e) => setDisputeText(e.target.value)}
            placeholder="e.g. We are the registered premises, GPhC 1234567"
            style={{ width: '100%', marginBottom: 'var(--ps-space-md)' }}
          />
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setDisputing(null)} disabled={disputeBusy}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleDispute} disabled={disputeBusy}>
              {disputeBusy ? 'Sending…' : 'Send to PharmStation'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
