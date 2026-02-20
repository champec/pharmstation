import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useUIStore, useNetworkStore } from '@pharmstation/core'

export function TopNav() {
  const navigate = useNavigate()
  const { activeUser, organisation, switchUser, orgLogout } = useAuthStore()
  const { sideNavMode, toggleSideNav } = useUIStore()
  const { unreadCount, inbox, fetchUnreadCount, fetchInbox, subscribeToInbox, unsubscribeFromInbox } = useNetworkStore()

  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  // Bootstrap network state when org is ready
  useEffect(() => {
    if (!organisation?.id) return
    fetchUnreadCount(organisation.id)
    fetchInbox(organisation.id)
    subscribeToInbox(organisation.id)
    return () => unsubscribeFromInbox()
  }, [organisation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close bell dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false)
      }
    }
    if (bellOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [bellOpen])

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

