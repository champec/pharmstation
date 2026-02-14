import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useUIStore, useChatStore } from '@pharmstation/core'

interface NavItem {
  to: string
  icon: string
  label: string
}

interface NavSection {
  title: string
  icon?: string
  to?: string
  items: NavItem[]
  expandable?: boolean
}

const menuSections: NavSection[] = [
  {
    title: '',
    items: [{ to: '/', icon: '📊', label: 'Dashboard' }],
  },
  {
    title: 'Registers',
    icon: '📑',
    to: '/registers',
    expandable: true,
    items: [
      { to: '/registers/cd', icon: '💊', label: 'CD Register' },
      { to: '/registers/rp', icon: '👤', label: 'RP Log' },
      { to: '/registers/returns', icon: '↩', label: 'Returns' },
    ],
  },
  {
    title: 'Utilities',
    icon: '🛠',
    expandable: true,
    items: [
      { to: '/handover', icon: '📌', label: 'Handover Notes' },
      { to: '/sops', icon: '📋', label: 'SOPs' },
    ],
  },
]

export function SideNav() {
  const { sideNavMode } = useUIStore()
  const location = useLocation()
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const expanded = new Set<string>()
    for (const section of menuSections) {
      if (section.expandable && section.items.some((item) => location.pathname.startsWith(item.to))) {
        expanded.add(section.title)
      }
    }
    return expanded
  })

  const toggleSection = (title: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  const isExpanded = sideNavMode === 'expanded'

  return (
    <aside className="side-nav" data-mode={sideNavMode}>
      <div className="side-nav-logo">
        Pharm<span>Station</span>
      </div>

      <nav className="side-nav-menu">
        {menuSections.map((section, i) => {
          const sectionOpen = expandedSections.has(section.title)
          const sectionActive = section.items.some((item) => location.pathname.startsWith(item.to))

          return (
            <div key={i} className="side-nav-section">
              {section.title && isExpanded && (
                section.expandable ? (
                  <button
                    className={`side-nav-section-toggle ${sectionActive ? 'active' : ''}`}
                    onClick={() => toggleSection(section.title)}
                  >
                    {section.icon && <span className="side-nav-section-icon">{section.icon}</span>}
                    <span className="side-nav-section-label">{section.title}</span>
                    <span className={`side-nav-chevron ${sectionOpen ? 'open' : ''}`}>▸</span>
                  </button>
                ) : (
                  <div className="side-nav-section-title">{section.title}</div>
                )
              )}

              {(!section.expandable || !isExpanded || sectionOpen) && (
                <div className={`side-nav-section-items ${isExpanded && section.expandable ? 'indented' : ''}`}>
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
                      {isExpanded && (
                        <span className="side-nav-item-label">{item.label}</span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="side-nav-footer">
        <button
          className={`side-nav-item genie-nav-btn ${useChatStore.getState().isOpen ? 'active' : ''}`}
          onClick={() => useChatStore.getState().toggleOpen()}
          title="Genie AI Assistant"
        >
          <span className="side-nav-item-icon">✨</span>
          {isExpanded && (
            <span className="side-nav-item-label">Genie</span>
          )}
        </button>
        <NavLink to="/settings" className="side-nav-item">
          <span className="side-nav-item-icon">⚙</span>
          {isExpanded && (
            <span className="side-nav-item-label">Settings</span>
          )}
        </NavLink>
      </div>
    </aside>
  )
}
