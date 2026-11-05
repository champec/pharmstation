-- Rollback for 20261105170000_locum_production_readiness.sql
-- Puts the locum RLS policies back as they were on 4 Nov 2026 and removes the
-- new functions. NOTE: this re-opens the holes the migration closed (direct
-- booking inserts, unchecked sign-ins, open sop-pdfs bucket). Use only to
-- recover from a breakage, then fix forward.
-- ps_locum_book_shift, ps_admin_set_locum_compliance,
-- ps_protect_locum_compliance_status and ps_locum_sign_in_duration keep their
-- new (stricter) bodies; they work with the old policies. Re-run
-- 20261102180000_locum_compliance_review.sql to restore the old admin function.
begin;

-- Compliance statuses: map new values back first
update public.ps_locum_profiles set compliance_status = 'changes_requested' where compliance_status = 'rejected';
alter table public.ps_locum_profiles drop constraint if exists ps_locum_profiles_compliance_status_check;
alter table public.ps_locum_profiles add constraint ps_locum_profiles_compliance_status_check
  check (compliance_status in ('pending', 'approved', 'changes_requested', 'suspended'));

-- Shifts
drop policy if exists locum_read_open_shifts on public.ps_locum_shifts;
drop policy if exists org_members_read_shifts on public.ps_locum_shifts;
drop policy if exists org_managers_insert_shifts on public.ps_locum_shifts;
drop policy if exists org_managers_update_shifts on public.ps_locum_shifts;
drop policy if exists org_managers_delete_shifts on public.ps_locum_shifts;
create policy authenticated_read_open_shifts on public.ps_locum_shifts for select using (auth.role() = 'authenticated' and status = 'open');
create policy org_members_crud_shifts on public.ps_locum_shifts for all
  using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));

-- Criteria
drop policy if exists shift_criteria_read on public.ps_locum_shift_criteria;
drop policy if exists shift_criteria_manage on public.ps_locum_shift_criteria;
create policy authenticated_read_shift_criteria on public.ps_locum_shift_criteria for select using (auth.role() = 'authenticated');
create policy org_members_crud_shift_criteria on public.ps_locum_shift_criteria for all
  using (shift_id in (select id from ps_locum_shifts where org_id in (select ps_get_user_org_ids())))
  with check (shift_id in (select id from ps_locum_shifts where org_id in (select ps_get_user_org_ids())));

-- Bookings
drop policy if exists org_members_read_bookings on public.ps_locum_bookings;
create policy locum_insert_own_bookings on public.ps_locum_bookings for insert to authenticated
  with check (locum_id = ps_get_my_locum_id() and status = 'pending');
create policy locum_cancel_own_bookings on public.ps_locum_bookings for update to authenticated
  using (locum_id = ps_get_my_locum_id() and status in ('pending', 'approved'))
  with check (locum_id = ps_get_my_locum_id() and status = 'cancelled');
create policy org_members_manage_bookings on public.ps_locum_bookings for all
  using (shift_id in (select id from ps_locum_shifts where org_id in (select ps_get_user_org_ids())))
  with check (shift_id in (select id from ps_locum_shifts where org_id in (select ps_get_user_org_ids())));

-- Sign-ins
drop policy if exists org_members_read_sign_ins on public.ps_locum_sign_ins;
create policy locum_insert_own_sign_in on public.ps_locum_sign_ins for insert with check (locum_id = ps_get_my_locum_id());
create policy locum_update_own_sign_in on public.ps_locum_sign_ins for update using (locum_id = ps_get_my_locum_id());
create policy org_members_read_sign_ins on public.ps_locum_sign_ins for all
  using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));

-- Profiles, services, documents
drop policy if exists org_managers_read_locum_profiles on public.ps_locum_profiles;
create policy org_members_read_locum_profiles on public.ps_locum_profiles for select
  using (id in (select distinct lb.locum_id from ps_locum_bookings lb join ps_locum_shifts ls on ls.id = lb.shift_id
                where ls.org_id in (select ps_get_user_org_ids())));
drop policy if exists org_managers_read_locum_services on public.ps_locum_services;
create policy authenticated_read_locum_services on public.ps_locum_services for select using (auth.role() = 'authenticated');
create policy org_members_read_locum_services on public.ps_locum_services for select
  using (locum_id in (select distinct lb.locum_id from ps_locum_bookings lb join ps_locum_shifts ls on ls.id = lb.shift_id
                      where ls.org_id in (select ps_get_user_org_ids())));
drop policy if exists org_managers_read_locum_documents on public.ps_locum_documents;
create policy org_members_read_locum_documents on public.ps_locum_documents for select
  using (locum_id in (select distinct lb.locum_id from ps_locum_bookings lb join ps_locum_shifts ls on ls.id = lb.shift_id
                      where ls.org_id in (select ps_get_user_org_ids())));

-- Pharmacy-private tables
drop policy if exists org_managers_crud_blacklist on public.ps_locum_blacklist;
create policy org_members_crud_blacklist on public.ps_locum_blacklist for all using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));
drop policy if exists org_managers_crud_locum_notes on public.ps_locum_notes;
create policy org_members_crud_locum_notes on public.ps_locum_notes for all using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));
drop policy if exists org_managers_crud_reviews on public.ps_locum_reviews;
create policy org_members_crud_reviews on public.ps_locum_reviews for all using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));
drop policy if exists org_managers_read_feedback on public.ps_locum_pharmacy_feedback;
create policy org_members_read_own_feedback on public.ps_locum_pharmacy_feedback for select using (org_id in (select ps_get_user_org_ids()));
drop policy if exists org_managers_read_mandates on public.ps_locum_payment_mandates;
create policy org_members_manage_mandates on public.ps_locum_payment_mandates for all using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));
drop policy if exists org_managers_read_invoices on public.ps_locum_invoices;
create policy org_members_read_invoices on public.ps_locum_invoices for select using (org_id in (select ps_get_user_org_ids()));
drop policy if exists org_managers_read_invoice_lines on public.ps_locum_invoice_lines;
create policy org_members_read_invoice_lines on public.ps_locum_invoice_lines for select
  using (invoice_id in (select id from ps_locum_invoices where org_id in (select ps_get_user_org_ids())));
drop policy if exists org_managers_read_payment_weeks on public.ps_locum_payment_weeks;
create policy org_members_read_payment_weeks on public.ps_locum_payment_weeks for select using (org_id in (select ps_get_user_org_ids()));
drop policy if exists org_managers_read_payments on public.ps_locum_payments;
create policy org_members_read_payments on public.ps_locum_payments for select using (org_id in (select ps_get_user_org_ids()));

-- SOPs and sign-offs
drop policy if exists locum_read_booked_org_sops on public.ps_locum_sop_documents;
drop policy if exists org_members_read_sop_documents on public.ps_locum_sop_documents;
drop policy if exists org_managers_manage_sop_documents on public.ps_locum_sop_documents;
create policy authenticated_read_active_sops on public.ps_locum_sop_documents for select using (auth.role() = 'authenticated' and is_active = true);
create policy org_members_crud_sop_documents on public.ps_locum_sop_documents for all using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));
drop policy if exists locum_read_own_signoffs on public.ps_locum_sop_signoffs;
drop policy if exists locum_insert_own_signoffs on public.ps_locum_sop_signoffs;
create policy locum_crud_own_signoffs on public.ps_locum_sop_signoffs for all using (locum_id = ps_get_my_locum_id()) with check (locum_id = ps_get_my_locum_id());

-- Storage
drop policy if exists sop_pdfs_select_scoped on storage.objects;
drop policy if exists sop_pdfs_insert_scoped on storage.objects;
drop policy if exists sop_pdfs_update_scoped on storage.objects;
drop policy if exists sop_pdfs_delete_scoped on storage.objects;
create policy sop_pdfs_select_authenticated on storage.objects for select to authenticated using (bucket_id = 'sop-pdfs');
create policy sop_pdfs_insert_authenticated on storage.objects for insert to authenticated with check (bucket_id = 'sop-pdfs');
create policy sop_pdfs_update_authenticated on storage.objects for update to authenticated using (bucket_id = 'sop-pdfs');
create policy sop_pdfs_delete_authenticated on storage.objects for delete to authenticated using (bucket_id = 'sop-pdfs');
drop policy if exists locum_documents_select_org_managers on storage.objects;

-- New functions
drop function if exists public.ps_org_review_booking(uuid, text, text);
drop function if exists public.ps_org_cancel_shift(uuid, text);
drop function if exists public.ps_org_mark_booking(uuid, text);
drop function if exists public.ps_org_shift_locums(uuid, uuid[]);
drop function if exists public.ps_locum_sign_in(uuid);
drop function if exists public.ps_locum_sign_out(uuid);
drop function if exists public.ps_can_write_sop_pdf(text);
drop function if exists public.ps_sop_pdf_org(text);
drop function if exists public.ps_org_can_view_locum_user(text);
drop function if exists public.ps_org_can_view_locum(uuid);
-- ps_locum_book_shift uses these three, so they stay:
--   ps_locum_shift_window, ps_locum_expired_items, ps_locum_has_booking_at
drop function if exists public.ps_can_manage_locums(uuid);

commit;
