-- Rollback for 20261104131500_locum_shift_access.sql
-- Revokes any shift access still open, then removes the feature.
begin;
select cron.unschedule('ps-expire-shift-access');
update public.ps_organisation_members set status = 'revoked'
 where access_expires_at is not null and status = 'active';
drop function if exists public.ps_expire_shift_access();
drop function if exists public.ps_locum_claim_shift_access(uuid);
-- The two columns are left in place (harmless, and keep the history).
commit;
