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
      { to: '/registers/scan', icon: '📸', label: 'AI Scan' },
      { to: '/registers/rp', icon: '👤', label: 'RP Log' },
      { to: '/registers/returns', icon: '↩', label: 'Returns' },
    ],
  },
  {
    title: 'PEPS',
    icon: '℞',
    to: '/peps',
    expandable: true,
    items: [
      { to: '/peps', icon: '📥', label: 'PEPS Queue' },
      { to: '/peps/write', icon: '✍️', label: 'Write Prescription' },
      { to: '/peps/mine', icon: '📄', label: 'My Prescriptions' },
      { to: '/peps/prescriber', icon: '🪪', label: 'Prescriber Setup' },
    ],
  },
  {
    title: 'Services',
    icon: '🩺',
    expandable: true,
    items: [
      { to: '/services', icon: '📋', label: 'Services' },
      { to: '/services/library', icon: '📚', label: 'Library' },
      { to: '/services/claims', icon: '📝', label: 'Claims' },
      { to: '/services/111-referrals', icon: '📞', label: '111 Referrals' },
      { to: '/payments', icon: '💳', label: 'Payments' },
    ],
  },
  {
    title: 'Appointments',
    icon: '📅',
    expandable: true,
    items: [
      { to: '/appointments', icon: '📅', label: 'Calendar' },
      { to: '/appointments/slots', icon: '⏰', label: 'Slots' },
      { to: '/patients', icon: '👥', label: 'Patients' },
    ],
  },
  {
    title: 'Logs',
    icon: '📓',
    expandable: true,
    items: [
      { to: '/logs', icon: '📓', label: 'My Logs' },
      { to: '/logs/library', icon: '📚', label: 'Log Library' },
    ],
  },
  {
    title: 'Video',
    icon: '📹',
    expandable: false,
    items: [
      { to: '/video', icon: '📹', label: 'Video Consults' },
    ],
  },
  {
    title: 'Messaging',
    icon: '💬',
    expandable: true,
    items: [
      { to: '/messaging', icon: '💬', label: 'Patient Comms' },
      { to: '/messaging/compose', icon: '✏️', label: 'Compose' },
      { to: '/messaging/broadcasts', icon: '📢', label: 'Broadcasts' },
      { to: '/messaging/history', icon: '🗂️', label: 'History' },
    ],
  },
  {
    title: 'Pharm Network',
    icon: '🏥',
    expandable: true,
    items: [
      { to: '/messaging/network', icon: '🏥', label: 'Network Hub' },
      { to: '/messaging/network/compose', icon: '✍️', label: 'New Message' },
      { to: '/messaging/network/onboarding', icon: '🔗', label: 'Link Pharmacy' },
      { to: '/messaging/network/settings', icon: '⚙️', label: 'Network Settings' },
    ],
  },
  {
    title: 'Utilities',
    icon: '🛠',
    expandable: true,
    items: [
      { to: '/notes', icon: '📌', label: 'Notes' },
      { to: '/sops', icon: '📋', label: 'SOPs' },
      { to: '/resources', icon: '▤', label: 'Resources' },
    ],
  },
  {
    title: 'Delivery Rounds',
    icon: '🚗',
    expandable: true,
    items: [
      { to: '/delivery-rounds', icon: '📦', label: 'Rounds' },
      { to: '/delivery-rounds/new', icon: '➕', label: 'New Round' },
      { to: '/delivery-rounds/redelivery', icon: '🔄', label: 'Redelivery Queue' },
      { to: '/delivery-rounds/templates', icon: '📋', label: 'Templates' },
    ],
  },
  {
    title: 'Care Homes',
    icon: '▦',
    expandable: true,
    items: [
      { to: '/care-homes', icon: '▦', label: 'Workspace' },
      { to: '/care-homes?view=residents', icon: '●', label: 'Residents' },
      { to: '/care-homes?view=units', icon: '≡', label: 'Units & Floors' },
      { to: '/care-homes?view=supplies', icon: '□', label: 'Medicine Supplies' },
      { to: '/care-homes?view=requests', icon: '↗', label: 'Prescription Journey' },
      { to: '/care-homes?view=mar', icon: 'M', label: 'MAR Charts' },
    ],
  },
  {
    title: 'Driver',
    icon: '🏎️',
    expandable: false,
    items: [
      { to: '/driver', icon: '🚗', label: 'My Deliveries' },
    ],
  },
  {
    title: 'Shifts',
    icon: '🗓️',
    expandable: true,
    items: [
      { to: '/shifts', icon: '📋', label: 'Overview' },
      { to: '/shifts/calendar', icon: '📅', label: 'Calendar' },
      { to: '/shifts/new', icon: '➕', label: 'New Shift' },
      { to: '/shifts/locums', icon: '👤', label: 'Locum Directory' },
      { to: '/shifts/sops', icon: '📄', label: 'SOPs' },
      { to: '/shifts/payments', icon: '💳', label: 'Payments' },
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
