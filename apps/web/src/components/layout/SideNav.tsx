import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useUIStore, useChatStore, useSubscriptionStore, useAuthStore, featureForPath } from '@pharmstation/core'
import { useIsMobile } from '../../hooks/useIsMobile'
import { PLANS_ENFORCED } from '../../lib/billing'
import { getUserClient } from '@pharmstation/supabase-client'
import { Activity, BookMarked, BookOpenCheck, Building2, CalendarClock, CalendarDays, CalendarRange, Car, ChevronRight, ClipboardList, Clock, Contact, CreditCard, FileSignature, FileText, FolderOpen, History, Home, Inbox, LayoutDashboard, LayoutGrid, LayoutTemplate, Library, LifeBuoy, Link, List, Lock, Megaphone, MessageSquare, MessagesSquare, Network, NotebookPen, Package, PenLine, PhoneIncoming, Pill, Plus, Receipt, RotateCcw, ScanLine, Settings, Settings2, ShieldPlus, ShoppingBag, Sparkles, Stethoscope, StickyNote, Store, Timer, Truck, Undo2, UserCheck, Users, Video, Wrench, type LucideIcon } from 'lucide-react'

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  /** Extra pathname patterns that should highlight this item (e.g. detail routes). */
  match?: RegExp
}

interface NavSection {
  title: string
  icon?: LucideIcon
  items: NavItem[]
  expandable?: boolean
}

const menuSections: NavSection[] = [
  {
    title: '',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/oversight', icon: Activity, label: 'Oversight' },
      { to: '/oversight/activity', icon: History, label: 'Activity log' },
    ],
  },
  {
    title: 'Outreach',
    expandable: false,
    items: [{ to: '/outreach', icon: Megaphone, label: 'Pharmacy Outreach' }],
  },
  {
    title: 'Registers',
    icon: BookMarked,
    expandable: true,
    items: [
      { to: '/registers/cd', icon: Pill, label: 'CD Register' },
      { to: '/registers/scan', icon: ScanLine, label: 'AI Scan' },
      { to: '/registers/rp', icon: UserCheck, label: 'RP Log' },
      { to: '/registers/returns', icon: Undo2, label: 'Returns' },
    ],
  },
  {
    title: 'PEPS',
    icon: FileSignature,
    expandable: true,
    items: [
      { to: '/peps', icon: Inbox, label: 'PEPS Queue' },
      { to: '/peps/mine', icon: FileText, label: 'My Prescriptions' },
    ],
  },
  {
    title: 'Services',
    icon: Stethoscope,
    expandable: true,
    items: [
      { to: '/services', icon: Stethoscope, label: 'Services' },
      { to: '/services/library', icon: Library, label: 'Library' },
      { to: '/services/claims', icon: Receipt, label: 'Claims' },
      { to: '/services/111-referrals', icon: PhoneIncoming, label: '111 Referrals' },
      { to: '/payments', icon: CreditCard, label: 'Payments' },
    ],
  },
  {
    title: 'Shop',
    icon: Store,
    expandable: true,
    items: [
      { to: '/shop-admin', icon: Package, label: 'Products & Stock' },
      { to: '/shop-admin/orders', icon: ShoppingBag, label: 'Orders' },
    ],
  },
  {
    title: 'Appointments',
    icon: CalendarClock,
    expandable: true,
    items: [
      { to: '/appointments', icon: List, label: 'List' },
      { to: '/appointments/calendar', icon: CalendarDays, label: 'Calendar' },
      { to: '/appointments/slots', icon: Clock, label: 'Slots' },
      { to: '/patients', icon: Users, label: 'Patients' },
    ],
  },
  {
    title: 'Logs',
    expandable: false,
    items: [
      { to: '/logs', icon: NotebookPen, label: 'Logs' },
    ],
  },
  {
    title: 'Patient Safety',
    expandable: false,
    items: [
      { to: '/patient-safety', icon: ShieldPlus, label: 'Patient Safety' },
    ],
  },
  {
    title: 'Video',
    expandable: false,
    items: [
      { to: '/video', icon: Video, label: 'Video Consults' },
    ],
  },
  {
    title: 'Messaging',
    icon: MessagesSquare,
    expandable: true,
    items: [
      { to: '/messaging', icon: MessageSquare, label: 'Patient Comms' },
      { to: '/messaging/inbox', icon: Inbox, label: 'Patient Inbox' },
      { to: '/messaging/compose', icon: PenLine, label: 'Compose' },
      { to: '/messaging/broadcasts', icon: Megaphone, label: 'Broadcasts' },
      { to: '/messaging/history', icon: History, label: 'History' },
    ],
  },
  {
    title: 'Pharm Network',
    icon: Network,
    expandable: true,
    items: [
      { to: '/messaging/network', icon: Network, label: 'Network Hub' },
      { to: '/messaging/network/compose', icon: PenLine, label: 'New Message' },
      { to: '/messaging/network/onboarding', icon: Link, label: 'Link Pharmacy' },
      { to: '/messaging/network/settings', icon: Settings2, label: 'Network Settings' },
    ],
  },
  {
    title: 'Utilities',
    icon: Wrench,
    expandable: true,
    items: [
      { to: '/notes', icon: StickyNote, label: 'Notes' },
      { to: '/sops', icon: BookOpenCheck, label: 'SOPs' },
      { to: '/resources', icon: FolderOpen, label: 'Resources' },
      { to: '/contact', icon: LifeBuoy, label: 'Help & support' },
    ],
  },
  {
    title: 'Deliveries',
    icon: Truck,
    expandable: true,
    items: [
      { to: '/deliveries', icon: Truck, label: 'Deliveries Board', match: /^\/deliveries\/(?!new$|redelivery$|templates(\/|$))[^/]+(\/edit)?$/ },
      { to: '/deliveries/new', icon: Plus, label: 'New Delivery' },
      { to: '/deliveries/redelivery', icon: RotateCcw, label: 'Redelivery Queue' },
      { to: '/deliveries/templates', icon: LayoutTemplate, label: 'Templates' },
    ],
  },
  {
    title: 'Care Homes',
    icon: Home,
    expandable: true,
    items: [
      { to: '/care-homes', icon: LayoutGrid, label: 'Groups Board', match: /^\/care-homes\/(?!manage)[^/]+\/(groups|supplies)/ },
      { to: '/care-homes/manage', icon: Building2, label: 'Manage Care Homes', match: /^\/care-homes\/manage/ },
      { to: '/care-homes?view=residents', icon: Users, label: 'Residents', match: /^\/care-homes\/[^/]+\/residents/ },
      { to: '/care-homes?view=mar', icon: BookOpenCheck, label: 'MAR Charts', match: /^\/care-homes\/[^/]+\/mar/ },
      { to: '/care-homes?view=requests', icon: ClipboardList, label: 'Requests Manager', match: /^\/care-homes\/[^/]+\/(requests|prescriptions)/ },
    ],
  },
  {
    title: 'Driver',
    expandable: false,
    items: [
      { to: '/driver', icon: Car, label: 'My Deliveries' },
    ],
  },
  {
    title: 'Shifts',
    icon: CalendarRange,
    expandable: true,
    items: [
      { to: '/shifts', icon: LayoutDashboard, label: 'Overview' },
      { to: '/shifts/calendar', icon: CalendarDays, label: 'Calendar' },
      { to: '/shifts/new', icon: Plus, label: 'New Shift' },
      { to: '/shifts/locums', icon: Contact, label: 'Locum Directory' },
      { to: '/shifts/sops', icon: BookOpenCheck, label: 'SOPs' },
      { to: '/shifts/timesheets', icon: Timer, label: 'Timesheets' },
      { to: '/shifts/payments', icon: CreditCard, label: 'Payments' },
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
  const { sideNavMode, mobileNavOpen } = useUIStore()
  const isMobile = useIsMobile()
  const chatOpen = useChatStore((state) => state.isOpen)
  const location = useLocation()
  const planLoaded = useSubscriptionStore((s) => s.loaded)
  const hasFeature = useSubscriptionStore((s) => s.hasFeature)
  useSubscriptionStore((s) => s.plan) // re-render when the plan changes
  /** True when plan enforcement is on and this item's feature isn't in the plan. */
  const organisationType = useAuthStore((s) => s.organisation?.organisation_type)
  const permissions = useAuthStore((s) => s.permissions)
  const isCareHomeOrg = organisationType === 'carehome'
  /** Pharmacy Outreach is PharmStation's own sales CRM: only platform admins see it. */
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  useEffect(() => {
    let live = true
    getUserClient().rpc('ps_is_platform_admin').then(({ data }) => { if (live) setIsPlatformAdmin(data === true) })
    return () => { live = false }
  }, [])
  const canViewCareHomes = permissions?.care_home_view === true
  const canManageCareHomes = !isCareHomeOrg && permissions?.care_home_manage === true
  /** Care home logins only see their care home workspace; pharmacy staff need care_home_view. */
  const canOversee = permissions?.view_audit === true && !isCareHomeOrg
  const visibleSections = useMemo(() => menuSections
    .map((section) => section.title === '' && !canOversee
      ? { ...section, items: section.items.filter((item) => !item.to.startsWith('/oversight')) }
      : section)
    .filter((section) => {
      if (isCareHomeOrg) return section.title === '' || section.title === 'Care Homes'
      if (section.title === 'Care Homes') return canViewCareHomes
      if (section.title === 'Outreach') return isPlatformAdmin
      return true
    })
    .map((section) => section.title === 'Care Homes' && !canManageCareHomes
      ? { ...section, items: section.items.filter((item) => item.to !== '/care-homes/manage') }
      : section), [isCareHomeOrg, canViewCareHomes, canManageCareHomes, isPlatformAdmin, canOversee])
  const isLocked = (to: string) => {
    if (!PLANS_ENFORCED || !planLoaded) return false
    const feature = featureForPath(to.split('?')[0])
    return !!feature && !hasFeature(feature)
  }

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

  // On phones the nav is a full-width drawer, so it always shows labels
  const isExpanded = isMobile || sideNavMode === 'expanded'

  return (
    <aside className="side-nav" data-mode={sideNavMode} data-mobile-open={isMobile && mobileNavOpen ? 'true' : undefined}>
      <div className="side-nav-logo">
        Pharm<span>Station</span>
      </div>

      <nav className="side-nav-menu">
        {visibleSections.map((section, i) => {
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
                  <span className="side-nav-item-icon">{section.icon && <section.icon size={18} strokeWidth={1.75} aria-hidden="true" />}</span>
                  <span className="side-nav-section-label">{section.title}</span>
                  <span className={`side-nav-chevron ${sectionOpen ? 'open' : ''}`} aria-hidden="true"><ChevronRight size={14} /></span>
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
                        <span className="side-nav-item-icon"><item.icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
                      )}
                      {isExpanded && <span className="side-nav-item-label">{item.label}</span>}
                      {isExpanded && isLocked(item.to) && (
                        <span className="side-nav-item-lock" title="Upgrade your plan to use this"><Lock size={13} aria-label="Locked" /></span>
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
          type="button"
          className={`side-nav-item genie-nav-btn ${chatOpen ? 'active' : ''}`}
          onClick={() => useChatStore.getState().toggleOpen()}
          title="Genie AI Assistant"
        >
          <span className="side-nav-item-icon"><Sparkles size={18} strokeWidth={1.75} aria-hidden="true" /></span>
          {isExpanded && <span className="side-nav-item-label">Genie</span>}
        </button>
        <NavLink to="/settings" className={({ isActive }) => `side-nav-item ${isActive ? 'active' : ''}`}>
          <span className="side-nav-item-icon"><Settings size={18} strokeWidth={1.75} aria-hidden="true" /></span>
          {isExpanded && <span className="side-nav-item-label">Settings</span>}
        </NavLink>
      </div>
    </aside>
  )
}
