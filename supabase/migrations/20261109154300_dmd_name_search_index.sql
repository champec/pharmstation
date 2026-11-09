-- Faster dm+d name search (PEPS drug picker, service prescribing field).
-- ps_peps_dmd_search uses nm ilike '%term%', which needs trigram indexes.
create extension if not exists pg_trgm with schema extensions;
create index if not exists idx_dmd_vmp_nm_trgm on public.dmd_vmp using gin (nm extensions.gin_trgm_ops);
create index if not exists idx_dmd_amp_nm_trgm on public.dmd_amp using gin (nm extensions.gin_trgm_ops);
