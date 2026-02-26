# Integrated NHS Expansion — Project Root

> **Status:** Planning Phase
> **Architect:** GitHub Copilot (Lead)
> **Created:** 26 February 2026
> **Classification:** Internal — Development Planning

---

## What This Is

The **Integrated NHS Expansion** transforms PharmStation from a pharmacy management tool into an **accredited NHS claim submission platform** — a direct alternative to PharmOutcomes and Sonar.

Pharmacies using PharmStation will be able to:
- Record clinical service interventions (NMS, CPCS, Hypertension, Contraception, Smoking Cessation, Flu Jab, etc.)
- Submit those records **directly** to the NHS BSA (MYS platform) via API
- Have claims pre-populated and processed for NHS reimbursement — without ever logging into PharmOutcomes

This is a high-value, high-complexity expansion that requires NHS BSA API accreditation.

---

## Files in This Directory

| File | Purpose |
|---|---|
| `README.md` | This file — project overview |
| `architect-findings.md` | Lead architect's full analysis of the NHS APIs, scope, and technical approach |
| `api-reference-summary.md` | Condensed reference for all relevant NHS/BSA APIs |
| `task-board.md` | Trackable task list for subagents — broken into phases |
| `agent-messages.md` | Communication log — architect leaves instructions/corrections here for subagents |
| `db-schema.md` | Database schema design for NHS claims tables |
| `onboarding-checklist.md` | Step-by-step accreditation and onboarding requirements |

---

## Quick Links to Source Documentation

- NHS APIs: `/documentation/nhs/api/`
- MYS Service Specs: `/documentation/nhs/mys/`
- Getting Started / Onboarding: `/documentation/nhs/gettingstarted/`
- Credentials/App: `/documentation/nhs/credentials.txt`

---

## Current NHS App Registration

- **App Name:** PharmStation
- **App ID:** `04cc89f0-3d9b-44d2-ba18-dd6ae18f9f7a`
- **Owner:** chronic2157@gmail.com
- **Environment:** Development
- **Portal:** developer.nhs.uk

---

## Guiding Principle

Every claim submission must be **audit-traceable**, **idempotent** (PLATFORM_DEPOSIT_ID prevents duplicates), and **reversible** (CRUD operations — Create, Read, Update, Delete — are supported by all MYS APIs). PharmStation will own the full lifecycle.
