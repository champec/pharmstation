import { Link } from 'react-router-dom'

export function AboutPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 var(--ps-space-lg)' }}>
      <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--ps-space-xl)' }}>
          <h1 style={{ marginBottom: 'var(--ps-space-sm)' }}>About PharmStation</h1>
          <p style={{ color: 'var(--ps-slate)' }}>
            PharmStation helps pharmacies run core workflows from one modern platform.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
          <div>
            <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>What we provide</h3>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              Registers, service delivery, appointments, messaging, SOPs, and patient-facing booking tools.
            </p>
          </div>

          <div>
            <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>Public tools</h3>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              You can use our Responsible Pharmacist certificate utility and public booking pages without signing in.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 'var(--ps-space-xl)', display: 'flex', flexWrap: 'wrap', gap: 'var(--ps-space-sm)' }}>
          <Link className="ps-btn ps-btn-primary" to="/rp">RP Certificate Tool</Link>
          <Link className="ps-btn ps-btn-ghost" to="/book">Book a Service</Link>
          <Link className="ps-btn ps-btn-ghost" to="/patient/login">Patient Login</Link>
        </div>
      </div>
    </div>
  )
}