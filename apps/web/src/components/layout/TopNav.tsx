import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useUIStore, useNetworkStore, useNHS111Store, useAlertStore } from '@pharmstation/core'
import type { NotificationReceipt } from '@pharmstation/types'

export function TopNav() {
  const navigate = useNavigate()
  const { activeUser, organisation, switchUser, orgLogout } = useAuthStore()
  const { sideNavMode, toggleSideNav } = useUIStore()
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

  return (
    <nav className="top-nav" data-sidenav={sideNavMode}>
      <div className="top-nav-left">
        <button className="ps-btn ps-btn-ghost" onClick={toggleSideNav} title="Toggle sidebar">
          ☰
        </button>
        <span className="top-nav-brand">Pharm<span>Station</span></span>
      </div>

      <div className="top-nav-right">
        {organisation && <span className="top-nav-org">{organisation.name}</span>}

        {/* Network message notification bell */}
        <div ref={bellRef} style={{ position: 'relative' }}>
          <button
            className="ps-btn ps-btn-ghost"
            style={{ position: 'relative' }}
            onClick={() => setBellOpen((v) => !v)}
            title="Pharmacy Network messages"
          >
            🔔
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: 2,
                background: 'var(--ps-red, #ef4444)', color: '#fff',
                borderRadius: '50%', width: 16, height: 16,
                fontSize: '0.65rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, pointerEvents: 'none',
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown */}
          {bellOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 200,
              width: 320, background: '#fff',
              boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
              borderRadius: 'var(--ps-radius)',
              border: '1px solid var(--ps-off-white)',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: 'var(--ps-space-sm) var(--ps-space-md)',
                borderBottom: '1px solid var(--ps-off-white)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <strong style={{ fontSize: '0.9rem' }}>🏥 Pharmacy Network</strong>
                <button
                  className="ps-btn ps-btn-ghost"
                  style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                  onClick={() => { setBellOpen(false); navigate('/messaging/network') }}
                >
                  View all →
                </button>
              </div>

              {unreadMessages.length === 0 ? (
                <div style={{ padding: 'var(--ps-space-lg)', textAlign: 'center', color: 'var(--ps-slate)', fontSize: '0.85rem' }}>
                  No unread messages
                </div>
              ) : (
                unreadMessages.map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      padding: 'var(--ps-space-sm) var(--ps-space-md)',
                      borderBottom: '1px solid var(--ps-off-white)',
                      cursor: 'pointer',
                      background: '#f8fdff',
                    }}
                    onClick={() => {
                      setBellOpen(false)
                      navigate(`/messaging/network/thread/${msg.thread_id}`)
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 2 }}>
                      {msg.from_org?.name ?? 'Unknown pharmacy'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.subject && <>{msg.subject} · </>}{msg.body.slice(0, 60)}{msg.body.length > 60 ? '…' : ''}
                    </div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--ps-slate)', marginTop: 2 }}>
                      {relativeTime(msg.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Staff alerts (appointments / PEPS / network / system / patient message) */}
        <div ref={alertBellRef} style={{ position: 'relative' }}>
          <button
            className="ps-btn ps-btn-ghost"
            style={{ position: 'relative' }}
            onClick={() => setAlertBellOpen((v) => !v)}
            title="Alerts"
          >
            🔔
            {alertUnread > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: 2,
                background: 'var(--ps-red, #ef4444)', color: '#fff',
                borderRadius: '50%', width: 16, height: 16,
                fontSize: '0.65rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, pointerEvents: 'none',
              }}>
                {alertUnread > 9 ? '9+' : alertUnread}
              </span>
            )}
          </button>

          {alertBellOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 200,
              width: 340, background: '#fff',
              boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
              borderRadius: 'var(--ps-radius)',
              border: '1px solid var(--ps-off-white)',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: 'var(--ps-space-sm) var(--ps-space-md)',
                borderBottom: '1px solid var(--ps-off-white)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <strong style={{ fontSize: '0.9rem' }}>🔔 Alerts</strong>
                {alertUnread > 0 && (
                  <button
                    className="ps-btn ps-btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => organisation?.id && activeUser?.id && useAlertStore.getState().markAllRead(organisation.id, activeUser.id)}
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {alerts.length === 0 ? (
                  <div style={{ padding: 'var(--ps-space-lg)', textAlign: 'center', color: 'var(--ps-slate)', fontSize: '0.85rem' }}>
                    No alerts yet
                  </div>
                ) : (
                  alerts.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        padding: 'var(--ps-space-sm) var(--ps-space-md)',
                        borderBottom: '1px solid var(--ps-off-white)',
                        cursor: 'pointer',
                        background: a.is_read ? 'transparent' : '#f8fdff',
                      }}
                      onClick={() => handleAlertClick(a)}
                    >
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 2 }}>
                        {a.notification?.title ?? 'Notification'}
                      </div>
                      {a.notification?.body && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.notification.body}
                        </div>
                      )}
                      <div style={{ fontSize: '0.73rem', color: 'var(--ps-slate)', marginTop: 2 }}>
                        {relativeTime(a.notification?.created_at ?? a.created_at)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* NHS 111 referral notification */}
        <button
          className="ps-btn ps-btn-ghost"
          style={{ position: 'relative' }}
          onClick={() => navigate('/services/111-referrals')}
          title="NHS 111 Referrals"
        >
          📞
          {referralUnread > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 2,
              background: 'var(--ps-amber, #f59e0b)', color: '#fff',
              borderRadius: '50%', width: 16, height: 16,
              fontSize: '0.65rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, pointerEvents: 'none',
            }}>
              {referralUnread > 9 ? '9+' : referralUnread}
            </span>
          )}
        </button>

        <div className="top-nav-user">
          <strong>{activeUser?.full_name ?? 'Unknown'}</strong>
        </div>

        <button
          className="ps-btn ps-btn-ghost"
          onClick={() => navigate('/me')}
          title="My personal account"
        >
          👤
        </button>

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

