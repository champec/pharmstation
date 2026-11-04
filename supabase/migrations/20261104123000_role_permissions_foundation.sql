-- Staff roles: database foundation and pharmacy settings
--
-- 1. ps_role_default_permission now knows EVERY permission, not only the CD
--    ones. Values are generated from DEFAULT_ROLE_PERMISSIONS in
--    packages/types/src/index.ts. If you change one, change the other.
--    The CD values are unchanged from the CD register migration (PR #18).
--    Owners and managers now also default to patient_returns_write, matching
--    the user's decision that they can write CD entries.
--    ps_member_has_permission(org, permission) (role default + per-member
--    override) is what policies and functions should call.
--
-- 2. Pharmacy details (ps_organisations) can only be changed by a signed-in
--    staff member with org_settings (owners by default). Before this, only the
--    shared pharmacy login could change them, so anyone who knew the counter
--    password could, and the NHS settings tab (which saves with the staff
--    session) silently saved nothing. ps_organisations_guard still blocks
--    verification, plan, owner-link and type changes.
--
-- Rollback: supabase/rollbacks/rollback_20261104123000_role_permissions_foundation.sql

begin;

create or replace function public.ps_role_default_permission(p_role text, p_permission text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce((
    case p_role
      when 'owner' then '{"cd_register_read":true,"cd_register_write":true,"patient_returns_write":true,"rp_log_sign":true,"rp_log_view":true,"sop_upload":true,"handover_all":true,"manage_users":true,"approve_locums":true,"view_audit":true,"ai_scan_use":true,"org_settings":true,"billing":true,"delivery_manage":true,"delivery_drive":true,"care_home_view":true,"care_home_manage":true,"care_home_medications":true,"care_home_requests":true,"care_home_mar_prepare":true,"care_home_mar_administer":true}'
      when 'manager' then '{"cd_register_read":true,"cd_register_write":true,"patient_returns_write":true,"rp_log_view":true,"sop_upload":true,"handover_all":true,"manage_users":true,"approve_locums":true,"view_audit":true,"ai_scan_use":true,"delivery_manage":true,"delivery_drive":true,"care_home_view":true,"care_home_manage":true,"care_home_medications":true,"care_home_requests":true,"care_home_mar_prepare":true,"care_home_mar_administer":true}'
      when 'pharmacist' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":true,"rp_log_sign":true,"rp_log_view":true,"patient_returns_write":true,"handover_all":true,"ai_scan_use":true,"delivery_manage":true,"care_home_view":true,"care_home_manage":true,"care_home_medications":true,"care_home_requests":true,"care_home_mar_prepare":true,"care_home_mar_administer":true}'
      when 'technician' then '{"cd_register_read":true,"cd_register_write":true,"rp_log_view":true,"patient_returns_write":true,"handover_all":true,"ai_scan_use":true,"delivery_drive":true,"care_home_view":true,"care_home_medications":true,"care_home_requests":true,"care_home_mar_prepare":true}'
      when 'dispenser' then '{"rp_log_view":true,"handover_all":true,"delivery_drive":true,"care_home_view":true,"care_home_requests":true}'
      when 'locum' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":true,"rp_log_sign":true,"rp_log_view":true,"patient_returns_write":true,"handover_all":true,"ai_scan_use":true,"care_home_view":true,"care_home_medications":true,"care_home_requests":true,"care_home_mar_prepare":true}'
      when 'carehome_user' then '{"care_home_view":true,"care_home_requests":true,"care_home_mar_administer":true}'
      else '{}'
    end
  )::jsonb ->> p_permission, 'false')::boolean
$$;

drop policy if exists ps_orgs_update_own on public.ps_organisations;
drop policy if exists ps_orgs_update_staff on public.ps_organisations;
create policy ps_orgs_update_staff on public.ps_organisations
  for update to authenticated
  using (public.ps_member_has_permission(id, 'org_settings'))
  with check (public.ps_member_has_permission(id, 'org_settings'));

commit;
