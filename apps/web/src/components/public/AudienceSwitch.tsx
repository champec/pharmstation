import { Link } from 'react-router-dom'

// Thin bar above the public headers so every visitor can tell at a glance which side of
// PharmStation they are on: patients (shop, book, find a pharmacy) or pharmacy teams.
export function AudienceSwitch({ active }: { active: 'patients' | 'pharmacies' }) {
  return (
    <div className="audience-switch" role="navigation" aria-label="Choose who you are">
      <div className="audience-switch-tabs">
        <Link to="/pharmacies" className={active === 'patients' ? 'active' : undefined} aria-current={active === 'patients' ? 'page' : undefined}>
          For patients
        </Link>
        <Link to="/" className={active === 'pharmacies' ? 'active' : undefined} aria-current={active === 'pharmacies' ? 'page' : undefined}>
          For pharmacies
        </Link>
      </div>
      <p>
        {active === 'pharmacies'
          ? <>Looking for a pharmacy? <Link to="/pharmacies">Shop, book a service or find one near you</Link></>
          : <>Work in a pharmacy? <Link to="/">See PharmStation for pharmacy teams</Link></>}
      </p>
    </div>
  )
}
