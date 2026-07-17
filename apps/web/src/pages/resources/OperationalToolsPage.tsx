import { Link } from 'react-router-dom'
import { ResourceHeader } from './ResourceHeader'

const tools = [
  { to: '/resources/tools/contacts', label: 'Contacts and reporting', title: 'Useful NHS pharmacy contacts', description: 'Urgent care, safeguarding, mental health, complaints and incident-reporting routes in one printable reference.' },
  { to: '/resources/tools/closure-notice', label: 'Business continuity', title: 'Temporary closure notice', description: 'Enter closure and reopening details, alternative arrangements and contact information, then print for the pharmacy door.' },
  { to: '/resources/tools/sildenafil-cards', label: 'Consultation cards', title: 'Sildenafil consultation cards', description: 'Customize and print six wallet-sized cards for patients to present at their next pharmacy consultation.' },
]

const nhsQuickLinks = [
  {
    name: 'NHS Prescription Tracker',
    description: 'Track NHS electronic prescriptions and prescription status.',
    url: 'https://portal2.national.ncrs.nhs.uk/prescriptionsadmin/',
  },
  {
    name: 'National Care Records Service',
    description: 'Open the NHS National Care Records Service portal.',
    url: 'https://portal.spineservices.nhs.uk/nationalcarerecordsservice/',
  },
]

export function OperationalToolsPage() {
  return <div className="resource-shell"><ResourceHeader /><main className="resource-library"><div className="resource-page-heading"><Link to="/resources">Resources</Link><span>/</span><span>Operational tools</span><h1>Operational tools</h1><p>Practical, editable resources for continuity, signposting and safer consultations.</p></div><section className="resource-quick-links" aria-labelledby="nhs-quick-links-heading"><div><p>Secure NHS portals</p><h2 id="nhs-quick-links-heading">NHS quick links</h2></div><div>{nhsQuickLinks.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer"><strong>{link.name}</strong><span>{link.description}</span><b>Open NHS portal</b></a>)}</div></section><section className="resource-tool-grid">{tools.map((tool) => <Link key={tool.to} to={tool.to}><span>{tool.label}</span><h2>{tool.title}</h2><p>{tool.description}</p><b>Open tool</b></Link>)}</section></main></div>
}