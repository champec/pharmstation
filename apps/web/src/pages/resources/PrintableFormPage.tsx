import { Link, Navigate, useParams } from 'react-router-dom'
import { ResourceHeader } from './ResourceHeader'
import { formDefinitions, type FormDefinition } from './formDefinitions'

function Field({ label, wide = false }: { label: string; wide?: boolean }) {
  return <div className={`print-field ${wide ? 'is-wide' : ''}`}><span>{label}</span><i /></div>
}

function Checks({ items }: { items: string[] }) {
  return <div className="print-checks">{items.map((item) => <div key={item}><b>□</b><span>{item}</span></div>)}</div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="print-section"><h2>{title}</h2>{children}</section>
}

function Page({ form, page, children }: { form: FormDefinition; page: number; children: React.ReactNode }) {
  return (
    <article className="print-sheet">
      <header className="print-sheet-header">
        <div><strong>Pharm<span>Station</span></strong><small>Pharmacy continuity resources</small></div>
        <div><b>{form.service}</b><small>Page {page}</small></div>
      </header>
      <div className="print-sheet-title"><h1>{form.title}</h1><span>CONFIDENTIAL</span></div>
      {children}
      <footer><span>pharmstation.co.uk/resources</span><span>Verify against the current service specification and PGD before use.</span></footer>
    </article>
  )
}

function PatientSection() {
  return <Section title="Patient details"><div className="print-field-grid"><Field label="Full name" wide /><Field label="Date of birth" /><Field label="NHS number" /><Field label="Address" wide /><Field label="Postcode" /><Field label="Telephone" /><Field label="GP practice" wide /><Field label="Ethnicity" /><Field label="Gender" /></div></Section>
}

function PharmacyFirstForm({ form }: { form: FormDefinition }) {
  return <>
    <Page form={form} page={1}>
      <PatientSection />
      <Section title="Consultation"><div className="print-field-grid"><Field label="Consultation date" /><Field label="Time" /><Field label="Practitioner name" wide /><Field label="GPhC number" /><Field label="Referral reference" /><Field label="Referrer ODS code" /></div><Checks items={['Consent obtained', 'Face to face', 'Live video', 'Signposted', 'Self-referral', 'NHS 111 referral', 'GP referral', 'Other referral']} /></Section>
      <Section title="Clinical history"><div className="print-field-grid"><Field label="Presenting complaint" wide /><Field label="Symptom duration" /><Field label="Temperature" /><Field label="Existing conditions" wide /><Field label="Allergies and sensitivities" wide /><Field label="Current medicines" wide /><Field label="Actions already taken" wide /></div><Checks items={['Pregnant', 'Breastfeeding', 'Clinical record checked', 'Relevant tests or algorithms completed']} /></Section>
      <Section title="Clinical notes"><div className="print-writing-lines" /></Section>
    </Page>
    <Page form={form} page={2}>
      <div className="print-patient-strip"><Field label="Patient name" wide /><Field label="Date" /></div>
      <Section title="Pathway assessment"><Checks items={form.assessment ?? []} /><div className="print-field-grid"><Field label="Assessment score / result" wide /><Field label="Weight, if relevant" /><Field label="Additional observations" wide /></div></Section>
      <Section title="Treatment options considered"><Checks items={form.treatments ?? []} /></Section>
      <Section title="Exclusions and red flags"><Checks items={['No exclusion criteria apply', 'Exclusion criteria identified', 'No red flags identified', 'Red flags identified and escalated']} /><div className="print-writing-lines is-short" /></Section>
      <Section title="Shared decision and clinical rationale"><div className="print-writing-lines" /></Section>
    </Page>
    <Page form={form} page={3}>
      <div className="print-patient-strip"><Field label="Patient name" wide /><Field label="Date" /></div>
      <Section title="Consultation outcome"><Checks items={['Advice only', 'Medicine supplied under PGD', 'OTC sale', 'Local service supply', 'Routine referral', 'Urgent escalation', 'Other']} /></Section>
      <Section title="Medicine supplied"><div className="print-field-grid"><Field label="Product" wide /><Field label="Form" /><Field label="Strength" /><Field label="Quantity" /><Field label="Dose" wide /><Field label="Duration" /><Field label="Start date" /><Field label="Additional instructions" wide /></div></Section>
      <Section title="Prescription charge status"><Checks items={['Paid', 'A: age exemption', 'B: full-time education', 'D: maternity', 'E: medical', 'F: prepayment', 'G: MoD', 'L: HC2', 'H: income support', 'K: JSA', 'M: tax credit', 'S: pension credit', 'U: universal credit', 'HMP']} /></Section>
      <Section title="Referral, advice and safety netting"><div className="print-field-grid"><Field label="Referred / signposted to" wide /><Field label="Urgency" /><Field label="Organisation ODS code" /><Field label="Reason" wide /></div><Checks items={['Self-care advice', 'Medicine counselling', 'Worsening advice', 'Printed leaflet supplied', 'GP notification required']} /><div className="print-writing-lines is-short" /></Section>
      <Section title="Practitioner declaration"><div className="print-field-grid"><Field label="Name" wide /><Field label="Signature" wide /><Field label="Date" /></div></Section>
    </Page>
  </>
}

function EmergencySupplyForm({ form }: { form: FormDefinition }) {
  return <>
    <Page form={form} page={1}><PatientSection /><Section title="GP details"><div className="print-field-grid"><Field label="GP practice" wide /><Field label="GP address" wide /></div></Section><Section title="Medicines supplied"><div className="print-table"><b>Medicine</b><b>Strength / form</b><b>Quantity</b>{[1, 2, 3, 4].flatMap((row) => [<span key={`${row}a`} />, <span key={`${row}b`} />, <span key={`${row}c`} />])}</div></Section><Section title="Nature of the emergency"><div className="print-writing-lines" /></Section><Section title="Supply record"><div className="print-field-grid"><Field label="Authorising pharmacist" wide /><Field label="GPhC number" /><Field label="Date of supply" /><Field label="Time" /><Field label="Date GP notified" /><Field label="Pharmacy ODS code" /><Field label="Pharmacy stamp" wide /></div></Section></Page>
    <Page form={form} page={2}><div className="print-patient-strip"><Field label="Patient name" wide /><Field label="Date" /></div><Section title="Prescription charge declaration"><Checks items={['Paid prescription charge', 'Under 16', '16–18 in full-time education', '60 or over', 'Maternity exemption', 'Medical exemption', 'Prepayment certificate', 'Free contraception', 'HC2 certificate', 'Income Support', 'Income-based JSA', 'Universal Credit', 'Income-related ESA', 'Pension Credit Guarantee Credit']} /></Section><Section title="Patient declaration"><p className="print-declaration">I declare that the information given is correct and complete, and consent to relevant information being shared for care, service monitoring, fraud prevention and contract management.</p><div className="print-field-grid"><Field label="Patient / guardian name" wide /><Field label="Signature" wide /><Field label="Date" /></div></Section><Section title="Without this supply, I would have"><Checks items={['Gone without my medicine', 'Contacted my GP practice', 'Contacted the out-of-hours GP service', 'Visited A&E or an urgent care centre']} /></Section><Section title="Additional notes"><div className="print-writing-lines" /></Section></Page>
  </>
}

function HypertensionForm({ form }: { form: FormDefinition }) {
  return <>
    <Page form={form} page={1}><PatientSection /><Section title="Service entry"><Checks items={['GP referral', 'Identified in pharmacy', 'Patient consent obtained']} /><div className="print-field-grid"><Field label="Consultation date" /><Field label="Practitioner name" wide /><Field label="GPhC number" /></div></Section><Section title="Clinic blood pressure"><div className="print-table bp-table"><b>Reading</b><b>Arm</b><b>Systolic</b><b>Diastolic</b>{[1, 2, 3, 4].flatMap((row) => [<span key={`${row}a`}>{row}</span>, <span key={`${row}b`}>□ L&nbsp;&nbsp;□ R</span>, <span key={`${row}c`} />, <span key={`${row}d`} />])}</div><div className="print-field-grid"><Field label="Final clinic BP" /><Field label="Pulse" /></div><Checks items={['Irregular pulse detected', 'ABPM indicated', 'ABPM declined']} /></Section><Section title="Clinic notes"><div className="print-writing-lines" /></Section></Page>
    <Page form={form} page={2}><div className="print-patient-strip"><Field label="Patient name" wide /><Field label="Date" /></div><Section title="ABPM fitting"><div className="print-field-grid"><Field label="Fitting date" /><Field label="Practitioner name" wide /><Field label="GPhC number" /><Field label="Planned follow-up" /></div><Checks items={['Referred by GP', 'Identified following clinic check']} /></Section><Section title="Missed follow-up contact attempts"><div className="print-table"><b>Date / time</b><b>Method</b><b>Outcome</b>{[1, 2, 3].flatMap((row) => [<span key={`${row}a`} />, <span key={`${row}b`} />, <span key={`${row}c`} />])}</div></Section><Section title="ABPM follow-up"><div className="print-field-grid"><Field label="Follow-up date" /><Field label="Practitioner name" wide /><Field label="Average daytime BP" /><Field label="Average night-time BP" /><Field label="Average 24-hour BP" /></div></Section><Section title="Additional notes"><div className="print-writing-lines" /></Section></Page>
    <Page form={form} page={3}><div className="print-patient-strip"><Field label="Patient name" wide /><Field label="Date" /></div><Section title="Outcome and referral"><Checks items={['Low BP: asymptomatic', 'Low BP: symptomatic – GP within 3 weeks', 'Low BP: at risk – same-day GP', 'Fainting / falls – same-day GP', 'Fainting / falls – same-day A&E', 'Normal clinic BP', 'Normal ABPM', 'High clinic BP – GP within 3 weeks', 'High ABPM – GP within 3 weeks', 'Very high BP – same-day GP', 'Very high BP – same-day A&E', 'Irregular pulse – same-day GP']} /></Section><Section title="Healthy living advice"><Checks items={['Diet and nutrition', 'Sodium / salt', 'Caffeine', 'Alcohol', 'Smoking', 'Weight management', 'Physical activity', 'Referral to local healthy living service']} /><div className="print-field-grid"><Field label="Service referred to" wide /></div></Section><Section title="Outcome notes"><div className="print-writing-lines" /></Section><Section title="Practitioner declaration"><div className="print-field-grid"><Field label="Name" wide /><Field label="Signature" wide /><Field label="Date" /></div></Section></Page>
  </>
}

export function PrintableFormPage() {
  const { formSlug } = useParams<{ formSlug: string }>()
  const form = formDefinitions.find((item) => item.slug === formSlug)
  if (!form) return <Navigate to="/resources/forms" replace />
  return <div className="resource-shell resource-print-page"><div className="resource-screen-only"><ResourceHeader /><div className="resource-print-toolbar"><Link to="/resources/forms">Back to service forms</Link><button className="resource-primary-action" type="button" onClick={() => window.print()}>Print A4 form</button></div></div><main className="print-document">{form.kind === 'pharmacy-first' ? <PharmacyFirstForm form={form} /> : form.kind === 'emergency-supply' ? <EmergencySupplyForm form={form} /> : <HypertensionForm form={form} />}</main></div>
}