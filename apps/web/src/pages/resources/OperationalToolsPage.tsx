import { Link } from 'react-router-dom'
import { ResourceHeader } from './ResourceHeader'

const tools = [
  { to: '/resources/tools/contacts', label: 'Contacts and reporting', title: 'Useful NHS pharmacy contacts', description: 'Urgent care, safeguarding, mental health, complaints and incident-reporting routes in one printable reference.' },
  { to: '/resources/tools/closure-notice', label: 'Business continuity', title: 'Temporary closure notice', description: 'Enter closure and reopening details, alternative arrangements and contact information, then print for the pharmacy door.' },
  { to: '/resources/tools/sildenafil-cards', label: 'Consultation cards', title: 'Sildenafil consultation cards', description: 'Customize and print six wallet-sized cards for patients to present at their next pharmacy consultation.' },
]

export function OperationalToolsPage() {
  return <div className="resource-shell"><ResourceHeader /><main className="resource-library"><div className="resource-page-heading"><Link to="/resources">Resources</Link><span>/</span><span>Operational tools</span><h1>Operational tools</h1><p>Practical, editable resources for continuity, signposting and safer consultations.</p></div><section className="resource-tool-grid">{tools.map((tool) => <Link key={tool.to} to={tool.to}><span>{tool.label}</span><h2>{tool.title}</h2><p>{tool.description}</p><b>Open tool</b></Link>)}</section></main></div>
}