import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'

const moduleCards = [
  {
    icon: '💊',
    title: 'CD Register',
    description: 'Controlled drugs register entries and balance tracking',
    to: '/registers/cd',
  },
  {
    icon: '👤',
    title: 'RP Log',
    description: 'Responsible Pharmacist sign-in and sign-out records',
    to: '/registers/rp',
  },
  {
    icon: '↩',
    title: 'Patient Returns',
    description: 'Record and manage patient CD returns and disposals',
    to: '/registers/returns',
  },
  {
    icon: '📌',
    title: 'Handover Notes',
    description: 'Staff handover board and task management',
    to: '/handover',
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

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Welcome back, {activeUser?.full_name ?? 'User'} — {organisation?.name ?? ''}
        </p>
      </div>

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
    </div>
  )
}
