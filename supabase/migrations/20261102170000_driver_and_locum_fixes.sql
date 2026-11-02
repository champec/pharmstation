-- Driver and locum fixes found by the end-to-end test of 2 Nov 2026.
-- Safe to run more than once. Run on London (dbgwfdrvqzuevbfrmsdt) and on PharmEx while it is still live.

-- 1. Starting or completing a delivery round failed with
--    "invalid reference to FROM-clause entry for table p": the care home sync
--    trigger referenced the UPDATE target inside a JOIN ... ON clause.
--    Every status change on ps_delivery_rounds hit it, so drivers could not
--    start a round and rounds could not be completed.
create or replace function public.ps_sync_care_home_group_delivery_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.ps_care_home_units g
  set group_state = case
      when new.status = 'in_progress' then 'in_transit'
      when new.status = 'completed' then 'delivered'
      else g.group_state
    end,
    state_changed_at = case when new.status in ('in_progress','completed') and old.status is distinct from new.status then now() else g.state_changed_at end,
    updated_at = now()
  where g.delivery_round_id = new.id
    and new.status in ('in_progress','completed')
    and old.status is distinct from new.status;

  -- dual-link bags to their delivery stops
  if new.status = 'in_progress' and old.status is distinct from new.status then
    update public.ps_care_home_supply_packages p
    set delivery_round_patient_id = drp.id, updated_at = now()
    from public.ps_care_home_supply_batches b,
         public.ps_care_home_residents r,
         public.ps_delivery_round_patients drp
    where p.batch_id = b.id
      and b.delivery_round_id = new.id
      and r.id = p.care_home_resident_id
      and drp.round_id = new.id
      and drp.patient_id = r.patient_id
      and p.delivery_round_patient_id is null;
  end if;

  return new;
end;
$function$;

-- 2. Locums could not see which pharmacy a shift was at: ps_organisations RLS
--    only lets members read their own org, so shift cards said "Pharmacy" with
--    no address. Return just name and address for orgs that have an open shift
--    the locum can see, or a shift the locum has booked.
create or replace function public.ps_locum_shift_orgs(p_org_ids uuid[])
 returns table(id uuid, name text, address jsonb)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select o.id, o.name, o.address
  from public.ps_organisations o
  where o.id = any(p_org_ids)
    and public.ps_get_my_locum_id() is not null
    and (
      exists (
        select 1 from public.ps_locum_shifts s
        where s.org_id = o.id and s.status = 'open' and s.date >= current_date
      )
      or exists (
        select 1
        from public.ps_locum_bookings b
        join public.ps_locum_shifts s on s.id = b.shift_id
        where s.org_id = o.id and b.locum_id = public.ps_get_my_locum_id()
      )
    );
$function$;

revoke all on function public.ps_locum_shift_orgs(uuid[]) from public, anon;
grant execute on function public.ps_locum_shift_orgs(uuid[]) to authenticated, service_role;

-- 3. GPS updates: the driver insert policy compared r.driver_id with itself,
--    so any driver could post locations to any in-progress round they could name.
drop policy if exists personal_drivers_insert_location_updates on public.ps_delivery_location_updates;
create policy personal_drivers_insert_location_updates on public.ps_delivery_location_updates
  for insert to authenticated
  with check (
    public.ps_is_my_driver_membership(driver_id, null::uuid)
    and exists (
      select 1 from public.ps_delivery_rounds r
      where r.id = ps_delivery_location_updates.round_id
        and r.driver_id = ps_delivery_location_updates.driver_id
        and r.status = 'in_progress'
    )
  );
