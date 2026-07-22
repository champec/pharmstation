import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'

export function LocumLayout() {
  const { activeUser: userProfile, isUserLoggedIn: isLoggedIn, userLogout: logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/me/login')
  }

  return (
    <div className="locum-layout">
      <header className="locum-header">
        <div className="locum-header-brand">
          Pharm<span>Station</span>
          <span className="locum-badge">Locum</span>
        </div>

        <nav className="locum-nav">
          <NavLink to="/locum/dashboard" className={({ isActive }) => isActive ? 'locum-nav-link active' : 'locum-nav-link'}>
            Dashboard
          </NavLink>
          <NavLink to="/locum/shifts" className={({ isActive }) => isActive ? 'locum-nav-link active' : 'locum-nav-link'}>
            Browse Shifts
          </NavLink>
          <NavLink to="/locum/bookings" className={({ isActive }) => isActive ? 'locum-nav-link active' : 'locum-nav-link'}>
            My Bookings
          </NavLink>
          <NavLink to="/locum/invoices" className={({ isActive }) => isActive ? 'locum-nav-link active' : 'locum-nav-link'}>
            Invoices
          </NavLink>
          <NavLink to="/locum/sops" className={({ isActive }) => isActive ? 'locum-nav-link active' : 'locum-nav-link'}>
            SOPs
          </NavLink>
          <NavLink to="/locum/profile" className={({ isActive }) => isActive ? 'locum-nav-link active' : 'locum-nav-link'}>
            Profile
          </NavLink>
        </nav>

        <div className="locum-header-user">
          {isLoggedIn && userProfile && (
            <span className="locum-header-name">
                {userProfile.first_name && userProfile.last_name
                  ? `${userProfile.first_name} ${userProfile.last_name}`
                  : userProfile.first_name ?? userProfile.full_name ?? userProfile.email}
              </span>
          )}
          <Link to="/me" className="ps-btn ps-btn-ghost ps-btn-sm" title="My personal account">
            👤 My Account
          </Link>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="locum-main">
        <Outlet />
      </main>
    </div>
  )
}
