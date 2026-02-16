import { useNavigate } from 'react-router-dom'

const registerCards = [
  {
    icon: '💊',
    title: 'CD Register',
    description: 'Controlled drugs register — entries, balances, and audit trail',
    to: '/registers/cd',
    color: 'var(--ps-deep-blue)',
  },
  {
    icon: '�',
    title: 'AI Scan',
    description: 'Scan prescriptions and invoices — AI extracts CD entries for you',
    to: '/registers/scan',
    color: 'var(--ps-electric-cyan)',
  },
  {
    icon: '�👤',
    title: 'RP Log',
    description: 'Responsible Pharmacist sign-in and sign-out records',
    to: '/registers/rp',
    color: 'var(--ps-sky-blue)',
  },
  {
    icon: '↩',
    title: 'Patient Returns',
    description: 'Record and manage patient CD returns and destructions',
    to: '/registers/returns',
    color: 'var(--ps-cloud-blue)',
  },
]

export function RegistersPage() {
  const navigate = useNavigate()

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Registers</span>
        </div>
        <h1>📑 Registers</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Select a register to view or add entries
        </p>
      </div>

      <div className="dashboard-grid">
        {registerCards.map((card) => (
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
