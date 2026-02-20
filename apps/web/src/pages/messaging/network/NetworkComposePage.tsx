import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import type { NetworkPharmacy, NetworkMessageLabel } from '@pharmstation/types'
import { NETWORK_LABEL_CONFIG } from '@pharmstation/types'

type Step = 1 | 2 | 3

interface Recipient {
  orgId: string
  orgName: string
  pharmacyName: string
  ods: string
  city: string | null
  distanceKm: number | null
}

const LABEL_OPTIONS: NetworkMessageLabel[] = ['prescription_query', 'stock_query', 'community_alert', 'other']

export function NetworkComposePage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    searchResults, searchLoading, error,
    searchPharmacies, sendMessage, clearError,
  } = useNetworkStore()

  // Step state
  const [step, setStep] = useState<Step>(1)

  // Step 1 — recipient selection
  const [onlyPlatform, setOnlyPlatform] = useState(true)
  const [searchTerm, setSearchTerm]     = useState('')
  const [radiusKm, setRadiusKm]         = useState(10)
  const [recipients, setRecipients]     = useState<Recipient[]>([])

  // Step 2 — compose
  const [subject, setSubject]           = useState('')
  const [body, setBody]                 = useState('')
  const [label, setLabel]               = useState<NetworkMessageLabel>('other')
  const [requestSmsPing, setRequestSmsPing] = useState(false)

  // Step 3 — sending
  const [sending, setSending]           = useState(false)
  const [sent, setSent]                 = useState(false)

  const doSearch = useCallback(async () => {
    if (!organisation?.id) return
    await searchPharmacies({
      orgId: organisation.id,
      search: searchTerm,
      radiusKm,
      onlyPlatform,
      limit: 50,
    })
  }, [organisation?.id, searchTerm, radiusKm, onlyPlatform, searchPharmacies])

  useEffect(() => {
    doSearch()
  }, [onlyPlatform, radiusKm]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleRecipient(ph: NetworkPharmacy) {
    if (!ph.is_on_platform || !ph.linked_org_id) return
    const exists = recipients.find((r) => r.orgId === ph.linked_org_id)
    if (exists) {
      setRecipients((rs) => rs.filter((r) => r.orgId !== ph.linked_org_id))
    } else {
      setRecipients((rs) => [...rs, {
        orgId:        ph.linked_org_id!,
        orgName:      ph.linked_org_name ?? ph.organisation_name,
        pharmacyName: ph.organisation_name,
        ods:          ph.ods_code,
        city:         ph.city,
        distanceKm:   ph.distance_km,
      }])
    }
  }

  function isSelected(ph: NetworkPharmacy) {
    return recipients.some((r) => r.orgId === ph.linked_org_id)
  }

  async function handleSend() {
    if (!organisation?.id) return
    setSending(true)
    try {
      await sendMessage({
        fromOrgId:     organisation.id,
        toOrgIds:      recipients.map((r) => r.orgId),
        subject:       subject.trim() || undefined,
        body:          body.trim(),
        label,
        requestSmsPing,
      })
      setSent(true)
    } catch {
      // error shown via store
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div>
        <div className="page-header">
          <h1>✅ Message Sent</h1>
        </div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--ps-space-md)' }}>✅</div>
          <h2 style={{ marginBottom: 'var(--ps-space-sm)' }}>
            Message sent to {recipients.length} {recipients.length === 1 ? 'pharmacy' : 'pharmacies'}
          </h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            {requestSmsPing && 'SMS ping requests have been sent to pharmacies with text notifications enabled.'}
          </p>
          <div style={{ display: 'flex', gap: 'var(--ps-space-md)', justifyContent: 'center' }}>
            <button className="ps-btn ps-btn-primary" onClick={() => {
              setSent(false); setStep(1); setRecipients([]); setSubject(''); setBody(''); setLabel('other'); setRequestSmsPing(false)
            }}>
              Send Another
            </button>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/messaging/network')}>
              Back to Inbox
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging/network" onClick={(e) => { e.preventDefault(); navigate('/messaging/network') }}>Pharmacy Network</a>
          <span className="separator">/</span>
          <span>New Message</span>
        </div>
        <h1>📝 New Network Message</h1>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-lg)', alignItems: 'center' }}>
        {([1, 2, 3] as Step[]).map((s) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.9rem',
              background: step === s ? 'var(--ps-electric-cyan)' : step > s ? 'var(--ps-deep-blue)' : 'var(--ps-off-white)',
              color: step >= s ? '#fff' : 'var(--ps-slate)',
              cursor: step > s ? 'pointer' : undefined,
            }} onClick={() => { if (step > s) setStep(s) }}>
              {step > s ? '✓' : s}
            </div>
            <span style={{ fontWeight: step === s ? 700 : 400, color: step === s ? 'var(--ps-deep-blue)' : 'var(--ps-slate)', fontSize: '0.9rem' }}>
              {s === 1 ? 'Select Recipients' : s === 2 ? 'Compose' : 'Confirm'}
            </span>
            {s < 3 && <span style={{ color: 'var(--ps-slate)' }}>›</span>}
          </div>
        ))}
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost" onClick={clearError}>✕</button>
        </div>
      )}

      {/* ===== STEP 1: SELECT RECIPIENTS ===== */}
      {step === 1 && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--ps-space-lg)', alignItems: 'start' }}>
            {/* Search panel */}
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>Find Pharmacies</h3>

              {/* Filters */}
              <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    id="onlyPlatform"
                    checked={onlyPlatform}
                    onChange={(e) => setOnlyPlatform(e.target.checked)}
                  />
                  <label htmlFor="onlyPlatform" style={{ fontSize: '0.9rem', cursor: 'pointer' }}>
                    PharmStation only
                  </label>
                </div>

                <select
                  className="ps-input"
                  style={{ width: 'auto', padding: '4px 8px', fontSize: '0.85rem' }}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                >
                  <option value={2}>Within 2 km</option>
                  <option value={5}>Within 5 km</option>
                  <option value={10}>Within 10 km</option>
                  <option value={25}>Within 25 km</option>
                  <option value={50}>Within 50 km</option>
                  <option value={9999}>Any distance</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)' }}>
                <input
                  className="ps-input"
                  placeholder="Search by name, postcode or ODS code…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                  style={{ flex: 1 }}
                />
                <button className="ps-btn ps-btn-secondary" onClick={doSearch} disabled={searchLoading}>
                  {searchLoading ? '…' : '🔍'}
                </button>
              </div>

              {/* Results */}
              {searchLoading ? (
                <div style={{ textAlign: 'center', padding: 'var(--ps-space-xl)' }}>
                  <div className="loading-spinner" />
                </div>
              ) : searchResults.length === 0 ? (
                <p style={{ color: 'var(--ps-slate)', textAlign: 'center', padding: 'var(--ps-space-lg)' }}>
                  No pharmacies found. Try expanding the radius or unchecking "PharmStation only".
                </p>
              ) : (
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {searchResults.map((ph) => {
                    const selected = isSelected(ph)
                    const canSelect = ph.is_on_platform && !!ph.linked_org_id
                    return (
                      <div
                        key={ph.pharmacy_id}
                        style={{
                          padding: 'var(--ps-space-sm) var(--ps-space-md)',
                          borderBottom: '1px solid var(--ps-off-white)',
                          display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)',
                          cursor: canSelect ? 'pointer' : 'default',
                          background: selected ? '#f0faff' : undefined,
                          opacity: canSelect ? 1 : 0.6,
                        }}
                        onClick={() => canSelect && toggleRecipient(ph)}
                      >
                        <div style={{ flexShrink: 0 }}>
                          {canSelect
                            ? (selected
                              ? <span style={{ fontSize: '1.1rem' }}>✅</span>
                              : <span style={{ width: 18, height: 18, border: '2px solid var(--ps-slate)', borderRadius: 4, display: 'inline-block' }} />)
                            : <span style={{ fontSize: '1rem' }}>🏥</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ph.organisation_name}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                            {ph.ods_code}{ph.postcode && ` · ${ph.postcode}`}{ph.city && ` · ${ph.city}`}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          {ph.distance_km != null && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--ps-slate)' }}>
                              {ph.distance_km.toFixed(1)} km
                            </div>
                          )}
                          {ph.is_on_platform
                            ? <span className="ps-badge ps-badge-green" style={{ fontSize: '0.7rem' }}>On Platform</span>
                            : <span className="ps-badge" style={{ fontSize: '0.7rem' }}>Not on PharmStation</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Recipients panel */}
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>
                Recipients <span className="ps-badge ps-badge-blue">{recipients.length}</span>
              </h3>
              {recipients.length === 0 ? (
                <p style={{ color: 'var(--ps-slate)', fontSize: '0.9rem' }}>
                  Click on a pharmacy in the list to add them as a recipient.
                </p>
              ) : (
                <div>
                  {recipients.map((r) => (
                    <div key={r.orgId} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: 'var(--ps-space-xs) 0',
                      borderBottom: '1px solid var(--ps-off-white)',
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.pharmacyName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--ps-slate)' }}>
                          {r.ods}{r.city && ` · ${r.city}`}
                          {r.distanceKm != null && ` · ${r.distanceKm.toFixed(1)} km`}
                        </div>
                      </div>
                      <button
                        className="ps-btn ps-btn-ghost"
                        style={{ padding: '2px 6px', fontSize: '0.8rem' }}
                        onClick={() => setRecipients((rs) => rs.filter((x) => x.orgId !== r.orgId))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 'var(--ps-space-lg)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => setStep(2)}
              disabled={recipients.length === 0}
            >
              Next: Compose →
            </button>
          </div>
        </div>
      )}

      {/* ===== STEP 2: COMPOSE ===== */}
      {step === 2 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h3 style={{ margin: '0 0 var(--ps-space-lg)' }}>
            Composing for {recipients.length} {recipients.length === 1 ? 'recipient' : 'recipients'}
            {recipients.length > 1 && <span className="ps-badge ps-badge-amber" style={{ marginLeft: 8 }}>Broadcast</span>}
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)', maxWidth: 680 }}>
            {/* Label */}
            <div>
              <label className="ps-label">Message Type *</label>
              <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap', marginTop: 'var(--ps-space-xs)' }}>
                {LABEL_OPTIONS.map((l) => {
                  const cfg = NETWORK_LABEL_CONFIG[l]
                  return (
                    <button
                      key={l}
                      className={`ps-btn ${label === l ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                      style={{ fontSize: '0.85rem' }}
                      onClick={() => setLabel(l)}
                    >
                      {cfg.icon} {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Subject */}
            <div>
              <label className="ps-label">Subject <span style={{ color: 'var(--ps-slate)', fontWeight: 400 }}>(optional)</span></label>
              <input
                className="ps-input"
                placeholder="e.g. Do you have Metformin 500mg in stock?"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
              />
            </div>

            {/* Body */}
            <div>
              <label className="ps-label">Message *</label>
              <textarea
                className="ps-input"
                rows={6}
                placeholder="Write your message here…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2000}
                style={{ resize: 'vertical' }}
              />
              <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', textAlign: 'right', marginTop: 4 }}>
                {body.length} / 2000
              </div>
            </div>

            {/* SMS ping */}
            <div className="ps-card" style={{ padding: 'var(--ps-space-md)', background: 'var(--ps-off-white)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ps-space-sm)' }}>
                <input
                  type="checkbox"
                  id="smsPing"
                  checked={requestSmsPing}
                  onChange={(e) => setRequestSmsPing(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <label htmlFor="smsPing" style={{ fontWeight: 600, cursor: 'pointer' }}>
                    📱 Request SMS ping
                  </label>
                  <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
                    For urgent messages. Recipients with SMS notifications enabled will receive a text alert (if within their notification window).
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 'var(--ps-space-lg)', display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-ghost" onClick={() => setStep(1)}>← Back</button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => setStep(3)}
              disabled={!body.trim()}
            >
              Review →
            </button>
          </div>
        </div>
      )}

      {/* ===== STEP 3: CONFIRM ===== */}
      {step === 3 && (
        <div>
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }}>
            <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>Review Your Message</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)' }}>
              <span style={{ color: 'var(--ps-slate)', fontWeight: 600 }}>To:</span>
              <span>
                {recipients.length === 1
                  ? recipients[0].pharmacyName
                  : `${recipients.length} pharmacies (broadcast)`}
              </span>
              <span style={{ color: 'var(--ps-slate)', fontWeight: 600 }}>Type:</span>
              <span>
                <span className={NETWORK_LABEL_CONFIG[label].cssClass}>
                  {NETWORK_LABEL_CONFIG[label].icon} {NETWORK_LABEL_CONFIG[label].label}
                </span>
              </span>
              {subject && <>
                <span style={{ color: 'var(--ps-slate)', fontWeight: 600 }}>Subject:</span>
                <span>{subject}</span>
              </>}
              {requestSmsPing && <>
                <span style={{ color: 'var(--ps-slate)', fontWeight: 600 }}>SMS Ping:</span>
                <span>📱 Requested for eligible recipients</span>
              </>}
            </div>

            <div style={{
              background: 'var(--ps-off-white)',
              padding: 'var(--ps-space-md)',
              borderRadius: 'var(--ps-radius)',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              lineHeight: 1.6,
            }}>
              {body}
            </div>
          </div>

          {recipients.length > 1 && (
            <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', background: '#fff8e6' }}>
              <strong>📢 Broadcast:</strong> This message will be sent individually to {recipients.length} pharmacies.
              Replies will come to you as separate conversations — there are no group chats.
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-ghost" onClick={() => setStep(2)} disabled={sending}>
              ← Edit
            </button>
            <button className="ps-btn ps-btn-primary" onClick={handleSend} disabled={sending}>
              {sending ? 'Sending…' : `🚀 Send to ${recipients.length} ${recipients.length === 1 ? 'pharmacy' : 'pharmacies'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
