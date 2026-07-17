import { Link } from 'react-router-dom'
import { ResourceHeader } from './ResourceHeader'

const contactGroups = [
  { title: 'Urgent and emergency care', items: [
    ['Life-threatening emergency', 'Call 999', 'For immediate threats to life or serious emergencies.'],
    ['NHS 111', 'Call 111 or use 111.nhs.uk', 'Urgent medical help when it is not a 999 emergency. Healthcare professionals should follow the professional route offered by the local 111 service.'],
    ['Urgent mental health support', 'Call 111 and select the mental health option', 'For urgent mental health support in England. Call 999 where there is an immediate risk to life.'],
  ] },
  { title: 'Reporting and patient safety', items: [
    ['MHRA Yellow Card', 'yellowcard.mhra.gov.uk', 'Report suspected adverse drug reactions, defective medicines and medical-device incidents.'],
    ['Learn from Patient Safety Events', 'record.learn-from-patient-safety-events.nhs.uk', 'Record NHS patient-safety events through the national service. Follow local reporting procedures as well.'],
    ['Defective medicines and recalls', 'gov.uk/drug-device-alerts', 'Check current MHRA medicine and device alerts.'],
  ] },
  { title: 'Complaints and concerns', items: [
    ['Local pharmacy complaints', 'Use the pharmacy complaints procedure', 'Acknowledge concerns, provide the complaints lead’s details and explain escalation routes.'],
    ['NHS England', 'england.nhs.uk/contact-us/feedback-and-complaints', 'Information about complaints concerning NHS services commissioned by NHS England.'],
    ['Parliamentary and Health Service Ombudsman', 'ombudsman.org.uk', 'Independent final-stage review after the relevant complaints process is complete.'],
  ] },
]

export function UsefulContactsPage() {
  return <div className="resource-shell resource-contact-page"><div className="resource-screen-only"><ResourceHeader /></div><main className="resource-library"><div className="resource-print-toolbar resource-screen-only"><Link to="/resources/tools">Back to operational tools</Link><button className="resource-primary-action" onClick={() => window.print()}>Print contacts</button></div><article className="contact-sheet"><header><strong>Pharm<span>Station</span></strong><div><h1>Useful pharmacy contacts</h1><p>England · urgent care, reporting, complaints and safeguarding</p></div></header>{contactGroups.map((group) => <section key={group.title}><h2>{group.title}</h2>{group.items.map(([name, route, note]) => <div className="contact-row" key={name}><strong>{name}</strong><b>{route}</b><p>{note}</p></div>)}</section>)}<section><h2>Local safeguarding and escalation contacts</h2><p className="contact-guidance">Safeguarding routes differ locally. Enter verified contacts for your pharmacy and review them regularly.</p>{['Local authority adult safeguarding', 'Local authority children safeguarding', 'Integrated Care Board safeguarding lead', 'Local mental health crisis team', 'Local NHS 111 professional advice route', 'Pharmacy complaints lead'].map((label) => <div className="contact-local-line" key={label}><span>{label}</span><i>Telephone / email / instructions</i></div>)}</section><footer><span>pharmstation.co.uk/resources</span><span>Verify local numbers and procedures before display. Last reviewed: ____ / ____ / ______</span></footer></article></main></div>
}