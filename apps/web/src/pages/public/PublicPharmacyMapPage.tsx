// ============================================================
// PublicPharmacyMapPage — /maps
// Public-facing page to find pharmacies near you.
// Opens the shared PharmacyMapModal (messaging/select features
// are hidden automatically when no org session is active).
// ============================================================

import { useState } from 'react'
import { PublicSiteShell } from '../../components/public/PublicSiteShell'
import { PharmacyMapModal } from '../../components/maps/PharmacyMapModal'

export function PublicPharmacyMapPage() {
  const [mapOpen, setMapOpen] = useState(false)

  return (
    <PublicSiteShell variant="narrow">
      <section className="public-panel public-feature-card">
        <span className="landing-eyebrow">Find a pharmacy</span>
        <h1>Find a pharmacy near you</h1>
        <p>
          Search NHS pharmacies across the UK. See contact details, opening hours
          and the services available near you.
        </p>
        <button type="button" className="landing-btn landing-btn-primary landing-btn-lg" onClick={() => setMapOpen(true)}>
          Open the pharmacy map
        </button>
        <ul className="public-chip-list">
          <li>Phone and email</li>
          <li>Opening hours</li>
          <li>Map view</li>
          <li>Search by postcode</li>
        </ul>
        <small>Pharmacy data sourced from NHS Digital.</small>
      </section>

      <PharmacyMapModal isOpen={mapOpen} onClose={() => setMapOpen(false)} />
    </PublicSiteShell>
  )
}
