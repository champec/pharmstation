# PharmStation Product Vision

**Version**: 1.0  
**Last Updated**: February 2026  
**Status**: Planning Phase

## Executive Summary

**PharmStation** is a comprehensive digital pharmacy compliance platform designed specifically for UK pharmacies. Our mission is to transform pharmacy workflow from manual, paper-based registers into a streamlined, compliant digital experience that saves time, reduces errors, and enables pharmacies to focus on patient care.

**Tagline**: "Your Digital Pharmacy Workstation"

## The Problem

UK pharmacies are legally required to maintain multiple registers and records:
- Controlled Drug (CD) Registers (Misuse of Drugs Regulations 2001)
- Responsible Pharmacist (RP) Records (Medicines Act 1968)
- Patient Returns and Disposal Logs
- Standard Operating Procedures (SOPs)
- Various compliance logs (fridge, date checking, cleaning, etc.)

**Current Pain Points:**
- **Manual Entry**: Time-consuming handwritten records prone to errors
- **Compliance Risk**: Missing entries or incorrect formats can lead to GPhC inspections issues
- **No Digital Backup**: Paper records can be lost, damaged, or destroyed
- **Search & Retrieval**: Finding specific entries in paper registers is tedious
- **Export Difficulty**: Providing records to inspectors requires photocopying
- **Training Burden**: New staff must learn proper record-keeping formats
- **Correction Complexity**: Fixing errors in paper registers is cumbersome

## The Solution

PharmStation provides a digital platform that:
1. **Maintains Legal Compliance** — Built around GPhC and Misuse of Drugs regulations
2. **Saves Time** — Fast data entry, keyboard shortcuts, autocomplete
3. **Ensures Accuracy** — Validation rules prevent common errors
4. **Enables Audit** — Complete history, cannot delete/overwrite records
5. **Works Offline** — Continues functioning without internet connection
6. **Exports Easily** — Print or PDF registers for inspections
7. **Scales Features** — From MVP registers to AI-powered assistance

## Target Market

### Primary: Community Pharmacies in the UK
- **Small Chains** (2-5 pharmacies): Need standardization across locations
- **Independent Pharmacies**: Want affordable, professional tools
- **Medium Chains** (6-20 pharmacies): Require centralized oversight

### Secondary: Hospital Pharmacies
- More complex CD workflows
- Higher volume of entries
- Integration with hospital systems (future)

### Geographic Focus
- **Phase 1**: England (pilot)
- **Phase 2**: Scotland, Wales, Northern Ireland
- **Future**: International expansion (Ireland, Australia, Canada)

## Product Philosophy

### Core Principles

1. **Compliance First**
   - Meet or exceed all legal requirements
   - Never shortcut regulatory obligations
   - Maintain complete audit trails

2. **Speed Over Features**
   - Fast data entry is priority #1
   - Keyboard-driven interfaces for power users
   - Minimal clicks to complete common tasks

3. **Offline-Ready**
   - Must work without internet
   - Sync when connection available
   - No data loss during offline periods

4. **User Trust**
   - Never delete or overwrite historical records
   - Transparent correction workflows
   - Clear permission systems

5. **Progressive Enhancement**
   - Launch with core features that work perfectly
   - Add AI assistance as enhancement, not requirement
   - Mobile and desktop as additions to web

## Phase 1: Core Product (Launch) 🚀

**Timeline**: Months 1-6  
**Goal**: Launch with essential registers that solve the biggest pain points

### A) Registers (The Main Sell)

#### 1. Responsible Pharmacist (RP) Record
**Purpose**: Track which pharmacist is responsible for the pharmacy at any given time

**Features**:
- **Fast Sign-in/Out**: One-click RP sign-in when pharmacist arrives
- **Automatic Timestamping**: System captures exact time
- **Absence Recording**: Record RP absence with time and reason
- **Role Permissions**: 
  - Any pharmacist can sign in/out as RP
  - Pharmacy owner can view all records
  - Non-pharmacist staff have read-only access
- **Audit Trail**: Complete history of who was RP and when
- **Export/Print**: Generate printable RP log for inspections

**Compliance**:
- Meets requirements of Pharmacy Order 2010
- Includes all mandatory fields (date, time, pharmacist name, GPhC number)

#### 2. Controlled Drug (CD) Register
**Purpose**: Record receipt, supply, and disposal of Schedule 2 CDs

**Features**:
- **Fast Typed Entry**: Keyboard-first interface for speed
- **Validation Rules**: 
  - Enforce mandatory fields (date, patient, prescriber, drug, strength, quantity)
  - Prevent invalid formats
  - Running balance calculations
- **Correction Workflow**:
  - Cannot delete or overwrite entries
  - Corrections create new entry with reference to original
  - Clear visual indication of corrected entries
  - Maintains complete audit trail
- **Multiple CD Books**: Separate registers per drug/strength combination
- **Balance Checking**: Visual indicators for discrepancies
- **Photo/Scan Assist** (optional, future): AI can suggest entries from photos
- **Export/Print**: Generate official CD register printouts

**Compliance**:
- Meets Misuse of Drugs Regulations 2001 requirements
- Permanent, indelible records
- Running balance maintained
- Proper correction procedure

#### 3. Patient Returns Log (includes CD Disposal)
**Purpose**: Combined workflow for patient-returned medications and their disposal

**Features**:
- **Unified Workflow**:
  1. Record return received (date, patient details, medication, quantity)
  2. Track storage period
  3. Record destruction/disposal (date, witness, method)
- **Disposal Methods**: Denaturing kit, collection service, incineration
- **Witness Recording**: For CD disposals requiring witness
- **Simple Interface**: No complex "waste module" — just one streamlined flow
- **Export/Print**: Generate returns and disposal logs

**Compliance**:
- Meets patient returns record requirements
- Proper CD destruction documentation
- Witness requirements for Schedule 2 CDs

#### 4. Private CD Register
**Purpose**: Record private prescriptions for Schedule 2 & 3 CDs

**Features**:
- **Straight Register Entries**: Date, patient, prescriber, medication, quantity
- **Linked to Main CD Register**: Cross-reference for balance tracking
- **Private Rx Retention**: Track which physical prescriptions are retained
- **Export/Print**: Generate private CD register

**Compliance**:
- Meets Misuse of Drugs Regulations for private prescriptions
- 2-year retention period tracking

### B) Secondary Features (Included in Launch)

#### 5. SOP Library (Lightweight v1)
**Purpose**: Central repository for Standard Operating Procedures

**Features**:
- **Document Upload**: PDF or DOC file upload with title
- **Text Entry**: Paste raw text as an SOP
- **Categorization**: Tag SOPs by category (dispensing, CD handling, cleaning, etc.)
- **Assignment** (optional): Assign SOPs to roles or individuals
- **Read Tracking**: Mark SOPs as read, track who has read them
- **Search**: Find SOPs by title or category
- **No Versioning** (v1): Keep it simple — update in place
- **Future**: Version control, approval workflow, e-signatures

#### 6. Handover Notes (Sticky-Note Board)
**Purpose**: Digital sticky-note board for shift handovers and task management

**Features**:
- **Canvas-Style Board**: Freeform digital corkboard
- **Create Notes**: Double-click to add new note
- **Edit & Move**: Drag to reposition, resize
- **Color Coding**: Different colors = priority levels
  - Yellow: Normal priority
  - Orange: Medium priority
  - Red: High priority / urgent
  - Green: Completed
  - Blue: Informational
- **Assign to Staff**: Tag team members
- **Due Dates**: Set deadlines
- **Status**: Mark as "Done", archive, or delete
- **Filters**: 
  - View today's tasks
  - View overdue items
  - View "My Tasks"
  - View unassigned
  - Filter by person
  - Filter by date range

**Use Cases**:
- "Fridge door left open overnight — needs checking"
- "Mrs. Smith's prescription ready for collection"
- "Order more gabapentin — running low"
- "RP log shows gap yesterday — needs correction"

### C) Optional Utilities (Included in Launch)

#### 7. Compliance Logs (Lightweight)
**Purpose**: Simple daily/periodic logs for routine compliance tasks

**Log Types**:

**Fridge Log**:
- Date, time, temperature reading
- Optional notes for temperature excursions
- Visual indicator when outside acceptable range (2-8°C)

**Date Checking Log**:
- Pharmacy-defined zones (e.g., "Shelf A1", "Dispensary Top Shelf")
- Track "where we left off" for systematic rotation
- Custom rules (e.g., check every Monday, check items expiring in 3 months)
- Record findings (items found, actions taken)

**Cleaning Log**:
- Area cleaned (e.g., "Dispensary counters", "Waiting area")
- Date, time, staff member
- Optional notes

**Guest/Visitor Log**:
- Name, company, time in, time out, purpose of visit
- Staff member who authorized entry

**Features (All Logs)**:
- Fast entry (mobile-friendly)
- Export/print for inspections
- Overdue alerts (e.g., "Fridge not logged today")

#### 8. Near Miss / Incident Log
**Purpose**: Record near misses and incidents for learning and compliance

**Features**:
- **Incident Details**:
  - What happened (free text)
  - When it happened
  - Who was involved (optional, can be anonymous)
  - Where it happened (e.g., dispensary, front counter)
- **Categorization**:
  - Near miss (no harm)
  - Incident (actual error/harm)
  - Category: Dispensing error, labeling error, counseling issue, etc.
- **Action Taken**: What was done to resolve
- **Learning Points**: What can be improved
- **Attachments**: Optional photos or documents
- **Analysis**: Periodic review of trends
- **Export**: Generate reports for internal review or reporting to NRLS

## Phase 2: The "Genie" AI Layer 🤖

**Timeline**: Months 7-12  
**Goal**: Add AI-powered assistance to reduce manual work and enhance compliance

### Genie Features

**Genie** is PharmStation's AI assistant — a natural language interface that helps pharmacists work faster and smarter.

#### 1. Natural Language Search
**Feature**: "Find all CD entries for Mrs. Smith in January"

- Search across all records using plain English
- Understands pharmacy terminology
- Returns relevant results with highlights
- Includes RP logs, CD entries, returns, SOPs

**Examples**:
- "Show me all morphine entries this week"
- "Find the RP record for last Tuesday"
- "Which patient returns are awaiting disposal?"

#### 2. Draft Entries from Scans
**Feature**: AI suggests entries from photos/scans

**Invoice Scanning**:
- Pharmacist photographs CD invoice
- AI extracts: drug name, strength, quantity, supplier, date
- Displays suggested CD entry
- Pharmacist reviews and confirms
- **Always human-approved** — AI never writes directly

**Prescription Scanning** (future):
- Scan handwritten or typed prescription
- AI suggests patient name, medication, quantity
- Pharmacist verifies and approves

**Important**: AI is assistive, not autonomous. Every entry must be approved by a pharmacist.

#### 3. Task Suggestions
**Feature**: Genie proactively identifies issues and suggests actions

**Examples**:
- "Fridge log hasn't been completed today"
- "CD balance for morphine 10mg shows a discrepancy of -2"
- "5 patient returns are overdue for disposal (>6 months)"
- "RP log shows a 30-minute gap yesterday"
- "Date checking hasn't been done this week"

**Not Annoying**:
- Suggestions appear in a dedicated "Genie" panel
- Can be dismissed or snoozed
- Configurable (turn off specific suggestions)

#### 4. Reconciliation Assistant
**Feature**: Helps reconcile CD register against physical stock

- Pharmacist selects drug to reconcile
- System shows: register balance, last physical count, entries since count
- Pharmacist enters new physical count
- Genie identifies discrepancies
- Pharmacist investigates and records findings
- System guides proper documentation

#### 5. Regulatory Q&A
**Feature**: Ask Genie pharmacy regulations questions

**Examples**:
- "How long do I need to keep CD registers?"
- "What are the requirements for private CD prescriptions?"
- "Do I need a witness for Schedule 3 CD disposal?"

**Sources**: GPhC guidelines, Misuse of Drugs Regulations, standard pharmacy law
**Disclaimer**: Always includes "This is guidance only — verify with official sources"

## Phase 3: Mobile & Desktop Expansion 📱💻

**Timeline**: Months 13-18  
**Goal**: Extend to mobile (React Native) and desktop (Tauri) for specialized use cases

### Mobile App (React Native)
**Purpose**: Quick logging and photo-based entry when away from desk

**Features**:
- **Quick RP Sign-in/Out**: One-tap RP login on the go
- **Photo-Based Entry**: Snap photos of invoices/prescriptions for later processing
- **Fridge Logging**: Log temperature while standing at the fridge
- **Handover Notes**: View and create sticky notes on mobile
- **Offline Sync**: All features work offline, sync when online
- **Push Notifications**: Overdue tasks, urgent handover notes

**Not Included in Mobile**:
- Full CD register entry (too complex for mobile typing)
- Complex reconciliation workflows
- Full SOP library management

### Desktop App (Tauri)
**Purpose**: Offline-first, high-performance desktop application

**Features**:
- **Everything from Web**: Full feature parity with web app
- **Offline-First**: Works completely offline
- **Local Database**: SQLite for fast local storage
- **Background Sync**: Syncs to Supabase when online
- **Print Optimization**: Better print layouts for CD registers
- **Barcode Scanner Support**: USB barcode scanner integration
- **Performance**: Faster than web for large datasets

**Use Cases**:
- Pharmacies with unreliable internet
- Pharmacists who want desktop-installed app
- High-volume CD dispensing (hospital pharmacies)

## Phase 4: Future Vision — Service Delivery Platform 🚀

**Timeline**: Months 18+  
**Goal**: Expand beyond compliance into service delivery

### 1. Remote Consultations
**Feature**: Built-in video calling for pharmacy consultations

- **Pre-Consult Intake**: Patient completes intake form
- **Live Video**: WebRTC-based secure video calling
- **Consult Notes**: Pharmacist takes structured notes during consult
- **Outcome Capture**: Record outcome, recommendations, actions
- **Post-Consult Summary**: Automated summary sent to patient
- **Audit Trail**: Complete record of consultation

### 2. Consultation Delivery Services Platform
**Feature**: Guided workflows for specific pharmacy services

**Service Types**:
- Flu vaccinations
- Travel health consultations
- Smoking cessation
- Minor ailment scheme
- Hypertension case-finding
- Contraception consultations

**Workflow**:
1. Service booking (online or in-person)
2. Pre-consult questions (patient completes)
3. Consultation (guided workflow, prompts pharmacist for required info)
4. Outcome documentation (structured data capture)
5. Follow-up (automated reminders, outcomes tracking)

### 3. Front-End Booking Management
**Feature**: Patient-facing booking page for pharmacy services

- **Public Booking Page**: `pharmstation.co.uk/pharmacy-name/book`
- **Service Catalog**: List of services offered by pharmacy
- **Availability Rules**: Set pharmacist schedules, blocked times
- **Online Booking**: Patients self-book available slots
- **Reschedule/Cancel**: Patients can modify bookings
- **Pharmacy Dashboard**: View all bookings, mark as completed
- **Reminders**: Automated SMS/email reminders to patients

### 4. Custom Service Delivery Platform
**Feature**: Pharmacy creates and modifies service workflows

- **Service Builder**: Create custom consultation services
- **Question Sets**: Build custom intake forms
- **Templates**: Create documentation templates
- **Roles/Permissions**: Assign services to specific staff
- **Reporting**: Track outcomes, service volume, revenue

### 5. Potential Auto-Submission Platform
**Feature**: Direct submission to NHS/payers (if integrations available)

- **Submission-Ready Packs**: All required data captured
- **Validation Checks**: Ensure submission completeness
- **Direct Submission**: API integrations with NHS systems (if available)
- **Export Formats**: Generate files in required formats for manual submission
- **Status Tracking**: Track submission status

### 6. Communication Hub
**Feature**: Centralized communication per patient/service

- **Message Threads**: One thread per patient per service/booking
- **Multi-Channel**: SMS, email, in-app, print
- **Automated Comms**: Triggered by events (booking confirmed, consult completed)
- **Delivery Status**: Track message delivery, read receipts
- **Audit Trail**: Complete communication history

## Public Marketing Utility: RP Certificate Generator 🎓

**Feature**: Free public tool that generates printable RP certificates

**URL**: `pharmstation.co.uk/rp`

**How It Works**:
1. Anyone (no login required) enters a GPhC number
2. System checks GPhC register (if API available) OR uses community data
3. Generates professional RP certificate-style page/PDF
4. Includes: Pharmacist name, GPhC number, registration date, photo (optional)
5. Suitable for printing and displaying in pharmacy

**Data Sources**:
- **Ideal**: GPhC API (if available) — verified, authoritative data
- **Fallback**: Community-submitted data with clear labeling:
  - "This information was user-submitted and has not been verified by PharmStation or GPhC"
  - Logged-in users can submit/update their own details
  - Community validation (other pharmacists can confirm)

**Marketing Value**:
- Drives traffic to PharmStation site
- Demonstrates PharmStation's pharmacy focus
- Subtle branding on certificate (small PharmStation logo/link)
- Call-to-action: "Want digital RP logging? Try PharmStation"

**Free Forever**: This utility remains free as a service to the pharmacy community

## Business Model

### Pricing Tiers (Proposed)

**Freemium**: RP Log only (free forever)
- Free RP certificate generator
- Basic RP logging
- Limited users (1-2)
- No export/print

**Starter**: £29/month per pharmacy
- Full RP Log with export
- CD Register (1 book)
- Patient Returns Log
- Handover Notes
- SOP Library (up to 20 SOPs)
- 5 users

**Professional**: £79/month per pharmacy
- All Starter features
- Unlimited CD books
- Private CD register
- All compliance logs (fridge, cleaning, date checking, guest, near miss)
- Unlimited SOPs
- Genie AI assistant (Phase 2)
- 15 users
- Priority support

**Enterprise**: £199/month per pharmacy (or custom for chains)
- All Professional features
- Mobile app access
- Desktop app access
- Unlimited users
- Custom integrations
- Dedicated account manager
- SLA guarantees

**Add-ons**:
- **Service Delivery Platform**: +£49/month (Phase 4)
- **Booking Management**: +£29/month (Phase 4)
- **Additional Users**: +£5/user/month (beyond tier limits)

### Revenue Model
- **Primary**: Subscription revenue (SaaS)
- **Secondary**: Premium support, training, custom development
- **Future**: Commission on service bookings (if integrated with booking platform)

## Success Metrics

### Phase 1 (Launch)
- **100 pharmacies** signed up in first 6 months
- **80% active usage** (at least 3 logins per week per pharmacy)
- **NPS score**: >40
- **CD entries**: >1,000/month across platform
- **Churn rate**: <10% monthly

### Phase 2 (Genie)
- **500 pharmacies** using platform
- **50% adoption** of Genie features (among Professional tier users)
- **Time savings**: 30 minutes/day per pharmacy (self-reported)

### Phase 3 (Mobile/Desktop)
- **1,000 pharmacies** using platform
- **40% mobile app** adoption
- **20% desktop app** adoption

### Phase 4 (Service Delivery)
- **2,000+ pharmacies** using platform
- **25% adoption** of Service Delivery Platform
- **10,000+ consultations** delivered per month via platform

## Competitive Advantages

1. **Pharmacy-Specific**: Built by pharmacists, for pharmacists (not generic compliance software)
2. **Compliance-First**: Legal requirements baked into design
3. **Offline-Capable**: Works without internet (critical for pharmacies)
4. **Progressive Enhancement**: Start simple, add AI as enhancement
5. **Multi-Platform**: Web, mobile, desktop — use what fits your workflow
6. **Modern Tech Stack**: Fast, reliable, maintainable
7. **UK-Focused**: Specific to UK regulations and GPhC requirements

## Risk Mitigation

### Regulatory Risk
- **Mitigation**: Legal review of CD register and RP log features
- **Mitigation**: Continuous monitoring of GPhC guideline changes
- **Mitigation**: Clear disclaimers about platform being a tool (pharmacist remains responsible)

### Adoption Risk
- **Mitigation**: Free RP log tier to drive initial adoption
- **Mitigation**: Excellent onboarding and training materials
- **Mitigation**: Pilot program with early adopter pharmacies

### Technical Risk
- **Mitigation**: Robust offline sync strategy
- **Mitigation**: Comprehensive testing of CD register correction workflows
- **Mitigation**: Regular backups and disaster recovery plan

### Competition Risk
- **Mitigation**: First-mover advantage in AI-powered pharmacy compliance
- **Mitigation**: Focus on user experience and speed (competitors often clunky)
- **Mitigation**: Build community and network effects (pharmacy-to-pharmacy referrals)

## Roadmap Summary

| Phase | Timeline | Key Deliverables |
|-------|----------|------------------|
| **Phase 1: MVP** | Months 1-6 | RP Log, CD Register, Returns Log, SOPs, Handover Notes, Compliance Logs |
| **Phase 2: Genie** | Months 7-12 | Natural language search, scan-to-entry, task suggestions, reconciliation assist |
| **Phase 3: Multi-Platform** | Months 13-18 | Mobile app (React Native), Desktop app (Tauri) |
| **Phase 4: Service Delivery** | Months 18+ | Remote consultations, service workflows, booking management |

## Conclusion

PharmStation aims to transform pharmacy compliance from a burden into a streamlined, efficient process. By starting with core registers that solve immediate pain points and progressively enhancing with AI and multi-platform support, we'll build a platform that pharmacies love to use and can't work without.

Our vision is ambitious but grounded in real pharmacy needs. We'll validate each phase with real users, iterate based on feedback, and never compromise on compliance or data integrity.

**Next Steps**:
1. Build Phase 1 MVP
2. Pilot with 10-20 early adopter pharmacies
3. Iterate based on feedback
4. Launch publicly
5. Begin Phase 2 development

---

*This document should be treated as a living document and updated as the product evolves.*

**Questions or Feedback?** Contact the product owner.
