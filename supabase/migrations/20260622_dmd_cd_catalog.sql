-- ============================================================
-- dmd_cd_catalog() — controlled-drug catalog from dm+d
-- Migration: 20260622_dmd_cd_catalog
--
-- Returns the full Schedule-N controlled-drug catalog (generic VMPs +
-- branded AMPs) with a representative barcode, computed server-side.
-- Used by the dmd-sync reconcile step to keep cdr_drugs_unique current.
--
-- dm+d CONTROL_DRUG_CATEGORY codes (verified against the live lookup file):
--   0001 Sch1 | 0002/0003 Sch2 | 0004-0007 Sch3 | 0008/0009 Sch4 | 0010 Sch5.
-- Default = Schedule 2 (0002 + 0003).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_dmd_ampp_apid ON dmd_ampp(apid);

CREATE OR REPLACE FUNCTION dmd_cd_catalog(p_cats text[] DEFAULT ARRAY['0002','0003'])
RETURNS TABLE (
  level       text,    -- 'vmp' (generic) or 'amp' (brand)
  vpid        text,
  apid        text,
  nm          text,    -- dm+d product name
  vtm_nm      text,    -- ingredient (VTM) name -> drug_class
  cat_cd      text,
  is_generic  boolean,
  gtin        text     -- representative barcode (brands only)
)
LANGUAGE sql
STABLE
AS $$
  WITH cats AS (
    SELECT DISTINCT c FROM (
      SELECT unnest(p_cats) AS c
      UNION SELECT ltrim(unnest(p_cats), '0')
      UNION SELECT lpad(ltrim(unnest(p_cats), '0'), 4, '0')
    ) s
    WHERE c <> ''
  ),
  cd_vmp AS (
    SELECT v.vpid, v.nm, v.vtmid, v.cat_cd
    FROM dmd_vmp v
    WHERE v.cat_cd IN (SELECT c FROM cats)
      AND coalesce(v.invalid, '0') <> '1'
  ),
  amp_gtin AS (
    -- one representative barcode per brand: prefer an active (no end date) GTIN
    SELECT DISTINCT ON (a.apid) a.apid, g.gtin
    FROM dmd_amp a
    JOIN dmd_ampp p ON p.apid = a.apid
    JOIN dmd_gtin g ON g.appid = p.appid
    WHERE a.vpid IN (SELECT vpid FROM cd_vmp)
    ORDER BY a.apid, (g.enddt IS NULL) DESC, g.startdt DESC NULLS LAST
  )
  SELECT 'vmp'::text, cv.vpid, NULL::text, cv.nm, t.nm, cv.cat_cd, true, NULL::text
  FROM cd_vmp cv
  LEFT JOIN dmd_vtm t ON t.vtmid = cv.vtmid
  UNION ALL
  SELECT 'amp'::text, a.vpid, a.apid, a.nm, t.nm, cv.cat_cd, false, ag.gtin
  FROM dmd_amp a
  JOIN cd_vmp cv ON cv.vpid = a.vpid
  LEFT JOIN dmd_vtm t ON t.vtmid = cv.vtmid
  LEFT JOIN amp_gtin ag ON ag.apid = a.apid
  WHERE coalesce(a.invalid, '0') <> '1';
$$;

COMMENT ON FUNCTION dmd_cd_catalog(text[]) IS 'Controlled-drug catalog (generic VMPs + branded AMPs) with representative barcode, for the given dm+d control-drug categories. Default Schedule 2.';
