import { Link } from 'react-router-dom'
import { CONTACT_EMAIL, PublicSiteFooter } from '../../components/public/PublicSiteShell'

// Shown at "/" to visitors who aren't signed in to a pharmacy. Signed-in staff get the dashboard.

function mailto(subject: string, opening: string) {
  const body = `${opening}\n\nPharmacy name:\nPostcode:\nBest number to reach me:\n`
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

const DEMO_MAILTO = mailto('PharmStation demo', 'Hi, I would like a demo of PharmStation.')
const JOIN_MAILTO = mailto('Join the PharmStation network', 'Hi, I would like to join the PharmStation pharmacy network.')

const REPLACES = [
  'Paper CD register',
  'RP log binder',
  'Service claims tool',
  'Appointment app',
  'Patient texting',
  'Delivery clipboard',
  'SOP folder',
]

const FEATURES = [
  {
    icon: '💊',
    title: 'Registers and logs',
    body: 'Digital CD register, RP log and patient returns, searchable in seconds. Add fridge, cleaning, visitor or any custom log your SOPs need.',
  },
  {
    icon: '🏥',
    title: 'Pharmacy Network',
    body: 'Message pharmacies near you securely. Ask who has a medicine in stock, broadcast to every open pharmacy nearby, and get an answer with a tap.',
  },
  {
    icon: '🩺',
    title: 'Services and PEPS',
    body: 'Run NHS and private services from ready-made or custom forms. Issue private prescriptions electronically through PEPS so they can be tracked and dispensed anywhere.',
  },
  {
    icon: '📅',
    title: 'Bookings, payments and video',
    body: 'Patients book online, pay at checkout and join video consultations from a link. No app for them to download, no payment gateway for you to set up.',
  },
  {
    icon: '💬',
    title: 'Patient messaging',
    body: 'A real textable number for your pharmacy. Every approved team member can reply from any terminal, and existing patients are recognised when they text in.',
  },
  {
    icon: '🚚',
    title: 'Deliveries',
    body: 'Plan rounds, manage redeliveries and give drivers a proper app with today’s stops, proof of delivery and automatic status updates.',
  },
  {
    icon: '🏠',
    title: 'Care homes and locums',
    body: 'A workspace for care home residents, medication requests and supply cycles. Short-staffed? Post a shift and fill it from the locum network.',
  },
  {
    icon: '✨',
    title: 'Genie, your AI assistant',
    body: 'Ask a question in plain English, pull up information or hand off a routine task, instead of digging through menus.',
  },
]

const PLANS = [
  {
    name: 'Network',
    price: '£0',
    note: 'Free for life',
    pitch: 'Join the pharmacy network and stay in the loop.',
    items: ['Pharmacy Network messaging and broadcasts', 'Receive private e-prescriptions (PEPS)', 'Pharmacy map with opening times', 'All free printable resources'],
    cta: 'Join free',
    href: JOIN_MAILTO,
  },
  {
    name: 'Essential',
    price: '£39',
    note: 'per month',
    pitch: 'Go paperless for registers, logs and SOPs.',
    items: ['Everything in Network', 'Digital CD register, RP log and returns', 'Custom logs, handover notes and tasks', 'SOP library with read tracking'],
    cta: 'Book a demo',
  },
  {
    name: 'Complete',
    price: '£79',
    note: 'per month',
    pitch: 'The whole platform for the whole pharmacy.',
    items: ['Everything in Essential', 'Services, appointments, payments and video', 'Patient messaging and online shop', 'Deliveries, care homes and locum shifts'],
    cta: 'Book a demo',
    featured: true,
  },
]

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="landing-wordmark" aria-label="PharmStation home">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <span>Pharm<span>Station</span></span>
        </Link>
        <nav aria-label="Main">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <Link to="/resources">Free resources</Link>
          <Link to="/book">Book an appointment</Link>
        </nav>
        <div className="landing-nav-actions">
          <Link to="/login/org" className="landing-btn landing-btn-ghost">Sign in</Link>
          <a href={DEMO_MAILTO} className="landing-btn landing-btn-primary">Book a demo</a>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">Built by a pharmacist for UK community pharmacy</span>
            <h1>One login for everything your pharmacy does all day.</h1>
            <p>
              Registers, services, bookings, patient messages, deliveries and a secure network of pharmacies
              near you, in one connected workstation. Retire a few logins instead of adding another.
            </p>
            <div className="landing-hero-actions">
              <a href={DEMO_MAILTO} className="landing-btn landing-btn-primary landing-btn-lg">Book a demo</a>
              <Link to="/login/org" className="landing-btn landing-btn-ghost landing-btn-lg">Pharmacy sign in</Link>
            </div>
            <small>Start free on the pharmacy network. Add paid modules only when they earn their place.</small>
          </div>

          <div className="landing-hero-visual" aria-hidden="true">
            <div className="landing-mock">
              <div className="landing-mock-bar"><i /><i /><i /><span>Today at your pharmacy</span></div>
              <div className="landing-mock-row landing-mock-ok"><b>RP signed in</b><span>08:52 · on duty</span></div>
              <div className="landing-mock-row"><b>CD balance check</b><span>Morphine 10mg/5ml · balance matches</span></div>
              <div className="landing-mock-row landing-mock-msg"><b>Network message</b><span>“Anyone have amoxicillin 250mg/5ml?” · 3 replies</span></div>
              <div className="landing-mock-row"><b>Next appointment</b><span>11:30 · Pharmacy First, sore throat</span></div>
              <div className="landing-mock-row"><b>Deliveries</b><span>14 stops · driver on round 2</span></div>
            </div>
          </div>
        </section>

        <section className="landing-replaces" aria-label="What PharmStation replaces">
          <strong>Replaces</strong>
          <ul>
            {REPLACES.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className="landing-section" id="features">
          <header className="landing-section-head">
            <span className="landing-eyebrow">Features</span>
            <h2>Everything a pharmacy runs on, working together</h2>
            <p>Use the modules you need. Keep the suppliers you like and replace the ones you only tolerate.</p>
          </header>
          <div className="landing-features">
            {FEATURES.map((feature) => (
              <article key={feature.title}>
                <span aria-hidden="true">{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-network">
          <div>
            <span className="landing-eyebrow">The Pharmacy Network</span>
            <h2>A patient needs one box. Six pharmacies nearby might have it.</h2>
            <p>
              Instead of ringing round the high street, send one secure message to every open pharmacy near you.
              When a local pharmacy messages you, you know it matters, and answering takes a tap.
            </p>
          </div>
          <ul>
            <li><b>Stock checks</b>Ask nearby pharmacies at once, not one call at a time.</li>
            <li><b>Who’s open</b>See local pharmacies and opening times on a map, even on a Sunday.</li>
            <li><b>Alerts everywhere</b>Desktop, app and text notifications so nothing gets missed.</li>
          </ul>
        </section>

        <section className="landing-section" id="pricing">
          <header className="landing-section-head">
            <span className="landing-eyebrow">Pricing</span>
            <h2>Costs less than the tools it replaces</h2>
            <p>Most pharmacies spend £130 to £300 a month across systems that don’t talk to each other.</p>
          </header>
          <div className="landing-plans">
            {PLANS.map((plan) => (
              <article key={plan.name} className={plan.featured ? 'landing-plan-featured' : undefined}>
                {plan.featured && <em>Most popular</em>}
                <h3>{plan.name}</h3>
                <div className="landing-price"><b>{plan.price}</b><span>{plan.note}</span></div>
                <p>{plan.pitch}</p>
                <ul>
                  {plan.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <a href={plan.href ?? DEMO_MAILTO} className={`landing-btn ${plan.featured ? 'landing-btn-primary' : 'landing-btn-ghost'}`}>{plan.cta}</a>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-founder">
          <blockquote>
            “Most developers have never tried to find an owing while answering a prescriber, checking a CD balance
            and being asked where the cotton wool is. I have. That is the product research.”
          </blockquote>
          <span>Founder of PharmStation, practising pharmacist</span>
        </section>

        <section className="landing-split">
          <article>
            <span className="landing-eyebrow">Free for every pharmacy</span>
            <h2>Free resources</h2>
            <p>Responsible Pharmacist notices, Pharmacy First consultation forms, printable logs and patient leaflets. No account needed.</p>
            <div className="landing-links">
              <Link to="/rp">RP notice</Link>
              <Link to="/resources/forms">Consultation forms</Link>
              <Link to="/resources/logs">Printable logs</Link>
              <Link to="/resources">All resources →</Link>
            </div>
          </article>
          <article>
            <span className="landing-eyebrow">For patients</span>
            <h2>Looking for a pharmacy?</h2>
            <p>Book a service, shop from a local pharmacy or find one near you.</p>
            <div className="landing-links">
              <Link to="/book">Book an appointment</Link>
              <Link to="/shop">Shop</Link>
              <Link to="/maps">Find a pharmacy</Link>
              <Link to="/patient/login">Patient sign in</Link>
            </div>
          </article>
        </section>

        <section className="landing-cta">
          <h2>See it working in your pharmacy</h2>
          <p>A short demo, on your terms. We’ll show you the free starting point and what the paid modules add.</p>
          <div className="landing-hero-actions">
            <a href={DEMO_MAILTO} className="landing-btn landing-btn-light landing-btn-lg">Book a demo</a>
            <a href={`mailto:${CONTACT_EMAIL}`} className="landing-btn landing-btn-outline-light landing-btn-lg">{CONTACT_EMAIL}</a>
          </div>
        </section>
      </main>

      <PublicSiteFooter />
    </div>
  )
}
