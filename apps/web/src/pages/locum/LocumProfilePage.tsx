import { useCallback, useEffect, useState } from 'react'
import { getLocumClient } from '@pharmstation/supabase-client'
import { useLocumAuthStore } from '@pharmstation/core'

type Tab = 'profile' | 'services' | 'documents' | 'payments'

interface ServiceOption { id: string; name: string; category: string }
interface DocRecord { id: string; doc_type: string; label: string | null; file_url: string; expiry_date: string | null; uploaded_at: string; is_current: boolean }

interface StripeStatus {
  status: string
  account_id?: string
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
}

/** Pull the real error message out of a failed functions.invoke call. */
async function extractFnError(err: unknown): Promise<string> {
  const anyErr = err as { context?: Response; message?: string }
  if (anyErr?.context && typeof anyErr.context.json === 'function') {
    try {
      const body = await anyErr.context.json()
      if (body?.error) return String(body.error)
    } catch { /* fall through */ }
  }
  return anyErr?.message ?? 'Request failed'
}

const DOC_TYPES = [
  { type: 'gphc_certificate',     label: 'GPhC Registration Certificate',    hasExpiry: true  },
  { type: 'indemnity_certificate', label: 'Indemnity Insurance Certificate',  hasExpiry: true  },
  { type: 'dbs_certificate',       label: 'DBS Certificate',                  hasExpiry: false },
  { type: 'proof_of_id',           label: 'Proof of Identity',                hasExpiry: false },
]

const CATEGORY_LABELS: Record<string, string> = {
  consultation: 'Consultations',
  nhs_advanced_service: 'NHS Advanced Services',
  pharmacy_first: 'Pharmacy First',
}

export function LocumProfilePage() {
  const { locumProfile, userProfile, refreshProfile } = useLocumAuthStore()
  const [tab, setTab] = useState<Tab>('profile')

  /* Profile tab */
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [gphcNumber, setGphcNumber] = useState('')
  const [gphcExpiry, setGphcExpiry] = useState('')
  const [indemnityProvider, setIndemnityProvider] = useState('')
  const [indemnityExpiry, setIndemnityExpiry] = useState('')
  const [dbsNumber, setDbsNumber] = useState('')
  const [dbsExpiry, setDbsExpiry] = useState('')
  const [niNumber, setNiNumber] = useState('')
  const [nhsEmail, setNhsEmail] = useState('')
  const [smartCardHeld, setSmartCardHeld] = useState(false)
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  /* Services tab */
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [loadingServices, setLoadingServices] = useState(false)
  const [savingServices, setSavingServices] = useState(false)
  const [servicesMsg, setServicesMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  /* Documents tab */
  const [documents, setDocuments] = useState<DocRecord[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null)
  const [expiryInputs, setExpiryInputs] = useState<Record<string, string>>({})
  const [docMsg, setDocMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [loadingDocUrl, setLoadingDocUrl] = useState<string | null>(null)

  /* Payments tab */
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null)
  const [loadingStripe, setLoadingStripe] = useState(false)
  const [startingOnboarding, setStartingOnboarding] = useState(false)
  const [payMsg, setPayMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setFirstName(userProfile?.first_name ?? '')
    setLastName(userProfile?.last_name ?? '')
  }, [userProfile])

  useEffect(() => {
    if (!locumProfile) return
    setGphcNumber(locumProfile.gphc_number ?? '')
    setGphcExpiry(locumProfile.gphc_expiry ?? '')
    setIndemnityProvider(locumProfile.indemnity_provider ?? '')
    setIndemnityExpiry(locumProfile.indemnity_expiry ?? '')
    setDbsNumber(locumProfile.dbs_number ?? '')
    setDbsExpiry(locumProfile.dbs_expiry ?? '')
    setNiNumber(locumProfile.ni_number ?? '')
    setNhsEmail(locumProfile.nhs_email ?? '')
    setSmartCardHeld(locumProfile.smart_card_held ?? false)
    setAddressLine1(locumProfile.address_line_1 ?? '')
    setAddressLine2(locumProfile.address_line_2 ?? '')
    setCity(locumProfile.city ?? '')
    setPostcode(locumProfile.postcode ?? '')
  }, [locumProfile])

  const loadServices = useCallback(async () => {
    if (!locumProfile?.id) return
    setLoadingServices(true)
    const client = getLocumClient()
    const [libRes, selRes] = await Promise.all([
      client.from('ps_service_library').select('id, name, category').order('category').order('name'),
      client.from('ps_locum_services').select('service_library_id').eq('locum_id', locumProfile.id),
    ])
    setServiceOptions((libRes.data as ServiceOption[]) ?? [])
    setSelectedServiceIds(
      ((selRes.data ?? []) as { service_library_id: string }[]).map((r) => r.service_library_id)
    )
    setLoadingServices(false)
  }, [locumProfile?.id])

  useEffect(() => {
    if (tab === 'services') loadServices()
  }, [tab, loadServices])

  const loadDocuments = useCallback(async () => {
    if (!locumProfile?.id) return
    setLoadingDocs(true)
    const { data } = await getLocumClient()
      .from('ps_locum_documents')
      .select('*')
      .eq('locum_id', locumProfile.id)
      .eq('is_current', true)
      .order('uploaded_at', { ascending: false })
    setDocuments((data ?? []) as DocRecord[])
    setLoadingDocs(false)
  }, [locumProfile?.id])

  useEffect(() => {
    if (tab === 'documents') loadDocuments()
  }, [tab, loadDocuments])

  /* ---- Stripe payments (Get Paid) ---- */
  const loadStripeStatus = useCallback(async () => {
    setLoadingStripe(true)
    setPayMsg(null)
    try {
      const { data, error } = await getLocumClient().functions.invoke('stripe-connect', {
        body: { action: 'get_status', entity: 'locum' },
      })
      if (error) throw error
      setStripeStatus(data as StripeStatus)
    } catch (err) {
      setPayMsg({ type: 'error', text: await extractFnError(err) })
    } finally {
      setLoadingStripe(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'payments') loadStripeStatus()
  }, [tab, loadStripeStatus])

  // Returning from Stripe onboarding (?stripe_return=1 / ?stripe_refresh=1) →
  // jump to the payments tab and refresh status.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('stripe_return') || params.has('stripe_refresh')) {
      setTab('payments')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function handleStartPayments() {
    setStartingOnboarding(true)
    setPayMsg(null)
    try {
      const origin = window.location.origin
      const { data, error } = await getLocumClient().functions.invoke('stripe-connect', {
        body: {
          action: 'start_onboarding',
          entity: 'locum',
          return_url: `${origin}/locum/profile?stripe_return=1`,
          refresh_url: `${origin}/locum/profile?stripe_refresh=1`,
        },
      })
      if (error) throw error
      if (data?.url) {
        window.location.href = data.url as string
        return
      }
      throw new Error('No onboarding URL returned')
    } catch (err) {
      setPayMsg({ type: 'error', text: await extractFnError(err) })
      setStartingOnboarding(false)
    }
  }

  async function handleUploadDoc(docType: string, file: File) {
    if (!locumProfile?.id || !userProfile?.id) return
    setUploadingDoc(docType)
    setDocMsg(null)
    try {
      const ext = file.name.split('.').pop() ?? 'pdf'
      const storagePath = `${userProfile.id}/${docType}/${Date.now()}.${ext}`
      const { error: upErr } = await getLocumClient()
        .storage.from('locum-documents')
        .upload(storagePath, file, { upsert: true })
      if (upErr) throw upErr

      // Mark any existing doc of this type as not current
      await getLocumClient()
        .from('ps_locum_documents')
        .update({ is_current: false })
        .eq('locum_id', locumProfile.id)
        .eq('doc_type', docType)

      // Insert new record
      const { error: dbErr } = await getLocumClient()
        .from('ps_locum_documents')
        .insert({
          locum_id: locumProfile.id,
          doc_type: docType,
          file_url: storagePath,
          expiry_date: expiryInputs[docType] || null,
          is_current: true,
        })
      if (dbErr) throw dbErr

      setDocMsg({ type: 'success', text: 'Document uploaded successfully.' })
      await loadDocuments()
    } catch (err) {
      setDocMsg({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed.' })
    } finally {
      setUploadingDoc(null)
    }
  }

  async function handleViewDoc(doc: DocRecord) {
    setLoadingDocUrl(doc.id)
    try {
      const { data, error } = await getLocumClient()
        .storage.from('locum-documents')
        .createSignedUrl(doc.file_url, 3600)
      if (error) throw error
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch {
      window.open(doc.file_url, '_blank', 'noopener,noreferrer')
    } finally {
      setLoadingDocUrl(null)
    }
  }

  async function handleDeleteDoc(doc: DocRecord) {
    if (!window.confirm('Remove this document?')) return
    await getLocumClient().storage.from('locum-documents').remove([doc.file_url])
    await getLocumClient().from('ps_locum_documents').update({ is_current: false }).eq('id', doc.id)
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!locumProfile?.id || !userProfile?.id) return
    setSavingProfile(true)
    setProfileMsg(null)
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
      const [{ error }, { error: nameErr }] = await Promise.all([
        getLocumClient()
          .from('ps_locum_profiles')
          .update({
            gphc_number: gphcNumber.trim(),
            gphc_expiry: gphcExpiry || null,
            indemnity_provider: indemnityProvider.trim(),
            indemnity_expiry: indemnityExpiry || null,
            dbs_number: dbsNumber.trim() || null,
            dbs_expiry: dbsExpiry || null,
            ni_number: niNumber.trim(),
            nhs_email: nhsEmail.trim() || null,
            smart_card_held: smartCardHeld,
            address_line_1: addressLine1.trim(),
            address_line_2: addressLine2.trim() || null,
            city: city.trim(),
            postcode: postcode.trim().toUpperCase(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', locumProfile.id),
        getLocumClient()
          .from('ps_user_profiles')
          .update({
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            full_name: fullName || (userProfile?.full_name ?? ''),
          })
          .eq('id', userProfile!.id),
      ])
      if (error) throw error
      if (nameErr) throw nameErr
      await refreshProfile()
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' })
    } catch (err) {
      setProfileMsg({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' })
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSaveServices() {
    if (!locumProfile?.id) return
    setSavingServices(true)
    setServicesMsg(null)
    try {
      const client = getLocumClient()
      await client.from('ps_locum_services').delete().eq('locum_id', locumProfile.id)
      if (selectedServiceIds.length > 0) {
        const { error } = await client.from('ps_locum_services').insert(
          selectedServiceIds.map((sid) => ({ locum_id: locumProfile.id, service_library_id: sid }))
        )
        if (error) throw error
      }
      setServicesMsg({ type: 'success', text: 'Services updated.' })
    } catch (err) {
      setServicesMsg({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' })
    } finally {
      setSavingServices(false)
    }
  }

  function toggleService(id: string) {
    setSelectedServiceIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id])
  }

  const grouped = serviceOptions.reduce<Record<string, ServiceOption[]>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})

  function expiryWarning(expiry: string) {
    if (!expiry) return null
    const days = (new Date(expiry).getTime() - Date.now()) / 86400000
    if (days < 0) return <span className="form-hint form-hint-error">Expired!</span>
    if (days < 30) return <span className="form-hint form-hint-warning">Expires in {Math.ceil(days)} days</span>
    return null
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">My Profile</h1>
        <p className="page-subtitle">
          {userProfile?.first_name && userProfile?.last_name
            ? `${userProfile.first_name} ${userProfile.last_name}`
            : userProfile?.full_name}
        </p>
      </div>

      <div className="ps-tabs" style={{ marginBottom: '1.5rem' }}>
        {(['profile', 'services', 'documents', 'payments'] as Tab[]).map((t) => (
          <button key={t} className={`ps-tab${tab === t ? ' active' : ''}`} onClick={() => { setTab(t); setProfileMsg(null); setServicesMsg(null); setPayMsg(null) }}>
            {t === 'profile' ? 'Compliance Details' : t === 'services' ? 'My Services' : t === 'documents' ? 'Documents' : '💰 Get Paid'}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <form onSubmit={handleSaveProfile} style={{ maxWidth: 640 }}>
          {profileMsg && <div className={`ps-alert ps-alert-${profileMsg.type}`} style={{ marginBottom: '1rem' }}>{profileMsg.text}</div>}

          <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
            <div className="ps-card-header"><h2 className="ps-card-title">Personal Details</h2></div>
            <div className="ps-card-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">First Name</label>
                  <input className="form-input" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Last Name</label>
                  <input className="form-input" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
            <div className="ps-card-header"><h2 className="ps-card-title">GPhC Registration</h2></div>
            <div className="ps-card-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">GPhC Number</label>
                  <input className="form-input" type="text" value={gphcNumber} onChange={(e) => setGphcNumber(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Expiry Date</label>
                  <input className="form-input" type="date" value={gphcExpiry} onChange={(e) => setGphcExpiry(e.target.value)} />
                  {expiryWarning(gphcExpiry)}
                </div>
              </div>
            </div>
          </div>

          <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
            <div className="ps-card-header"><h2 className="ps-card-title">Indemnity Insurance</h2></div>
            <div className="ps-card-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Provider</label>
                  <input className="form-input" type="text" value={indemnityProvider} onChange={(e) => setIndemnityProvider(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Expiry Date</label>
                  <input className="form-input" type="date" value={indemnityExpiry} onChange={(e) => setIndemnityExpiry(e.target.value)} />
                  {expiryWarning(indemnityExpiry)}
                </div>
              </div>
            </div>
          </div>

          <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
            <div className="ps-card-header"><h2 className="ps-card-title">DBS &amp; Personal</h2></div>
            <div className="ps-card-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">DBS Certificate Number</label>
                  <input className="form-input" type="text" value={dbsNumber} onChange={(e) => setDbsNumber(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">DBS Issue Date</label>
                  <input className="form-input" type="date" value={dbsExpiry} onChange={(e) => setDbsExpiry(e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">NI Number</label>
                  <input className="form-input" type="text" value={niNumber} onChange={(e) => setNiNumber(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">NHS Email</label>
                  <input className="form-input" type="email" value={nhsEmail} onChange={(e) => setNhsEmail(e.target.value)} />
                </div>
              </div>
              <label className="ps-checkbox-label" style={{ marginTop: '0.5rem' }}>
                <input type="checkbox" checked={smartCardHeld} onChange={(e) => setSmartCardHeld(e.target.checked)} />
                I hold an NHS Smartcard
              </label>
            </div>
          </div>

          <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
            <div className="ps-card-header"><h2 className="ps-card-title">Home Address</h2></div>
            <div className="ps-card-body">
              <div className="form-group">
                <label className="form-label">Address Line 1</label>
                <input className="form-input" type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Address Line 2</label>
                <input className="form-input" type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">City</label>
                  <input className="form-input" type="text" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Postcode</label>
                  <input className="form-input" type="text" value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())} />
                </div>
              </div>
            </div>
          </div>

          <button type="submit" className="ps-btn ps-btn-primary" disabled={savingProfile}>
            {savingProfile ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      )}

      {tab === 'services' && (
        <div style={{ maxWidth: 640 }}>
          {servicesMsg && <div className={`ps-alert ps-alert-${servicesMsg.type}`} style={{ marginBottom: '1rem' }}>{servicesMsg.text}</div>}
          {loadingServices ? (
            <div className="loading-indicator">Loading…</div>
          ) : (
            <>
              <p className="text-muted" style={{ marginBottom: '1rem' }}>
                Select all services you are qualified to provide. Pharmacies use this to filter eligible locums for shifts.
              </p>
              <div className="ps-card" style={{ marginBottom: '1rem' }}>
                <div className="ps-card-body">
                  {Object.entries(grouped).map(([cat, svcs]) => (
                    <div key={cat} style={{ marginBottom: '1.25rem' }}>
                      <h4 style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ps-slate)', marginBottom: '0.5rem' }}>
                        {CATEGORY_LABELS[cat] ?? cat}
                      </h4>
                      {svcs.map((svc) => (
                        <label key={svc.id} className="ps-checkbox-label" style={{ padding: '3px 0' }}>
                          <input type="checkbox" checked={selectedServiceIds.includes(svc.id)} onChange={() => toggleService(svc.id)} />
                          {svc.name}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <button className="ps-btn ps-btn-primary" onClick={handleSaveServices} disabled={savingServices}>
                {savingServices ? 'Saving…' : `Save Services (${selectedServiceIds.length} selected)`}
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div style={{ maxWidth: 700 }}>
          {docMsg && <div className={`ps-alert ps-alert-${docMsg.type}`} style={{ marginBottom: '1rem' }}>{docMsg.text}</div>}
          {loadingDocs ? (
            <div className="loading-indicator">Loading…</div>
          ) : (
            DOC_TYPES.map((dt) => {
              const existing = documents.find((d) => d.doc_type === dt.type)
              const isExpired = existing?.expiry_date
                ? new Date(existing.expiry_date) < new Date()
                : false
              const expiringSOon = existing?.expiry_date && !isExpired
                ? (new Date(existing.expiry_date).getTime() - Date.now()) / 86400000 < 30
                : false

              return (
                <div key={dt.type} className="ps-card" style={{ marginBottom: '0.75rem' }}>
                  <div className="ps-card-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{dt.label}</span>
                          {existing
                            ? isExpired
                              ? <span className="ps-badge ps-badge-danger">Expired</span>
                              : expiringSOon
                                ? <span className="ps-badge ps-badge-warning">Expiring soon</span>
                                : <span className="ps-badge ps-badge-success">Uploaded</span>
                            : <span className="ps-badge ps-badge-warning">Pending</span>
                          }
                        </div>
                        {existing?.expiry_date && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                            Expiry: {new Date(existing.expiry_date).toLocaleDateString('en-GB')}
                          </div>
                        )}
                        {existing && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                            Uploaded: {new Date(existing.uploaded_at).toLocaleDateString('en-GB')}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        {existing && (
                          <>
                            <button
                              className="ps-btn ps-btn-ghost ps-btn-sm"
                              onClick={() => handleViewDoc(existing)}
                              disabled={loadingDocUrl === existing.id}
                            >
                              {loadingDocUrl === existing.id ? '…' : 'View'}
                            </button>
                            <button
                              className="ps-btn ps-btn-ghost ps-btn-sm"
                              onClick={() => handleDeleteDoc(existing)}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      {dt.hasExpiry && (
                        <div className="form-group" style={{ margin: 0, minWidth: 160 }}>
                          <label className="form-label" style={{ fontSize: '0.78rem' }}>Expiry Date</label>
                          <input
                            className="form-input"
                            type="date"
                            value={expiryInputs[dt.type] ?? ''}
                            onChange={(e) => setExpiryInputs((p) => ({ ...p, [dt.type]: e.target.value }))}
                          />
                        </div>
                      )}
                      <div>
                        <label className="ps-btn ps-btn-primary ps-btn-sm" style={{ cursor: 'pointer' }}>
                          {uploadingDoc === dt.type ? 'Uploading…' : existing ? 'Replace' : 'Upload'}
                          <input
                            type="file"
                            accept="application/pdf,image/jpeg,image/png,image/webp"
                            style={{ display: 'none' }}
                            disabled={uploadingDoc === dt.type}
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              if (f) handleUploadDoc(dt.type, f)
                              e.target.value = ''
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div style={{ maxWidth: 640 }}>
          {payMsg && <div className={`ps-alert ps-alert-${payMsg.type}`} style={{ marginBottom: '1rem' }}>{payMsg.text}</div>}
          <div className="ps-card">
            <div className="ps-card-header">
              <h2 className="ps-card-title">💰 Get paid by pharmacies</h2>
            </div>
            <div className="ps-card-body">
              {loadingStripe ? (
                <div className="loading-indicator">Checking payment account…</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Payment account status:</span>
                    {stripeStatus?.status === 'active' ? (
                      <span className="ps-badge ps-badge-success">Active — ready to receive payments</span>
                    ) : stripeStatus?.status === 'pending_verification' ? (
                      <span className="ps-badge ps-badge-warning">Pending verification</span>
                    ) : stripeStatus?.status === 'onboarding' ? (
                      <span className="ps-badge ps-badge-warning">Onboarding incomplete</span>
                    ) : (
                      <span className="ps-badge">Not set up</span>
                    )}
                  </div>

                  <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
                    Connect a payment account so pharmacies can pay your invoices directly.
                    You'll be taken to Stripe to verify your identity and add your bank details —
                    PharmStation never sees or stores your banking information.
                  </p>

                  {stripeStatus?.status === 'active' ? (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="ps-btn ps-btn-ghost" onClick={loadStripeStatus}>
                        Refresh status
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        className="ps-btn ps-btn-primary"
                        onClick={handleStartPayments}
                        disabled={startingOnboarding}
                      >
                        {startingOnboarding
                          ? 'Redirecting to Stripe…'
                          : stripeStatus?.status === 'not_onboarded' || !stripeStatus
                            ? 'Set up payments'
                            : 'Continue setup'}
                      </button>
                      <button className="ps-btn ps-btn-ghost" onClick={loadStripeStatus} disabled={startingOnboarding}>
                        Refresh status
                      </button>
                    </div>
                  )}

                  {stripeStatus?.account_id && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--ps-slate)' }}>
                      Account: {stripeStatus.account_id}
                      {' · '}Charges: {stripeStatus.charges_enabled ? '✓' : '✗'}
                      {' · '}Payouts: {stripeStatus.payouts_enabled ? '✓' : '✗'}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
