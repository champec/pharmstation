// ============================================
// RPCertificatePage — Public utility page
// Available at /rp without login
// Lets any pharmacist print an RP certificate
// ============================================

import { useState } from 'react'
import { RPCertificate } from '../../components/RPCertificate'

export function RPCertificatePage() {
  const [name, setName] = useState('')
  const [gphcNumber, setGphcNumber] = useState('')

  const handlePrint = (orientation: 'portrait' | 'landscape') => {
    const el = document.getElementById('rp-certificate-print')
    if (!el) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>RP Certificate — ${name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          }
          @page {
            size: A4 ${orientation};
            margin: ${orientation === 'landscape' ? '5mm 10mm' : '10mm 15mm'};
          }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .rp-cert-card {
              max-width: none !important;
              width: 100% !important;
              height: 100vh !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              justify-content: center !important;
              padding: ${orientation === 'landscape' ? '24px 48px' : '40px 32px'} !important;
              border-radius: 0 !important;
              border: 3px solid #257BB4 !important;
              margin: 0 !important;
            }
            .rp-cert-card h1 { font-size: ${orientation === 'landscape' ? '42px' : '36px'} !important; }
            .rp-cert-card .rp-cert-name { font-size: ${orientation === 'landscape' ? '40px' : '34px'} !important; }
            .rp-cert-card .rp-cert-reg { font-size: ${orientation === 'landscape' ? '22px' : '20px'} !important; }
            .rp-cert-card p { font-size: ${orientation === 'landscape' ? '17px' : '16px'} !important; }
          }
        </style>
      </head>
      <body>${el.innerHTML}</body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    printWindow.close()
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #257BB4 0%, #04B0FF 100%)',
        padding: '40px 20px',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          padding: '40px',
          width: '100%',
          maxWidth: '720px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ fontSize: '24px', color: '#1a1a2e', marginBottom: '8px' }}>
            Responsible Pharmacist Certificate
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px' }}>
            Free utility by <strong>PharmStation</strong> — enter your details and print your RP notice.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '32px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              Full Name *
            </label>
            <input
              className="ps-input"
              placeholder="e.g. Sarah Ahmed"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              GPhC Registration No. *
            </label>
            <input
              className="ps-input"
              placeholder="e.g. 2087654"
              value={gphcNumber}
              inputMode="numeric"
              maxLength={7}
              onChange={(e) => {
                const val = e.target.value
                if (/^\d{0,7}$/.test(val)) setGphcNumber(val)
              }}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {name.trim() && gphcNumber.trim() ? (
          <RPCertificate name={name} gphcNumber={gphcNumber} onPrint={handlePrint} />
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: '#94a3b8',
              border: '2px dashed #e2e8f0',
              borderRadius: '12px',
            }}
          >
            Enter your name and GPhC number above to preview your certificate.
          </div>
        )}
      </div>

      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', marginTop: '24px', textAlign: 'center' }}>
        PharmStation — Pharmacy Management, Simplified.
      </p>
    </div>
  )
}
