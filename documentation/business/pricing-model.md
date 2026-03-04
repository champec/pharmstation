# PharmStation Pricing Model

**Last Updated**: 28 February 2026
**Version**: 2.0

---

## Pricing Philosophy

PharmStation can afford to charge less than competitors because:

1. **Solo developer** — qualified pharmacist building with AI-assisted development. No 20-person team burning £50k/month in salaries
2. **Modern infrastructure** — Supabase, Railway, Vercel scale with usage. No on-prem servers, no DevOps team
3. **No legacy baggage** — built from scratch in 2026. No decade of patches and workarounds to maintain
4. **Hire as needed** — will grow the team strategically, not preemptively

The goal is not to be the cheapest — it's to deliver **10x the value at half the cost** of what pharmacies currently spend across multiple disconnected systems.

---

## What Pharmacies Currently Spend

A typical independent pharmacy paying for:

| Service | Estimated Monthly Cost |
|---------|----------------------|
| PharmOutcomes or Sonar | £50-100 |
| Appointment/booking tool | £15-30 |
| Video consultation platform | £20-50 |
| SMS/patient comms provider | £20-50 |
| Delivery management | £10-30 |
| CD register inserts (paper) | £5-15 |
| Misc productivity tools | £10-20 |
| **Total** | **£130-295/month** |

PharmStation replaces all of the above.

---

## Proposed Tiers

### Free Tier — "Network Member"

**£0/month** — forever free

- Join the PharmStation Network (visible to other pharmacies, GPs, public)
- Stock check requests (respond to queries from other pharmacies)
- Public pharmacy profile (opening hours, services, location)
- Basic GENIE AI (limited queries/month)

**Purpose:** Grow the network. Every pharmacy on the free tier makes the network more valuable for everyone. Conversion to paid happens naturally when they see what paying pharmacies can do.

### Starter — "Essential"

**£39/month** (annual: £29/month — 2 months free)

- Everything in Free, plus:
- CD Register (digital, compliant, searchable)
- RP Log
- Custom compliance logs (fridge, cleaning, date checking, etc.)
- Patient returns log
- Handover notes (sticky board)
- SOP management
- Up to 3 staff users
- GENIE AI (standard usage)

**Target:** Small independent pharmacies wanting to go digital with compliance.

### Professional — "Full Platform"

**£79/month** (annual: £59/month — 2 months free)

- Everything in Starter, plus:
- NHS 111 referral receiving
- Service delivery & recording (NHS + custom)
- MYS claim submission & tracking
- Appointment management + public booking
- Patient communications (NHS Notify — SMS, letters, emails)
- Video consultations
- Delivery management
- Calendar management
- Unlimited staff users
- GENIE AI (full usage + action execution)
- Priority support

**Target:** Pharmacies wanting the full one-stop platform. **This is the main tier.**

### Enterprise — "Chain"

**Custom pricing** (typically £49-59/pharmacy/month for 5+ locations)

- Everything in Professional, plus:
- Multi-location management dashboard
- Cross-pharmacy reporting & analytics
- Centralised SOP distribution
- Bulk user management
- Dedicated account manager
- Custom integrations
- Volume discounts:
  - 2-5 pharmacies: 15% off
  - 6-10 pharmacies: 25% off
  - 11-20 pharmacies: 35% off
  - 21+ pharmacies: Custom

**Target:** Small-to-medium pharmacy chains.

---

## Revenue Math

### Conservative Scenario (Year 1)

| Tier | Pharmacies | Monthly Revenue |
|------|-----------|----------------|
| Free | 200 | £0 |
| Starter (£39) | 50 | £1,950 |
| Professional (£79) | 80 | £6,320 |
| Enterprise (~£55 avg) | 20 | £1,100 |
| **Total** | **350** | **£9,370/mo** |

**Annual: ~£112k ARR**

### Moderate Scenario (Year 2)

| Tier | Pharmacies | Monthly Revenue |
|------|-----------|----------------|
| Free | 500 | £0 |
| Starter (£39) | 150 | £5,850 |
| Professional (£79) | 250 | £19,750 |
| Enterprise (~£55 avg) | 80 | £4,400 |
| **Total** | **980** | **£30,000/mo** |

**Annual: ~£360k ARR**

### Infrastructure Costs (Current)

| Service | Monthly Cost |
|---------|-------------|
| Supabase (Pro) | £20 |
| Railway (3 services) | £5-10 |
| Vercel (Pro) | £16 |
| Domain + misc | £5 |
| **Total** | **~£50/month** |

Costs scale with usage but remain low relative to revenue. At 100 paying customers, infrastructure might be £200-500/month. Margins stay above 90%.

---

## Pricing Advantages Over Competitors

| | PharmStation Professional | PharmOutcomes + Others |
|---|---|---|
| Monthly cost | **£79** | **£130-295** (combined) |
| Services included | Everything | Only service delivery + claims |
| AI assistant | ✅ Included | ❌ |
| Video consultation | ✅ Included | ❌ (separate £20-50/mo) |
| Patient comms | ✅ Included | ❌ (separate £20-50/mo) |
| Booking system | ✅ Included | ❌ (separate £15-30/mo) |
| Digital registers | ✅ Included | ❌ (paper) |
| Network access | ✅ Included | ❌ |
| **Net savings** | | **£50-200/month** |

A pharmacy switching to PharmStation Professional saves money AND gets more features.

---

## Future Revenue Streams (Phase 2)

| Stream | Model | Potential |
|--------|-------|----------|
| Locum marketplace | Transaction fee per shift booked | High — locum market is large |
| Drug exchange | Commission on pharmacy-to-pharmacy sales | Medium — short-dated stock is a real problem |
| Premium GENIE AI | Higher usage tier or advanced features | Medium — upsell to power users |
| API access | Partners integrating with PharmStation data | Low initially, grows with network size |

---

## Early Adopter Incentives

- **Founding pharmacies** (first 50): Locked at launch pricing forever, regardless of future price increases
- **Referral bonus**: 1 month free for each pharmacy referred that converts to paid
- **Annual commitment**: 2 months free (effectively 17% discount)
- **Beta feedback participants**: 3 months free Professional tier

---

**Related Documents**:
- [Business Plan](./business-plan.md)
- [Competitor Analysis](./competitor-analysis.md)
- [Revenue Targets](./revenue-targets.md)
- [Feature Roadmap](../product/feature-roadmap.md)
