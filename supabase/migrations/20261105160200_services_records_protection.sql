-- Services: protect clinical service records (production readiness, phase 1)
--
-- Before this migration:
--   * Deleting a service (ps_services) cascaded away every delivery and
--     outcome recorded under it, and any staff member could do it.
--   * Any staff member could edit or delete a completed delivery, its outcome
--     and its medicines, with no trail.
--   * delivered_by was whatever the browser sent.
--   * A delivery and its outcome were two separate inserts, so a failure in
--     between left half a record and a retry made a duplicate.
--   * Editing a form changed how old records read; saving a form deleted all
--     fields and re-inserted them in two calls.
--
-- After it:
--   1. ps_member_has_services_permission(org, 'services_manage' | 'services_amend').
--      Defaults: services_manage = owner, manager, pharmacist;
--      services_amend = owner, manager, pharmacist, locum. A per-member
--      override in ps_organisation_members.permissions wins, as for every
--      other permission. Mirrored in DEFAULT_ROLE_PERMISSIONS
--      (packages/types/src/index.ts). Kept out of ps_role_default_permission
--      so this migration does not race other modules redefining that function.
--   2. Services and forms are archived (archived_at), never deleted by staff.
--      Deliveries keep a hard link to their service and form (ON DELETE NO
--      ACTION), so a delete can never take records with it.
--   3. Completed deliveries, their outcomes and medicines are locked. Changes
--      go through ps_amend_service_delivery, which records who, when, why and
--      the before/after in ps_service_delivery_events.
--   4. delivered_by is always the signed-in person.
--   5. ps_complete_service_delivery saves delivery + outcome + medicines in
--      one transaction, idempotent on client_ref, and stores a snapshot of
--      the form (labels, types, version) with the record.
--   6. ps_save_service_form_fields saves a form's fields atomically and bumps
--      the form version.
--   7. Staff may keep drafts (status 'draft'): only the author can edit or
--      delete their own draft.
--   8. Patients can no longer read raw delivery rows (staff notes included)
--      through patients_read_own_deliveries; the portal never used it.
--
-- Service-role / postgres sessions (auth.uid() is null) are not blocked by the
-- record locks, so deleting a whole organisation still works.
--
-- Rollback: supabase/rollbacks/rollback_20261105160200_services_records_protection.sql

begin;

-- 1. Permission helper -------------------------------------------------------
create or replace function public.ps_member_has_services_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when jsonb_typeof(m.permissions -> p_permission) = 'boolean'
        then (m.permissions ->> p_permission)::boolean
      when p_permission = 'services_manage'
        then m.role in ('owner', 'manager', 'pharmacist')
      when p_permission = 'services_amend'
        then m.role in ('owner', 'manager', 'pharmacist', 'locum')
      else false
    end
    from ps_organisation_members m
    where m.organisation_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
    limit 1
  ), false)
$$;

revoke all on function public.ps_member_has_services_permission(uuid, text) from public, anon;
grant execute on function public.ps_member_has_services_permission(uuid, text) to authenticated, service_role;

-- 2. New columns -------------------------------------------------------------
alter table public.ps_services add column if not exists archived_at timestamptz;
alter table public.ps_service_forms add column if not exists archived_at timestamptz;

alter table public.ps_service_deliveries
  add column if not exists client_ref uuid,
  add column if not exists form_version integer,
  add column if not exists form_snapshot jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists amended_at timestamptz,
  add column if not exists amendment_count integer not null default 0;

create unique index if not exists ps_service_deliveries_client_ref_key
  on public.ps_service_deliveries (org_id, client_ref) where client_ref is not null;
create index if not exists ps_service_deliveries_org_created_idx
  on public.ps_service_deliveries (org_id, created_at desc);
create index if not exists ps_service_deliveries_patient_idx
  on public.ps_service_deliveries (patient_id) where patient_id is not null;

-- 3. Foreign keys: never cascade records away --------------------------------
alter table public.ps_service_deliveries drop constraint if exists ps_service_deliveries_service_id_fkey;
alter table public.ps_service_deliveries
  add constraint ps_service_deliveries_service_id_fkey
  foreign key (service_id) references public.ps_services(id);

alter table public.ps_service_deliveries drop constraint if exists ps_service_deliveries_form_id_fkey;
alter table public.ps_service_deliveries
  add constraint ps_service_deliveries_form_id_fkey
  foreign key (form_id) references public.ps_service_forms(id);

-- 4. Audit trail ------------------------------------------------------------
create table if not exists public.ps_service_delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.ps_service_deliveries(id) on delete cascade,
  org_id uuid not null references public.ps_organisations(id) on delete cascade,
  event text not null check (event in ('completed', 'amended')),
  actor uuid references public.ps_user_profiles(id) on delete set null,
  reason text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ps_service_delivery_events_delivery_idx
  on public.ps_service_delivery_events (delivery_id, created_at);

alter table public.ps_service_delivery_events enable row level security;
drop policy if exists service_delivery_events_members_read on public.ps_service_delivery_events;
create policy service_delivery_events_members_read on public.ps_service_delivery_events
  for select to authenticated
  using (org_id in (select public.ps_get_user_org_ids()));
-- No write policies: rows are written only by the functions below.

-- 5. Policies: services ------------------------------------------------------
drop policy if exists org_members_crud_services on public.ps_services;
drop policy if exists services_members_read on public.ps_services;
drop policy if exists services_managers_insert on public.ps_services;
drop policy if exists services_managers_update on public.ps_services;
create policy services_members_read on public.ps_services
  for select to authenticated
  using (org_id in (select public.ps_get_user_org_ids()));
create policy services_managers_insert on public.ps_services
  for insert to authenticated
  with check (public.ps_member_has_services_permission(org_id, 'services_manage'));
create policy services_managers_update on public.ps_services
  for update to authenticated
  using (public.ps_member_has_services_permission(org_id, 'services_manage'))
  with check (public.ps_member_has_services_permission(org_id, 'services_manage'));
-- No delete policy: archive instead (archived_at, is_active = false).

-- 6. Policies: custom forms and fields --------------------------------------
drop policy if exists org_members_crud_custom_service_forms on public.ps_service_forms;
drop policy if exists custom_forms_members_read on public.ps_service_forms;
drop policy if exists custom_forms_managers_insert on public.ps_service_forms;
drop policy if exists custom_forms_managers_update on public.ps_service_forms;
create policy custom_forms_members_read on public.ps_service_forms
  for select to authenticated
  using (org_service_id in (
    select s.id from public.ps_services s
    where s.org_id in (select public.ps_get_user_org_ids())));
create policy custom_forms_managers_insert on public.ps_service_forms
  for insert to authenticated
  with check (org_service_id in (
    select s.id from public.ps_services s
    where s.is_nhs_service = false
      and public.ps_member_has_services_permission(s.org_id, 'services_manage')));
create policy custom_forms_managers_update on public.ps_service_forms
  for update to authenticated
  using (org_service_id in (
    select s.id from public.ps_services s
    where s.is_nhs_service = false
      and public.ps_member_has_services_permission(s.org_id, 'services_manage')))
  with check (org_service_id in (
    select s.id from public.ps_services s
    where s.is_nhs_service = false
      and public.ps_member_has_services_permission(s.org_id, 'services_manage')));
-- No delete policy: archive instead.

drop policy if exists org_members_crud_custom_form_fields on public.ps_service_form_fields;
drop policy if exists custom_form_fields_members_read on public.ps_service_form_fields;
create policy custom_form_fields_members_read on public.ps_service_form_fields
  for select to authenticated
  using (form_id in (
    select f.id from public.ps_service_forms f
    join public.ps_services s on s.id = f.org_service_id
    where s.org_id in (select public.ps_get_user_org_ids())));
-- Field writes go through ps_save_service_form_fields only.

-- 7. Policies: deliveries ----------------------------------------------------
drop policy if exists org_members_crud_deliveries on public.ps_service_deliveries;
drop policy if exists deliveries_members_read on public.ps_service_deliveries;
drop policy if exists deliveries_draft_insert on public.ps_service_deliveries;
drop policy if exists deliveries_draft_update on public.ps_service_deliveries;
drop policy if exists deliveries_draft_delete on public.ps_service_deliveries;
create policy deliveries_members_read on public.ps_service_deliveries
  for select to authenticated
  using (org_id in (select public.ps_get_user_org_ids()));
create policy deliveries_draft_insert on public.ps_service_deliveries
  for insert to authenticated
  with check (
    status = 'draft'
    and org_id in (select public.ps_get_user_org_ids())
    and service_id in (select s.id from public.ps_services s where s.org_id = ps_service_deliveries.org_id)
  );
create policy deliveries_draft_update on public.ps_service_deliveries
  for update to authenticated
  using (status = 'draft' and delivered_by = auth.uid()
         and org_id in (select public.ps_get_user_org_ids()))
  with check (status = 'draft' and delivered_by = auth.uid()
         and org_id in (select public.ps_get_user_org_ids()));
create policy deliveries_draft_delete on public.ps_service_deliveries
  for delete to authenticated
  using (status = 'draft' and delivered_by = auth.uid()
         and org_id in (select public.ps_get_user_org_ids()));
-- Completing a delivery: ps_complete_service_delivery. Changing a completed
-- one: ps_amend_service_delivery.
--
-- Patients could read their own raw delivery rows, including staff notes.
-- Nothing in the patient portal uses it; drop it until a patient-safe
-- summary exists.
drop policy if exists patients_read_own_deliveries on public.ps_service_deliveries;

-- 8. Record locks ------------------------------------------------------------
create or replace function public.ps_service_deliveries_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rpc boolean := coalesce(current_setting('ps.services_rpc', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.delivered_by := auth.uid();
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if auth.uid() is not null and old.status = 'completed' and not v_rpc then
      raise exception 'Completed service records cannot be changed. Use Amend record.'
        using errcode = 'P0001';
    end if;
    if auth.uid() is not null and new.status = 'completed' and old.status = 'draft' and not v_rpc then
      raise exception 'Use Complete Service Delivery to complete a record.'
        using errcode = 'P0001';
    end if;
    new.delivered_by := old.delivered_by;
    new.org_id := old.org_id;
    new.created_at := old.created_at;
    new.updated_at := now();
    return new;
  end if;

  -- DELETE
  if auth.uid() is not null and old.status = 'completed' then
    raise exception 'Completed service records cannot be deleted.'
      using errcode = 'P0001';
  end if;
  return old;
end
$$;

drop trigger if exists ps_service_deliveries_guard on public.ps_service_deliveries;
create trigger ps_service_deliveries_guard
  before insert or update or delete on public.ps_service_deliveries
  for each row execute function public.ps_service_deliveries_guard();

create or replace function public.ps_delivery_outcomes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery uuid;
begin
  if auth.uid() is null or coalesce(current_setting('ps.services_rpc', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'ps_delivery_outcomes' then
    v_delivery := coalesce(new.delivery_id, old.delivery_id);
  else
    select o.delivery_id into v_delivery
    from ps_delivery_outcomes o
    where o.id = coalesce(new.outcome_id, old.outcome_id);
  end if;
  if exists (select 1 from ps_service_deliveries d where d.id = v_delivery and d.status = 'completed') then
    raise exception 'Outcomes of a completed service record cannot be changed.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end
$$;

drop trigger if exists ps_delivery_outcomes_guard on public.ps_delivery_outcomes;
create trigger ps_delivery_outcomes_guard
  before insert or update or delete on public.ps_delivery_outcomes
  for each row execute function public.ps_delivery_outcomes_guard();
drop trigger if exists ps_delivery_outcome_medications_guard on public.ps_delivery_outcome_medications;
create trigger ps_delivery_outcome_medications_guard
  before insert or update or delete on public.ps_delivery_outcome_medications
  for each row execute function public.ps_delivery_outcomes_guard();

-- 9. Form snapshot helper ----------------------------------------------------
create or replace function public.ps_service_form_snapshot(p_form_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'form_id', f.id,
    'name', f.name,
    'version', f.version,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'field_key', ff.field_key,
        'label', ff.label,
        'field_type', ff.field_type,
        'options', ff.options,
        'is_required', ff.is_required
      ) order by ff.display_order)
      from ps_service_form_fields ff where ff.form_id = f.id
    ), '[]'::jsonb)
  )
  from ps_service_forms f where f.id = p_form_id
$$;

revoke all on function public.ps_service_form_snapshot(uuid) from public, anon;

-- 10. Complete a delivery (one transaction) ----------------------------------
create or replace function public.ps_complete_service_delivery(
  p_org_id uuid,
  p_service_id uuid,
  p_client_ref uuid,
  p_patient_id uuid default null,
  p_form_id uuid default null,
  p_form_data jsonb default '{}'::jsonb,
  p_notes text default '',
  p_outcome jsonb default null,
  p_medications jsonb default '[]'::jsonb,
  p_draft_id uuid default null
)
returns public.ps_service_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_service ps_services%rowtype;
  v_form ps_service_forms%rowtype;
  v_row ps_service_deliveries%rowtype;
  v_snapshot jsonb;
  v_outcome_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to record a service.' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id not in (select ps_get_user_org_ids()) then
    raise exception 'You are not a member of this pharmacy.' using errcode = '42501';
  end if;
  if p_client_ref is null then
    raise exception 'client_ref is required.' using errcode = '22023';
  end if;

  -- Idempotent: a retry with the same client_ref returns the saved record.
  select * into v_row from ps_service_deliveries
  where org_id = p_org_id and client_ref = p_client_ref;
  if found then
    return v_row;
  end if;

  select * into v_service from ps_services where id = p_service_id and org_id = p_org_id;
  if not found then
    raise exception 'Service not found.' using errcode = 'P0002';
  end if;
  if v_service.archived_at is not null then
    raise exception 'This service has been archived.' using errcode = 'P0001';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from ps_patients where id = p_patient_id and organisation_id = p_org_id) then
    raise exception 'Patient not found for this pharmacy.' using errcode = 'P0002';
  end if;

  if p_form_id is not null then
    select * into v_form from ps_service_forms
    where id = p_form_id
      and (org_service_id = v_service.id
           or (v_service.library_service_id is not null and service_id = v_service.library_service_id));
    if not found then
      raise exception 'Form does not belong to this service.' using errcode = 'P0002';
    end if;
    v_snapshot := ps_service_form_snapshot(p_form_id);
  end if;

  perform set_config('ps.services_rpc', 'on', true);

  if p_draft_id is not null then
    update ps_service_deliveries set
      patient_id = p_patient_id,
      form_id = p_form_id,
      form_data = coalesce(p_form_data, '{}'::jsonb),
      notes = coalesce(p_notes, ''),
      status = 'completed',
      completed_at = now(),
      client_ref = p_client_ref,
      form_version = v_form.version,
      form_snapshot = v_snapshot
    where id = p_draft_id and org_id = p_org_id and service_id = p_service_id
      and status = 'draft' and delivered_by = v_uid
    returning * into v_row;
    if not found then
      raise exception 'Draft not found, or it is not yours.' using errcode = 'P0002';
    end if;
  else
    insert into ps_service_deliveries (
      org_id, service_id, patient_id, form_id, form_data, delivered_by, notes,
      status, completed_at, client_ref, form_version, form_snapshot)
    values (
      p_org_id, p_service_id, p_patient_id, p_form_id, coalesce(p_form_data, '{}'::jsonb), v_uid,
      coalesce(p_notes, ''), 'completed', now(), p_client_ref, v_form.version, v_snapshot)
    returning * into v_row;
  end if;

  if p_outcome is not null then
    insert into ps_delivery_outcomes (
      delivery_id, org_id, outcome_type, referral_to, referral_reason,
      referral_urgency, advice_given, created_by)
    values (
      v_row.id, p_org_id,
      coalesce(p_outcome ->> 'outcome_type', 'advice'),
      p_outcome ->> 'referral_to',
      p_outcome ->> 'referral_reason',
      p_outcome ->> 'referral_urgency',
      p_outcome ->> 'advice_given',
      v_uid)
    returning id into v_outcome_id;

    if jsonb_typeof(p_medications) = 'array' then
      insert into ps_delivery_outcome_medications (
        outcome_id, drug_id, drug_name, drug_form, drug_strength, dose,
        quantity, unit, is_controlled_drug, sort_order)
      select v_outcome_id,
             nullif(e.value ->> 'drug_id', '')::uuid,
             trim(e.value ->> 'drug_name'),
             e.value ->> 'drug_form',
             e.value ->> 'drug_strength',
             e.value ->> 'dose',
             nullif(e.value ->> 'quantity', '')::numeric::integer,
             e.value ->> 'unit',
             coalesce((e.value ->> 'is_controlled_drug')::boolean, false),
             coalesce((e.value ->> 'sort_order')::integer, (e.ord - 1)::integer)
      from jsonb_array_elements(p_medications) with ordinality as e(value, ord)
      where coalesce(trim(e.value ->> 'drug_name'), '') <> '';
    end if;
  end if;

  insert into ps_service_delivery_events (delivery_id, org_id, event, actor)
  values (v_row.id, p_org_id, 'completed', v_uid);

  return v_row;
end
$$;

revoke all on function public.ps_complete_service_delivery(uuid, uuid, uuid, uuid, uuid, jsonb, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.ps_complete_service_delivery(uuid, uuid, uuid, uuid, uuid, jsonb, text, jsonb, jsonb, uuid) to authenticated;

-- 11. Amend a completed delivery ---------------------------------------------
create or replace function public.ps_amend_service_delivery(
  p_delivery_id uuid,
  p_reason text,
  p_form_data jsonb default null,
  p_notes text default null
)
returns public.ps_service_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old ps_service_deliveries%rowtype;
  v_row ps_service_deliveries%rowtype;
begin
  select * into v_old from ps_service_deliveries where id = p_delivery_id for update;
  if not found or v_uid is null or not ps_member_has_services_permission(v_old.org_id, 'services_amend') then
    raise exception 'You do not have permission to amend this record.' using errcode = '42501';
  end if;
  if v_old.status <> 'completed' then
    raise exception 'Only completed records are amended. Edit the draft instead.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason for the amendment (at least 5 characters).' using errcode = '22023';
  end if;
  if p_form_data is null and p_notes is null then
    raise exception 'Nothing to amend.' using errcode = '22023';
  end if;

  perform set_config('ps.services_rpc', 'on', true);

  update ps_service_deliveries set
    form_data = coalesce(p_form_data, form_data),
    notes = coalesce(p_notes, notes),
    amended_at = now(),
    amendment_count = amendment_count + 1
  where id = p_delivery_id
  returning * into v_row;

  insert into ps_service_delivery_events (delivery_id, org_id, event, actor, reason, before, after)
  values (
    v_row.id, v_row.org_id, 'amended', v_uid, trim(p_reason),
    jsonb_build_object('form_data', v_old.form_data, 'notes', v_old.notes),
    jsonb_build_object('form_data', v_row.form_data, 'notes', v_row.notes));

  return v_row;
end
$$;

revoke all on function public.ps_amend_service_delivery(uuid, text, jsonb, text) from public, anon;
grant execute on function public.ps_amend_service_delivery(uuid, text, jsonb, text) to authenticated;

-- 12. Save a custom form's fields atomically ---------------------------------
create or replace function public.ps_save_service_form_fields(p_form_id uuid, p_fields jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service ps_services%rowtype;
  v_form ps_service_forms%rowtype;
  v_version integer;
begin
  select * into v_form from ps_service_forms where id = p_form_id for update;
  if not found or v_form.org_service_id is null then
    raise exception 'Only your own custom forms can be edited.' using errcode = '42501';
  end if;
  select * into v_service from ps_services where id = v_form.org_service_id;
  if auth.uid() is null or not ps_member_has_services_permission(v_service.org_id, 'services_manage') then
    raise exception 'You do not have permission to edit service forms.' using errcode = '42501';
  end if;
  if v_service.is_nhs_service then
    raise exception 'Standard NHS service forms cannot be edited.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fields) <> 'array' then
    raise exception 'fields must be an array.' using errcode = '22023';
  end if;

  delete from ps_service_form_fields where form_id = p_form_id;

  insert into ps_service_form_fields (form_id, label, field_key, field_type, options, is_required, display_order)
  select p_form_id,
         e.value ->> 'label',
         e.value ->> 'field_key',
         coalesce(e.value ->> 'field_type', 'text'),
         case when e.value -> 'options' = 'null'::jsonb then null else e.value -> 'options' end,
         coalesce((e.value ->> 'is_required')::boolean, false),
         (e.ord - 1)::integer
  from jsonb_array_elements(p_fields) with ordinality as e(value, ord);

  update ps_service_forms set version = version + 1 where id = p_form_id
  returning version into v_version;
  return v_version;
end
$$;

revoke all on function public.ps_save_service_form_fields(uuid, jsonb) from public, anon;
grant execute on function public.ps_save_service_form_fields(uuid, jsonb) to authenticated;

commit;
