// ============================================
// RPCertificate — Printable RP Certificate
// Displays the Responsible Pharmacist notice
// required under The Medicines (Pharmacies)
// (Responsible Pharmacist) Regulations 2008
// ============================================

import { useState } from 'react'

interface RPCertificateProps {
  name: string
  gphcNumber: string
  onPrint?: (orientation: 'portrait' | 'landscape') => void
}

export function RPCertificate({ name, gphcNumber, onPrint }: RPCertificateProps) {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape')

  return (
    <div>
      <div id="rp-certificate-print">
        <div
          style={{
            border: '3px solid #257BB4',
            borderRadius: '16px',
            padding: '48px 40px',
            maxWidth: '620px',
            margin: '0 auto',
            textAlign: 'center',
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            background: 'linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)',
            position: 'relative',
          }}
          className="rp-cert-card"
        >
          <div
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: '#ffffff',
              border: '1px solid #d3e8f7',
              borderRadius: '10px',
              padding: '6px',
              width: '92px',
            }}
            className="rp-cert-qr"
          >
            <img
              src="https://quickchart.io/qr?text=https%3A%2F%2Fwww.pharmstation.co.uk%2Fabout&size=120"
              alt="PharmStation info QR"
              style={{ width: '100%', display: 'block', borderRadius: '4px' }}
            />
          </div>

          {/* Header accent */}
          <div
            style={{
              width: '80px',
              height: '4px',
              background: 'linear-gradient(90deg, #04B0FF, #257BB4)',
              borderRadius: '2px',
              margin: '0 auto 24px',
            }}
          />

          <div style={{ fontSize: '13px', letterSpacing: '2px', textTransform: 'uppercase', color: '#64748b', marginBottom: '8px' }}>
            Notice
          </div>

          <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#1a1a2e', margin: '0 0 24px', lineHeight: 1.3 }}>
            Responsible Pharmacist
          </h1>

          <div
            style={{
              width: '40px',
              height: '2px',
              background: '#04B0FF',
              margin: '0 auto 24px',
              borderRadius: '1px',
            }}
          />

          <p style={{ fontSize: '15px', color: '#475569', lineHeight: 1.7, marginBottom: '32px' }}>
            In accordance with <strong>The Medicines (Pharmacies) (Responsible Pharmacist) Regulations 2008</strong>,
            the pharmacist in charge of this pharmacy is:
          </p>

          <div
            style={{
              background: '#f1f8ff',
              border: '1px solid #d3e8f7',
              borderRadius: '12px',
              padding: '28px 24px',
              marginBottom: '32px',
            }}
          >
            <div className="rp-cert-name" style={{ fontSize: '26px', fontWeight: 700, color: '#257BB4', marginBottom: '8px' }}>
              {name || '—'}
            </div>
            <div className="rp-cert-reg" style={{ fontSize: '16px', color: '#64748b' }}>
              GPhC Registration No. <strong style={{ color: '#1a1a2e' }}>{gphcNumber || '—'}</strong>
            </div>
          </div>

          <div
            style={{
              width: '40px',
              height: '2px',
              background: '#e2e8f0',
              margin: '0 auto 16px',
              borderRadius: '1px',
            }}
          />

          <div style={{ fontSize: '11px', color: '#94a3b8', letterSpacing: '1px', textTransform: 'uppercase' }}>
            PharmStation — www.pharmstation.co.uk/rp
          </div>
        </div>
      </div>

      {onPrint && (
        <div style={{ textAlign: 'center', marginTop: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }} className="no-print">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '14px', color: '#64748b' }}>Orientation:</label>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>
          <button className="ps-btn ps-btn-primary" onClick={() => onPrint(orientation)}>
            🖨️ Print Certificate
          </button>
        </div>
      )}
    </div>
  )
}
