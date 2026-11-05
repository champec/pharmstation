-- Rollback for 20261105160100_sop_production_readiness.sql
-- Puts the SOP policies back as they were on London on 5 Nov 2026 and removes
-- the guards and publish function. WARNING: this reopens the sop-pdfs storage
-- hole (any signed-in user can read, change and delete every pharmacy's SOP
-- files). The frozen version tables, the new columns and the sign-off name
-- backfill are kept (harmless, and they hold audit history).
begin;

drop trigger if exists ps_sop_completion_guard on public.ps_sop_completions;
drop trigger if exists ps_locum_sop_signoff_guard on public.ps_locum_sop_signoffs;
drop trigger if exists ps_sop_document_guard on public.ps_sop_documents;
drop trigger if exists ps_sop_nodes_mark_changed on public.ps_sop_nodes;
drop trigger if exists ps_locum_sop_document_guard on public.ps_locum_sop_documents;
drop function if exists public.ps_sop_publish(uuid);
drop function if exists public.ps_can_manage_locum_sops(uuid) cascade;

-- Storage, as before
drop policy if exists sop_pdfs_select_authenticated on storage.objects;
drop policy if exists sop_pdfs_insert_authenticated on storage.objects;
drop policy if exists sop_pdfs_update_authenticated on storage.objects;
drop policy if exists sop_pdfs_delete_authenticated on storage.objects;
create policy sop_pdfs_select_authenticated on storage.objects for select to authenticated using (bucket_id = 'sop-pdfs');
create policy sop_pdfs_insert_authenticated on storage.objects for insert to authenticated with check (bucket_id = 'sop-pdfs');
create policy sop_pdfs_update_authenticated on storage.objects for update to authenticated using (bucket_id = 'sop-pdfs');
create policy sop_pdfs_delete_authenticated on storage.objects for delete to authenticated using (bucket_id = 'sop-pdfs');
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'sop-pdfs';

-- Locum SOP list
drop policy if exists org_members_read_sop_documents on public.ps_locum_sop_documents;
drop policy if exists booked_locums_read_active_sops on public.ps_locum_sop_documents;
drop policy if exists sop_managers_write_sop_documents on public.ps_locum_sop_documents;
create policy authenticated_read_active_sops on public.ps_locum_sop_documents for select to public
  using (auth.role() = 'authenticated' and is_active = true);
create policy org_members_crud_sop_documents on public.ps_locum_sop_documents for all to public
  using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));

-- Locum sign-offs
drop policy if exists locum_read_own_signoffs on public.ps_locum_sop_signoffs;
drop policy if exists locum_insert_own_signoffs on public.ps_locum_sop_signoffs;
create policy locum_crud_own_signoffs on public.ps_locum_sop_signoffs for all to public
  using (locum_id = ps_get_my_locum_id()) with check (locum_id = ps_get_my_locum_id());

-- Staff sign-offs
drop policy if exists sop_completions_own_read on public.ps_sop_completions;
drop policy if exists sop_completions_own_insert on public.ps_sop_completions;
create policy sop_completions_own on public.ps_sop_completions for all to public
  using (member_id in (select id from ps_organisation_members where user_id = auth.uid()));

-- Library policies back to role lists
drop policy if exists sop_docs_org_write on public.ps_sop_documents;
create policy sop_docs_org_write on public.ps_sop_documents for all to public
  using (org_id in (select organisation_id from ps_organisation_members
                    where user_id = auth.uid() and status = 'active' and role = any (array['owner','manager','pharmacist'])));
drop policy if exists sop_nodes_org_write on public.ps_sop_nodes;
create policy sop_nodes_org_write on public.ps_sop_nodes for all to public
  using (document_id in (select id from ps_sop_documents where org_id in (
           select organisation_id from ps_organisation_members
           where user_id = auth.uid() and status = 'active' and role = any (array['owner','manager','pharmacist']))));
drop policy if exists sop_assignments_org_write on public.ps_sop_assignments;
create policy sop_assignments_org_write on public.ps_sop_assignments for all to public
  using (org_id in (select organisation_id from ps_organisation_members
                    where user_id = auth.uid() and status = 'active' and role = any (array['owner','manager','pharmacist'])));
alter policy sop_completions_org_read on public.ps_sop_completions
  using (org_id in (select organisation_id from ps_organisation_members
                    where user_id = auth.uid() and status = 'active' and role = any (array['owner','manager','pharmacist'])));

commit;
