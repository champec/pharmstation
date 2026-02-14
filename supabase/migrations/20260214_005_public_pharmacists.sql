-- ============================================
-- Public Pharmacist Lookup Table
-- Used by the /rp public certificate page
-- Allows quick lookup of pharmacist name by GPhC number
-- ============================================

create table if not exists public.ps_public_pharmacists (
  gphc_number text primary key check (gphc_number ~ '^\d{1,7}$'),
  full_name   text not null check (char_length(full_name) >= 2),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.ps_public_pharmacists is
  'Public registry of pharmacist names by GPhC number. Used for the /rp certificate tool.';

-- Allow anonymous reads and inserts/updates (public utility)
alter table public.ps_public_pharmacists enable row level security;

create policy "Anyone can read public pharmacists"
  on public.ps_public_pharmacists for select
  using (true);

create policy "Anyone can insert public pharmacists"
  on public.ps_public_pharmacists for insert
  with check (true);

create policy "Anyone can update public pharmacists"
  on public.ps_public_pharmacists for update
  using (true)
  with check (true);

-- Auto-update updated_at on changes
create or replace function public.ps_public_pharmacists_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_public_pharmacists_updated_at
  before update on public.ps_public_pharmacists
  for each row execute function public.ps_public_pharmacists_updated_at();
