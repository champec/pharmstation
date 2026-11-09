-- One locum profile per GPhC number (QA: same number found on two people).
-- Staff profiles are separate and not affected. Applied on London 9 Nov 2026.
create unique index if not exists ps_locum_profiles_gphc_number_unique
  on public.ps_locum_profiles (trim(gphc_number))
  where nullif(trim(gphc_number), '') is not null;
