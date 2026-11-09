-- Logged-out visitors may only read the public columns of a listed pharmacy (9 Nov 2026).
-- Row access still comes from the anon_read_public_orgs policy. Public pages select
-- PUBLIC_ORG_COLUMNS explicitly; select('*') as anon now fails with permission denied.
revoke select, insert, update, delete on public.ps_organisations from anon;
grant select (id, name, slug, address, geolocation, public_description, public_logo_url,
              is_public, is_active, organisation_type, ods_code, gphc_premises_number)
  on public.ps_organisations to anon;
