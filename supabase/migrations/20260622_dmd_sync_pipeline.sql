-- ============================================================
-- dm+d sync pipeline support
-- Migration: 20260622_dmd_sync_pipeline
--
-- Adds:
--   1. dmd_sync_state    — tracks the last loaded TRUD release per item
--   2. dmd_vmp.cat_cd    — controlled-drug category (from VMP CONTROL_INFO)
--   3. cdr_drugs_unique  — dm+d code-link columns so the curated CD table can
--                          be reconciled against dm+d without duplicates and
--                          new CD products can be inserted with their codes.
-- ============================================================

-- 1. Sync state -------------------------------------------------
CREATE TABLE IF NOT EXISTS dmd_sync_state (
  item            text PRIMARY KEY,         -- TRUD item number (e.g. '24')
  release_id      text,
  release_name    text,
  release_date    date,
  archive_sha256  text,
  row_counts      jsonb,
  synced_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dmd_sync_state IS 'Last successfully loaded NHS dm+d TRUD release, per item. Used to skip unchanged weekly releases.';

-- 2. Controlled-drug category on VMP ----------------------------
ALTER TABLE dmd_vmp
  ADD COLUMN IF NOT EXISTS cat_cd text;

COMMENT ON COLUMN dmd_vmp.cat_cd IS 'dm+d controlled-drug category code (CONTROL_INFO/CATCD): 0000=none, 0001=Sch1, 0002/0003=Sch2, 0004-0007=Sch3, 0008/0009=Sch4, 0010=Sch5.';

-- 3. dm+d linkage on the curated CD table -----------------------
ALTER TABLE cdr_drugs_unique
  ADD COLUMN IF NOT EXISTS vpid          text,   -- linked VMP SNOMED code
  ADD COLUMN IF NOT EXISTS apid          text,   -- linked AMP SNOMED code (brand)
  ADD COLUMN IF NOT EXISTS gtin          text,   -- representative barcode
  ADD COLUMN IF NOT EXISTS dmd_cat_cd    text,   -- dm+d controlled-drug category
  ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS dmd_synced_at timestamptz;

COMMENT ON COLUMN cdr_drugs_unique.source IS 'manual = hand-curated; dmd = inserted/maintained by the dm+d sync pipeline.';

-- The pre-existing table had no id default; the sync pipeline inserts new CD
-- products, so generate ids automatically.
ALTER TABLE cdr_drugs_unique ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_cdr_drugs_unique_vpid ON cdr_drugs_unique(vpid) WHERE vpid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdr_drugs_unique_apid ON cdr_drugs_unique(apid) WHERE apid IS NOT NULL;

-- Helpful indexes for the loader / reconcile joins
CREATE INDEX IF NOT EXISTS idx_dmd_amp_vpid ON dmd_amp(vpid);
CREATE INDEX IF NOT EXISTS idx_dmd_vmp_vtmid ON dmd_vmp(vtmid);
CREATE INDEX IF NOT EXISTS idx_dmd_vmp_cat_cd ON dmd_vmp(cat_cd) WHERE cat_cd IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dmd_gtin_appid ON dmd_gtin(appid);
