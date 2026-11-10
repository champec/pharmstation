import { Link } from 'react-router-dom'
import { Pill, ScanLine, Undo2, UserCheck, type LucideIcon } from 'lucide-react'
import { PageHeader } from '../../components/ui'

const registerCards: { icon: LucideIcon; title: string; description: string; to: string }[] = [
  { icon: Pill, title: 'CD register', description: 'Controlled drugs entries, running balances and audit trail', to: '/registers/cd' },
  { icon: ScanLine, title: 'AI scan', description: 'Photograph prescriptions and invoices and let AI draft the CD entries', to: '/registers/scan' },
  { icon: UserCheck, title: 'RP log', description: 'Responsible Pharmacist sign-in and sign-out records', to: '/registers/rp' },
  { icon: Undo2, title: 'Patient returns', description: 'Record patient CD returns and their destruction', to: '/registers/returns' },
]

export function RegistersPage() {
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Registers' }]}
        title="Registers"
        subtitle="Choose a register to view or add entries."
      />

      <div className="dashboard-grid">
        {registerCards.map((card) => (
          <Link key={card.to} to={card.to} className="dashboard-card">
            <span className="dashboard-card-icon" aria-hidden="true">
              <card.icon size={22} strokeWidth={1.75} />
            </span>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
