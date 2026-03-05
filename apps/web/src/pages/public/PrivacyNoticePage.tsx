import { Link } from 'react-router-dom'

export function PrivacyNoticePage() {
  return (
    <div style={{ maxWidth: '900px', margin: '40px auto', padding: '0 var(--ps-space-lg)' }}>
      <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)' }}>

        <div style={{ textAlign: 'center', marginBottom: 'var(--ps-space-xl)' }}>
          <h1 style={{ marginBottom: 'var(--ps-space-sm)' }}>Privacy Notice</h1>
          <p style={{ color: 'var(--ps-slate)' }}>
            How PharmStation collects, uses, and protects your personal data
          </p>
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-text-sm)' }}>
            Last updated: 4 March 2026 &nbsp;|&nbsp; Version 1.0
          </p>
        </div>

        <div style={{ display: 'grid', gap: 'var(--ps-space-lg)' }}>

          {/* 1. Who we are */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              1. Who we are
            </h2>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              PharmStation is a pharmacy management platform operated by Champe Chilufya (sole trader),
              registered with the NHS as ODS code <strong>D8W5S</strong>. We provide cloud-based software
              to community pharmacies for managing registers, clinical services, patient records, appointments,
              medication deliveries, and NHS service claims.
            </p>
            <p style={{ marginTop: 'var(--ps-space-sm)', color: 'var(--ps-slate)' }}>
              <strong>Data Protection Contact:</strong> Champe Chilufya (SIRO, IG Lead, Caldicott Guardian)
              <br />
              <strong>Email:</strong> chronic2157@gmail.com
            </p>
          </section>

          {/* 2. Our role */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              2. Our role in processing your data
            </h2>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              Each pharmacy organisation using PharmStation is the <strong>data controller</strong> for
              the personal data of their patients and staff. PharmStation acts as a <strong>data processor</strong> on
              behalf of each pharmacy, processing data only on their instructions and in accordance with our
              data processing agreement.
            </p>
            <p style={{ marginTop: 'var(--ps-space-sm)', color: 'var(--ps-slate)' }}>
              For platform-level user accounts (pharmacy staff registration, locum marketplace), PharmStation
              is the data controller.
            </p>
          </section>

          {/* 3. What data we collect */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              3. What personal data we collect
            </h2>

            <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>If you are a patient</h3>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', margin: '0 0 var(--ps-space-md) 0' }}>
              <li>Name, date of birth, address, email, phone number</li>
              <li>NHS number (used to identify you within the NHS)</li>
              <li>Health information: prescriptions, medications, clinical consultation records, vaccination records, referral data from NHS 111</li>
              <li>Appointment bookings and service delivery records</li>
              <li>Delivery addresses and proof-of-delivery signatures (if medications are delivered to you)</li>
              <li>Messages sent to you by your pharmacy (via SMS, email, or letter)</li>
            </ul>

            <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>If you are pharmacy staff</h3>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', margin: '0 0 var(--ps-space-md) 0' }}>
              <li>Name, email, phone number, job role</li>
              <li>GPhC registration number (pharmacists and technicians)</li>
              <li>Responsible Pharmacist sign-in/sign-out times</li>
              <li>Actions recorded in the audit trail (what you changed and when)</li>
              <li>GPS location (delivery drivers only, during active delivery rounds)</li>
              <li>AI chat conversation content</li>
            </ul>

            <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>If you are a locum pharmacist</h3>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', margin: '0 0 var(--ps-space-md) 0' }}>
              <li>Name, email, phone number, address</li>
              <li>GPhC number, indemnity insurance details, DBS certificate number</li>
              <li>National Insurance number, bank/payment details (for invoicing via Stripe)</li>
              <li>Government-issued photo ID and professional certificates (uploaded documents)</li>
              <li>Shift history, reviews, and performance ratings</li>
            </ul>

            <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>If you are a prescriber</h3>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', margin: 0 }}>
              <li>Name, address, GMC/GPhC registration number (recorded on controlled drug register entries as a legal requirement)</li>
            </ul>
          </section>

          {/* 4. Where data comes from */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              4. Where your data comes from
            </h2>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', margin: 0 }}>
              <li><strong>Directly from you</strong> — when you register, book an appointment, or provide details to your pharmacy</li>
              <li><strong>From your pharmacy</strong> — staff enter your details during dispensing and consultations</li>
              <li><strong>From the NHS Personal Demographics Service (PDS)</strong> — your name, DOB, address, NHS number, and GP practice are verified via the NHS Spine</li>
              <li><strong>From NHS 111</strong> — if you are referred to a pharmacy after calling 111, your clinical triage details are sent to the pharmacy electronically</li>
              <li><strong>From AI document scanning</strong> — when pharmacy staff photograph prescriptions or invoices, personal data is extracted automatically</li>
            </ul>
          </section>

          {/* 5. Why we process */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              5. Why we process your data (lawful bases)
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-text-sm)', color: 'var(--ps-slate)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--ps-border)', textAlign: 'left' }}>
                    <th style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>Purpose</th>
                    <th style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>Lawful basis</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Dispensing controlled drugs and maintaining the CD register', 'Legal obligation (Misuse of Drugs Regulations 2001)'],
                    ['Maintaining the Responsible Pharmacist log', 'Legal obligation (RP Regulations 2008)'],
                    ['Providing NHS clinical services (CPCS, Pharmacy First, NMS, Flu, Contraception, CVD)', 'Public task (provision of NHS pharmaceutical services)'],
                    ['Submitting NHS claims to NHSBSA for payment', 'Public task / Legal obligation'],
                    ['Verifying your identity via NHS PDS', 'Public task (direct patient care)'],
                    ['Receiving NHS 111 referrals', 'Public task (direct patient care)'],
                    ['Managing appointments and service bookings', 'Contract (service provision)'],
                    ['Delivering medications to your home', 'Contract / Public task'],
                    ['Sending you messages (appointment reminders, health information)', 'Consent or Legitimate interests'],
                    ['Staff account management and authentication', 'Contract (platform provision)'],
                    ['Locum marketplace and payment processing', 'Contract (locum engagement)'],
                    ['AI-assisted document scanning', 'Legitimate interests (efficient, accurate data entry)'],
                    ['Security audit logging', 'Legal obligation (pharmacy regulatory requirements)'],
                    ['GPS tracking of delivery drivers', 'Legitimate interests (delivery efficiency, proof of delivery)'],
                  ].map(([purpose, basis], i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--ps-border)' }}>
                      <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>{purpose}</td>
                      <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>{basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-text-sm)' }}>
              For <strong>special category health data</strong>, processing is necessary for health or social care
              purposes under <strong>UK GDPR Article 9(2)(h)</strong>, carried out by or under the responsibility
              of a health professional bound by professional confidentiality obligations.
            </p>
          </section>

          {/* 6. Who we share data with */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              6. Who we share your data with
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-text-sm)', color: 'var(--ps-slate)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--ps-border)', textAlign: 'left' }}>
                    <th style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>Recipient</th>
                    <th style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>Data shared</th>
                    <th style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['NHS Personal Demographics Service', 'NHS number, name, DOB', 'Patient identity verification'],
                    ['NHSBSA (NHS Business Services Authority)', 'NHS number, clinical service data, ODS code', 'NHS claim submission for payment'],
                    ['NHS 111', 'N/A (we receive data from NHS 111)', 'Receiving patient referrals'],
                    ['GOV.UK Notify', 'Phone numbers, email addresses, postal addresses, message content', 'Sending SMS, email, and letters on behalf of your pharmacy'],
                    ['Supabase (cloud hosting)', 'All data (as infrastructure provider)', 'Database hosting, authentication, storage — hosted in AWS London (eu-west-2)'],
                    ['AI providers (OpenAI, Anthropic, Google)', 'Prescription/invoice images, chat messages', 'AI-assisted data extraction and pharmacy assistant — data not used for AI training'],
                    ['Daily.co', 'Video consultation session metadata', 'Video consultation infrastructure'],
                    ['Stripe', 'Locum payment details, bank information', 'Locum payment processing'],
                  ].map(([recipient, data, purpose], i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--ps-border)' }}>
                      <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)', fontWeight: 500 }}>{recipient}</td>
                      <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>{data}</td>
                      <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-text-sm)' }}>
              We may also share data with <strong>GPhC</strong> (pharmacy regulator), <strong>police</strong>, or the <strong>Home Office</strong> when
              required by law (e.g., controlled drug inspections). We will never sell your data or share it for marketing purposes.
            </p>
          </section>

          {/* 7. International transfers */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              7. International data transfers
            </h2>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              Your data is primarily stored in the UK (AWS London, eu-west-2). When prescription images or
              chat messages are processed by AI providers (OpenAI, Anthropic), data may be transferred to
              the United States. These transfers are protected by:
            </p>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', marginTop: 'var(--ps-space-xs)' }}>
              <li>Standard Contractual Clauses (SCCs) in provider agreements</li>
              <li>Data processing agreements with no-training/no-retention clauses</li>
              <li>TLS 1.2+ encryption for all data in transit</li>
              <li>Data minimisation — only the specific content needed is sent</li>
            </ul>
          </section>

          {/* 8. How long we keep data */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              8. How long we keep your data
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-text-sm)', color: 'var(--ps-slate)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--ps-border)', textAlign: 'left' }}>
                    <th style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>Data type</th>
                    <th style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>Retention period</th>
                    <th style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Controlled drug register entries', 'Minimum 2 years (from last entry in register)', 'Misuse of Drugs Regulations 2001'],
                    ['Patient records', '10 years after last interaction', 'NHS Records Management Code of Practice'],
                    ['NHS clinical service records & claims', '6–10 years', 'NHS records retention / financial regulations'],
                    ['Responsible Pharmacist log', 'Minimum 2 years', 'RP Regulations 2008'],
                    ['Audit trail', '7 years', 'Regulatory best practice'],
                    ['Prescription/invoice images', 'Aligned with linked register entry', 'GPhC guidance'],
                    ['Locum financial records', '6 years', 'HMRC requirements'],
                    ['Driver GPS locations', '90 days', 'Data minimisation'],
                    ['User accounts', 'Until account deletion + 30-day grace period', 'Contract'],
                  ].map(([type, period, reason], i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--ps-border)' }}>
                      <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>{type}</td>
                      <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>{period}</td>
                      <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}>{reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 9. How we protect data */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              9. How we protect your data
            </h2>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', margin: 0 }}>
              <li><strong>Encryption:</strong> All data is encrypted in transit (TLS 1.2+) and at rest (AES-256)</li>
              <li><strong>Access control:</strong> Row Level Security ensures each pharmacy can only access their own data; role-based permissions control who can see what within a pharmacy</li>
              <li><strong>Authentication:</strong> Email/password with optional two-factor authentication; session tracking with device and geo-verification</li>
              <li><strong>Audit trail:</strong> Every data change is logged with who made it, when, and what was changed</li>
              <li><strong>Immutable registers:</strong> CD register and RP log entries cannot be edited or deleted — corrections are appended as new entries</li>
              <li><strong>Multi-tenancy isolation:</strong> Pharmacy data is strictly isolated — cross-tenant access is impossible at the database level</li>
            </ul>
          </section>

          {/* 10. Your rights */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              10. Your rights
            </h2>
            <p style={{ margin: '0 0 var(--ps-space-sm) 0', color: 'var(--ps-slate)' }}>
              Under UK GDPR, you have the following rights:
            </p>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', margin: '0 0 var(--ps-space-md) 0' }}>
              <li><strong>Right of access</strong> — request a copy of the personal data we hold about you</li>
              <li><strong>Right to rectification</strong> — ask us to correct inaccurate data</li>
              <li><strong>Right to erasure</strong> — ask us to delete your data (subject to legal retention requirements — e.g., CD register entries cannot be deleted)</li>
              <li><strong>Right to restrict processing</strong> — ask us to limit how we use your data</li>
              <li><strong>Right to data portability</strong> — receive your data in a machine-readable format</li>
              <li><strong>Right to object</strong> — object to processing based on legitimate interests</li>
              <li><strong>Rights related to automated decision-making</strong> — we do not make solely automated decisions about you</li>
            </ul>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              <strong>Important:</strong> Some data (controlled drug register entries, prescription records) is
              legally required to be retained for minimum periods. We cannot delete this data before those
              periods expire, even upon request.
            </p>
          </section>

          {/* 11. How to exercise your rights */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              11. How to exercise your rights or make a complaint
            </h2>
            <p style={{ margin: '0 0 var(--ps-space-sm) 0', color: 'var(--ps-slate)' }}>
              To exercise any of these rights, or if you have questions about how your data is used:
            </p>
            <ul style={{ color: 'var(--ps-slate)', paddingLeft: 'var(--ps-space-lg)', margin: '0 0 var(--ps-space-md) 0' }}>
              <li><strong>Contact your pharmacy directly</strong> — they are the data controller for your patient records</li>
              <li><strong>Contact PharmStation</strong> — for platform account queries: <strong>chronic2157@gmail.com</strong></li>
            </ul>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              You also have the right to lodge a complaint with the Information Commissioner's Office (ICO):
              <br />
              <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ps-primary)' }}>
                https://ico.org.uk/make-a-complaint/
              </a>
              <br />
              Helpline: 0303 123 1113
            </p>
          </section>

          {/* 12. Children's data */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              12. Children's data
            </h2>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              We process children's data only where necessary for healthcare provision (e.g., dispensing
              prescriptions, vaccinations, NHS 111 referrals). This data is processed under the same lawful
              bases and with the same safeguards as adult patient data. Children's data is recorded in the
              controlled drug register where legally required (e.g., prescriptions for patients under 12 must
              include their age).
            </p>
          </section>

          {/* 13. Cookies */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              13. Cookies and analytics
            </h2>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              PharmStation uses essential cookies only, required for authentication and session management.
              We do not use tracking cookies, advertising cookies, or third-party analytics. No personal
              data is shared with analytics or advertising providers.
            </p>
          </section>

          {/* 14. Changes */}
          <section>
            <h2 style={{ borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }}>
              14. Changes to this notice
            </h2>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              We may update this privacy notice from time to time. Significant changes will be communicated
              to registered users via email. The latest version will always be available at this page.
            </p>
          </section>

        </div>

        {/* Footer */}
        <div style={{ marginTop: 'var(--ps-space-xl)', paddingTop: 'var(--ps-space-md)', borderTop: '1px solid var(--ps-border)', display: 'flex', flexWrap: 'wrap', gap: 'var(--ps-space-sm)' }}>
          <Link className="ps-btn ps-btn-ghost" to="/about">About PharmStation</Link>
          <Link className="ps-btn ps-btn-ghost" to="/">Home</Link>
        </div>

      </div>
    </div>
  )
}
