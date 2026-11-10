import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useAuthStore, useUIStore, useNetworkStore, useNHS111Store, useAlertStore } from '@pharmstation/core'
import type { NotificationReceipt } from '@pharmstation/types'
import { Bell, LogOut, Menu, Network, PhoneIncoming, RefreshCw } from 'lucide-react'
import { confirmDialog } from '../ui/dialog'

export function TopNav() {
  const navigate = useNavigate()
  const { activeUser, organisation, switchUser, orgLogout } = useAuthStore()
  const { sideNavMode, toggleSideNav, mobileNavOpen, setMobileNavOpen } = useUIStore()
  const isMobile = useIsMobile()
  const { unreadCount, inbox, fetchUnreadCount, fetchInbox, subscribeToInbox, unsubscribeFromInbox } = useNetworkStore()
  const {
    unreadCount: referralUnread,
    fetchReferrals: fetchReferrals111,
    subscribeToReferrals: subscribe111,
    unsubscribeFromReferrals: unsubscribe111,
  } = useNHS111Store()
  const {
    notifications: alerts,
    unreadCount: alertUnread,
    fetchNotifications: fetchAlerts,
    fetchUnreadCount: fetchAlertUnread,
    subscribeToNotifications: subscribeAlerts,
    unsubscribeFromNotifications: unsubscribeAlerts,
    markRead: markAlertRead,
  } = useAlertStore()

  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const [alertBellOpen, setAlertBellOpen] = useState(false)
  const alertBellRef = useRef<HTMLDivElement>(null)

  // Bootstrap network state when org is ready
  useEffect(() => {
    if (!organisation?.id) return
    fetchUnreadCount(organisation.id)
    fetchInbox(organisation.id)
    subscribeToInbox(organisation.id)
    return () => unsubscribeFromInbox()
  }, [organisation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bootstrap NHS 111 referral subscription
  useEffect(() => {
    if (!organisation?.id) return
    fetchReferrals111(organisation.id)
    subscribe111(organisation.id)
    return () => unsubscribe111()
  }, [organisation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bootstrap staff alerts (appointments / PEPS / network / system / patient message)
  useEffect(() => {
    if (!organisation?.id || !activeUser?.id) return
    fetchAlertUnread(organisation.id, activeUser.id)
    fetchAlerts(organisation.id, activeUser.id)
    subscribeAlerts(organisation.id, activeUser.id)
    return () => unsubscribeAlerts()
  }, [organisation?.id, activeUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close bell dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false)
      }
      if (alertBellRef.current && !alertBellRef.current.contains(e.target as Node)) {
        setAlertBellOpen(false)
      }
    }
    if (bellOpen || alertBellOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [bellOpen, alertBellOpen])

  function handleAlertClick(receipt: NotificationReceipt) {
    setAlertBellOpen(false)
    if (!receipt.is_read) markAlertRead(receipt.id)
    if (receipt.notification?.link) navigate(receipt.notification.link)
  }

  async function handleLogout() {
    const name = organisation?.name ?? 'this pharmacy'
    if (await confirmDialog(`Log out ${name} on this device? Staff will need the pharmacy login to sign back in.`)) {
      orgLogout()
    }
  }

  const unreadMessages = inbox.filter((m) => !m.is_read).slice(0, 5)

  function relativeTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const h = Math.floor(mins / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  const initials = (activeUser?.full_name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return (
    <nav className="top-nav" data-sidenav={sideNavMode}>
      <div className="top-nav-left">
        <button
          className="top-nav-icon-btn"
          onClick={() => (isMobile ? setMobileNavOpen(!mobileNavOpen) : toggleSideNav())}
          title={isMobile ? 'Menu' : 'Toggle sidebar'}
          aria-label={isMobile ? 'Menu' : 'Toggle sidebar'}
          aria-expanded={isMobile ? mobileNavOpen : undefined}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <span className="top-nav-brand">Pharm<span>Station</span></span>
      </div>

      <div className="top-nav-right">
        {organisation && <span className="top-nav-org" title="Signed-in pharmacy">{organisation.name}</span>}

        {/* Network message notification bell */}
        <div ref={bellRef} className="top-nav-menu-anchor">
          <button
            className="top-nav-icon-btn"
            onClick={() => setBellOpen((v) => !v)}
            title="Pharmacy Network messages"
            aria-label={`Pharmacy Network messages${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            aria-expanded={bellOpen}
          >
            <Network size={19} aria-hidden="true" />
            {unreadCount > 0 && <span className="top-nav-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>

          {bellOpen && (
            <div className="top-nav-dropdown">
              <div className="top-nav-dropdown-header">
                <strong>Pharmacy Network</strong>
                <button
                  className="ps-btn ps-btn-ghost ps-btn-sm"
                  onClick={() => { setBellOpen(false); navigate('/messaging/network') }}
                >
                  View all →
                </button>
              </div>

              <div className="top-nav-dropdown-list">
                {unreadMessages.length === 0 ? (
                  <div className="top-nav-dropdown-empty">No unread messages</div>
                ) : (
                  unreadMessages.map((msg) => (
                    <button
                      type="button"
                      key={msg.id}
                      className="top-nav-dropdown-item unread"
                      onClick={() => {
                        setBellOpen(false)
                        navigate(`/messaging/network/thread/${msg.thread_id}`)
                      }}
                    >
                      <span className="top-nav-dropdown-title">{msg.from_org?.name ?? 'Unknown pharmacy'}</span>
                      <span className="top-nav-dropdown-body">
                        {msg.subject && <>{msg.subject} · </>}{msg.body.slice(0, 60)}{msg.body.length > 60 ? '…' : ''}
                      </span>
                      <span className="top-nav-dropdown-time">{relativeTime(msg.created_at)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Staff alerts (appointments / PEPS / network / system / patient message) */}
        <div ref={alertBellRef} className="top-nav-menu-anchor">
          <button
            className="top-nav-icon-btn"
            onClick={() => setAlertBellOpen((v) => !v)}
            title="Alerts"
            aria-label={`Alerts${alertUnread > 0 ? `, ${alertUnread} unread` : ''}`}
            aria-expanded={alertBellOpen}
          >
            <Bell size={19} aria-hidden="true" />
            {alertUnread > 0 && <span className="top-nav-badge">{alertUnread > 9 ? '9+' : alertUnread}</span>}
          </button>

          {alertBellOpen && (
            <div className="top-nav-dropdown">
              <div className="top-nav-dropdown-header">
                <strong>Alerts</strong>
                {alertUnread > 0 && (
                  <button
                    className="ps-btn ps-btn-ghost ps-btn-sm"
                    onClick={() => organisation?.id && activeUser?.id && useAlertStore.getState().markAllRead(organisation.id, activeUser.id)}
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="top-nav-dropdown-list">
                {alerts.length === 0 ? (
                  <div className="top-nav-dropdown-empty">No alerts yet</div>
                ) : (
                  alerts.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={`top-nav-dropdown-item ${a.is_read ? '' : 'unread'}`}
                      onClick={() => handleAlertClick(a)}
                    >
                      <span className="top-nav-dropdown-title">{a.notification?.title ?? 'Notification'}</span>
                      {a.notification?.body && <span className="top-nav-dropdown-body">{a.notification.body}</span>}
                      <span className="top-nav-dropdown-time">{relativeTime(a.notification?.created_at ?? a.created_at)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* NHS 111 referral notification */}
        <button
          className="top-nav-icon-btn"
          onClick={() => navigate('/services/111-referrals')}
          title="NHS 111 Referrals"
          aria-label={`NHS 111 Referrals${referralUnread > 0 ? `, ${referralUnread} new` : ''}`}
        >
          <PhoneIncoming size={19} aria-hidden="true" />
          {referralUnread > 0 && <span className="top-nav-badge warning">{referralUnread > 9 ? '9+' : referralUnread}</span>}
        </button>

        <span className="top-nav-divider" aria-hidden="true" />

        <button
          type="button"
          className="top-nav-user"
          onClick={() => navigate('/me')}
          title="My personal account"
        >
          <span className="top-nav-avatar" aria-hidden="true">{initials}</span>
          <span className="top-nav-user-name">{activeUser?.full_name ?? 'Unknown'}</span>
        </button>

        <button className="top-nav-icon-btn with-text" onClick={() => switchUser()} title="Switch user" aria-label="Switch user">
          <RefreshCw size={17} aria-hidden="true" />
          <span className="top-nav-btn-text">Switch</span>
        </button>

        <button className="top-nav-icon-btn" onClick={handleLogout} title="Log out pharmacy" aria-label="Log out pharmacy">
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}
