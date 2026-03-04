# PharmStation Feature Roadmap

**Last Updated**: 28 February 2026
**Version**: 2.0 — Post-Build Reality (not planning speculation)

---

## Platform Summary

PharmStation is a **one-stop digital pharmacy workstation** for UK community pharmacies. It covers the full operational lifecycle:

**Receive referral → Deliver service → Claim payment**

Plus: compliance registers, patient communications, video consultations, public booking, inter-pharmacy networking, AI assistance, and SOP management.

---

## Launch Features (Phase 1 — Ready Now)

Everything below is **built and functional**. Some modules are barebone implementations that will be refined through iteration, stress testing, edge case handling, UI improvements, and closer adherence to NHS specifications and GPhC guidance.

### Core Compliance & Registers

| Feature | Status | Description |
|---------|--------|-------------|
| **CD Register** | ✅ Built | Digital Controlled Drugs register — Schedule 2 compliant, immutable entries, correction workflows, audit trail, drug class accordion, contact autocomplete |
| **RP Log** | ✅ Built | Responsible Pharmacist sign-in/out records |
| **Custom Logs** | ✅ Built | Configurable log templates — fridge, cleaning, date checking, near miss, guest, or any custom log a pharmacy needs |
| **Patient Returns Log** | ✅ Built | CD patient returns and destruction records |
| **SOP Management** | ✅ Built | Digital Standard Operating Procedures — create, version, distribute, acknowledge |

### Service Delivery & NHS Integration

| Feature | Status | Description |
|---------|--------|-------------|
| **NHS 111 Referrals** | ✅ Built + Live on Railway | Full pipeline: ITK SOAP → FHIR → RabbitMQ → Supabase. Real-time queue, patient detail, accept/reject/complete |
| **Service Delivery** | ✅ Built | Record clinical interventions (NMS, CPCS, Hypertension, Flu, Smoking Cessation, Contraception, custom services) |
| **Custom Services** | ✅ Built | Create any service type with custom form fields — not limited to NHS services |
| **MYS Claim Submission** | ✅ Built | Submit service records directly to NHS BSA (MYS platform) for reimbursement |
| **Claim Tracking** | ✅ Built | Full claim lifecycle — submitted, accepted, rejected, paid. Dashboard visibility |
| **ODS Code Configuration** | ✅ Built | Dynamic ODS code management per pharmacy |

### Appointments & Booking

| Feature | Status | Description |
|---------|--------|-------------|
| **Appointment Management** | ✅ Built | Staff-facing appointment creation, scheduling, management |
| **Public Self-Booking** | ✅ Built | Patient-facing booking page — public can browse services and book available slots |
| **Calendar Management** | ✅ Built | Visual calendar for appointment scheduling and availability |

### Patient Communications

| Feature | Status | Description |
|---------|--------|-------------|
| **NHS Notify Integration** | ✅ Built | Text messages (SMS), letters, and emails via NHS Notify API |
| **Batch Communications** | ✅ Built | Send bulk messages — useful for service updates, recalls, batch notifications |
| **Communication Templates** | ✅ Built | Reusable message templates for common scenarios |

### Video Consultations

| Feature | Status | Description |
|---------|--------|-------------|
| **Video Consultation** | ✅ Built | Quick text-to-patient → open browser → instant video consult. No app install required for patient |
| **In-Platform Video** | ✅ Built | Consultation happens within PharmStation — no switching to external tools |

### PharmStation Network

| Feature | Status | Description |
|---------|--------|-------------|
| **Pharmacy Directory** | ✅ Built | Find pharmacies — see which are open, what services they provide |
| **Stock Check Requests** | ✅ Built | Query other pharmacies for stock availability without calling. Secure inter-pharmacy messaging |
| **Public Access** | ✅ Built | Public can see which pharmacies are open, which provide specific services, and book |
| **GP Access** | ✅ Built | Out-of-hours GPs can check open pharmacies and stock — especially valuable for urgent care |

### AI Assistant — GENIE

| Feature | Status | Description |
|---------|--------|-------------|
| **GENIE AI Agent** | ✅ Built | Natural language pharmacy assistant. Knows pharmacy regulations, drugs, procedures. Can perform actions on behalf of pharmacists |
| **Knowledge Base** | ✅ Built | Comprehensive pharmacy knowledge — CD schedules, regulations, SOPs, clinical guidance |
| **Action Execution** | ✅ Built | GENIE can create entries, look up information, draft communications, assist with service delivery |

### Handover & Collaboration

| Feature | Status | Description |
|---------|--------|-------------|
| **Handover Notes** | ✅ Built | Sticky-note style handover board — staff leave notes for the next shift |
| **Team Dashboard** | ✅ Built | Overview of pharmacy activity, pending tasks, referrals |

### Delivery Management

| Feature | Status | Description |
|---------|--------|-------------|
| **Patient Deliveries** | ✅ Built | Track prescription deliveries, routes, status |

---

## Pending: NHS Approval Process

The following are **built** but require NHS approval/accreditation before production use:

| Item | Status | Dependency |
|------|--------|------------|
| NHS 111 live messages | 🔲 Awaiting NHS Digital approval | Connection Agreement + mTLS certs + DoS registration |
| MYS production claims | 🔲 Awaiting NHSBSA response | Supplier onboarding email sent 26 Feb 2026. Need staging credentials + IP whitelisting |
| NHS Notify production | 🔲 Awaiting approval | Production API keys |
| PDS (Patient Demographics) | 🔲 Not yet applied | Need application-restricted access via developer.nhs.uk |

> **Note:** NHS approval processes typically take 1-3 months. PharmStation will launch and begin customer acquisition immediately. Non-NHS features are fully operational without approval.

---

## Near-Term Iteration (Post-Launch)

These are improvements to existing features, not new features:

- [ ] Stress testing all pipelines (NHS 111, MYS claims, notifications)
- [ ] Edge case handling and error recovery
- [ ] UI/UX refinement across all modules
- [ ] Closer adherence to NHS specifications and GPhC guidance
- [ ] Accessibility improvements (WCAG compliance)
- [ ] Performance optimisation under load
- [ ] Bug fixes from early customer feedback
- [ ] Comprehensive test suites (unit, integration, e2e)
- [ ] Offline sync reliability
- [ ] Print/export for GPhC inspections

---

## Phase 2 — Deep Future

Features planned for after launch stabilisation and market penetration:

### Locum Management
- [ ] Locum marketplace — pharmacies post shifts, locums browse and book
- [ ] Shift matching — availability, qualifications, location-based
- [ ] Locum profiles — GPhC verification, ratings, work history
- [ ] Integrated payment/invoicing for locum shifts
- [ ] Calendar integration with pharmacy rota

### Pharmacy Drug Exchange
- [ ] Inter-pharmacy drug selling/buying marketplace
- [ ] Short-dated stock alerts and offers
- [ ] Secure payment processing
- [ ] Delivery/collection coordination
- [ ] Regulatory compliance for drug transfers

### PMR Integration
- [ ] Integration with major PMR systems (Cegedim Rx, ProScript, Nexphase, PharmaSys)
- [ ] Bi-directional data sync — patient records, dispensing history
- [ ] Auto-populate service forms from PMR patient data
- [ ] **Dependency:** Requires market penetration first — PMR vendors need incentive to integrate

### Advanced GENIE AI
- [ ] Prescription scan-to-entry (image → structured data)
- [ ] Invoice scan-to-register (supplier invoices → CD entries)
- [ ] Proactive compliance alerts (missing entries, approaching deadlines)
- [ ] Regulatory Q&A with citation to source legislation
- [ ] Automated reconciliation assistance
- [ ] Natural language report generation

### Mobile & Desktop
- [ ] React Native mobile app (quick RP sign-in, fridge logging, photo entries)
- [ ] Tauri desktop app (full feature parity, offline-first, barcode scanner)

### Geographic Expansion
- [ ] Scotland, Wales, Northern Ireland regulatory adaptations
- [ ] Ireland (similar regulatory framework)
- [ ] International (Australia, Canada — long-term)

---

## Revenue Model Alignment

| Feature | Revenue Impact |
|---------|---------------|
| NHS 111 + Service Delivery + Claims | **Core value prop** — pharmacy makes money using PharmStation |
| PharmStation Network | **Network effect** — more pharmacies = more value for all |
| Public Booking | **Patient acquisition** — pharmacies get more business |
| GENIE AI | **Premium tier** differentiator |
| Locum Management | **New revenue stream** — transaction fees |
| Drug Exchange | **New revenue stream** — marketplace fees |
| PMR Integration | **Lock-in** — becomes indispensable once connected to PMR |

---

## Competitive Position

PharmStation vs existing solutions:

| Capability | PharmStation | PharmOutcomes | Sonar | Paper Registers |
|-----------|-------------|---------------|-------|----------------|
| CD Register | ✅ | ❌ | ❌ | ✅ (manual) |
| RP Log | ✅ | ❌ | ❌ | ✅ (manual) |
| NHS 111 Referrals | ✅ | ✅ | ✅ | ❌ |
| Service Delivery | ✅ | ✅ | ✅ | ❌ |
| MYS Claim Submission | ✅ | ✅ | ✅ | ❌ |
| Custom Services | ✅ | ❌ | ❌ | ❌ |
| Video Consultation | ✅ | ❌ | ❌ | ❌ |
| AI Assistant | ✅ | ❌ | ❌ | ❌ |
| Pharmacy Network | ✅ | ❌ | ❌ | ❌ |
| Public Booking | ✅ | ❌ | Limited | ❌ |
| Patient Comms (NHS Notify) | ✅ | ❌ | ❌ | ❌ |
| SOP Management | ✅ | ❌ | ❌ | ❌ |
| Handover Notes | ✅ | ❌ | ❌ | ✅ (whiteboard) |
| Stock Checks | ✅ | ❌ | ❌ | ❌ (phone calls) |
| Delivery Tracking | ✅ | ❌ | ❌ | ❌ |
| Custom Logs | ✅ | ❌ | ❌ | ✅ (manual) |
| One Platform | ✅ | ❌ (service only) | ❌ (service only) | ❌ (multiple books) |

**PharmStation is the only platform that covers the entire pharmacy operation in one place.**

---

**Related Documents**:
- [Product Vision](./PRODUCT_VISION.md)
- [NHS 111 Pipeline](../nhs/nhs111-pipeline.md)
- [NHS Integration Expansion](../nhs-integration-expansion/README.md)
- [Business Plan](../business/business-plan.md)
- [Go-to-Market Strategy](../business/go-to-market-strategy.md)
