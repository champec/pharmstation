-- ============================================================
-- Appointments: pharmacies switch on their own online booking page.
-- Settings → Bookings now lets staff with org_settings list the pharmacy
-- on /book and pick its web address (slug). This guard keeps the values
-- sane, and only verified pharmacies can be listed to the public.
-- ============================================================

create or replace function public.ps_organisations_guard_public_page()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.slug is not null then
    new.slug := lower(btrim(new.slug));
    if new.slug = '' then
      new.slug := null;
    elsif new.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(new.slug) not between 3 and 60 then
      raise exception 'The web address can only use lowercase letters, numbers and single dashes (3 to 60 characters).'
        using errcode = '22023';
    elsif new.slug in ('admin', 'api', 'book', 'manage', 'shop', 'login', 'settings', 'pharmstation') then
      raise exception 'That web address is reserved. Please pick another.' using errcode = '22023';
    end if;
  end if;

  if new.is_public and not coalesce(old.is_public, false) then
    if coalesce(new.verification_status, 'pending') <> 'verified' then
      raise exception 'Your pharmacy must be verified before it can be listed for online booking.' using errcode = 'P0001';
    end if;
    if new.slug is null then
      raise exception 'Choose a web address for your booking page first.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace trigger ps_organisations_guard_public_page
  before insert or update of slug, is_public on public.ps_organisations
  for each row execute function public.ps_organisations_guard_public_page();
