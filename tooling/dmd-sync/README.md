# @pharmstation/dmd-sync

Automated **NHS dm+d** (dictionary of medicines and devices) sync pipeline.

It replaces the manual Windows + Excel macro process (`apps/dmd_extract_tool/`):
it downloads the latest release straight from the **TRUD API**, verifies its
SHA-256, parses the XML directly, and loads it into Supabase. No Excel, no
Windows, no macros — runs anywhere Node runs.

## What it loads

The main NHSBSA dm+d release (TRUD item `24`) into these tables:

| Table            | Source file       | Key content                                |
| ---------------- | ----------------- | ------------------------------------------ |
| `dmd_vtm`        | `f_vtm`           | Virtual Therapeutic Moieties (ingredients) |
| `dmd_vmp`        | `f_vmp`           | Virtual Medicinal Products + **CD category**|
| `dmd_vmpp`       | `f_vmpp`          | Virtual Medicinal Product Packs            |
| `dmd_amp`        | `f_amp2`          | Actual Medicinal Products (brands)         |
| `dmd_ampp`       | `f_ampp`          | Actual Medicinal Product Packs             |
| `dmd_ingredient` | `f_ingredient`    | Ingredient substances                      |
| `dmd_gtin`       | `f_gtin` (GTIN)   | **Barcodes** (GTIN ↔ AMPP) for scanning    |

Releases are full weekly snapshots, so entity tables are **upserted on their
natural primary key** (dm+d flags removed items `invalid=1` rather than deleting
them); `dmd_gtin` is fully replaced each run.

`dmd_sync_state` records the loaded release so unchanged weeks are skipped.

## Why this matters

Your app reads drugs from `cdr_drugs_unique`, but `dmd_gtin` (barcodes),
`dmd_vmp`, `dmd_vmpp` and `dmd_ingredient` were **empty** and the rest were from
mid-2024. This keeps the codes (SNOMED VPID/APID), controlled-drug categories,
and barcodes current.

## Setup

```bash
cd tooling/dmd-sync
cp .env.example .env      # then fill in the values
pnpm install
```

Required env (see `.env.example`):

- `TRUD_API_KEY` — from your TRUD account "Your account" page
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — service role (server-side only, bypasses RLS)
- `TRUD_DMD_ITEM` — defaults to `24`

## Usage (run from your computer)

```bash
pnpm status      # show loaded vs latest TRUD release
pnpm sync        # download + verify + load dmd_* tables AND reconcile the CD register
pnpm sync --force          # re-load even if unchanged
pnpm sync --no-reconcile   # load dmd_* tables only, skip the CD register step
pnpm reconcile             # DRY RUN: preview CD register changes (no writes)
pnpm reconcile --apply     # apply CD register changes only
```

### The CD register (`cdr_drugs_unique`) is kept current automatically

`sync` finishes by reconciling the CD register against dm+d, so the weekly cron
keeps it up to date with no manual step. It builds the **Schedule 2 catalog**
(generic VMPs **and** branded AMPs, with a representative barcode) via the
`dmd_cd_catalog()` SQL function, then:

1. **Backfills** codes (`vpid`/`apid`/`dmd_cat_cd`) and a **barcode** (`gtin`)
   onto existing rows — only filling blanks. It **never** overwrites your
   curated brand / form / strength / class, and **never** touches images.
2. **Inserts** genuinely new controlled drugs, tagged `source='dmd'`, live.
3. **Never deletes** rows — ledgers, scans and balance checks reference drug ids
   by foreign key, so rows are only updated or added.

Defaults to **Schedule 2** (your register is all CD2). Add more with
`--categories=2,3` — these are **schedule numbers** (2=Sch2, 3=Sch3, 4=Sch4,
5=Sch5), mapped internally to the dm+d category codes
(0002/0003=Sch2, 0004-0007=Sch3, 0008/0009=Sch4, 0010=Sch5).

Run `pnpm reconcile` (dry run) any time to preview what the next sync would
change. Anything inserted is reversible: `delete from cdr_drugs_unique where
source='dmd'`. Matching of your original rows is by drug name (they had no codes
historically); once a row is linked it carries its `vpid`/`apid` for exact
matching thereafter.

## Automate on Railway (weekly cron)

The same code runs as a Railway cron — `railway.json` is included.

1. New Railway service → deploy from this repo, **Root Directory** =
   `tooling/dmd-sync`.
2. Add the env vars above in the Railway service Variables.
3. The cron (`0 9 * * 1` — Mondays 09:00 UTC, when TRUD publishes) runs
   `pnpm sync`, which loads the dm+d tables **and** reconciles the CD register
   in one go. `restartPolicyType: NEVER` so the job exits cleanly.

## Notes

- TRUD asks that automated downloads run weekdays 08:00–18:00 or 00:00–06:00 UK.
- The old `apps/dmd_extract_tool/` Windows tool is now redundant and can be removed.
