import { useState, useEffect, useCallback } from 'react'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import type { SmsTemplate } from '@pharmstation/types'

// ============================================================
// Messaging Settings — SMS Works first (platform SMS provider)
//
// GOV.UK Notify no longer supports community pharmacies, so SMS for
// every org is delivered through the platform SMS Works account:
//   • per-pharmacy sender identity (alpha sender ID or two-way reply number)
//   • pharmacy-authored {{placeholder}} templates + signature
//   • usage metering per org for chargeback billing
// NHS Notify (email / letters) remains available ONLY to NHS-affiliated
// organisations (NHS-funded, hospital, military, prison) via the
// nhs_channels_enabled flag.
// ============================================================

const TEMPLATE_CATEGORIES = ['appointment', 'reminder', 'video', 'delivery', 'collection', 'custom'] as const

/** Mirror of the server-side segment estimator — indicative only. */
function estimateSegments(text: string): number {
  const len = text.length
  if (len === 0) return 0
  return len <= 160 ? 1 : Math.ceil(len / 153)
}

const cardStyle: React.CSSProperties = { padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }
const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-xs)', fontSize: '0.9rem' }
const hintStyle: React.CSSProperties = { color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }

export function MessagingSettingsTab() {
  const { organisation } = useAuthStore()
  const {
    routing, fetchRouting,
    smsSettings, fetchSmsSettings, saveSmsSettings, testSmsConnection,
    smsTemplates, fetchSmsTemplates, saveSmsTemplate, deleteSmsTemplate,
    assignReplyNumber, releaseReplyNumber,
    usage, fetchSmsUsage,
    error, clearError,
  } = useMessagingStore()

  // ── Form state (SMS Works) ──
  const [senderType, setSenderType] = useState<'alpha' | 'number'>('alpha')
  const [senderId, setSenderId] = useState('')
  const [signature, setSignature] = useState('')
  const [replyForwardEmail, setReplyForwardEmail] = useState('')
  const [isActive, setIsActive] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyNotice, setReplyNotice] = useState<string | null>(null)

  // ── Template editor state ──
  const [editingTemplate, setEditingTemplate] = useState<Partial<SmsTemplate> | null>(null)
  const [templateBusy, setTemplateBusy] = useState(false)

  const orgId = organisation?.id

  useEffect(() => {
    if (!orgId) return
    fetchRouting(orgId)
    fetchSmsSettings(orgId)
    fetchSmsTemplates(orgId)
    fetchSmsUsage(orgId)
  }, [orgId, fetchRouting, fetchSmsSettings, fetchSmsTemplates, fetchSmsUsage])

  useEffect(() => {
    if (smsSettings) {
      setSenderType(smsSettings.sender_type === 'number' ? 'number' : 'alpha')
      setSenderId(smsSettings.sender_id || '')
      setSignature(smsSettings.signature || '')
      setReplyForwardEmail(smsSettings.reply_forward_email || '')
      setIsActive(smsSettings.is_active)
    }
  }, [smsSettings])

  const senderValid = senderType === 'number' || !senderId.trim() || /^[a-zA-Z0-9]{3,11}$/.test(senderId.trim())

  const handleSave = async () => {
    if (!orgId) return
    setSaving(true)
    setSaveSuccess(false)
    try {
      await saveSmsSettings({
        org_id: orgId,
        sender_type: senderType,
        sender_id: senderId.trim() || undefined,
        signature: signature.trim() || undefined,
        reply_forward_email: replyForwardEmail.trim() || undefined,
        is_active: isActive,
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2500)
    } catch { /* surfaced via error banner */ }
    setSaving(false)
  }

  const handleTest = async () => {
    if (!orgId) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testSmsConnection(orgId)
      setTestResult(result.valid
        ? { success: true, message: `Connected — platform balance: ${result.balance ?? 'n/a'} credits.` }
        : { success: false, message: result.error || 'Connection failed' })
    } catch (e: unknown) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : 'Connection failed' })
    }
    setTesting(false)
  }

  const handleRequestReplyNumber = async () => {
    if (!orgId) return
    setReplyBusy(true)
    setReplyNotice(null)
    try {
      const result = await assignReplyNumber(orgId)
      if (result.assigned) {
        setReplyNotice(`✓ Reply number assigned: ${result.phone_number}`)
        setSenderType('number')
      } else if (result.pending_provisioning) {
        setReplyNotice(result.message ?? 'A number will be provisioned shortly.')
      }
    } catch (e: unknown) {
      setReplyNotice(e instanceof Error ? e.message : 'Failed to request a reply number')
    }
    setReplyBusy(false)
  }

  const handleReleaseReplyNumber = async () => {
    if (!orgId) return
    if (!window.confirm('Release your reply number? Patients will no longer be able to reply to your messages, and the monthly rental stops.')) return
    setReplyBusy(true)
    setReplyNotice(null)
    try {
      await releaseReplyNumber(orgId)
      setSenderType('alpha')
      setReplyNotice('Reply number released.')
    } catch (e: unknown) {
      setReplyNotice(e instanceof Error ? e.message : 'Failed to release the reply number')
    }
    setReplyBusy(false)
  }

  const handleSaveTemplate = async () => {
    if (!orgId || !editingTemplate) return
    if (!editingTemplate.name?.trim() || !editingTemplate.body?.trim()) return
    setTemplateBusy(true)
    try {
      await saveSmsTemplate({
        org_id: orgId,
        id: editingTemplate.id,
        name: editingTemplate.name.trim(),
        category: editingTemplate.category || 'custom',
        body: editingTemplate.body,
        description: editingTemplate.description?.trim() || undefined,
        is_active: editingTemplate.is_active ?? true,
      })
      setEditingTemplate(null)
    } catch { /* surfaced via error banner */ }
    setTemplateBusy(false)
  }

  const handleDeleteTemplate = useCallback(async (t: SmsTemplate) => {
    if (!orgId) return
    if (!window.confirm(`Delete template "${t.name}"?`)) return
    try { await deleteSmsTemplate(orgId, t.id) } catch { /* surfaced via error banner */ }
  }, [orgId, deleteSmsTemplate])

  const fmtPence = (p: number) => `£${(p / 100).toFixed(2)}`

  return (
    <div>
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error} <button className="ps-btn ps-btn-ghost" onClick={clearError}>Dismiss</button>
        </div>
      )}
      {saveSuccess && (
        <div style={{
          padding: 'var(--ps-space-sm) var(--ps-space-md)',
          background: 'var(--ps-ice-blue)', borderRadius: 'var(--ps-radius-md)',
          marginBottom: 'var(--ps-space-md)', color: 'var(--ps-deep-blue)',
        }}>
          ✓ SMS settings saved
        </div>
      )}

      {/* ── Status ── */}
      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>📱 SMS (via SMS Works)</h3>
        <p style={hintStyle}>
          Text messages are sent through PharmStation's SMS gateway — no account or API key needed.
          Usage is metered per pharmacy and billed monthly.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            background: smsSettings?.is_active ? 'var(--ps-success)' : 'var(--ps-warning)',
          }} />
          <span>{smsSettings?.is_active ? 'SMS messaging is enabled' : 'SMS messaging is disabled'}</span>
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Enable SMS
          </label>
          <button className="ps-btn ps-btn-secondary" disabled={testing} onClick={handleTest}>
            {testing ? 'Testing…' : '🔌 Test Connection'}
          </button>
        </div>
        {testResult && (
          <div style={{ marginTop: 'var(--ps-space-sm)', fontSize: '0.9rem', color: testResult.success ? 'var(--ps-success)' : 'var(--ps-error)' }}>
            {testResult.success ? '✓' : '✗'} {testResult.message}
          </div>
        )}
      </div>

      {/* ── Sender identity ── */}
      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Sender Identity</h3>
        <p style={hintStyle}>
          Choose how your messages appear to patients. A <strong>name</strong> looks professional but patients
          can't reply; a <strong>reply number</strong> lets patients text you back.
        </p>

        <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }}>
          {([
            { key: 'alpha' as const, title: 'Pharmacy name', desc: '3–11 letters/numbers, one-way' },
            { key: 'number' as const, title: 'Reply number', desc: 'two-way — patients can reply', disabled: !smsSettings?.reply_number },
          ]).map((opt) => (
            <label key={opt.key} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)',
              cursor: opt.disabled ? 'not-allowed' : 'pointer', padding: 'var(--ps-space-sm) var(--ps-space-md)',
              borderRadius: 'var(--ps-radius-md)', opacity: opt.disabled ? 0.55 : 1,
              border: senderType === opt.key ? '2px solid var(--ps-deep-blue)' : '2px solid var(--ps-mist)',
              background: senderType === opt.key ? 'rgba(0,48,135,0.04)' : 'transparent',
            }}>
              <input type="radio" name="sender-type" disabled={opt.disabled} checked={senderType === opt.key} onChange={() => setSenderType(opt.key)} />
              <div>
                <div style={{ fontWeight: 600 }}>{opt.title}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {senderType === 'alpha' && (
          <div style={{ marginBottom: 'var(--ps-space-md)' }}>
            <label style={labelStyle}>Sender name</label>
            <input
              className="ps-input"
              placeholder={organisation?.name ? organisation.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 11) : 'e.g. Hollowtree'}
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              maxLength={11}
              style={{ maxWidth: 280 }}
            />
            <div style={{ fontSize: '0.8rem', marginTop: 4, color: senderValid ? 'var(--ps-slate)' : 'var(--ps-error)' }}>
              {senderValid
                ? 'Letters and numbers only, 3–11 characters. Generic words (e.g. "Pharmacy", "Alert", "Reminder") are rejected by the carrier — use your pharmacy\'s name.'
                : '✗ Must be 3–11 letters/numbers with no spaces or symbols'}
            </div>
          </div>
        )}
        {senderType === 'number' && smsSettings?.reply_number && (
          <div style={{ marginBottom: 'var(--ps-space-md)', fontFamily: 'monospace', fontSize: '1rem' }}>
            Sending from: <strong>{smsSettings.reply_number}</strong>
          </div>
        )}

        <label style={labelStyle}>Signature (appended to every SMS)</label>
        <input
          className="ps-input"
          placeholder={`e.g. — ${organisation?.name ?? 'Your Pharmacy'}`}
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          style={{ maxWidth: 420 }}
        />
      </div>

      {/* ── Two-way replies ── */}
      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Two-way Replies</h3>
        <p style={hintStyle}>
          Rent a dedicated virtual number so patients can reply to your messages. Replies appear in your
          Messaging inbox. Adds a monthly rental to your bill{smsSettings?.reply_number ? '' : ' (typically £5/month)'}.
        </p>

        {smsSettings?.reply_enabled && smsSettings.reply_number ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
            <span style={{
              padding: 'var(--ps-space-xs) var(--ps-space-sm)', background: 'var(--ps-ice-blue)',
              borderRadius: 'var(--ps-radius-sm)', fontFamily: 'monospace', fontWeight: 600,
            }}>
              {smsSettings.reply_number}
            </span>
            <span style={{ color: 'var(--ps-success)', fontSize: '0.9rem' }}>✓ Two-way messaging active</span>
            <button className="ps-btn ps-btn-ghost" disabled={replyBusy} onClick={handleReleaseReplyNumber} style={{ marginLeft: 'auto', color: 'var(--ps-error)' }}>
              {replyBusy ? 'Working…' : 'Release number'}
            </button>
          </div>
        ) : (
          <button className="ps-btn ps-btn-secondary" disabled={replyBusy} onClick={handleRequestReplyNumber}>
            {replyBusy ? 'Requesting…' : '📞 Request a reply number'}
          </button>
        )}
        {replyNotice && <div style={{ marginTop: 'var(--ps-space-sm)', fontSize: '0.9rem', color: 'var(--ps-slate)' }}>{replyNotice}</div>}

        <div style={{ marginTop: 'var(--ps-space-md)' }}>
          <label style={labelStyle}>Forward replies to email (optional)</label>
          <input
            className="ps-input"
            type="email"
            placeholder="e.g. dispensary@yourpharmacy.co.uk"
            value={replyForwardEmail}
            onChange={(e) => setReplyForwardEmail(e.target.value)}
            style={{ maxWidth: 420 }}
          />
        </div>
      </div>

      {/* ── Templates ── */}
      <div className="ps-card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--ps-space-sm)' }}>
          <h3 style={{ margin: 0 }}>Message Templates</h3>
          <button
            className="ps-btn ps-btn-secondary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setEditingTemplate({ category: 'custom', is_active: true })}
          >
            ＋ New template
          </button>
        </div>
        <p style={hintStyle}>
          Write reusable messages with placeholders like <code>{'{{first_name}}'}</code>, <code>{'{{date}}'}</code> or{' '}
          <code>{'{{time}}'}</code> — they're filled in per patient when sending. Your signature is added automatically.
        </p>

        {editingTemplate && (
          <div style={{ border: '2px solid var(--ps-mist)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
            <div style={{ display: 'flex', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={labelStyle}>Name</label>
                <input className="ps-input" placeholder="e.g. Prescription ready" value={editingTemplate.name ?? ''}
                  onChange={(e) => setEditingTemplate((t) => ({ ...t, name: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Category</label>
                <select className="ps-input" value={editingTemplate.category ?? 'custom'}
                  onChange={(e) => setEditingTemplate((t) => ({ ...t, category: e.target.value }))}>
                  {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <label style={labelStyle}>Message</label>
            <textarea
              className="ps-input"
              rows={3}
              placeholder={'e.g. Hi {{first_name}}, your prescription is ready to collect from {{pharmacy}}.'}
              value={editingTemplate.body ?? ''}
              onChange={(e) => setEditingTemplate((t) => ({ ...t, body: e.target.value }))}
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', marginTop: 4 }}>
              {(editingTemplate.body ?? '').length} chars ≈ {estimateSegments(editingTemplate.body ?? '')} segment{estimateSegments(editingTemplate.body ?? '') === 1 ? '' : 's'} (before placeholder values + signature)
            </div>
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-md)' }}>
              <button className="ps-btn ps-btn-primary" disabled={templateBusy || !editingTemplate.name?.trim() || !editingTemplate.body?.trim()} onClick={handleSaveTemplate}>
                {templateBusy ? 'Saving…' : editingTemplate.id ? 'Update template' : 'Create template'}
              </button>
              <button className="ps-btn ps-btn-ghost" onClick={() => setEditingTemplate(null)}>Cancel</button>
            </div>
          </div>
        )}

        {smsTemplates.length === 0 && !editingTemplate ? (
          <p style={{ color: 'var(--ps-slate)', fontSize: '0.9rem', margin: 0 }}>No templates yet — create one to speed up common messages.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
            {smsTemplates.map((t) => (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)',
                padding: 'var(--ps-space-sm) var(--ps-space-md)',
                border: '1px solid var(--ps-mist)', borderRadius: 'var(--ps-radius-md)',
                opacity: t.is_active ? 1 : 0.55,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {t.name}{' '}
                    <span className="ps-badge" style={{ fontSize: '0.7rem', verticalAlign: 'middle' }}>{t.category}</span>
                    {!t.is_active && <span style={{ fontSize: '0.75rem', color: 'var(--ps-slate)', marginLeft: 6 }}>(inactive)</span>}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.body}
                  </div>
                </div>
                <button className="ps-btn ps-btn-ghost" onClick={() => setEditingTemplate({ ...t })}>Edit</button>
                <button className="ps-btn ps-btn-ghost" style={{ color: 'var(--ps-error)' }} onClick={() => handleDeleteTemplate(t)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Usage & billing ── */}
      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Usage & Billing</h3>
        <p style={hintStyle}>
          Messages are billed per SMS segment, plus the reply-number rental where enabled. Figures update as
          delivery receipts arrive.
        </p>
        {usage.length === 0 ? (
          <p style={{ color: 'var(--ps-slate)', fontSize: '0.9rem', margin: 0 }}>No usage recorded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--ps-mist)' }}>
                <th style={{ padding: 'var(--ps-space-xs)' }}>Month</th>
                <th style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>Sent</th>
                <th style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>Received</th>
                <th style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>Segments</th>
                <th style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>Number rental</th>
                <th style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>Est. charge</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.period} style={{ borderBottom: '1px solid var(--ps-mist)' }}>
                  <td style={{ padding: 'var(--ps-space-xs)', fontFamily: 'monospace' }}>{u.period}</td>
                  <td style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>{u.outbound_count}</td>
                  <td style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>{u.inbound_count}</td>
                  <td style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>{u.segments}</td>
                  <td style={{ padding: 'var(--ps-space-xs)', textAlign: 'right' }}>{u.reply_enabled ? fmtPence(u.reply_number_rental_pence) : '—'}</td>
                  <td style={{ padding: 'var(--ps-space-xs)', textAlign: 'right', fontWeight: 600 }}>{fmtPence(u.estimated_charge_pence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Save ── */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-xl)' }}>
        <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving || !senderValid}>
          {saving ? 'Saving…' : 'Save SMS Settings'}
        </button>
      </div>

      {/* ── NHS Notify (restricted) ── */}
      {routing?.nhsChannelsEnabled ? (
        <NhsNotifySection />
      ) : (
        <div className="ps-card" style={{ ...cardStyle, borderLeft: '4px solid var(--ps-mist)' }}>
          <h3 style={{ margin: '0 0 var(--ps-space-sm)', color: 'var(--ps-slate)' }}>🏥 NHS Notify (email & letters)</h3>
          <p style={{ color: 'var(--ps-slate)', margin: 0, fontSize: '0.9rem', lineHeight: 1.7 }}>
            GOV.UK / NHS Notify no longer supports community pharmacies, so email and letter channels are
            unavailable. Pharmacies directly affiliated with the NHS (NHS-funded, hospital, GP surgeries within an
            ICB, military or prison pharmacies) can contact support to have NHS Notify enabled for their organisation.
          </p>
        </div>
      )}
    </div>
  )
}

// ============================================================
// NHS Notify section — shown ONLY for NHS-affiliated organisations
// (nhs_channels_enabled). Unchanged bring-your-own-key flow.
// ============================================================

function NhsNotifySection() {
  const { organisation } = useAuthStore()
  const { settings, fetchSettings, testConnection, saveSettings, getCallbackInfo } = useMessagingStore()

  const [apiKey, setApiKey] = useState('')
  const [smsTemplateId, setSmsTemplateId] = useState('')
  const [emailTemplateId, setEmailTemplateId] = useState('')
  const [letterTemplateId, setLetterTemplateId] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [callback, setCallback] = useState<{ callback_url: string; callback_token: string | null } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (organisation?.id) fetchSettings(organisation.id)
  }, [organisation?.id, fetchSettings])

  useEffect(() => {
    if (settings) {
      setSmsTemplateId(settings.sms_template_id || '')
      setEmailTemplateId(settings.email_template_id || '')
      setLetterTemplateId(settings.letter_template_id || '')
      setIsActive(settings.is_active)
    }
  }, [settings])

  useEffect(() => {
    if (!organisation?.id) return
    getCallbackInfo(organisation.id)
      .then(setCallback)
      .catch(() => { /* non-critical */ })
  }, [organisation?.id, getCallbackInfo])

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  const handleTestConnection = async () => {
    if (!organisation?.id) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnection(organisation.id, apiKey.trim() || undefined)
      if (result.valid) {
        const n = result.templates?.length ?? 0
        setTestResult({ success: true, message: `Connection successful — ${n} template${n === 1 ? '' : 's'} found on your Notify account.` })
      } else {
        setTestResult({ success: false, message: result.error || 'Connection failed' })
      }
    } catch (e: unknown) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : 'Connection failed' })
    }
    setTesting(false)
  }

  const handleSave = async () => {
    if (!organisation?.id) return
    setSaving(true)
    setSaveSuccess(false)
    try {
      await saveSettings({
        org_id: organisation.id,
        api_key: apiKey.trim() || undefined,
        sms_template_id: smsTemplateId.trim() || undefined,
        email_template_id: emailTemplateId.trim() || undefined,
        letter_template_id: letterTemplateId.trim() || undefined,
        is_active: isActive,
      })
      setSaveSuccess(true)
      setApiKey('')
      fetchSettings(organisation.id)
    } catch { /* error in store */ }
    setSaving(false)
  }

  return (
    <div style={{ borderTop: '2px solid var(--ps-mist)', paddingTop: 'var(--ps-space-lg)' }}>
      <h2 style={{ margin: '0 0 var(--ps-space-xs)' }}>🏥 NHS Notify (email & letters)</h2>
      <p style={hintStyle}>
        Your organisation is NHS-affiliated, so email and letter channels via NHS Notify remain available.
        SMS is still delivered via the platform gateway above unless support has switched your provider.
      </p>

      {saveSuccess && (
        <div style={{
          padding: 'var(--ps-space-sm) var(--ps-space-md)',
          background: 'var(--ps-ice-blue)', borderRadius: 'var(--ps-radius-md)',
          marginBottom: 'var(--ps-space-md)', color: 'var(--ps-deep-blue)',
        }}>
          ✓ NHS Notify settings saved
        </div>
      )}

      {/* Status */}
      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>Status</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            background: settings?.has_api_key ? 'var(--ps-success)' : 'var(--ps-warning)',
          }} />
          <span>
            {settings?.has_api_key
              ? 'NHS Notify API key is configured'
              : 'No API key configured — NHS Notify channels are inactive'}
          </span>
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Enabled
          </label>
        </div>
      </div>

      {/* API Key */}
      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>NHS Notify API Key</h3>
        <p style={hintStyle}>
          Your API key from the GOV.UK Notify dashboard. It will be stored securely and never displayed again.
          Format: <code>key_name-uuid-uuid</code>
        </p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
          <input
            className="ps-input"
            type="password"
            placeholder={settings?.has_api_key ? '••••••••••••••••••  (key already set — enter new to replace)' : 'Paste your API key here'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="ps-btn ps-btn-secondary"
            disabled={testing || (!apiKey.trim() && !settings?.has_api_key)}
            onClick={handleTestConnection}
          >
            {testing ? 'Testing...' : '🔌 Test Connection'}
          </button>
        </div>
        {testResult && (
          <div style={{
            marginTop: 'var(--ps-space-sm)', fontSize: '0.9rem',
            color: testResult.success ? 'var(--ps-success)' : 'var(--ps-error)',
          }}>
            {testResult.success ? '✓' : '✗'} {testResult.message}
          </div>
        )}
      </div>

      {/* Templates */}
      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Notify Template IDs</h3>
        <p style={{ ...hintStyle, marginBottom: 'var(--ps-space-sm)' }}>
          GOV.UK Notify does not allow templates to be created via API, so create one
          <strong> blank</strong> template per channel in your Notify dashboard, then paste the IDs here:
        </p>
        <ul style={{ margin: '0 0 var(--ps-space-md)', paddingLeft: 'var(--ps-space-lg)', color: 'var(--ps-slate)', fontSize: '0.85rem', lineHeight: 1.7 }}>
          <li><strong>SMS</strong> — message: <code>((body))</code></li>
          <li><strong>Email</strong> — subject: <code>((subject))</code>, message: <code>((body))</code></li>
          <li><strong>Letter</strong> — message: <code>((body))</code> (plus the address placeholders Notify adds automatically)</li>
        </ul>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
          <div>
            <label style={labelStyle}>📱 SMS Template ID</label>
            <input className="ps-input" placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890" value={smsTemplateId} onChange={(e) => setSmsTemplateId(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>📧 Email Template ID</label>
            <input className="ps-input" placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890" value={emailTemplateId} onChange={(e) => setEmailTemplateId(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>✉️ Letter Template ID</label>
            <input className="ps-input" placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890" value={letterTemplateId} onChange={(e) => setLetterTemplateId(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Delivery callback */}
      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Delivery Receipts (Callback)</h3>
        <p style={hintStyle}>
          To track whether each message was <strong>delivered</strong> or <strong>failed</strong>, add this callback in your
          Notify dashboard under <em>API integration → Callbacks</em>. This only needs to be done once.
        </p>

        <label style={{ ...labelStyle, fontSize: '0.85rem' }}>Callback URL</label>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)' }}>
          <input className="ps-input" readOnly value={callback?.callback_url ?? 'Loading…'} style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem' }} />
          <button className="ps-btn ps-btn-ghost" disabled={!callback?.callback_url} onClick={() => copy('url', callback!.callback_url)}>
            {copied === 'url' ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <label style={{ ...labelStyle, fontSize: '0.85rem' }}>Bearer Token</label>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
          <input className="ps-input" readOnly value={callback?.callback_token ?? 'Loading…'} style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem' }} />
          <button className="ps-btn ps-btn-ghost" disabled={!callback?.callback_token} onClick={() => copy('token', callback!.callback_token!)}>
            {copied === 'token' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
        <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save NHS Notify Settings'}
        </button>
      </div>
    </div>
  )
}
