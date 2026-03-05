# DSPT Self-Assessment — Verification Checklist

**Purpose:** Things we stated as done/in place during the DSPT self-assessment that need to be verified or actually implemented.  
**Created:** 4 March 2026  
**Owner:** Champe Chilufya  

---

## Section 6 Claims

- [ ] **Incident reporting procedure** — Write a formal standalone incident reporting procedure document (referenced in 6.1.1). Currently described in TNA Module 5 but not a standalone doc.
- [ ] **Breach action plan template** — Create a breach action plan template with fields for: root cause, mitigation steps, responsible person, timescales, completion status (referenced in 6.1.2).
- [ ] **Weekly self-review process** — Establish a recurring weekly review for tracking outstanding security actions (referenced in 6.1.2).
- [ ] **Windows Defender real-time protection** — Verify it is ON on the Windows 11 PC (Settings → Privacy & Security → Windows Security → Virus & threat protection → Real-time protection).
- [ ] **Malwarebytes real-time protection** — Verify it is ON and licence is active (free version does NOT include real-time protection — need Malwarebytes Premium).
- [ ] **Malwarebytes auto-update** — Verify auto-update is enabled for both app and threat database.
- [ ] **Windows auto-updates enabled** — Verify Windows Update is set to automatic and not deferred.
- [ ] **Microsoft Defender SmartScreen** — Verify SmartScreen is enabled (Settings → Privacy & Security → Windows Security → App & browser control).
- [ ] **Malwarebytes Web Protection** — Verify web protection module is active (requires Premium).
- [ ] **Browser Safe Browsing** — Verify Google Safe Browsing (Chrome) or SmartScreen (Edge) is enabled in browser settings.
- [ ] **pharmstation.co.uk SPF record** — Check GoDaddy DNS for a TXT record like `v=spf1 ...`. If not present, add one.
- [ ] **pharmstation.co.uk DKIM record** — Check GoDaddy DNS for DKIM selector TXT records. If not sending email from this domain, note that.
- [ ] **pharmstation.co.uk DMARC record** — Check GoDaddy DNS for `_dmarc.pharmstation.co.uk` TXT record. If not present, add `v=DMARC1; p=reject; rua=mailto:champe.chilufya@wales.nhs.uk` as a minimum anti-spoofing measure.
- [ ] **Phishing reporting process** — Document the process for staff to report suspicious emails (e.g., use Microsoft "Report Message" button, forward to NHS Wales IT security).
- [ ] **NHS Wales email DMARC/DKIM/SPF** — Confirm these are managed by DHCW (they almost certainly are, but verify you can state this).

## Section 6.3 Claims

- [ ] **GitHub Dependabot alerts** — Verify Dependabot is enabled on champec/pharmstation for vulnerability detection (referenced in 6.3.3).
- [ ] **Supabase audit triggers** — Verify `ps_audit_log` triggers are active on all critical tables (referenced in 6.3.3).
- [ ] **Railway container logging** — Verify NHS 111 pipeline services are producing accessible logs (referenced in 6.3.3).
- [ ] **Incident response procedure** — Write a standalone document (currently only described in TNA Module 5, referenced in 6.3.5).
- [ ] **Post-incident review template** — Create a template for root cause analysis and lessons learned (referenced in 6.3.5).

## Section 7 Claims

- [ ] **Supabase automated backups** — Verify backup schedule and retention in Supabase dashboard (referenced in 7.1.1).
- [ ] **Key person dependency mitigation** — Document a continuity plan for sole-operator risk (referenced in 7.1.1).
- [ ] **Credential recovery plan** — Document how critical credentials (NHS API keys, Supabase keys, Stripe keys) would be recovered if lost (referenced in 7.1.1, 7.1.3).
- [ ] **Password manager** — Verify all production credentials are stored in a password manager (referenced in 7.1.3).
- [ ] **Customer incident notification templates** — Pre-draft email templates for common incident scenarios (identified as improvement in 7.2.1 tabletop exercise).
- [ ] **Tabletop exercise record** — Write up the 4 March 2026 tabletop exercise with scenario, actions, outcomes, and lessons learned as a standalone document (referenced in 7.2.1).
- [ ] **Customer communication plan** — Document the 24-hour customer notification commitment formally (referenced in 7.1.5).
- [ ] **Tabletop exercise — Action 1** — Draft incident notification email templates (service outage, data breach, credential compromise). **Due: 31 March 2026** (referenced in 7.2.2).
- [ ] **Tabletop exercise — Action 2** — Document credential rotation procedures for Supabase, NHS API keys, Stripe, Railway, Vercel. **Due: 31 March 2026** (referenced in 7.2.2).
- [ ] **Tabletop exercise — Action 3** — Create encrypted offline backup of emergency credentials and critical contact numbers. **Due: 14 March 2026** (referenced in 7.2.2).
- [ ] **Tabletop exercise — Action 5** — Bookmark ICO breach reporting portal and DSPT incident tool; add to incident response quicksheet. **Due: 7 March 2026** (referenced in 7.2.2).
- [ ] **Tabletop exercise — Action 6** — Write standalone Business Continuity Plan. **Due: 30 April 2026** (referenced in 7.2.2).
- [ ] **Commit tabletop exercise record** — Write up and commit the 4 March 2026 exercise as a standalone document in documentation/legal-and-compliance/ (referenced in 7.2.2).

## Section 7.3 Claims

- [ ] **Emergency contacts hardcopy** — Print the emergency contact list and store at home office. Include: ICO, NHS Digital, NCSC, Supabase, Action Fraud (referenced in 7.3.2).
- [ ] **Draft press statements** — Formalise the two template press statements into a standalone document for quick retrieval (referenced in 7.3.3).
- [ ] **Supabase backup plan confirmation** — Log into Supabase dashboard → Database → Backups and confirm daily backups are active and retention period (referenced in 7.3.4).
- [ ] **Supabase restore test** — Perform an actual restore test (to a test project or confirm restore button is accessible and understood) (referenced in 7.3.5).
- [ ] **Offline database backup** — Schedule a manual pg_dump export to encrypted offline storage (ties into tabletop Action 3, due 14 March 2026) (referenced in 7.3.6).
- [ ] **Retained incident response provider** — Review need for retained cyber IR company as organisation scales (referenced in 7.3.1).

## Section 8 Claims

- [ ] **GitHub Dependabot** — Verify Dependabot is enabled on champec/pharmstation (referenced in 8.1.1, 8.3.1, 8.3.4).
- [ ] **BitLocker** — Verify BitLocker full disk encryption is enabled on the Windows 11 PC (referenced in 8.1.2).
- [ ] **No local data** — Confirm no PharmStation production/patient data is stored locally on the PC (referenced in 8.1.2).
- [ ] **Node.js 18 upgrade** — Upgrade NHS 111 Bridge Docker image from Node.js 18 Alpine to Node.js 20 or 22 LTS. **Due: 30 April 2026** (referenced in 8.2.1).
- [ ] **Windows auto-updates** — Verify Windows Update is set to automatic with no deferral (referenced in 8.3.1, 8.3.2).
- [ ] **Dependabot PR review** — Check for any open Dependabot PRs and merge/address them (referenced in 8.3.4, 8.3.5).
- [ ] **Malwarebytes Premium** — Verify Malwarebytes has an active Premium licence (free version lacks real-time protection and web protection) (referenced in 8.3.6).
- [ ] **NCSC Early Warning registration** — Register for NCSC Early Warning service at https://www.ncsc.gov.uk/section/services/early-warning if not already done (referenced in 8.3.8).
- [ ] **Windows 11 version screenshot** — Take a screenshot of Windows Security showing OS version + update status for 8.3.7 evidence if requested.
- [ ] **MFA on all critical accounts** — Verify MFA is enabled on: GitHub, Supabase, Vercel, Railway, GoDaddy, Microsoft 365/NHS Wales email (referenced in 8.4.1).
- [ ] **Password manager** — Verify all production credentials are stored in a password manager with unique passwords (referenced in 8.4.1, 7.1.3).
- [ ] **Supabase RLS** — Verify Row-Level Security is enabled on all database tables (referenced in 8.4.1).
- [ ] **NCSC Cyber Alerts subscription** — Subscribe to NCSC weekly threat reports if not already (referenced in 8.4.3).
- [ ] **Run npm audit** — Run `pnpm audit` across the monorepo and address any findings (referenced in 8.4.3).

## Section 9 Claims

- [ ] **Home router default password** — Verify home broadband router admin password has been changed from default and Wi-Fi uses WPA2/WPA3 with non-default password (referenced in 9.1.1).
- [ ] **MFA on all accounts** — Cross-check: GitHub, Supabase, Vercel, Railway, GoDaddy, Microsoft 365 all have MFA enabled (referenced in 9.1.1).
- [ ] **Formal penetration test** — Commission a CHECK/CREST-accredited third-party pen test before going live with production NHS data. **Due: before production launch** (referenced in 9.2.1).
- [ ] **Internal vulnerability scan record** — Document the 4 March 2026 internal security assessment findings as a standalone report for evidence (referenced in 9.2.1).
- [ ] **Supabase RLS audit** — Conduct full audit of RLS policies on all Supabase tables and document coverage. **Due: 31 March 2026** (referenced in 9.2.3).
- [ ] **pharmstation.co.uk DMARC/SPF/DKIM** — Configure email auth DNS records in GoDaddy. **Due: 14 March 2026** (referenced in 9.2.3, 6.2.8).
- [ ] **NCSC Protective DNS (PDNS)** — Evaluate and register for PDNS service for development environment (referenced in 9.3.3).
- [ ] **GoDaddy MFA** — Verify MFA is enabled on GoDaddy account (referenced in 9.3.4).
- [ ] **Static IP provisioning** — When static IP is provisioned for NHSBSA, record it in the asset register (referenced in 9.3.5).
- [ ] **Vercel security headers** — Verify CSP, X-Frame-Options, X-Content-Type-Options headers are configured on Vercel deployment (referenced in 9.3.1).
- [ ] **Vercel HTTPS redirect** — Verify HTTP → HTTPS redirect is enforced (referenced in 9.3.6).
- [ ] **DSPT independent audit** — Determine audit requirements for PharmStation's organisation category and commission if required. Check "Provide Audit details" menu in DSPT portal (referenced in 9.4.5).
- [ ] **Annual security review schedule** — Set calendar reminder for March 2027 annual security review (referenced in 9.4.3).

## Earlier Section Claims (Sections 1–5)

- [ ] *(Add items from earlier sections as they are completed)*

## How to Verify DNS Records

Run these commands or use https://mxtoolbox.com/SuperTool.aspx:

```bash
# SPF
dig TXT pharmstation.co.uk +short

# DMARC
dig TXT _dmarc.pharmstation.co.uk +short

# DKIM (need to know selector name, e.g. "default" or "google")
dig TXT default._domainkey.pharmstation.co.uk +short

# MX (check if email is configured at all)
dig MX pharmstation.co.uk +short
```

---

*This checklist should be completed before DSPT submission is finalised.*
