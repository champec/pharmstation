import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useUIStore, useChatStore } from '@pharmstation/core'

interface NavItem {
  to: string
  icon: string
  label: string
  /** Extra pathname patterns that should highlight this item (e.g. detail routes). */
  match?: RegExp
}

interface NavSection {
  title: string
  icon?: string
  items: NavItem[]
  expandable?: boolean
}

const menuSections: NavSection[] = [
  {
    title: '',
    items: [{ to: '/', icon: '📊', label: 'Dashboard' }],
  },
  {
    title: 'Outreach',
    expandable: false,
    items: [{ to: '/outreach', icon: '📣', label: 'Pharmacy Outreach' }],
  },
  {
    title: 'Registers',
    icon: '📑',
    expandable: true,
    items: [
      { to: '/registers/cd', icon: '💊', label: 'CD Register' },
      { to: '/registers/scan', icon: '📸', label: 'AI Scan' },
      { to: '/registers/rp', icon: '👤', label: 'RP Log' },
      { to: '/registers/returns', icon: '↩️', label: 'Returns' },
    ],
  },
  {
    title: 'PEPS',
    icon: '℞',
    expandable: true,
    items: [
      { to: '/peps', icon: '📥', label: 'PEPS Queue' },
      { to: '/peps/mine', icon: '📄', label: 'My Prescriptions' },
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
    title: 'Shop',
    icon: '🛍️',
    expandable: true,
    items: [
      { to: '/shop-admin', icon: '📦', label: 'Products & Stock' },
      { to: '/shop-admin/orders', icon: '🧾', label: 'Orders' },
    ],
  },
  {
    title: 'Appointments',
    icon: '📅',
    expandable: true,
    items: [
      { to: '/appointments', icon: '📋', label: 'List' },
      { to: '/appointments/calendar', icon: '📅', label: 'Calendar' },
      { to: '/appointments/slots', icon: '⏰', label: 'Slots' },
      { to: '/patients', icon: '👥', label: 'Patients' },
    ],
  },
  {
    title: 'Logs',
    expandable: false,
    items: [
      { to: '/logs', icon: '📓', label: 'Logs' },
    ],
  },
  {
    title: 'Patient Safety',
    expandable: false,
    items: [
      { to: '/patient-safety', icon: '✚', label: 'Patient Safety' },
    ],
  },
  {
    title: 'Video',
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
    icon: '🛠️',
    expandable: true,
    items: [
      { to: '/notes', icon: '📌', label: 'Notes' },
      { to: '/sops', icon: '📋', label: 'SOPs' },
      { to: '/resources', icon: '📂', label: 'Resources' },
    ],
  },
  {
    title: 'Deliveries',
    icon: '🚚',
    expandable: true,
    items: [
      { to: '/deliveries', icon: '📦', label: 'Deliveries Board', match: /^\/deliveries(\/[^/]+)?$/ },
      { to: '/deliveries/new', icon: '➕', label: 'New Delivery' },
      { to: '/deliveries/redelivery', icon: '🔄', label: 'Redelivery Queue' },
      { to: '/deliveries/templates', icon: '📋', label: 'Templates' },
    ],
  },
  {
    title: 'Care Homes',
    icon: '🏠',
    expandable: true,
    items: [
      { to: '/care-homes', icon: '🗂️', label: 'Groups Board', match: /^\/care-homes\/(?!manage)[^/]+\/groups/ },
      { to: '/care-homes/manage', icon: '🏠', label: 'Manage Care Homes', match: /^\/care-homes\/manage/ },
      { to: '/care-homes?view=residents', icon: '👥', label: 'Residents', match: /^\/care-homes\/[^/]+\/residents/ },
      { to: '/care-homes?view=requests', icon: '📨', label: 'Requests Manager', match: /^\/care-homes\/[^/]+\/(requests|prescriptions)/ },
    ],
  },
  {
    title: 'Driver',
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

/**
 * Scores how well an item matches the current location.
 * Returns -1 when it does not match at all. Higher is more specific,
 * so exactly one item (the best match) is highlighted.
 */
function matchScore(item: NavItem, pathname: string, search: string): number {
  if (item.match?.test(pathname)) return 10_000

  const [path, itemSearch] = item.to.split('?')
  let score: number
  if (pathname === path) {
    score = path.length * 2
  } else if (path !== '/' && pathname.startsWith(`${path}/`)) {
    score = path.length
  } else {
    return -1
  }

  if (itemSearch) {
    const wanted = new URLSearchParams(itemSearch)
    const current = new URLSearchParams(search)
    for (const [key, value] of wanted) {
      if (current.get(key) !== value) return -1
      score += 1_000
    }
  } else if (path !== '/' && new URLSearchParams(search).get('view')) {
    // A ?view= sibling should win over the plain item on the same path.
    score -= 1
  }
  return score
}

export function SideNav() {
  const { sideNavMode } = useUIStore()
  const chatOpen = useChatStore((state) => state.isOpen)
  const location = useLocation()

  /** The single best-matching item across the whole menu. */
  const activeTo = useMemo(() => {
    let best: string | null = null
    let bestScore = -1
    for (const section of menuSections) {
      for (const item of section.items) {
        const score = matchScore(item, location.pathname, location.search)
        if (score > bestScore) {
          bestScore = score
          best = item.to
        }
      }
    }
    return best
  }, [location.pathname, location.search])

  const [expandedSection, setExpandedSection] = useState<string | null>(() => {
    const owner = menuSections.find(
      (section) => section.expandable && section.items.some((item) => item.to === activeTo),
    )
    return owner?.title ?? null
  })

  // Auto-expand the section that owns the active route when navigating.
  useEffect(() => {
    const owner = menuSections.find(
      (section) => section.expandable && section.items.some((item) => item.to === activeTo),
    )
    if (owner) setExpandedSection(owner.title)
  }, [activeTo])

  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const justExpandedRef = useRef<string | null>(null)

  // After opening a section, scroll the newly revealed items into view.
  useEffect(() => {
    if (!justExpandedRef.current) return
    const el = sectionRefs.current.get(justExpandedRef.current)
    justExpandedRef.current = null
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [expandedSection])

  const toggleSection = (title: string) => {
    setExpandedSection((prev) => {
      if (prev === title) return null
      justExpandedRef.current = title
      return title
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
          const sectionOpen = expandedSection === section.title
          const sectionActive = section.items.some((item) => item.to === activeTo)
          const showItems = !section.expandable || !isExpanded || sectionOpen

          return (
            <div
              key={i}
              className="side-nav-section"
              ref={(el) => {
                if (el) sectionRefs.current.set(section.title, el)
                else sectionRefs.current.delete(section.title)
              }}
            >
              {section.expandable && isExpanded && (
                <button
                  type="button"
                  className={`side-nav-section-toggle ${sectionActive ? 'active' : ''}`}
                  aria-expanded={sectionOpen}
                  onClick={() => toggleSection(section.title)}
                >
                  <span className="side-nav-item-icon">{section.icon}</span>
                  <span className="side-nav-section-label">{section.title}</span>
                  <span className={`side-nav-chevron ${sectionOpen ? 'open' : ''}`} aria-hidden="true">▸</span>
                </button>
              )}

              {showItems && (
                <div className={`side-nav-section-items ${isExpanded && section.expandable ? 'indented' : ''}`}>
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={() => `side-nav-item ${item.to === activeTo ? 'active' : ''}`}
                    >
                      {(!isExpanded || !section.expandable) && (
                        <span className="side-nav-item-icon">{item.icon}</span>
                      )}
                      {isExpanded && <span className="side-nav-item-label">{item.label}</span>}
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
          type="button"
          className={`side-nav-item genie-nav-btn ${chatOpen ? 'active' : ''}`}
          onClick={() => useChatStore.getState().toggleOpen()}
          title="Genie AI Assistant"
        >
          <span className="side-nav-item-icon">✨</span>
          {isExpanded && <span className="side-nav-item-label">Genie</span>}
        </button>
        <NavLink to="/settings" className={({ isActive }) => `side-nav-item ${isActive ? 'active' : ''}`}>
          <span className="side-nav-item-icon">⚙️</span>
          {isExpanded && <span className="side-nav-item-label">Settings</span>}
        </NavLink>
      </div>
    </aside>
  )
}
