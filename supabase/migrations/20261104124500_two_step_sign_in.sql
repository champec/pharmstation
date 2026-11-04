-- Two-step sign-in (authenticator app) for powerful accounts
--
-- Run AFTER 20261104123000_role_permissions_foundation.sql and after the
-- web app with two-step sign-in is deployed (owners and managers are asked
-- to set it up the next time they sign in).
--
-- A session that entered its authenticator code has aal = 'aal2' in its JWT.
--
-- 1. Platform admin powers need aal2. ps_platform_admin_needs_mfa() lets the
--    app tell an admin to turn it on.
-- 2. Staff management (ps_org_manager_level) and the sensitive permissions
--    manage_users, org_settings, billing, approve_locums and view_audit need
--    aal2. Everyday work (registers, deliveries, patients) does not, so staff
--    without an authenticator app are unaffected.
-- 3. ps_org_reset_member_mfa(member) lets an owner or manager remove a staff
--    member's authenticator app when they lose their phone. Only an owner
--    can reset another owner or a manager.
--
-- Rollback: supabase/rollbacks/rollback_20261104124500_two_step_sign_in.sql

begin;

create or replace function public.ps_session_is_aal2()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;
grant execute on function public.ps_session_is_aal2() to authenticated, service_role;

-- 1. Platform admin -----------------------------------------------------------
create or replace function public.ps_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ps_session_is_aal2()
     and exists (select 1 from ps_platform_admins where user_id = auth.uid())
$$;

create or replace function public.ps_platform_admin_needs_mfa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.ps_session_is_aal2()
     and exists (select 1 from ps_platform_admins where user_id = auth.uid())
$$;
revoke all on function public.ps_platform_admin_needs_mfa() from public, anon;
grant execute on function public.ps_platform_admin_needs_mfa() to authenticated;

-- 2. Staff management and sensitive permissions -----------------------------
create or replace function public.ps_org_manager_level(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.ps_session_is_aal2() then null
    when m.role = 'owner' then 'owner'
    when m.role = 'manager' and coalesce((m.permissions->>'manage_users')::boolean, true) then 'manager'
    when coalesce((m.permissions->>'manage_users')::boolean, false) then 'manager'
    else null
  end
  from ps_organisation_members m
  where m.organisation_id = p_org_id and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function public.ps_member_has_permission(p_organisation_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_permission in ('manage_users', 'org_settings', 'billing', 'approve_locums', 'view_audit')
         and not public.ps_session_is_aal2() then false
    else coalesce((
      select case
        when jsonb_typeof(m.permissions -> p_permission) = 'boolean'
          then (m.permissions ->> p_permission)::boolean
        else ps_role_default_permission(m.role, p_permission)
      end
      from ps_organisation_members m
      where m.organisation_id = p_organisation_id
        and m.user_id = auth.uid()
        and m.status = 'active'
      limit 1
    ), false)
  end
$$;

-- 3. Reset a staff member's authenticator app --------------------------------
create or replace function public.ps_org_reset_member_mfa(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_m ps_organisation_members%rowtype;
  v_level text;
begin
  select * into v_m from ps_organisation_members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;
  v_level := ps_org_manager_level(v_m.organisation_id);
  if v_level is null then
    raise exception 'Only an owner or manager signed in with two-step sign-in can do this' using errcode = '42501';
  end if;
  if v_m.user_id = auth.uid() then
    raise exception 'You can''t reset your own two-step sign-in. Ask another owner.' using errcode = '42501';
  end if;
  if v_level <> 'owner' and v_m.role in ('owner', 'manager') then
    raise exception 'Only an owner can reset an owner or manager' using errcode = '42501';
  end if;
  delete from auth.mfa_factors where user_id = v_m.user_id;
end;
$$;
revoke all on function public.ps_org_reset_member_mfa(uuid) from public, anon;
grant execute on function public.ps_org_reset_member_mfa(uuid) to authenticated;

commit;
