# ⚠️ NHS Notify status — READ FIRST

**As of July 2026, NHS Notify (GOV.UK Notify) is NOT the primary messaging
provider.** Our application was rejected — GOV Notify no longer supports
pharmacies.

- **SMS** for all organisations → **SMS Works** (platform account)
- **Email / Letters** → NHS Notify, **only** for NHS-affiliated orgs with
  `ps_organisations.nhs_channels_enabled = true` and their own API key
- All other orgs see email/letter channels locked in the UI

See the current integration docs:
`documentation/thesmsworks/sms-works-integration.md`

The `nhsnotificaitons.txt` file in this folder is retained as raw API
reference for the email/letter carve-out only.
