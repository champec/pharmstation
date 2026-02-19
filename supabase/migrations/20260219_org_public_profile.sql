-- ===========================================
-- PharmStation: Organisation public profile columns
-- ===========================================

ALTER TABLE ps_organisations
  ADD COLUMN slug text,
  ADD COLUMN is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN public_description text,
  ADD COLUMN public_logo_url text;

-- Slug must be unique and URL-safe where set
CREATE UNIQUE INDEX idx_org_slug ON ps_organisations(slug) WHERE slug IS NOT NULL;

-- Public orgs are queryable by anon users (additive to existing RLS)
CREATE POLICY "anon_read_public_orgs"
  ON ps_organisations FOR SELECT
  USING (is_public = true);
