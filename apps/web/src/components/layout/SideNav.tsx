import { NavLink } from 'react-router-dom'
import { useUIStore } from '@pharmstation/core'

interface NavItem {
  to: string
  icon: string
  label: string
}

const menuSections: { title: string; items: NavItem[] }[] = [
  {
    title: '',
    items: [{ to: '/', icon: '📊', label: 'Dashboard' }],
  },
  {
    title: 'Registers',
    items: [
      { to: '/registers/cd', icon: '💊', label: 'CD Register' },
      { to: '/registers/rp', icon: '👤', label: 'RP Log' },
      { to: '/registers/returns', icon: '↩', label: 'Returns' },
    ],
  },
  {
    title: 'Utilities',
    items: [
      { to: '/handover', icon: '📌', label: 'Handover Notes' },
      { to: '/sops', icon: '📋', label: 'SOPs' },
    ],
  },
]

export function SideNav() {
  const { sideNavMode } = useUIStore()

  return (
    <aside className="side-nav" data-mode={sideNavMode}>
      <div className="side-nav-logo">
        Pharm<span>Station</span>
      </div>

      <nav className="side-nav-menu">
        {menuSections.map((section, i) => (
          <div key={i} className="side-nav-section">
            {section.title && sideNavMode === 'expanded' && (
              <div className="side-nav-section-title">{section.title}</div>
            )}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `side-nav-item ${isActive ? 'active' : ''}`
                }
              >
                <span className="side-nav-item-icon">{item.icon}</span>
                {sideNavMode === 'expanded' && (
                  <span className="side-nav-item-label">{item.label}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="side-nav-footer">
        <NavLink to="/settings" className="side-nav-item">
          <span className="side-nav-item-icon">⚙</span>
          {sideNavMode === 'expanded' && (
            <span className="side-nav-item-label">Settings</span>
          )}
        </NavLink>
      </div>
    </aside>
  )
}
