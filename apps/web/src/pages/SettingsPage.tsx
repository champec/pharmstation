import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore, useMessagingStore, useNHSStore } from '@pharmstation/core'

type Tab = 'general' | 'messaging' | 'nhs'

export function SettingsPage() {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab')
    if (t === 'nhs' || t === 'messaging') return t
    return 'general'
  })

  return (
    <div>
      <div className="page-header">
        <h1>⚙ Settings</h1>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-lg)', borderBottom: '2px solid var(--ps-mist)', paddingBottom: 'var(--ps-space-sm)' }}>
        {([
          { key: 'general' as Tab, label: 'General' },
          { key: 'messaging' as Tab, label: '📨 Messaging' },
          { key: 'nhs' as Tab, label: '🏥 NHS' },
        ]).map((t) => (
          <button
            key={t.key}
            className={`ps-btn ${tab === t.key ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <p style={{ color: 'var(--ps-slate)' }}>
            Organisation settings, user management, and billing will be here.
          </p>
        </div>
      )}

      {tab === 'messaging' && <MessagingSettingsTab />}
      {tab === 'nhs' && <NHSSettingsTab />}
    </div>
  )
}

function MessagingSettingsTab() {
  const { organisation } = useAuthStore()
  const { settings, fetchSettings, testConnection, saveSettings, loading, error, clearError } = useMessagingStore()

  const [apiKey, setApiKey] = useState('')
  const [smsTemplateId, setSmsTemplateId] = useState('')
  const [emailTemplateId, setEmailTemplateId] = useState('')
  const [letterTemplateId, setLetterTemplateId] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

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

  const handleTestConnection = async () => {
    if (!organisation?.id || !apiKey.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnection(organisation.id, apiKey.trim())
      setTestResult({ success: true, message: 'Connection successful! Notify API is working.' })
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
      setApiKey('') // clear after save (key is stored server-side, never re-exposed)
      fetchSettings(organisation.id)
    } catch { /* error in store */ }
    setSaving(false)
  }

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
          ✓ Settings saved successfully
        </div>
      )}

      {/* Status */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>Status</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            background: settings?.has_api_key ? 'var(--ps-success)' : 'var(--ps-warning)',
          }} />
          <span>
            {settings?.has_api_key
              ? 'NHS Notify API key is configured'
              : 'No API key configured — messaging is inactive'}
          </span>
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Messaging enabled
          </label>
        </div>
      </div>

      {/* API Key */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>NHS Notify API Key</h3>
        <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }}>
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
            disabled={!apiKey.trim() || testing}
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
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Message Templates</h3>
        <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }}>
          Enter the template IDs from your GOV.UK Notify dashboard. Each template should use a <code>((body))</code> placeholder for the message content.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-xs)', fontSize: '0.9rem' }}>📱 SMS Template ID</label>
            <input className="ps-input" placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890" value={smsTemplateId} onChange={(e) => setSmsTemplateId(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-xs)', fontSize: '0.9rem' }}>📧 Email Template ID</label>
            <input className="ps-input" placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890" value={emailTemplateId} onChange={(e) => setEmailTemplateId(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-xs)', fontSize: '0.9rem' }}>✉️ Letter Template ID</label>
            <input className="ps-input" placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890" value={letterTemplateId} onChange={(e) => setLetterTemplateId(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Setup guide */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Setup Guide</h3>
        <ol style={{ margin: 0, paddingLeft: 'var(--ps-space-lg)', color: 'var(--ps-slate)', lineHeight: 1.8 }}>
          <li>Register at <a href="https://www.notifications.service.gov.uk" target="_blank" rel="noopener noreferrer">GOV.UK Notify</a></li>
          <li>Create an API key (choose "Team and guest list" for testing, "Live" for production)</li>
          <li>Create one template per channel (SMS, Email, Letter) with a <code>((body))</code> personalisation field</li>
          <li>Copy your API key and template IDs into the fields above</li>
          <li>Click "Test Connection" to verify your key works</li>
          <li>Save settings and enable messaging</li>
        </ol>
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
        <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

// ============================================================
// NHS Settings Tab
// ============================================================

function NHSSettingsTab() {
  const { organisation } = useAuthStore()
  const { settings, fetchSettings, saveSettings, loading, error, clearError } = useNHSStore()

  const [odsCode, setOdsCode] = useState(settings.odsCode ?? '')
  const [bsaEnv, setBsaEnv] = useState<'staging' | 'production'>(settings.bsaEnvironment)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (organisation?.id) fetchSettings(organisation.id)
  }, [organisation?.id, fetchSettings])

  useEffect(() => {
    setOdsCode(settings.odsCode ?? '')
    setBsaEnv(settings.bsaEnvironment)
  }, [settings])

  const handleSave = async () => {
    if (!organisation?.id) return
    setSaving(true)
    setSaveSuccess(false)
    try {
      await saveSettings(organisation.id, {
        odsCode: odsCode.trim().toUpperCase() || null,
        bsaEnvironment: bsaEnv,
      })
      setSaveSuccess(true)
    } catch { /* error in store */ }
    setSaving(false)
  }

  // Validate ODS code format: letter followed by 5 digits (e.g. FA123)
  const odsValid = !odsCode.trim() || /^[A-Z]\d{4,5}$/i.test(odsCode.trim())

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
          ✓ NHS settings saved successfully
        </div>
      )}

      {/* ODS Code */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>ODS Code</h3>
        <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }}>
          Your Organisation Data Service code issued by NHS Digital. Required for all NHSBSA claim submissions.
          Format: a letter followed by 5 digits (e.g. <code>FA123</code>).
        </p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center' }}>
          <input
            className="ps-input"
            placeholder="e.g. FA123"
            value={odsCode}
            onChange={(e) => setOdsCode(e.target.value.toUpperCase())}
            style={{ maxWidth: 200, fontFamily: 'monospace', fontSize: '1rem', letterSpacing: 1 }}
            maxLength={6}
          />
          {odsCode && (
            <span style={{ fontSize: '0.85rem', color: odsValid ? 'var(--ps-success)' : 'var(--ps-error)' }}>
              {odsValid ? '✓ Valid format' : '✗ Invalid format'}
            </span>
          )}
        </div>
      </div>

      {/* BSA Environment */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>NHSBSA Environment</h3>
        <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }}>
          Choose which NHSBSA endpoint to send claims to. Use <strong>Staging</strong> until your pharmacy is approved
          by NHSBSA for live claim submission.
        </p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-lg)' }}>
          {(['staging', 'production'] as const).map((env) => (
            <label key={env} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)',
              cursor: 'pointer', padding: 'var(--ps-space-sm) var(--ps-space-md)',
              borderRadius: 'var(--ps-radius-md)',
              border: bsaEnv === env ? '2px solid var(--ps-deep-blue)' : '2px solid var(--ps-mist)',
              background: bsaEnv === env ? 'rgba(0,48,135,0.04)' : 'transparent',
            }}>
              <input
                type="radio"
                name="bsa-env"
                checked={bsaEnv === env}
                onChange={() => setBsaEnv(env)}
              />
              <div>
                <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                  {env === 'staging' ? '🧪 Staging' : '🚀 Production'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                  {env === 'staging'
                    ? 'stg.services.nhsbsa.nhs.uk — test submissions'
                    : 'services.nhsbsa.nhs.uk — live claims'}
                </div>
              </div>
            </label>
          ))}
        </div>
        {bsaEnv === 'production' && (
          <div style={{
            marginTop: 'var(--ps-space-sm)', padding: 'var(--ps-space-sm) var(--ps-space-md)',
            background: '#fef2f2', borderRadius: 'var(--ps-radius-sm)', fontSize: '0.85rem', color: '#dc2626',
          }}>
            ⚠️ Production mode will submit real claims to NHSBSA. Ensure your pharmacy is approved before switching.
          </div>
        )}
      </div>

      {/* IP Whitelist Status */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>IP Whitelist Status</h3>
        <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }}>
          NHSBSA requires your server's outbound IP address to be registered. PharmStation routes claims through a
          dedicated UK proxy with a static IP.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            background: settings.ipWhitelistRegistered ? 'var(--ps-success)' : 'var(--ps-warning)',
          }} />
          <span style={{ fontWeight: 600 }}>
            {settings.ipWhitelistRegistered
              ? '✓ IP address registered with NHSBSA'
              : '⏳ Pending — IP registration with NHSBSA is not yet confirmed'}
          </span>
        </div>
      </div>

      {/* Accreditation Status Info */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Accreditation Checklist</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
          {[
            { done: !!settings.odsCode, label: 'ODS code configured' },
            { done: settings.ipWhitelistRegistered, label: 'IP address whitelisted with NHSBSA' },
            { done: false, label: 'NHSBSA MYS API credentials received' },
            { done: false, label: 'End-to-end test submission passed' },
            { done: false, label: 'NHSBSA production approval granted' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', fontSize: '0.9rem' }}>
              <span style={{ color: item.done ? 'var(--ps-success)' : 'var(--ps-slate)', fontSize: '1.1rem' }}>
                {item.done ? '✅' : '⬜'}
              </span>
              <span style={{ color: item.done ? 'var(--ps-midnight)' : 'var(--ps-slate)' }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
        <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving || !odsValid}>
          {saving ? 'Saving...' : 'Save NHS Settings'}
        </button>
      </div>
    </div>
  )
}
