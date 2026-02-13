import { useAuthStore, useUIStore } from '@pharmstation/core'

export function TopNav() {
  const { activeUser, organisation, switchUser, orgLogout } = useAuthStore()
  const { sideNavMode, toggleSideNav } = useUIStore()

  return (
    <nav className="top-nav" data-sidenav={sideNavMode}>
      <div className="top-nav-left">
        <button className="ps-btn ps-btn-ghost" onClick={toggleSideNav} title="Toggle sidebar">
          ☰
        </button>
      </div>

      <div className="top-nav-right">
        {organisation && <span className="top-nav-org">{organisation.name}</span>}

        <div className="top-nav-user">
          <strong>{activeUser?.full_name ?? 'Unknown'}</strong>
        </div>

        <button className="ps-btn ps-btn-ghost" onClick={switchUser} title="Switch user">
          🔄 Switch
        </button>

        <button className="ps-btn ps-btn-ghost" onClick={orgLogout} title="Log out">
          ⏻
        </button>
      </div>
    </nav>
  )
}
