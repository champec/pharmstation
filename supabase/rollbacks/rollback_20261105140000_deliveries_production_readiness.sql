-- Rollback for 20261105140000_deliveries_production_readiness.sql
-- Puts back the policies as they were on London on 5 Nov 2026 and removes the
-- guard, auto-complete, audit and move functions. Audit rows already written
-- and the realtime publication entries are left in place (harmless).
begin;

drop trigger if exists ps_delivery_round_guard on public.ps_delivery_rounds;
drop trigger if exists ps_delivery_stop_guard on public.ps_delivery_round_patients;
drop trigger if exists ps_delivery_autocomplete_round on public.ps_delivery_round_patients;
drop trigger if exists ps_delivery_rounds_audit on public.ps_delivery_rounds;
drop trigger if exists ps_delivery_round_patients_audit on public.ps_delivery_round_patients;
drop function if exists public.ps_delivery_round_guard();
drop function if exists public.ps_delivery_stop_guard();
drop function if exists public.ps_delivery_autocomplete_round();
drop function if exists public.ps_delivery_audit();
drop function if exists public.ps_delivery_move_stops(uuid[], uuid, text);

drop policy if exists delivery_managers_insert_rounds on public.ps_delivery_rounds;
drop policy if exists delivery_managers_update_rounds on public.ps_delivery_rounds;
drop policy if exists delivery_managers_delete_rounds on public.ps_delivery_rounds;
drop policy if exists delivery_managers_insert_stops on public.ps_delivery_round_patients;
drop policy if exists delivery_managers_update_stops on public.ps_delivery_round_patients;
drop policy if exists delivery_managers_delete_stops on public.ps_delivery_round_patients;
drop policy if exists delivery_managers_write_stop_meds on public.ps_delivery_patient_medications;
drop policy if exists delivery_managers_write_templates on public.ps_delivery_round_templates;
drop policy if exists delivery_managers_write_template_patients on public.ps_delivery_round_template_patients;
drop policy if exists delivery_managers_write_template_meds on public.ps_delivery_round_template_medications;
drop policy if exists delivery_evidence_manager_upload on storage.objects;
drop policy if exists delivery_evidence_manager_update on storage.objects;
drop policy if exists delivery_evidence_manager_delete on storage.objects;

create policy org_members_insert_delivery_rounds on public.ps_delivery_rounds for insert to public
  with check (organisation_id in (select ps_get_user_org_ids()));
create policy org_members_update_delivery_rounds on public.ps_delivery_rounds for update to public
  using (organisation_id in (select ps_get_user_org_ids()));
create policy org_members_delete_delivery_rounds on public.ps_delivery_rounds for delete to public
  using (organisation_id in (select ps_get_user_org_ids()));

create policy org_members_insert_round_patients on public.ps_delivery_round_patients for insert to public
  with check (organisation_id in (select ps_get_user_org_ids()));
create policy org_members_update_round_patients on public.ps_delivery_round_patients for update to public
  using (organisation_id in (select ps_get_user_org_ids()));
create policy org_members_delete_round_patients on public.ps_delivery_round_patients for delete to public
  using (organisation_id in (select ps_get_user_org_ids()));

create policy org_members_insert_delivery_meds on public.ps_delivery_patient_medications for insert to public
  with check (delivery_round_patient_id in (select id from ps_delivery_round_patients where organisation_id in (select ps_get_user_org_ids())));
create policy org_members_update_delivery_meds on public.ps_delivery_patient_medications for update to public
  using (delivery_round_patient_id in (select id from ps_delivery_round_patients where organisation_id in (select ps_get_user_org_ids())));
create policy org_members_delete_delivery_meds on public.ps_delivery_patient_medications for delete to public
  using (delivery_round_patient_id in (select id from ps_delivery_round_patients where organisation_id in (select ps_get_user_org_ids())));

create policy org_members_insert_templates on public.ps_delivery_round_templates for insert to public
  with check (organisation_id in (select ps_get_user_org_ids()));
create policy org_members_update_templates on public.ps_delivery_round_templates for update to public
  using (organisation_id in (select ps_get_user_org_ids()));
create policy org_members_delete_templates on public.ps_delivery_round_templates for delete to public
  using (organisation_id in (select ps_get_user_org_ids()));

create policy org_members_insert_template_patients on public.ps_delivery_round_template_patients for insert to public
  with check (template_id in (select id from ps_delivery_round_templates where organisation_id in (select ps_get_user_org_ids())));
create policy org_members_update_template_patients on public.ps_delivery_round_template_patients for update to public
  using (template_id in (select id from ps_delivery_round_templates where organisation_id in (select ps_get_user_org_ids())));
create policy org_members_delete_template_patients on public.ps_delivery_round_template_patients for delete to public
  using (template_id in (select id from ps_delivery_round_templates where organisation_id in (select ps_get_user_org_ids())));

create policy org_members_insert_template_meds on public.ps_delivery_round_template_medications for insert to public
  with check (template_patient_id in (select tp.id from ps_delivery_round_template_patients tp join ps_delivery_round_templates t on t.id = tp.template_id where t.organisation_id in (select ps_get_user_org_ids())));
create policy org_members_update_template_meds on public.ps_delivery_round_template_medications for update to public
  using (template_patient_id in (select tp.id from ps_delivery_round_template_patients tp join ps_delivery_round_templates t on t.id = tp.template_id where t.organisation_id in (select ps_get_user_org_ids())));
create policy org_members_delete_template_meds on public.ps_delivery_round_template_medications for delete to public
  using (template_patient_id in (select tp.id from ps_delivery_round_template_patients tp join ps_delivery_round_templates t on t.id = tp.template_id where t.organisation_id in (select ps_get_user_org_ids())));

create policy org_members_insert_location_updates on public.ps_delivery_location_updates for insert to public
  with check (round_id in (select id from ps_delivery_rounds where organisation_id in (select ps_get_user_org_ids())));

create policy delivery_evidence_org_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-evidence' and (storage.foldername(name))[1] in (select ps_get_user_org_ids()::text));
create policy delivery_evidence_org_update on storage.objects for update to authenticated
  using (bucket_id = 'delivery-evidence' and (storage.foldername(name))[1] in (select ps_get_user_org_ids()::text))
  with check (bucket_id = 'delivery-evidence' and (storage.foldername(name))[1] in (select ps_get_user_org_ids()::text));
create policy delivery_evidence_org_delete on storage.objects for delete to authenticated
  using (bucket_id = 'delivery-evidence' and (storage.foldername(name))[1] in (select ps_get_user_org_ids()::text));

commit;

select cron.unschedule(jobid) from cron.job where jobname = 'ps-delivery-gps-retention';
