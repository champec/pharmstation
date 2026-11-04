import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import { PublicSiteShell } from '../../components/public/PublicSiteShell'

// Public contact page and in-app "Help & support". Messages become a
// ps_support_tickets row and are emailed to the matching team inbox by the
// support-request edge function.

const TOPICS = [
  { value: 'support', label: 'Help with PharmStation' },
  { value: 'sales', label: 'Book a demo or ask about pricing' },
  { value: 'billing', label: 'Billing' },
  { value: 'privacy', label: 'Data protection or privacy request' },
  { value: 'safety', label: 'Report a clinical safety concern' },
  { value: 'other', label: 'Something else' },
]

const ADDRESSES = [
  { email: 'support@pharmstation.co.uk', label: 'Help using PharmStation' },
  { email: 'hello@pharmstation.co.uk', label: 'Demos, pricing and partnerships' },
  { email: 'privacy@pharmstation.co.uk', label: 'Data protection requests' },
  { email: 'safety@pharmstation.co.uk', label: 'Clinical safety concerns' },
  { email: 'security@pharmstation.co.uk', label: 'Report a security issue' },
]

export function ContactPage() {
  const { organisation, activeUser, isUserLoggedIn } = useAuthStore()
  const inApp = isUserLoggedIn && !!organisation

  const [topic, setTopic] = useState(() => new URLSearchParams(window.location.search).get('topic') || 'support')
  const [name, setName] = useState(activeUser?.full_name ?? '')
  const [email, setEmail] = useState(activeUser?.email ?? '')
  const [phone, setPhone] = useState('')
  const [organisationName, setOrganisationName] = useState(organisation?.name ?? '')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentReference, setSentReference] = useState<string | null>(null)

  // The signed-in profile can arrive after first render.
  useEffect(() => {
    if (activeUser?.full_name) setName((v) => v || activeUser.full_name)
    if (activeUser?.email) setEmail((v) => v || activeUser.email || '')
    if (organisation?.name) setOrganisationName((v) => v || organisation.name)
  }, [activeUser, organisation])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError(null)
    const { data, error: fnError } = await getUserClient().functions.invoke('support-request', {
      body: {
        topic, name, email, phone, organisation_name: organisationName, message, website,
        source: inApp ? 'app' : 'public',
        org_id: inApp ? organisation?.id : null,
      },
    })
    setSending(false)
    if (fnError || !data?.ok) {
      let msg = data?.error as string | undefined
      if (!msg && fnError && 'context' in fnError) {
        try { msg = (await (fnError as { context: Response }).context.json()).error } catch { /* ignore */ }
      }
      setError(msg || 'Sorry, your message could not be sent. Please email support@pharmstation.co.uk.')
      return
    }
    setSentReference(data.reference)
  }

  return (
    <PublicSiteShell>
      <header className="public-page-head">
        <span className="landing-eyebrow">Contact</span>
        <h1>{inApp ? 'Help and support' : 'Contact PharmStation'}</h1>
        <p>Send us a message and we will reply by email, usually within one working day.</p>
      </header>

      <div className="contact-layout">
        <section className="public-panel">
          {sentReference ? (
            <div className="contact-sent" role="status">
              <h2>Thanks, we have your message</h2>
              <p>Your reference is <strong>{sentReference}</strong>. We will reply to {email}.</p>
              {topic === 'safety' && (
                <p>If a patient is at immediate risk, call 999. For urgent medical advice, call NHS 111.</p>
              )}
              <button type="button" className="ps-btn ps-btn-ghost" onClick={() => { setSentReference(null); setMessage('') }}>
                Send another message
              </button>
            </div>
          ) : (
            <form className="contact-form" onSubmit={submit}>
              <div className="form-group">
                <label htmlFor="contact-topic">What is it about?</label>
                <select id="contact-topic" className="ps-input" value={topic} onChange={(e) => setTopic(e.target.value)}>
                  {TOPICS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="contact-form-row">
                <div className="form-group">
                  <label htmlFor="contact-name">Your name</label>
                  <input id="contact-name" className="ps-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
                </div>
                <div className="form-group">
                  <label htmlFor="contact-email">Email</label>
                  <input id="contact-email" type="email" className="ps-input" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
                </div>
              </div>
              <div className="contact-form-row">
                <div className="form-group">
                  <label htmlFor="contact-org">Pharmacy or organisation <span className="contact-optional">(optional)</span></label>
                  <input id="contact-org" className="ps-input" value={organisationName} onChange={(e) => setOrganisationName(e.target.value)} maxLength={200} autoComplete="organization" />
                </div>
                <div className="form-group">
                  <label htmlFor="contact-phone">Phone <span className="contact-optional">(optional)</span></label>
                  <input id="contact-phone" type="tel" className="ps-input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="tel" />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="contact-message">Message</label>
                <textarea id="contact-message" className="ps-input" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={5000} />
                {topic !== 'privacy' && topic !== 'safety' && (
                  <small className="contact-hint">Please don't include patient details. We'll ask for them securely if we need them.</small>
                )}
              </div>
              {/* Hidden from people; bots tend to fill it in. */}
              <div className="contact-honeypot" aria-hidden="true">
                <label htmlFor="contact-website">Website</label>
                <input id="contact-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
              {error && <div className="auth-error" role="alert">{error}</div>}
              <button type="submit" className="ps-btn ps-btn-primary" disabled={sending}>
                {sending ? 'Sending…' : 'Send message'}
              </button>
              <p className="contact-hint">
                We use your details only to reply. See our <Link to="/privacy">privacy notice</Link>.
              </p>
            </form>
          )}
        </section>

        <aside className="public-panel">
          <h2>Email us directly</h2>
          <ul className="contact-addresses">
            {ADDRESSES.map((a) => (
              <li key={a.email}>
                <a href={`mailto:${a.email}`}>{a.email}</a>
                <span>{a.label}</span>
              </li>
            ))}
          </ul>
          <p className="contact-hint">For a medical emergency call 999. For urgent medical advice, call NHS 111.</p>
        </aside>
      </div>
    </PublicSiteShell>
  )
}
