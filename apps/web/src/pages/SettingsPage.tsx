import { useState, useEffect } from 'react'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'

type Tab = 'general' | 'messaging'

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general')

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
