import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { PharmacyMapModal } from '../components/maps/PharmacyMapModal'
import { RpStatusCard } from '../components/registers/RpStatusCard'

const moduleCards = [
  {
    icon: '📑',
    title: 'Registers',
    description: 'CD Register, RP Log, and Patient Returns',
    to: '/registers',
  },
  {
    icon: '📒',
    title: 'Logs',
    description: 'Fridge temperatures, cleaning, visitors and date checks',
    to: '/logs',
  },
  {
    icon: '📋',
    title: 'SOPs',
    description: 'Standard Operating Procedures library',
    to: '/sops',
  },
  {
    icon: '⚙',
    title: 'Settings',
    description: 'Organisation settings and user management',
    to: '/settings',
  },
]

export function DashboardPage() {
  const navigate = useNavigate()
  const { activeUser, organisation } = useAuthStore()
  const [showMap, setShowMap] = useState(false)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
            Welcome back, {activeUser?.full_name ?? 'User'} — {organisation?.name ?? ''}
          </p>
        </div>
        <button
          className="ps-btn ps-btn-secondary"
          onClick={() => setShowMap(true)}
          style={{ whiteSpace: 'nowrap' }}
        >
          Open Maps
        </button>
      </div>

      <RpStatusCard />

      <div className="dashboard-grid">
        {moduleCards.map((card) => (
          <div
            key={card.to}
            className="dashboard-card"
            onClick={() => navigate(card.to)}
          >
            <div className="dashboard-card-icon">{card.icon}</div>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </div>
        ))}
      </div>

      <PharmacyMapModal isOpen={showMap} onClose={() => setShowMap(false)} />
    </div>
  )
}
