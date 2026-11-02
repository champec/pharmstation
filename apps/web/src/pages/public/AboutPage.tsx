import { Link } from 'react-router-dom'
import { PublicSiteShell } from '../../components/public/PublicSiteShell'

export function AboutPage() {
  return (
    <PublicSiteShell>
      <header className="public-page-head">
        <span className="landing-eyebrow">About</span>
        <h1>About PharmStation</h1>
        <p>PharmStation helps community pharmacies run their core workflows from one modern platform.</p>
      </header>

      <div className="public-panel-grid">
        <section className="public-panel">
          <h2>What we provide</h2>
          <p>Registers, service delivery, appointments, messaging, SOPs and patient-facing booking tools, plus a secure network for messaging pharmacies near you.</p>
          <Link to="/#features" className="public-text-link">See all features →</Link>
        </section>
        <section className="public-panel">
          <h2>Free public tools</h2>
          <p>Use the Responsible Pharmacist certificate, printable resources and public booking pages without signing in.</p>
          <div className="landing-links">
            <Link to="/rp">RP notice</Link>
            <Link to="/resources">Free resources</Link>
            <Link to="/book">Book a service</Link>
          </div>
        </section>
        <section className="public-panel">
          <h2>For patients</h2>
          <p>Book with a participating pharmacy, shop online or find a pharmacy near you.</p>
          <div className="landing-links">
            <Link to="/patient/login">Patient sign in</Link>
            <Link to="/maps">Find a pharmacy</Link>
            <Link to="/privacy">Privacy notice</Link>
          </div>
        </section>
      </div>
    </PublicSiteShell>
  )
}
