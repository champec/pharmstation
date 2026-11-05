// ============================================
// RPCertificatePage — Public utility page
// Available at /rp without login
// Smart lookup: enter GPhC → auto-fetches name
// New users prompted to save name for next time
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { getOrgClient } from '@pharmstation/supabase-client'
import { RPCertificate } from '../../components/RPCertificate'
import { PublicSiteShell } from '../../components/public/PublicSiteShell'

type LookupState = 'idle' | 'searching' | 'found' | 'not-found'

export function RPCertificatePage() {
  const [gphcNumber, setGphcNumber] = useState('')
  const [name, setName] = useState('')
  const [lookupState, setLookupState] = useState<LookupState>('idle')
  const [editingName, setEditingName] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const lookupPharmacist = useCallback(async (gphc: string) => {
    if (!/^\d{7}$/.test(gphc)) return

    setLookupState('searching')
    setSaveMessage(null)

    const { data, error } = await getOrgClient()
      .from('ps_public_pharmacists')
      .select('full_name')
      .eq('gphc_number', gphc)
      .maybeSingle()

    if (error || !data) {
      setLookupState('not-found')
      setName('')
      return
    }

    setName(data.full_name)
    setLookupState('found')
    setEditingName(false)
  }, [])

  // Auto-lookup when 7 digits entered
  useEffect(() => {
    if (/^\d{7}$/.test(gphcNumber)) {
      lookupPharmacist(gphcNumber)
    } else {
      setLookupState('idle')
      setName('')
      setEditingName(false)
      setSaveMessage(null)
    }
  }, [gphcNumber, lookupPharmacist])

  const handleSave = async () => {
    if (!name.trim() || !/^\d{7}$/.test(gphcNumber)) return

    setSaving(true)
    setSaveMessage(null)

    if (lookupState === 'not-found') {
      const { error } = await getOrgClient()
        .from('ps_public_pharmacists')
        .insert({ gphc_number: gphcNumber, full_name: name.trim() })

      if (error) {
        setSaveMessage(error.message)
      } else {
        setSaveMessage('Saved! Your name will auto-fill next time.')
        setLookupState('found')
        setEditingName(false)
      }
    } else {
      const { error } = await getOrgClient()
        .from('ps_public_pharmacists')
        .update({ full_name: name.trim() })
        .eq('gphc_number', gphcNumber)

      if (error) {
        setSaveMessage(error.message)
      } else {
        setSaveMessage('Name updated successfully.')
        setEditingName(false)
      }
    }

    setSaving(false)
  }

  const handlePrint = (orientation: 'portrait' | 'landscape') => {
    const el = document.getElementById('rp-certificate-print')
    if (!el) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    const landscape = orientation === 'landscape'
    // Size the notice in millimetres to exactly one A4 page (minus 10mm margins and a small
    // safety gap). The old 100vh height is only treated as "one page" by Chrome; Firefox and
    // Safari could spill a sliver of the border onto a second sheet.
    const pageW = landscape ? 297 : 210
    const pageH = landscape ? 210 : 297
    const margin = 10
    const cardW = pageW - margin * 2
    const cardH = pageH - margin * 2 - 4
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>RP Certificate — ${name.replace(/[<>&"]/g, '')}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          @page { size: A4 ${orientation}; margin: ${margin}mm; }
          html, body { width: ${cardW}mm; height: ${cardH}mm; overflow: hidden; }
          body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
          .rp-cert-card {
            max-width: none !important;
            width: ${cardW}mm !important;
            height: ${cardH}mm !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            padding: ${landscape ? '8mm 14mm' : '12mm 10mm'} !important;
            border-radius: 0 !important;
            border: 3px solid #257BB4 !important;
            margin: 0 !important;
            background: #fff !important;
            break-inside: avoid;
            page-break-inside: avoid;
            overflow: hidden;
          }
          .rp-cert-card h1 { font-size: ${landscape ? '42px' : '36px'} !important; }
          .rp-cert-card .rp-cert-name { font-size: ${landscape ? '40px' : '34px'} !important; }
          .rp-cert-card .rp-cert-reg { font-size: ${landscape ? '22px' : '20px'} !important; }
          .rp-cert-card p { font-size: ${landscape ? '17px' : '16px'} !important; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>${el.innerHTML}</body>
      </html>
    `)
    printWindow.document.close()

    // Print once the QR code has loaded (or failed), so it isn't blank on the page.
    let printed = false
    const doPrint = () => {
      if (printed) return
      printed = true
      printWindow.focus()
      printWindow.print()
      printWindow.close()
    }
    const images = Array.from(printWindow.document.images)
    const pending = images.filter((img) => !img.complete)
    if (pending.length === 0) {
      doPrint()
    } else {
      let left = pending.length
      const done = () => { left -= 1; if (left <= 0) doPrint() }
      pending.forEach((img) => { img.onload = done; img.onerror = done })
      window.setTimeout(doPrint, 2500)
    }
  }

  const showCertificate = name.trim() && /^\d{7}$/.test(gphcNumber) && lookupState !== 'searching'

  return (
    <PublicSiteShell>
      <div className="public-panel public-tool-card">
        <header className="public-tool-head">
          <span className="landing-eyebrow">Free tool</span>
          <h1>Responsible Pharmacist notice</h1>
          <p>Enter your GPhC number to make a printable RP notice for your pharmacy. Free, no account needed.</p>
        </header>

        {/* Step 1: GPhC Number */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
            GPhC Registration Number
          </label>
          <input
            className="ps-input"
            placeholder="Enter your 7-digit GPhC number"
            value={gphcNumber}
            inputMode="numeric"
            maxLength={7}
            onChange={(e) => {
              const val = e.target.value
              if (/^\d{0,7}$/.test(val)) setGphcNumber(val)
            }}
            style={{ width: '100%', fontSize: '18px', padding: '12px 16px', textAlign: 'center', letterSpacing: '2px' }}
          />
          {gphcNumber.length > 0 && gphcNumber.length < 7 && (
            <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px', textAlign: 'center' }}>
              {7 - gphcNumber.length} more digit{7 - gphcNumber.length !== 1 ? 's' : ''} needed
            </p>
          )}
        </div>

        {/* Searching indicator */}
        {lookupState === 'searching' && (
          <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
            Looking you up...
          </div>
        )}

        {/* Found — show name with edit option */}
        {lookupState === 'found' && !editingName && (
          <div style={{ marginBottom: '24px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '10px',
                padding: '14px 18px',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600, marginBottom: '2px' }}>
                  Welcome back!
                </div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a2e' }}>
                  {name}
                </div>
              </div>
              <button
                onClick={() => setEditingName(true)}
                style={{
                  background: 'none',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  padding: '4px 12px',
                  fontSize: '13px',
                  color: '#64748b',
                  cursor: 'pointer',
                }}
              >
                Edit name
              </button>
            </div>
          </div>
        )}

        {/* Not found — prompt for name */}
        {lookupState === 'not-found' && (
          <div style={{ marginBottom: '24px' }}>
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '10px',
                padding: '14px 18px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '13px', color: '#92400e' }}>
                We don't have your details yet. Enter your name below and we'll save it for next time.
              </div>
            </div>

            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              Full Name
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="ps-input"
                placeholder="e.g. Sarah Ahmed"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="ps-btn ps-btn-primary"
                onClick={handleSave}
                disabled={saving || !name.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Editing existing name */}
        {lookupState === 'found' && editingName && (
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              Update Full Name
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="ps-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="ps-btn ps-btn-primary"
                onClick={handleSave}
                disabled={saving || !name.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {saving ? 'Saving...' : 'Update'}
              </button>
              <button
                className="ps-btn ps-btn-ghost"
                onClick={() => { setEditingName(false); lookupPharmacist(gphcNumber) }}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Save feedback */}
        {saveMessage && (
          <div
            style={{
              fontSize: '13px',
              color: saveMessage.includes('Saved') || saveMessage.includes('updated') ? '#16a34a' : '#dc2626',
              textAlign: 'center',
              marginBottom: '16px',
            }}
          >
            {saveMessage}
          </div>
        )}

        {/* Certificate preview */}
        {showCertificate ? (
          <RPCertificate name={name} gphcNumber={gphcNumber} onPrint={handlePrint} />
        ) : lookupState !== 'searching' && /^\d{7}$/.test(gphcNumber) ? null : (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: '#94a3b8',
              border: '2px dashed #e2e8f0',
              borderRadius: '12px',
            }}
          >
            Enter your 7-digit GPhC number to get started.
          </div>
        )}
      </div>
    </PublicSiteShell>
  )
}
