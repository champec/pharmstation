-- Rollback for 20261104124500_two_step_sign_in.sql
begin;

create or replace function public.ps_is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ps_platform_admins where user_id = auth.uid())
$$;

create or replace function public.ps_org_manager_level(p_org_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when m.role = 'owner' then 'owner'
    when m.role = 'manager' and coalesce((m.permissions->>'manage_users')::boolean, true) then 'manager'
    when coalesce((m.permissions->>'manage_users')::boolean, false) then 'manager'
    else null
  end
  from ps_organisation_members m
  where m.organisation_id = p_org_id and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function public.ps_member_has_permission(p_organisation_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
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
$$;

drop function if exists public.ps_org_reset_member_mfa(uuid);
drop function if exists public.ps_platform_admin_needs_mfa();
drop function if exists public.ps_session_is_aal2();

commit;
