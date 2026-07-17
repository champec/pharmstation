import { Outlet, Link } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="auth-layout">
      <div className="auth-layout-content">
        <div className="auth-layout-quick-links">
          <span className="auth-layout-quick-links-title">Quick links:</span>
          <Link to="/rp">Print RP Certificate</Link>
          <Link to="/resources">Additional resources</Link>
          <Link to="/about">About PharmStation</Link>
        </div>
        <Outlet />
      </div>
    </div>
  )
}
