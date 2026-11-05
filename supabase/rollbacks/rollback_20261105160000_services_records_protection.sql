-- Rollback for 20261105160000_services_records_protection.sql
--
-- Restores the old open policies and cascading foreign keys. The new columns
-- (archived_at, client_ref, form_version, form_snapshot, updated_at,
-- amended_at, amendment_count) and the ps_service_delivery_events history are
-- kept so no data is lost; nothing reads them once the app is rolled back.
-- WARNING: after this runs, deleting a service deletes its records again.

begin;

drop trigger if exists ps_service_deliveries_guard on public.ps_service_deliveries;
drop trigger if exists ps_delivery_outcomes_guard on public.ps_delivery_outcomes;
drop trigger if exists ps_delivery_outcome_medications_guard on public.ps_delivery_outcome_medications;
drop function if exists public.ps_service_deliveries_guard();
drop function if exists public.ps_delivery_outcomes_guard();
drop function if exists public.ps_complete_service_delivery(uuid, uuid, uuid, uuid, uuid, jsonb, text, jsonb, jsonb, uuid);
drop function if exists public.ps_amend_service_delivery(uuid, text, jsonb, text);
drop function if exists public.ps_save_service_form_fields(uuid, jsonb);
drop function if exists public.ps_service_form_snapshot(uuid);

alter table public.ps_service_deliveries drop constraint if exists ps_service_deliveries_service_id_fkey;
alter table public.ps_service_deliveries
  add constraint ps_service_deliveries_service_id_fkey
  foreign key (service_id) references public.ps_services(id) on delete cascade;
alter table public.ps_service_deliveries drop constraint if exists ps_service_deliveries_form_id_fkey;
alter table public.ps_service_deliveries
  add constraint ps_service_deliveries_form_id_fkey
  foreign key (form_id) references public.ps_service_forms(id) on delete set null;

drop policy if exists services_members_read on public.ps_services;
drop policy if exists services_managers_insert on public.ps_services;
drop policy if exists services_managers_update on public.ps_services;
create policy org_members_crud_services on public.ps_services
  for all to public
  using (org_id in (select public.ps_get_user_org_ids()))
  with check (org_id in (select public.ps_get_user_org_ids()));

drop policy if exists custom_forms_members_read on public.ps_service_forms;
drop policy if exists custom_forms_managers_insert on public.ps_service_forms;
drop policy if exists custom_forms_managers_update on public.ps_service_forms;
create policy org_members_crud_custom_service_forms on public.ps_service_forms
  for all to authenticated
  using (org_service_id in (select s.id from public.ps_services s
    where s.org_id in (select public.ps_get_user_org_ids())))
  with check (org_service_id in (select s.id from public.ps_services s
    where s.org_id in (select public.ps_get_user_org_ids()) and s.is_nhs_service = false));

drop policy if exists custom_form_fields_members_read on public.ps_service_form_fields;
create policy org_members_crud_custom_form_fields on public.ps_service_form_fields
  for all to authenticated
  using (form_id in (select f.id from public.ps_service_forms f
    join public.ps_services s on s.id = f.org_service_id
    where s.org_id in (select public.ps_get_user_org_ids())))
  with check (form_id in (select f.id from public.ps_service_forms f
    join public.ps_services s on s.id = f.org_service_id
    where s.org_id in (select public.ps_get_user_org_ids()) and s.is_nhs_service = false));

drop policy if exists deliveries_members_read on public.ps_service_deliveries;
drop policy if exists deliveries_draft_insert on public.ps_service_deliveries;
drop policy if exists deliveries_draft_update on public.ps_service_deliveries;
drop policy if exists deliveries_draft_delete on public.ps_service_deliveries;
create policy org_members_crud_deliveries on public.ps_service_deliveries
  for all to public
  using (org_id in (select public.ps_get_user_org_ids()))
  with check (org_id in (select public.ps_get_user_org_ids()));

drop function if exists public.ps_member_has_services_permission(uuid, text);

commit;
