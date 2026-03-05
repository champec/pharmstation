# PharmStation — Training Needs Analysis (TNA)

**Document Owner:** Champe Chilufya (SIRO)  
**Organisation:** PharmStation (ODS: D8W5S)  
**Version:** 1.0  
**Created:** 4 March 2026  
**Endorsed By:** Champe Chilufya (SIRO / Senior Leadership)  
**Next Review:** 4 September 2026

---

## 1. Purpose

This Training Needs Analysis (TNA) identifies the data security and protection training and awareness requirements for all PharmStation staff involved in services provided to health and care organisations. PharmStation is an NHS IT supplier providing cloud-based pharmacy management software that integrates with NHS APIs (PDS, NHSBSA MYS, NHS 111).

---

## 2. Scope

This TNA covers all individuals who access, develop, or support systems that process NHS patient data or connect to NHS services. Currently PharmStation is a sole-operator organisation; this document will be expanded as staff are recruited.

---

## 3. Staff Roles and Training Requirements

### 3.1 Current Staff

| Role | Name | Responsibilities Relevant to Data Security | Required Training |
|------|------|---------------------------------------------|-------------------|
| Founder / CEO / SIRO / Caldicott Guardian / IG Lead / Head of IT / Cyber Security Lead | Champe Chilufya | All system development, database administration, NHS API integration, credential management, incident response, data protection compliance | All modules (see Section 4) |

### 3.2 Planned Future Roles

| Role | Responsibilities | Required Training |
|------|-----------------|-------------------|
| **Software Developer** | Code development, database changes, edge function deployment | Modules 1, 2, 3, 5, 6 |
| **Support / Operations** | Customer support, pharmacy onboarding, issue triage | Modules 1, 2, 3, 4 |
| **QA / Tester** | Testing with synthetic/test data, staging environment access | Modules 1, 2, 3, 5 |

---

## 4. Training Modules

### Module 1: Data Security Awareness (Mandatory — All Staff)

| Item | Detail |
|------|--------|
| **Audience** | All staff |
| **Frequency** | Annual (within 12 months of start date, then annually) |
| **Delivery** | NHS Data Security Awareness e-learning (Level 1) via dsptoolkit.nhs.uk |
| **Content** | Recognising personal/confidential data, phishing awareness, password security, reporting incidents, clean desk principles, social engineering |
| **Assessment** | Pass the NHS DSA e-learning assessment |
| **Record** | Completion certificate stored; date logged in DSPT |

### Module 2: UK GDPR and Data Protection Fundamentals (Mandatory — All Staff)

| Item | Detail |
|------|--------|
| **Audience** | All staff |
| **Frequency** | At induction + annual refresher |
| **Delivery** | ICO online training modules + internal briefing document |
| **Content** | Data protection principles, lawful bases, data subject rights, breach reporting obligations, processor vs controller roles, Privacy Notice awareness |
| **Assessment** | Completion of ICO training; acknowledgement of PharmStation data protection policy |

### Module 3: Secure Development Practices (Mandatory — Technical Staff)

| Item | Detail |
|------|--------|
| **Audience** | Developers, testers, Head of IT |
| **Frequency** | At induction + annual refresher |
| **Delivery** | NCSC secure development guidance + internal technical briefing |
| **Content** | OWASP Top 10, secure coding practices, credential management (no secrets in code), Row Level Security enforcement, input validation, dependency management, vulnerability patching |
| **Assessment** | Code review demonstrating secure practices |

### Module 4: NHS Data Handling (Mandatory — Staff Accessing NHS Data)

| Item | Detail |
|------|--------|
| **Audience** | All staff with access to NHS patient data or NHS API credentials |
| **Frequency** | At induction + annual refresher |
| **Delivery** | Internal briefing document covering NHS-specific requirements |
| **Content** | NHS number handling, PDS restricted/S-flagged patients, NHS 111 clinical data sensitivity, NHSBSA claim data handling, Caldicott principles, NHS Records Management Code |
| **Assessment** | Written acknowledgement of NHS data handling procedures |

### Module 5: Incident Response (Mandatory — Technical Staff and SIRO)

| Item | Detail |
|------|--------|
| **Audience** | SIRO, developers, operations |
| **Frequency** | At induction + annual refresher |
| **Delivery** | Internal incident response procedure document + tabletop exercise |
| **Content** | Recognising a data breach, containment steps, reporting to SIRO within 24 hours, ICO notification within 72 hours, NHS DSPT incident reporting, evidence preservation |
| **Assessment** | Participation in annual tabletop exercise |

### Module 6: Cyber Security Essentials (Recommended — Technical Staff)

| Item | Detail |
|------|--------|
| **Audience** | Developers, Head of IT, Cyber Security Lead |
| **Frequency** | Annual |
| **Delivery** | NCSC Cyber Security for Small Organisations guidance + Cyber Essentials self-assessment preparation |
| **Content** | Firewalls, secure configuration, access control, malware protection, patch management |
| **Assessment** | Cyber Essentials certification (target) |

---

## 5. Training Delivery Methods

| Method | Audience | Description |
|--------|----------|-------------|
| **NHS DSA e-learning** | All staff | Online self-paced module via dsptoolkit.nhs.uk with assessment |
| **ICO online training** | All staff | Free online modules from ico.org.uk |
| **Internal briefing documents** | All staff | Written policies and procedures distributed via internal documentation repository (GitHub) |
| **One-to-one induction** | New joiners | SIRO conducts data security induction covering all relevant modules on day one |
| **Code review** | Developers | Secure coding practices assessed during pull request reviews |
| **Tabletop exercises** | Technical staff + SIRO | Annual simulated incident response scenario |

---

## 6. Training Completion Record

### Current Staff

| Name | Role | Module 1 (DSA) | Module 2 (GDPR) | Module 3 (Secure Dev) | Module 4 (NHS Data) | Module 5 (Incident) | Module 6 (Cyber) |
|------|------|----------------|-----------------|----------------------|--------------------|--------------------|-----------------|
| Champe Chilufya | SIRO / All roles | Completed 4 Mar 2026 | Completed 4 Mar 2026 | Completed 4 Mar 2026 | Completed 4 Mar 2026 | Completed 4 Mar 2026 | In progress |

---

## 7. Communication and Awareness

| Channel | Description | Frequency |
|---------|-------------|-----------|
| **Policy documents** | Data security policies, Privacy Notice, IAR/ROPA available in documentation repository | Continuously available |
| **Induction pack** | New joiner receives data security induction covering all policies and training requirements | On hire |
| **Security reminders** | Key reminders (password policy, phishing awareness, incident reporting) | Quarterly |
| **Policy updates** | Staff notified of policy changes via direct communication | As needed |

As a sole-operator startup, formal channels (intranet, posters, staff meetings) are not yet applicable. Communications are direct. These will be expanded as the organisation grows.

---

## 8. Endorsement

This Training Needs Analysis has been reviewed and endorsed by senior leadership:

| Date | Name | Role | Action |
|------|------|------|--------|
| 4 March 2026 | Champe Chilufya | SIRO / Founder & CEO | Created and endorsed TNA v1.0 |

---

*Document ends.*
