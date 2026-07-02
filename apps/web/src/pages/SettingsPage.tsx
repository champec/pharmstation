import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore, useNHSStore } from '@pharmstation/core'
import { MessagingSettingsTab } from './settings/MessagingSettingsTab'

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
