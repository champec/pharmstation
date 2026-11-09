-- New pharmacies start with 25 free text credits so they can try patient
-- texting before buying a pack. Applies only to organisations created from
-- now on; existing ones were given launch credits by hand on 9 Nov 2026.
create or replace function public.ps_org_welcome_sms_credits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ps_sms_add_credits(new.id, 25, 'grant', null, null, null, 'Welcome credits');
  return new;
end $$;
revoke all on function public.ps_org_welcome_sms_credits() from public, anon, authenticated;

drop trigger if exists trg_ps_org_welcome_sms_credits on public.ps_organisations;
create trigger trg_ps_org_welcome_sms_credits
  after insert on public.ps_organisations
  for each row execute function public.ps_org_welcome_sms_credits();
