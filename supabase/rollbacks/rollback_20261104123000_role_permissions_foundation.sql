-- Rollback for 20261104123000_role_permissions_foundation.sql
begin;

create or replace function public.ps_role_default_permission(p_role text, p_permission text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce((
    case p_role
      when 'owner' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":false,"ai_scan_use":true}'
      when 'manager' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":false,"ai_scan_use":true}'
      when 'pharmacist' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":true,"ai_scan_use":true}'
      when 'technician' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":false,"ai_scan_use":true}'
      when 'locum' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":true,"ai_scan_use":true}'
      else '{}'
    end
  )::jsonb ->> p_permission, 'false')::boolean
$$;

drop policy if exists ps_orgs_update_staff on public.ps_organisations;
drop policy if exists ps_orgs_update_own on public.ps_organisations;
create policy ps_orgs_update_own on public.ps_organisations
  for update using (auth_user_id = auth.uid());

commit;
