// ============================================================
// PublicPharmacyMapPage — /maps
// Public-facing page to find pharmacies near you.
// Opens the shared PharmacyMapModal (messaging/select features
// are hidden automatically when no org session is active).
// ============================================================

import { useState } from 'react'
import { PharmacyMapModal } from '../../components/maps/PharmacyMapModal'

export function PublicPharmacyMapPage() {
  const [mapOpen, setMapOpen] = useState(false)

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', display: 'flex', flexDirection: 'column' }}>
      {/* Nav bar */}
      <header style={{
        background: 'white',
        borderBottom: '1px solid #e2e8f0',
        padding: '0 24px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#0077B6', letterSpacing: '-0.5px' }}>
            Pharm<span style={{ color: '#00B4D8' }}>Station</span>
          </span>
        </div>
        <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a href="/book" style={{ color: '#475569', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>Book a Service</a>
          <a href="/rp" style={{ color: '#475569', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>RP Certificate</a>
          <a href="/resources" style={{ color: '#475569', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>Resources</a>
          <a href="/about" style={{ color: '#475569', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>About</a>
        </nav>
      </header>

      {/* Hero */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
        <div style={{
          background: 'white',
          borderRadius: 20,
          padding: '56px 48px',
          maxWidth: 560,
          width: '100%',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}>
          {/* Icon */}
          <div style={{ fontSize: 56, marginBottom: 16 }}>🗺️</div>

          <h1 style={{ margin: '0 0 12px', fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
            Find a Pharmacy Near You
          </h1>
          <p style={{ margin: '0 0 32px', color: '#64748b', fontSize: 16, lineHeight: 1.6 }}>
            Search thousands of NHS pharmacies across the UK. View contact details,
            opening hours, and the services available near you.
          </p>

          <button
            onClick={() => setMapOpen(true)}
            style={{
              background: 'linear-gradient(135deg, #0077B6, #00B4D8)',
              color: 'white',
              border: 'none',
              borderRadius: 12,
              padding: '14px 36px',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0,119,182,0.35)',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,119,182,0.45)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,119,182,0.35)'
            }}
          >
            Open Pharmacy Map
          </button>

          {/* Feature pills */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 32 }}>
            {[
              '📞 Phone & Email',
              '🕐 Opening Hours',
              '📍 Map View',
              '🔍 Search by postcode',
            ].map((f) => (
              <span key={f} style={{
                background: '#f1f5f9',
                color: '#475569',
                borderRadius: 999,
                padding: '5px 14px',
                fontSize: 13,
                fontWeight: 500,
              }}>{f}</span>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>
        © {new Date().getFullYear()} PharmStation · Pharmacy data sourced from NHS Digital
      </footer>

      <PharmacyMapModal isOpen={mapOpen} onClose={() => setMapOpen(false)} />
    </div>
  )
}
