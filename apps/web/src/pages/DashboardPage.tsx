import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { BookMarked, CalendarClock, Map, MessagesSquare, Network, NotebookPen, BookOpenCheck, Settings, Truck, type LucideIcon } from 'lucide-react'
import { PharmacyMapModal } from '../components/maps/PharmacyMapModal'
import { RpStatusCard } from '../components/registers/RpStatusCard'
import { PageHeader } from '../components/ui'

const moduleCards: { icon: LucideIcon; title: string; description: string; to: string }[] = [
  { icon: BookMarked, title: 'Registers', description: 'CD register, RP log and patient returns', to: '/registers' },
  { icon: NotebookPen, title: 'Logs', description: 'Fridge temperatures, cleaning, visitors and date checks', to: '/logs' },
  { icon: CalendarClock, title: 'Appointments', description: 'Bookings, calendar and patient records', to: '/appointments' },
  { icon: MessagesSquare, title: 'Patient messages', description: 'Text patients and read their replies', to: '/messaging' },
  { icon: Network, title: 'Pharmacy Network', description: 'Message other pharmacies nearby', to: '/messaging/network' },
  { icon: Truck, title: 'Deliveries', description: 'Plan rounds and track medicine deliveries', to: '/deliveries' },
  { icon: BookOpenCheck, title: 'SOPs', description: 'Standard operating procedures and sign-off', to: '/sops' },
  { icon: Settings, title: 'Settings', description: 'Pharmacy details, team and preferences', to: '/settings' },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardPage() {
  const { activeUser, organisation } = useAuthStore()
  const [showMap, setShowMap] = useState(false)
  const firstName = activeUser?.full_name?.split(' ')[0]

  return (
    <div>
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        subtitle={organisation?.name ? `You're signed in to ${organisation.name}.` : undefined}
        actions={
          <button className="ps-btn ps-btn-secondary" onClick={() => setShowMap(true)}>
            <Map size={16} aria-hidden="true" /> Pharmacy map
          </button>
        }
      />

      <RpStatusCard />

      <div className="dashboard-grid">
        {moduleCards.map((card) => (
          <Link key={card.to} to={card.to} className="dashboard-card">
            <span className="dashboard-card-icon" aria-hidden="true">
              <card.icon size={22} strokeWidth={1.75} />
            </span>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </Link>
        ))}
      </div>

      <PharmacyMapModal isOpen={showMap} onClose={() => setShowMap(false)} />
    </div>
  )
}
