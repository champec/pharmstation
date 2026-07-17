import { Link, NavLink } from 'react-router-dom'

export function ResourceHeader() {
  return (
    <header className="resource-header">
      <Link className="resource-brand" to="/resources" aria-label="PharmStation resources home">
        Pharm<span>Station</span>
        <small>Resources</small>
      </Link>
      <nav aria-label="Resource navigation">
        <NavLink to="/resources/forms">Service forms</NavLink>
        <NavLink to="/resources/pils">Medicine leaflets</NavLink>
        <NavLink to="/resources/logs">Printable logs</NavLink>
        <NavLink to="/resources/tools">Operational tools</NavLink>
        <Link className="resource-login-link" to="/login/org">Pharmacy login</Link>
      </nav>
    </header>
  )
}