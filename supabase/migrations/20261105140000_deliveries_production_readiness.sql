-- Deliveries: production readiness (Phase 3 and 4 of
-- /mnt/project-files/deliveries/production-readiness-plan.md)
--
-- Run AFTER 20261104123000_role_permissions_foundation.sql (it gives every role
-- its delivery_manage / delivery_drive defaults). Safe to run more than once.
--
-- 1. Live updates: delivery rounds, stops and driver GPS join the realtime
--    publication. On London only 6 messaging tables were in it, so the
--    deliveries board, the driver route and the manager map never updated live.
-- 2. Who can do what:
--    - Creating, editing, deleting and cancelling rounds, stops, stop medicines
--      and templates needs delivery_manage (owner, manager, pharmacist by
--      default). Before this, any active member could.
--    - Drivers keep their own policies, but a guard trigger limits what they
--      can change: claim an open round for themselves, start it, complete it
--      once every stop is resolved, and record the outcome of a pending stop
--      on a round that is in progress.
--    - Only the assigned driver can post GPS points for a round (the old
--      org-wide insert policy let any member post as any driver).
--    - Delivery evidence files: any member can still read their pharmacy's
--      files; only delivery managers (or the assigned driver, via the existing
--      driver policies) can upload, replace or delete them.
-- 3. Status rules enforced in the database, with server timestamps:
--    rounds  draft -> scheduled | cancelled
--            scheduled -> draft | in_progress | cancelled
--            in_progress -> completed | cancelled
--    stops   pending -> delivered | failed | pending_redelivery | skipped | cancelled
--            failed | pending_redelivery | skipped -> moved_to_round | returned | cancelled
--            (failed/skipped may also go to pending_redelivery)
--    A delivered stop needs a signature or a delivery method, and its evidence
--    can't be changed afterwards. A failed stop needs a reason.
-- 4. A round completes itself on the server when its last pending stop is
--    resolved, and failed stops move to another round in one transaction
--    (ps_delivery_move_stops), so a dropped connection can't leave half-moved
--    stops.
-- 5. Audit trail: every insert, update and delete on rounds and stops is
--    written to ps_audit_log (signature images are left out, with a
--    has_signature flag instead).
-- 6. Driver GPS points are deleted after 30 days (daily pg_cron job).
--
-- Rollback: supabase/rollbacks/rollback_20261105140000_deliveries_production_readiness.sql

begin;

-- 1. Realtime ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['ps_delivery_rounds', 'ps_delivery_round_patients', 'ps_delivery_location_updates']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

create index if not exists ps_delivery_location_updates_round_recorded_idx
  on public.ps_delivery_location_updates (round_id, recorded_at desc);
create index if not exists ps_delivery_location_updates_recorded_idx
  on public.ps_delivery_location_updates (recorded_at);

-- 2. Policies: management writes need delivery_manage ------------------------

-- Rounds
drop policy if exists org_members_insert_delivery_rounds on public.ps_delivery_rounds;
drop policy if exists org_members_update_delivery_rounds on public.ps_delivery_rounds;
drop policy if exists org_members_delete_delivery_rounds on public.ps_delivery_rounds;
drop policy if exists delivery_managers_insert_rounds on public.ps_delivery_rounds;
drop policy if exists delivery_managers_update_rounds on public.ps_delivery_rounds;
drop policy if exists delivery_managers_delete_rounds on public.ps_delivery_rounds;

create policy delivery_managers_insert_rounds on public.ps_delivery_rounds
  for insert to authenticated
  with check (public.ps_member_has_permission(organisation_id, 'delivery_manage'));
create policy delivery_managers_update_rounds on public.ps_delivery_rounds
  for update to authenticated
  using (public.ps_member_has_permission(organisation_id, 'delivery_manage'))
  with check (public.ps_member_has_permission(organisation_id, 'delivery_manage'));
create policy delivery_managers_delete_rounds on public.ps_delivery_rounds
  for delete to authenticated
  using (
    public.ps_member_has_permission(organisation_id, 'delivery_manage')
    and status in ('draft', 'cancelled')
  );

-- Stops
drop policy if exists org_members_insert_round_patients on public.ps_delivery_round_patients;
drop policy if exists org_members_update_round_patients on public.ps_delivery_round_patients;
drop policy if exists org_members_delete_round_patients on public.ps_delivery_round_patients;
drop policy if exists delivery_managers_insert_stops on public.ps_delivery_round_patients;
drop policy if exists delivery_managers_update_stops on public.ps_delivery_round_patients;
drop policy if exists delivery_managers_delete_stops on public.ps_delivery_round_patients;

create policy delivery_managers_insert_stops on public.ps_delivery_round_patients
  for insert to authenticated
  with check (
    public.ps_member_has_permission(organisation_id, 'delivery_manage')
    and exists (
      select 1 from public.ps_delivery_rounds r
      where r.id = round_id and r.organisation_id = ps_delivery_round_patients.organisation_id
    )
  );
create policy delivery_managers_update_stops on public.ps_delivery_round_patients
  for update to authenticated
  using (public.ps_member_has_permission(organisation_id, 'delivery_manage'))
  with check (public.ps_member_has_permission(organisation_id, 'delivery_manage'));
create policy delivery_managers_delete_stops on public.ps_delivery_round_patients
  for delete to authenticated
  using (
    public.ps_member_has_permission(organisation_id, 'delivery_manage')
    and status = 'pending'
    and exists (
      select 1 from public.ps_delivery_rounds r
      where r.id = round_id and r.status in ('draft', 'scheduled')
    )
  );

-- Medicines on a stop
drop policy if exists org_members_insert_delivery_meds on public.ps_delivery_patient_medications;
drop policy if exists org_members_update_delivery_meds on public.ps_delivery_patient_medications;
drop policy if exists org_members_delete_delivery_meds on public.ps_delivery_patient_medications;
drop policy if exists delivery_managers_write_stop_meds on public.ps_delivery_patient_medications;

create policy delivery_managers_write_stop_meds on public.ps_delivery_patient_medications
  for all to authenticated
  using (exists (
    select 1 from public.ps_delivery_round_patients s
    where s.id = delivery_round_patient_id
      and public.ps_member_has_permission(s.organisation_id, 'delivery_manage')
  ))
  with check (exists (
    select 1 from public.ps_delivery_round_patients s
    where s.id = delivery_round_patient_id
      and public.ps_member_has_permission(s.organisation_id, 'delivery_manage')
  ));

-- Templates
drop policy if exists org_members_insert_templates on public.ps_delivery_round_templates;
drop policy if exists org_members_update_templates on public.ps_delivery_round_templates;
drop policy if exists org_members_delete_templates on public.ps_delivery_round_templates;
drop policy if exists delivery_managers_write_templates on public.ps_delivery_round_templates;

create policy delivery_managers_write_templates on public.ps_delivery_round_templates
  for all to authenticated
  using (public.ps_member_has_permission(organisation_id, 'delivery_manage'))
  with check (public.ps_member_has_permission(organisation_id, 'delivery_manage'));

drop policy if exists org_members_insert_template_patients on public.ps_delivery_round_template_patients;
drop policy if exists org_members_update_template_patients on public.ps_delivery_round_template_patients;
drop policy if exists org_members_delete_template_patients on public.ps_delivery_round_template_patients;
drop policy if exists delivery_managers_write_template_patients on public.ps_delivery_round_template_patients;

create policy delivery_managers_write_template_patients on public.ps_delivery_round_template_patients
  for all to authenticated
  using (exists (
    select 1 from public.ps_delivery_round_templates t
    where t.id = template_id and public.ps_member_has_permission(t.organisation_id, 'delivery_manage')
  ))
  with check (exists (
    select 1 from public.ps_delivery_round_templates t
    where t.id = template_id and public.ps_member_has_permission(t.organisation_id, 'delivery_manage')
  ));

drop policy if exists org_members_insert_template_meds on public.ps_delivery_round_template_medications;
drop policy if exists org_members_update_template_meds on public.ps_delivery_round_template_medications;
drop policy if exists org_members_delete_template_meds on public.ps_delivery_round_template_medications;
drop policy if exists delivery_managers_write_template_meds on public.ps_delivery_round_template_medications;

create policy delivery_managers_write_template_meds on public.ps_delivery_round_template_medications
  for all to authenticated
  using (exists (
    select 1
    from public.ps_delivery_round_template_patients tp
    join public.ps_delivery_round_templates t on t.id = tp.template_id
    where tp.id = template_patient_id and public.ps_member_has_permission(t.organisation_id, 'delivery_manage')
  ))
  with check (exists (
    select 1
    from public.ps_delivery_round_template_patients tp
    join public.ps_delivery_round_templates t on t.id = tp.template_id
    where tp.id = template_patient_id and public.ps_member_has_permission(t.organisation_id, 'delivery_manage')
  ));

-- GPS: only the assigned driver (personal_drivers_insert_location_updates, fixed 2 Nov)
drop policy if exists org_members_insert_location_updates on public.ps_delivery_location_updates;

-- Evidence files: reading stays org-wide; writes need delivery_manage
-- (assigned drivers keep delivery_evidence_driver_upload / _delete).
drop policy if exists delivery_evidence_org_upload on storage.objects;
drop policy if exists delivery_evidence_org_update on storage.objects;
drop policy if exists delivery_evidence_org_delete on storage.objects;
drop policy if exists delivery_evidence_manager_upload on storage.objects;
drop policy if exists delivery_evidence_manager_update on storage.objects;
drop policy if exists delivery_evidence_manager_delete on storage.objects;

create policy delivery_evidence_manager_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'delivery-evidence'
    and exists (
      select 1 from public.ps_get_user_org_ids() o
      where o::text = (storage.foldername(name))[1]
        and public.ps_member_has_permission(o, 'delivery_manage')
    )
  );
create policy delivery_evidence_manager_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'delivery-evidence'
    and exists (
      select 1 from public.ps_get_user_org_ids() o
      where o::text = (storage.foldername(name))[1]
        and public.ps_member_has_permission(o, 'delivery_manage')
    )
  )
  with check (
    bucket_id = 'delivery-evidence'
    and exists (
      select 1 from public.ps_get_user_org_ids() o
      where o::text = (storage.foldername(name))[1]
        and public.ps_member_has_permission(o, 'delivery_manage')
    )
  );
create policy delivery_evidence_manager_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'delivery-evidence'
    and exists (
      select 1 from public.ps_get_user_org_ids() o
      where o::text = (storage.foldername(name))[1]
        and public.ps_member_has_permission(o, 'delivery_manage')
    )
  );

-- 3. Guard triggers ---------------------------------------------------------

-- Rounds: status rules, server timestamps, and what drivers may change.
create or replace function public.ps_delivery_round_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_manager boolean;
  v_driver_fields constant text[] := array['status', 'started_at', 'completed_at', 'driver_id', 'updated_at'];
begin
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'A delivery round cannot move to another pharmacy' using errcode = 'check_violation';
  end if;

  -- Status rules apply to everyone, including the server's own updates.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('scheduled', 'cancelled'))
      or (old.status = 'scheduled' and new.status in ('draft', 'in_progress', 'cancelled'))
      or (old.status = 'in_progress' and new.status in ('completed', 'cancelled'))
    ) then
      raise exception 'A delivery round cannot go from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;
    if new.status = 'in_progress' then
      new.started_at := now();
    elsif new.status = 'completed' then
      new.completed_at := now();
    end if;
  else
    new.started_at := old.started_at;
    new.completed_at := old.completed_at;
  end if;

  -- Service role / SQL editor, and updates made by our own triggers, skip the
  -- driver limits below.
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  v_is_manager := public.ps_member_has_permission(old.organisation_id, 'delivery_manage');
  if v_is_manager then
    return new;
  end if;

  -- Drivers
  if (to_jsonb(new) - v_driver_fields) is distinct from (to_jsonb(old) - v_driver_fields) then
    raise exception 'Drivers can only claim, start or complete a delivery round'
      using errcode = 'insufficient_privilege';
  end if;

  if new.driver_id is distinct from old.driver_id then
    if not (
      old.driver_id is null
      and old.status = 'scheduled'
      and new.driver_id is not null
      and public.ps_is_my_driver_membership(new.driver_id, new.organisation_id)
    ) then
      raise exception 'Drivers can only claim an open round for themselves'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status not in ('in_progress', 'completed') then
      raise exception 'Drivers can only start or complete a delivery round'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'completed' and exists (
      select 1 from public.ps_delivery_round_patients s
      where s.round_id = old.id and s.status = 'pending'
    ) then
      raise exception 'Every stop needs an outcome before the round can be completed'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ps_delivery_round_guard on public.ps_delivery_rounds;
create trigger ps_delivery_round_guard
  before update on public.ps_delivery_rounds
  for each row execute function public.ps_delivery_round_guard();

-- Stops: status rules, evidence rules, and what drivers may change.
create or replace function public.ps_delivery_stop_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_manager boolean;
  v_round_status text;
  v_driver_fields constant text[] := array[
    'status', 'signature_data', 'proof_photo_paths', 'delivery_recipient_name',
    'delivery_method', 'delivered_at', 'failure_reason', 'updated_at'
  ];
  v_evidence_fields constant text[] := array[
    'signature_data', 'proof_photo_paths', 'delivery_recipient_name', 'delivery_method', 'delivered_at'
  ];
  v_key text;
begin
  if new.organisation_id is distinct from old.organisation_id
     or new.round_id is distinct from old.round_id then
    raise exception 'A delivery stop cannot move to another round or pharmacy'
      using errcode = 'check_violation';
  end if;

  -- Evidence on a delivered stop is final.
  if old.status = 'delivered' then
    foreach v_key in array v_evidence_fields loop
      if (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
        raise exception 'Proof of delivery cannot be changed once a stop is delivered'
          using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('delivered', 'failed', 'pending_redelivery', 'skipped', 'cancelled'))
      or (old.status in ('failed', 'skipped') and new.status in ('pending_redelivery', 'moved_to_round', 'returned', 'cancelled'))
      or (old.status = 'pending_redelivery' and new.status in ('moved_to_round', 'returned', 'cancelled'))
    ) then
      raise exception 'A delivery stop cannot go from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;

    if new.status = 'delivered' then
      if new.signature_data is null and new.delivery_method is null then
        raise exception 'A delivered stop needs a signature or a delivery method'
          using errcode = 'check_violation';
      end if;
      new.delivered_at := now();
    elsif new.status in ('failed', 'pending_redelivery') and old.status = 'pending'
          and coalesce(btrim(new.failure_reason), '') = '' then
      raise exception 'A failed delivery needs a reason' using errcode = 'check_violation';
    end if;
  elsif old.status <> 'delivered' then
    new.delivered_at := old.delivered_at;
  end if;

  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  v_is_manager := public.ps_member_has_permission(old.organisation_id, 'delivery_manage');
  if v_is_manager then
    return new;
  end if;

  -- Drivers: only the outcome of a pending stop, on a round in progress.
  if (to_jsonb(new) - v_driver_fields) is distinct from (to_jsonb(old) - v_driver_fields) then
    raise exception 'Drivers can only record the outcome of a stop'
      using errcode = 'insufficient_privilege';
  end if;

  select r.status into v_round_status from public.ps_delivery_rounds r where r.id = old.round_id;
  if v_round_status is distinct from 'in_progress' then
    raise exception 'Start the round before recording deliveries' using errcode = 'check_violation';
  end if;

  if old.status <> 'pending' then
    raise exception 'This stop already has an outcome' using errcode = 'check_violation';
  end if;

  if new.status not in ('pending', 'delivered', 'failed', 'pending_redelivery', 'skipped') then
    raise exception 'Drivers can only mark a stop delivered, failed or skipped'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists ps_delivery_stop_guard on public.ps_delivery_round_patients;
create trigger ps_delivery_stop_guard
  before update on public.ps_delivery_round_patients
  for each row execute function public.ps_delivery_stop_guard();

-- 4. Auto-complete and atomic moves -----------------------------------------

create or replace function public.ps_delivery_autocomplete_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and old.status = 'pending' then
    update public.ps_delivery_rounds r
    set status = 'completed'
    where r.id = new.round_id
      and r.status = 'in_progress'
      and not exists (
        select 1 from public.ps_delivery_round_patients s
        where s.round_id = r.id and s.status = 'pending'
      );
  end if;
  return null;
end;
$$;

drop trigger if exists ps_delivery_autocomplete_round on public.ps_delivery_round_patients;
create trigger ps_delivery_autocomplete_round
  after update of status on public.ps_delivery_round_patients
  for each row execute function public.ps_delivery_autocomplete_round();

-- Move failed / skipped stops to another round (or a new redelivery round) in
-- one transaction. Returns the target round id.
create or replace function public.ps_delivery_move_stops(
  p_stop_ids uuid[],
  p_target_round_id uuid default null,
  p_new_round_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_target public.ps_delivery_rounds%rowtype;
  v_stop public.ps_delivery_round_patients%rowtype;
  v_next integer;
  v_new_id uuid;
  v_count integer;
begin
  if p_stop_ids is null or cardinality(p_stop_ids) = 0 then
    raise exception 'Choose at least one delivery to move' using errcode = 'invalid_parameter_value';
  end if;

  select count(distinct organisation_id), min(organisation_id::text)::uuid
  into v_count, v_org
  from public.ps_delivery_round_patients
  where id = any(p_stop_ids);

  if v_count <> 1 then
    raise exception 'Deliveries not found, or from more than one pharmacy' using errcode = 'invalid_parameter_value';
  end if;
  if not public.ps_member_has_permission(v_org, 'delivery_manage') then
    raise exception 'You need permission to manage deliveries' using errcode = 'insufficient_privilege';
  end if;

  if p_target_round_id is null then
    insert into public.ps_delivery_rounds (organisation_id, title, status, created_by)
    values (
      v_org,
      coalesce(nullif(btrim(p_new_round_title), ''), 'Redelivery — ' || to_char(now() at time zone 'Europe/London', 'DD/MM/YYYY')),
      'draft',
      auth.uid()
    )
    returning * into v_target;
  else
    select * into v_target from public.ps_delivery_rounds where id = p_target_round_id for update;
    if v_target.id is null or v_target.organisation_id <> v_org then
      raise exception 'Target round not found' using errcode = 'invalid_parameter_value';
    end if;
    if v_target.status not in ('draft', 'scheduled') then
      raise exception 'Deliveries can only be added to a draft or scheduled round' using errcode = 'check_violation';
    end if;
  end if;

  select coalesce(max(delivery_order), 0) into v_next
  from public.ps_delivery_round_patients where round_id = v_target.id;

  for v_stop in
    select * from public.ps_delivery_round_patients
    where id = any(p_stop_ids)
    order by delivery_order, created_at
    for update
  loop
    if v_stop.status not in ('failed', 'pending_redelivery', 'skipped') then
      raise exception 'Only failed or skipped deliveries can be moved' using errcode = 'check_violation';
    end if;
    if v_stop.round_id = v_target.id then
      raise exception 'A delivery cannot be moved to the round it is already on' using errcode = 'check_violation';
    end if;

    v_next := v_next + 1;
    insert into public.ps_delivery_round_patients (
      round_id, patient_id, organisation_id, delivery_order, status,
      delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_postcode,
      notes, original_round_patient_id
    ) values (
      v_target.id, v_stop.patient_id, v_org, v_next, 'pending',
      v_stop.delivery_address_line_1, v_stop.delivery_address_line_2, v_stop.delivery_city, v_stop.delivery_postcode,
      v_stop.notes, v_stop.id
    )
    returning id into v_new_id;

    insert into public.ps_delivery_patient_medications (delivery_round_patient_id, patient_medication_id, quantity, notes)
    select v_new_id, m.patient_medication_id, m.quantity, m.notes
    from public.ps_delivery_patient_medications m
    where m.delivery_round_patient_id = v_stop.id;

    update public.ps_delivery_round_patients
    set status = 'moved_to_round', moved_to_round_patient_id = v_new_id
    where id = v_stop.id;
  end loop;

  return v_target.id;
end;
$$;

-- 5. Audit trail ------------------------------------------------------------

create or replace function public.ps_delivery_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;

  if tg_table_name = 'ps_delivery_round_patients' then
    if v_old is not null then
      v_old := (v_old - 'signature_data') || jsonb_build_object('has_signature', v_old ->> 'signature_data' is not null);
    end if;
    if v_new is not null then
      v_new := (v_new - 'signature_data') || jsonb_build_object('has_signature', v_new ->> 'signature_data' is not null);
    end if;
  end if;

  -- Skip updates that only touched updated_at
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;

  v_row := coalesce(v_new, v_old);
  insert into public.ps_audit_log (organisation_id, table_name, record_id, action, old_data, new_data, performed_by)
  values (
    (v_row ->> 'organisation_id')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    tg_op,
    v_old,
    v_new,
    auth.uid()
  );
  return null;
end;
$$;

drop trigger if exists ps_delivery_rounds_audit on public.ps_delivery_rounds;
create trigger ps_delivery_rounds_audit
  after insert or update or delete on public.ps_delivery_rounds
  for each row execute function public.ps_delivery_audit();

drop trigger if exists ps_delivery_round_patients_audit on public.ps_delivery_round_patients;
create trigger ps_delivery_round_patients_audit
  after insert or update or delete on public.ps_delivery_round_patients
  for each row execute function public.ps_delivery_audit();

-- Grants --------------------------------------------------------------------
revoke all on function public.ps_delivery_round_guard() from public, anon, authenticated;
revoke all on function public.ps_delivery_stop_guard() from public, anon, authenticated;
revoke all on function public.ps_delivery_autocomplete_round() from public, anon, authenticated;
revoke all on function public.ps_delivery_audit() from public, anon, authenticated;
revoke all on function public.ps_delivery_move_stops(uuid[], uuid, text) from public, anon;
grant execute on function public.ps_delivery_move_stops(uuid[], uuid, text) to authenticated, service_role;

commit;

-- 6. GPS retention (outside the transaction: pg_cron) ------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'ps-delivery-gps-retention';
select cron.schedule(
  'ps-delivery-gps-retention',
  '15 3 * * *',
  $$delete from public.ps_delivery_location_updates where recorded_at < now() - interval '30 days'$$
);
