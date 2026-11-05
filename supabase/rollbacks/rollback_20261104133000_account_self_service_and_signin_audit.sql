-- Rollback for 20261104133000_account_self_service_and_signin_audit.sql
-- Keeps the two tables (they hold history); removes triggers and functions.
begin;
drop trigger if exists ps_on_auth_user_email_changed on auth.users;
drop function if exists public.ps_sync_profile_email();
drop trigger if exists ps_audit_member_change on public.ps_organisation_members;
drop function if exists public.ps_audit_member_change();
drop function if exists public.ps_log_auth_event(uuid, text, text);
drop function if exists public.ps_org_list_auth_events(uuid, integer);
drop function if exists public.ps_request_account_deletion(text);
drop function if exists public.ps_cancel_account_deletion();
drop function if exists public.ps_admin_set_deletion_request(uuid, text, text);
commit;
