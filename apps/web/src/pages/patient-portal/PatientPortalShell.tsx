import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { usePatientStore } from '@pharmstation/core'
import { PublicSiteShell } from '../../components/public/PublicSiteShell'

// Frame for the signed-in patient pages: the public site header and footer,
// with the patient's own links and Sign out in the header.
export function PatientPortalShell({ title, subtitle, actions, children }: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { patient, logout } = usePatientStore()
  const signOut = async () => {
    await logout()
    navigate('/patient/login')
  }
  return (
    <PublicSiteShell
      variant="article"
      headerActions={
        <div className="patient-portal-account">
          {patient && <span className="patient-portal-name">{patient.first_name} {patient.last_name}</span>}
          <button type="button" className="landing-btn landing-btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      }
    >
      <nav className="patient-portal-tabs" aria-label="Your account">
        <NavLink to="/patient/appointments">My appointments</NavLink>
        <NavLink to="/patient/profile">My details</NavLink>
      </nav>
      <div className="patient-portal-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="patient-portal-actions">{actions}</div>}
      </div>
      {children}
    </PublicSiteShell>
  )
}
