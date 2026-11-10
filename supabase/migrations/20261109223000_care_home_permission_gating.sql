-- ============================================================================
-- Care homes: permission gating
--
-- Until now any active member of the pharmacy or the care home could read and
-- write every care home table. This migration makes the care_home_* role
-- permissions (Team settings) real on the server:
--
--   care_home_view           see the care home workspace at all
--   care_home_manage         care home profile, residents, groups (pharmacy)
--   care_home_medications    medicine rounds, bags, packing, delivery runs (pharmacy)
--   care_home_requests       raise and work medication / GP requests (both sides)
--   care_home_mar_prepare    prepare and publish MAR charts (pharmacy)
--   care_home_mar_administer record doses on a published MAR chart (both sides)
--
-- Read access: the three helper functions now also require care_home_view.
-- Writes: RESTRICTIVE policies are layered on top of the existing permissive
-- ones, and the SECURITY DEFINER RPCs get permission-checking wrappers.
-- Idempotent: safe to run more than once.
-- ============================================================================

-- 1. Helpers ------------------------------------------------------------------

create or replace function public.ps_care_home_link_has_permission(target_link_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ps_care_home_links link
    where link.id = target_link_id
      and (
        (link.pharmacy_organisation_id in (select public.ps_get_user_org_ids())
          and public.ps_member_has_permission(link.pharmacy_organisation_id, p_permission))
        or
        (link.care_home_organisation_id in (select public.ps_get_user_org_ids())
          and public.ps_member_has_permission(link.care_home_organisation_id, p_permission))
      )
  );
$$;

-- Pharmacy side only.
create or replace function public.ps_care_home_pharmacy_has_permission(target_link_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ps_care_home_links link
    where link.id = target_link_id
      and link.pharmacy_organisation_id in (select public.ps_get_user_org_ids())
      and public.ps_member_has_permission(link.pharmacy_organisation_id, p_permission)
  );
$$;

revoke all on function public.ps_care_home_link_has_permission(uuid, text) from public, anon;
revoke all on function public.ps_care_home_pharmacy_has_permission(uuid, text) from public, anon;
grant execute on function public.ps_care_home_link_has_permission(uuid, text) to authenticated, service_role;
grant execute on function public.ps_care_home_pharmacy_has_permission(uuid, text) to authenticated, service_role;

-- Existing helpers keep their names (every policy uses them) but now need care_home_view.
create or replace function public.ps_can_access_care_home_link(target_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ps_care_home_link_has_permission(target_link_id, 'care_home_view');
$$;

create or replace function public.ps_is_care_home_pharmacy(target_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ps_care_home_pharmacy_has_permission(target_link_id, 'care_home_view');
$$;

create or replace function public.ps_is_linked_care_home(target_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ps_care_home_links link
    where link.id = target_link_id
      and link.care_home_organisation_id in (select public.ps_get_user_org_ids())
      and public.ps_member_has_permission(link.care_home_organisation_id, 'care_home_view')
  );
$$;

-- Small lookups used by the policies below.
create or replace function public.ps_care_home_link_of_resident(target_resident_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select care_home_link_id from public.ps_care_home_residents where id = target_resident_id;
$$;

create or replace function public.ps_care_home_link_of_unit(target_unit_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select care_home_link_id from public.ps_care_home_units where id = target_unit_id;
$$;

create or replace function public.ps_care_home_link_of_batch(target_batch_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select care_home_link_id from public.ps_care_home_supply_batches where id = target_batch_id;
$$;

create or replace function public.ps_care_home_link_of_package(target_package_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select batch.care_home_link_id
  from public.ps_care_home_supply_packages package
  join public.ps_care_home_supply_batches batch on batch.id = package.batch_id
  where package.id = target_package_id;
$$;

create or replace function public.ps_care_home_link_of_mar_cycle(target_cycle_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select resident.care_home_link_id
  from public.ps_care_home_mar_cycles cycle
  join public.ps_care_home_residents resident on resident.id = cycle.care_home_resident_id
  where cycle.id = target_cycle_id;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ps_care_home_link_of_resident', 'ps_care_home_link_of_unit', 'ps_care_home_link_of_batch',
    'ps_care_home_link_of_package', 'ps_care_home_link_of_mar_cycle'
  ] loop
    execute format('revoke all on function public.%I(uuid) from public, anon', f);
    execute format('grant execute on function public.%I(uuid) to authenticated, service_role', f);
  end loop;
end $$;

-- 2. Restrictive write policies ----------------------------------------------

-- Care home profile (link): pharmacy staff with care_home_manage.
drop policy if exists care_home_links_insert_perm on public.ps_care_home_links;
create policy care_home_links_insert_perm on public.ps_care_home_links as restrictive for insert to authenticated
  with check (public.ps_member_has_permission(pharmacy_organisation_id, 'care_home_manage'));
drop policy if exists care_home_links_update_perm on public.ps_care_home_links;
create policy care_home_links_update_perm on public.ps_care_home_links as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(id, 'care_home_manage'))
  with check (public.ps_care_home_pharmacy_has_permission(id, 'care_home_manage'));

-- Residents: added by the pharmacy (care_home_manage); kept up to date by
-- the pharmacy or by the care home itself (room, status, allergies...).
drop policy if exists care_home_residents_insert_perm on public.ps_care_home_residents;
create policy care_home_residents_insert_perm on public.ps_care_home_residents as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_manage'));
drop policy if exists care_home_residents_update_perm on public.ps_care_home_residents;
create policy care_home_residents_update_perm on public.ps_care_home_residents as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_manage') or public.ps_is_linked_care_home(care_home_link_id))
  with check (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_manage') or public.ps_is_linked_care_home(care_home_link_id));

-- Groups (units): pharmacy only. Managers set them up; medicines staff move
-- them through the delivery board.
drop policy if exists care_home_units_insert_perm on public.ps_care_home_units;
create policy care_home_units_insert_perm on public.ps_care_home_units as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_manage'));
drop policy if exists care_home_units_update_perm on public.ps_care_home_units;
create policy care_home_units_update_perm on public.ps_care_home_units as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_manage') or public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_medications'))
  with check (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_manage') or public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_medications'));

drop policy if exists care_home_group_members_insert_perm on public.ps_care_home_group_members;
create policy care_home_group_members_insert_perm on public.ps_care_home_group_members as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_unit(group_id), 'care_home_manage'));
drop policy if exists care_home_group_members_update_perm on public.ps_care_home_group_members;
create policy care_home_group_members_update_perm on public.ps_care_home_group_members as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_unit(group_id), 'care_home_manage'))
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_unit(group_id), 'care_home_manage'));
drop policy if exists care_home_group_members_delete_perm on public.ps_care_home_group_members;
create policy care_home_group_members_delete_perm on public.ps_care_home_group_members as restrictive for delete to authenticated
  using (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_unit(group_id), 'care_home_manage'));

-- Medicine rounds (schedules): care_home_medications.
drop policy if exists care_home_schedules_insert_perm on public.ps_care_home_medication_schedules;
create policy care_home_schedules_insert_perm on public.ps_care_home_medication_schedules as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_resident(care_home_resident_id), 'care_home_medications'));
drop policy if exists care_home_schedules_update_perm on public.ps_care_home_medication_schedules;
create policy care_home_schedules_update_perm on public.ps_care_home_medication_schedules as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_resident(care_home_resident_id), 'care_home_medications'))
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_resident(care_home_resident_id), 'care_home_medications'));

-- MAR charts: prepared and published by the pharmacy (care_home_mar_prepare).
drop policy if exists care_home_mar_cycles_insert_perm on public.ps_care_home_mar_cycles;
create policy care_home_mar_cycles_insert_perm on public.ps_care_home_mar_cycles as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_resident(care_home_resident_id), 'care_home_mar_prepare'));
drop policy if exists care_home_mar_cycles_update_perm on public.ps_care_home_mar_cycles;
create policy care_home_mar_cycles_update_perm on public.ps_care_home_mar_cycles as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_resident(care_home_resident_id), 'care_home_mar_prepare'))
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_resident(care_home_resident_id), 'care_home_mar_prepare'));

-- MAR doses: recorded by staff with care_home_mar_administer, only while the
-- chart is published (prepared charts are still being checked by the pharmacy).
drop policy if exists care_home_mar_entries_insert_perm on public.ps_care_home_mar_entries;
create policy care_home_mar_entries_insert_perm on public.ps_care_home_mar_entries as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_mar_cycle(mar_cycle_id), 'care_home_mar_prepare'));
drop policy if exists care_home_mar_entries_update_perm on public.ps_care_home_mar_entries;
create policy care_home_mar_entries_update_perm on public.ps_care_home_mar_entries as restrictive for update to authenticated
  using (
    public.ps_care_home_link_has_permission(public.ps_care_home_link_of_mar_cycle(mar_cycle_id), 'care_home_mar_administer')
    and exists (select 1 from public.ps_care_home_mar_cycles cycle where cycle.id = mar_cycle_id and cycle.status = 'published')
  )
  with check (
    public.ps_care_home_link_has_permission(public.ps_care_home_link_of_mar_cycle(mar_cycle_id), 'care_home_mar_administer')
    and (administered_by is null or administered_by = auth.uid())
  );

-- Medication requests and GP requests: care_home_requests.
drop policy if exists care_home_requests_insert_perm on public.ps_care_home_medication_requests;
create policy care_home_requests_insert_perm on public.ps_care_home_medication_requests as restrictive for insert to authenticated
  with check (public.ps_care_home_link_has_permission(care_home_link_id, 'care_home_requests'));
drop policy if exists care_home_requests_update_perm on public.ps_care_home_medication_requests;
create policy care_home_requests_update_perm on public.ps_care_home_medication_requests as restrictive for update to authenticated
  using (public.ps_care_home_link_has_permission(care_home_link_id, 'care_home_requests'))
  with check (public.ps_care_home_link_has_permission(care_home_link_id, 'care_home_requests'));

drop policy if exists care_home_gp_requests_insert_perm on public.ps_care_home_gp_requests;
create policy care_home_gp_requests_insert_perm on public.ps_care_home_gp_requests as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_requests'));
drop policy if exists care_home_gp_requests_update_perm on public.ps_care_home_gp_requests;
create policy care_home_gp_requests_update_perm on public.ps_care_home_gp_requests as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_requests'))
  with check (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_requests'));

-- Supply rounds, bags and bag lines: care_home_medications.
drop policy if exists care_home_batches_insert_perm on public.ps_care_home_supply_batches;
create policy care_home_batches_insert_perm on public.ps_care_home_supply_batches as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_medications'));
drop policy if exists care_home_batches_update_perm on public.ps_care_home_supply_batches;
create policy care_home_batches_update_perm on public.ps_care_home_supply_batches as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_medications'))
  with check (public.ps_care_home_pharmacy_has_permission(care_home_link_id, 'care_home_medications'));

drop policy if exists care_home_packages_insert_perm on public.ps_care_home_supply_packages;
create policy care_home_packages_insert_perm on public.ps_care_home_supply_packages as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_batch(batch_id), 'care_home_medications'));
drop policy if exists care_home_packages_update_perm on public.ps_care_home_supply_packages;
create policy care_home_packages_update_perm on public.ps_care_home_supply_packages as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_batch(batch_id), 'care_home_medications'))
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_batch(batch_id), 'care_home_medications'));

drop policy if exists care_home_supply_lines_insert_perm on public.ps_care_home_supply_lines;
create policy care_home_supply_lines_insert_perm on public.ps_care_home_supply_lines as restrictive for insert to authenticated
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_package(package_id), 'care_home_medications'));
drop policy if exists care_home_supply_lines_update_perm on public.ps_care_home_supply_lines;
create policy care_home_supply_lines_update_perm on public.ps_care_home_supply_lines as restrictive for update to authenticated
  using (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_package(package_id), 'care_home_medications'))
  with check (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_package(package_id), 'care_home_medications'));
drop policy if exists care_home_supply_lines_delete_perm on public.ps_care_home_supply_lines;
create policy care_home_supply_lines_delete_perm on public.ps_care_home_supply_lines as restrictive for delete to authenticated
  using (public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_package(package_id), 'care_home_medications'));

-- The supply_lines delete policy was granted to PUBLIC; limit it to signed-in users.
alter policy care_home_supply_lines_delete on public.ps_care_home_supply_lines to authenticated;

-- 3. Permission-checking wrappers for the SECURITY DEFINER RPCs ---------------
-- Each original function is renamed to *_unchecked (not callable by users) and
-- a wrapper with the same name and arguments checks the permission first.

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('ps_create_care_home', 'uuid, text, jsonb, text, text, text'),
      ('ps_create_care_home_supply_batch', 'uuid, text, date, date, date, text'),
      ('ps_generate_delivery_round_from_care_home_batch', 'uuid'),
      ('ps_generate_delivery_round_from_care_home_group', 'uuid'),
      ('ps_pack_care_home_supply_line', 'uuid, integer, text'),
      ('ps_prepare_care_home_gp_request', 'uuid, text, text, date, date'),
      ('ps_mark_care_home_gp_request_sent', 'uuid'),
      ('ps_reconcile_care_home_prescription_line', 'uuid, text, integer, text'),
      ('ps_prepare_care_home_mar_cycle', 'uuid, date, date'),
      ('ps_stop_care_home_medication_schedule', 'uuid, text, boolean')
    ) as t(fn, args)
  loop
    if to_regprocedure(format('public.%I(%s)', item.fn || '_unchecked', item.args)) is null then
      execute format('alter function public.%I(%s) rename to %I', item.fn, item.args, item.fn || '_unchecked');
    end if;
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', item.fn || '_unchecked', item.args);
    execute format('grant execute on function public.%I(%s) to service_role', item.fn || '_unchecked', item.args);
  end loop;
end $$;

create or replace function public.ps_create_care_home(
  target_pharmacy_organisation_id uuid, care_home_name text, care_home_address jsonb default '{}'::jsonb,
  care_home_contact_name text default null, care_home_contact_email text default null, care_home_contact_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.ps_member_has_permission(target_pharmacy_organisation_id, 'care_home_manage') then
    raise exception 'You need care home management permission to add a care home' using errcode = '42501';
  end if;
  return public.ps_create_care_home_unchecked(target_pharmacy_organisation_id, care_home_name, care_home_address,
    care_home_contact_name, care_home_contact_email, care_home_contact_phone);
end $$;

create or replace function public.ps_create_care_home_supply_batch(
  target_link_id uuid, target_title text, target_period_start date, target_period_end date,
  target_delivery_date date, target_supply_scope text default 'all')
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.ps_care_home_pharmacy_has_permission(target_link_id, 'care_home_medications') then
    raise exception 'You need care home medicines permission to start a supply round' using errcode = '42501';
  end if;
  return public.ps_create_care_home_supply_batch_unchecked(target_link_id, target_title, target_period_start,
    target_period_end, target_delivery_date, target_supply_scope);
end $$;

create or replace function public.ps_generate_delivery_round_from_care_home_batch(target_batch_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_batch(target_batch_id), 'care_home_medications') then
    raise exception 'You need care home medicines permission to create a delivery run' using errcode = '42501';
  end if;
  return public.ps_generate_delivery_round_from_care_home_batch_unchecked(target_batch_id);
end $$;

create or replace function public.ps_generate_delivery_round_from_care_home_group(target_group_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_unit(target_group_id), 'care_home_medications') then
    raise exception 'You need care home medicines permission to create a delivery run' using errcode = '42501';
  end if;
  return public.ps_generate_delivery_round_from_care_home_group_unchecked(target_group_id);
end $$;

create or replace function public.ps_pack_care_home_supply_line(target_line_id uuid, packed_quantity integer, target_omission_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare target_package_id uuid;
begin
  select package_id into target_package_id from public.ps_care_home_supply_lines where id = target_line_id;
  if not public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_package(target_package_id), 'care_home_medications') then
    raise exception 'You need care home medicines permission to pack bags' using errcode = '42501';
  end if;
  perform public.ps_pack_care_home_supply_line_unchecked(target_line_id, packed_quantity, target_omission_reason);
end $$;

create or replace function public.ps_prepare_care_home_gp_request(target_link_id uuid, target_surgery_name text, target_title text, target_cycle_start date, target_cycle_end date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.ps_care_home_pharmacy_has_permission(target_link_id, 'care_home_requests') then
    raise exception 'You need care home requests permission to prepare a GP request' using errcode = '42501';
  end if;
  return public.ps_prepare_care_home_gp_request_unchecked(target_link_id, target_surgery_name, target_title, target_cycle_start, target_cycle_end);
end $$;

create or replace function public.ps_mark_care_home_gp_request_sent(target_gp_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_link_id uuid;
begin
  select care_home_link_id into target_link_id from public.ps_care_home_gp_requests where id = target_gp_request_id;
  if not public.ps_care_home_pharmacy_has_permission(target_link_id, 'care_home_requests') then
    raise exception 'You need care home requests permission to send a GP request' using errcode = '42501';
  end if;
  perform public.ps_mark_care_home_gp_request_sent_unchecked(target_gp_request_id);
end $$;

create or replace function public.ps_reconcile_care_home_prescription_line(target_request_line_id uuid, target_outcome text, target_quantity_received integer default null, target_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare target_link_id uuid;
begin
  select care_home_link_id into target_link_id from public.ps_care_home_medication_requests where id = target_request_line_id;
  if not public.ps_care_home_pharmacy_has_permission(target_link_id, 'care_home_requests') then
    raise exception 'You need care home requests permission to record prescription outcomes' using errcode = '42501';
  end if;
  perform public.ps_reconcile_care_home_prescription_line_unchecked(target_request_line_id, target_outcome, target_quantity_received, target_reason);
end $$;

create or replace function public.ps_prepare_care_home_mar_cycle(target_resident_id uuid, target_period_start date, target_period_end date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_resident(target_resident_id), 'care_home_mar_prepare') then
    raise exception 'You need MAR preparation permission to prepare a MAR chart' using errcode = '42501';
  end if;
  return public.ps_prepare_care_home_mar_cycle_unchecked(target_resident_id, target_period_start, target_period_end);
end $$;

create or replace function public.ps_stop_care_home_medication_schedule(target_schedule_id uuid, target_reason text, target_completed boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare target_resident_id uuid;
begin
  select care_home_resident_id into target_resident_id from public.ps_care_home_medication_schedules where id = target_schedule_id;
  if not public.ps_care_home_pharmacy_has_permission(public.ps_care_home_link_of_resident(target_resident_id), 'care_home_medications') then
    raise exception 'You need care home medicines permission to stop a medicine' using errcode = '42501';
  end if;
  perform public.ps_stop_care_home_medication_schedule_unchecked(target_schedule_id, target_reason, target_completed);
end $$;

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('ps_create_care_home', 'uuid, text, jsonb, text, text, text'),
      ('ps_create_care_home_supply_batch', 'uuid, text, date, date, date, text'),
      ('ps_generate_delivery_round_from_care_home_batch', 'uuid'),
      ('ps_generate_delivery_round_from_care_home_group', 'uuid'),
      ('ps_pack_care_home_supply_line', 'uuid, integer, text'),
      ('ps_prepare_care_home_gp_request', 'uuid, text, text, date, date'),
      ('ps_mark_care_home_gp_request_sent', 'uuid'),
      ('ps_reconcile_care_home_prescription_line', 'uuid, text, integer, text'),
      ('ps_prepare_care_home_mar_cycle', 'uuid, date, date'),
      ('ps_stop_care_home_medication_schedule', 'uuid, text, boolean')
    ) as t(fn, args)
  loop
    execute format('revoke all on function public.%I(%s) from public, anon', item.fn, item.args);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', item.fn, item.args);
  end loop;
end $$;

notify pgrst, 'reload schema';
