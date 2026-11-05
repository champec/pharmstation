-- Logs module, step 2 (run AFTER the web app from PR #32 is live).
-- Log entries become read-only to the app: every save, edit and removal goes
-- through ps_log_save_entry / ps_log_void_entry, so nothing is overwritten or
-- deleted and the author is always the signed-in user.
begin;
drop policy if exists org_members_crud_entries on public.ps_log_entries;
revoke all on public.ps_log_entries from anon;
revoke insert, update, delete, truncate on public.ps_log_entries from authenticated;
commit;
