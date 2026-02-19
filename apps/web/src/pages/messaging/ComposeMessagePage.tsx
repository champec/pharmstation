import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { MessageChannel, Patient } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

type Channel = 'sms' | 'email' | 'letter'

const CHANNELS: { value: Channel; label: string; icon: string }[] = [
  { value: 'sms', label: 'SMS', icon: '📱' },
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'letter', label: 'Letter', icon: '✉️' },
]

function smsFragments(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 160)
}

export function ComposeMessagePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { organisation, userProfile } = useAuthStore()
  const { sendMessage, fetchSettings, settings } = useMessagingStore()

  // Channel
  const initialChannel = (searchParams.get('channel') as Channel) || 'sms'
  const [channel, setChannel] = useState<Channel>(initialChannel)

  // Patient search
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)

  // Recipient
  const [phoneNumber, setPhoneNumber] = useState('')
  const [emailAddress, setEmailAddress] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [addressLine3, setAddressLine3] = useState('')
  const [addressLine4, setAddressLine4] = useState('')

  // Message content
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  // State
  const [sending, setSending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    if (organisation?.id) fetchSettings(organisation.id)
  }, [organisation?.id, fetchSettings])

  /* ---- Patient search ---- */
  const searchPatients = useCallback(async (query: string) => {
    if (!organisation?.id || query.trim().length < 2) { setPatientResults([]); return }
    try {
      const { data } = await getUserClient()
        .from('ps_patients')
        .select('*')
        .eq('organisation_id', organisation.id)
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(8)
      setPatientResults((data as Patient[]) || [])
    } catch { setPatientResults([]) }
  }, [organisation?.id])

  useEffect(() => {
    const timer = setTimeout(() => searchPatients(patientSearch), 300)
    return () => clearTimeout(timer)
  }, [patientSearch, searchPatients])

  const selectPatient = (p: Patient) => {
    setSelectedPatient(p)
    setPatientSearch('')
    setPatientResults([])
    if (p.phone) setPhoneNumber(p.phone)
    if (p.email) setEmailAddress(p.email)
    if (p.address_line_1) {
      setAddressLine1(`${p.first_name} ${p.last_name}`)
      setAddressLine2(p.address_line_1)
      setAddressLine3([p.city, p.postcode].filter(Boolean).join(', '))
      if (p.address_line_2) setAddressLine4(p.address_line_2)
    }
  }

  const clearPatient = () => {
    setSelectedPatient(null)
    setPhoneNumber('')
    setEmailAddress('')
    setAddressLine1('')
    setAddressLine2('')
    setAddressLine3('')
    setAddressLine4('')
  }

  /* ---- Validate ---- */
  const validate = (): string | null => {
    if (channel === 'sms' && !phoneNumber.trim()) return 'Phone number is required for SMS'
    if (channel === 'email' && !emailAddress.trim()) return 'Email address is required'
    if (channel === 'letter') {
      if (!addressLine1.trim() || !addressLine2.trim() || !addressLine3.trim()) {
        return 'At least 3 address lines are required for letters'
      }
    }
    if (!body.trim()) return 'Message body is required'
    return null
  }

  /* ---- Send ---- */
  const handleSend = async () => {
    const err = validate()
    if (err) { setFormError(err); return }
    if (!organisation?.id) return

    setSending(true)
    setFormError(null)

    try {
      const baseParams = {
        org_id: organisation.id,
        body: body.trim(),
        patient_id: selectedPatient?.id,
      }

      if (channel === 'sms') {
        await sendMessage({ action: 'send_sms', phone_number: phoneNumber.trim(), ...baseParams })
      } else if (channel === 'email') {
        await sendMessage({ action: 'send_email', email_address: emailAddress.trim(), subject: subject.trim() || undefined, ...baseParams })
      } else if (channel === 'letter') {
        const address: Record<string, string> = {
          address_line_1: addressLine1.trim(),
          address_line_2: addressLine2.trim(),
          address_line_3: addressLine3.trim(),
        }
        if (addressLine4.trim()) address.address_line_4 = addressLine4.trim()
        await sendMessage({ action: 'send_letter', address, ...baseParams })
      }
      setShowSuccess(true)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to send message')
    }
    setSending(false)
  }

  const resetForm = () => {
    clearPatient()
    setSubject('')
    setBody('')
    setFormError(null)
    setShowSuccess(false)
  }

  const isNotConfigured = !settings?.has_api_key || !settings?.is_active

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging" onClick={(e) => { e.preventDefault(); navigate('/messaging') }}>Messaging</a>
          <span className="separator">/</span>
          <span>Compose</span>
        </div>
        <h1>✏️ Compose Message</h1>
      </div>

      {isNotConfigured && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          Messaging is not configured. Please set up your NHS Notify API key in Settings first.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 'var(--ps-space-lg)', alignItems: 'start' }}>
        {/* Left: compose form */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          {/* Channel selector */}
          <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Channel</label>
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
              {CHANNELS.map((ch) => (
                <button
                  key={ch.value}
                  className={`ps-btn ${channel === ch.value ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                  onClick={() => setChannel(ch.value)}
                >
                  {ch.icon} {ch.label}
                </button>
              ))}
            </div>
          </div>

          {/* Patient search */}
          <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Patient (optional)</label>
            {selectedPatient ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)',
                padding: 'var(--ps-space-sm) var(--ps-space-md)',
                background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)',
              }}>
                <span style={{ fontWeight: 500 }}>{selectedPatient.first_name} {selectedPatient.last_name}</span>
                <span style={{ color: 'var(--ps-slate)', fontSize: '0.85rem' }}>
                  {selectedPatient.phone && `📱 ${selectedPatient.phone}`}
                  {selectedPatient.email && ` · 📧 ${selectedPatient.email}`}
                </span>
                <button className="ps-btn ps-btn-ghost" onClick={clearPatient} style={{ marginLeft: 'auto' }}>✕</button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  className="ps-input"
                  placeholder="Search patients by name, phone, or email..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                />
                {patientResults.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--ps-white)', border: '1px solid var(--ps-mist)',
                    borderRadius: 'var(--ps-radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    maxHeight: '200px', overflow: 'auto',
                  }}>
                    {patientResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => selectPatient(p)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: 'var(--ps-space-sm) var(--ps-space-md)',
                          border: 'none', background: 'none', cursor: 'pointer',
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.background = 'var(--ps-off-white)')}
                        onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <strong>{p.first_name} {p.last_name}</strong>
                        <span style={{ color: 'var(--ps-slate)', fontSize: '0.85rem', marginLeft: 'var(--ps-space-sm)' }}>
                          {p.phone || p.email || ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recipient fields */}
          {channel === 'sms' && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Phone Number *</label>
              <input
                className="ps-input"
                placeholder="+447900900123"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>
          )}

          {channel === 'email' && (
            <>
              <div style={{ marginBottom: 'var(--ps-space-md)' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Email Address *</label>
                <input
                  className="ps-input"
                  type="email"
                  placeholder="patient@example.com"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                />
              </div>
              <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Subject</label>
                <input
                  className="ps-input"
                  placeholder="Message from your pharmacy"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            </>
          )}

          {channel === 'letter' && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Address *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-xs)' }}>
                <input className="ps-input" placeholder="Address line 1 (name) *" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
                <input className="ps-input" placeholder="Address line 2 (street) *" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
                <input className="ps-input" placeholder="Address line 3 (city/postcode) *" value={addressLine3} onChange={(e) => setAddressLine3(e.target.value)} />
                <input className="ps-input" placeholder="Address line 4 (optional)" value={addressLine4} onChange={(e) => setAddressLine4(e.target.value)} />
              </div>
            </div>
          )}

          {/* Message body */}
          <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>
              Message *
              {channel === 'sms' && (
                <span style={{ fontWeight: 400, color: 'var(--ps-slate)', marginLeft: 'var(--ps-space-sm)', fontSize: '0.85rem' }}>
                  {body.length} chars · {smsFragments(body)} SMS fragment{smsFragments(body) !== 1 ? 's' : ''}
                </span>
              )}
            </label>
            <textarea
              className="ps-input"
              rows={8}
              placeholder="Type your message here..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Error */}
          {formError && (
            <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
              {formError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button
              className="ps-btn ps-btn-primary"
              onClick={handleSend}
              disabled={sending || isNotConfigured}
            >
              {sending ? 'Sending...' : `Send ${channel === 'sms' ? 'SMS' : channel === 'email' ? 'Email' : 'Letter'}`}
            </button>
            <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging')}>
              Cancel
            </button>
          </div>
        </div>

        {/* Right: preview */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h3 style={{ margin: '0 0 var(--ps-space-md)', fontSize: '0.95rem' }}>Preview</h3>

          {channel === 'sms' && (
            <div style={{
              background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-lg)',
              padding: 'var(--ps-space-md)', minHeight: '120px',
            }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-xs)' }}>
                📱 To: {phoneNumber || '—'}
              </div>
              <div style={{
                background: 'var(--ps-deep-blue)', color: 'white',
                padding: 'var(--ps-space-sm) var(--ps-space-md)',
                borderRadius: 'var(--ps-radius-md)',
                fontSize: '0.9rem', lineHeight: 1.4,
              }}>
                {body || 'Your message will appear here...'}
              </div>
            </div>
          )}

          {channel === 'email' && (
            <div style={{
              background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-lg)',
              padding: 'var(--ps-space-md)', minHeight: '120px',
            }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-xs)' }}>
                📧 To: {emailAddress || '—'}
              </div>
              <div style={{ fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>
                {subject || 'Message from your pharmacy'}
              </div>
              <div style={{ fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--ps-midnight)', whiteSpace: 'pre-wrap' }}>
                {body || 'Your message will appear here...'}
              </div>
            </div>
          )}

          {channel === 'letter' && (
            <div style={{
              background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-lg)',
              padding: 'var(--ps-space-md)', minHeight: '120px', fontFamily: 'serif',
            }}>
              <div style={{ marginBottom: 'var(--ps-space-md)', lineHeight: 1.6 }}>
                {addressLine1 && <div>{addressLine1}</div>}
                {addressLine2 && <div>{addressLine2}</div>}
                {addressLine3 && <div>{addressLine3}</div>}
                {addressLine4 && <div>{addressLine4}</div>}
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--ps-mist)', margin: 'var(--ps-space-sm) 0' }} />
              <div style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {body || 'Your letter content will appear here...'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Success modal */}
      <Modal isOpen={showSuccess} onClose={() => setShowSuccess(false)} title="Message Sent">
        <p style={{ color: 'var(--ps-slate)' }}>
          Your {channel === 'sms' ? 'SMS' : channel === 'email' ? 'email' : 'letter'} has been sent successfully.
          It may take a few moments for the delivery status to update.
        </p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
          <button className="ps-btn ps-btn-primary" onClick={() => { resetForm() }}>
            Send Another
          </button>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/messaging/history')}>
            View History
          </button>
          <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging')}>
            Back to Hub
          </button>
        </div>
      </Modal>
    </div>
  )
}
