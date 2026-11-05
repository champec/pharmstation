-- Rollback for 20261105190000_genie_production_readiness.sql
-- Leaves the Claude Haiku 5.5 model row in place (harmless) but restores GLM
-- as the default standard model.

begin;

drop function if exists public.ps_genie_record_usage(uuid, integer, integer, boolean);
drop function if exists public.ps_genie_claim_message(uuid, uuid, integer, integer);
drop table if exists public.ps_ai_usage_monthly;

drop function if exists public.ps_admin_list_genie_patient_data();
drop function if exists public.ps_admin_set_genie_patient_data(uuid, boolean);
drop trigger if exists ps_ai_org_settings_guard on public.ps_ai_org_settings;
drop function if exists public.ps_ai_org_settings_guard();
alter table public.ps_ai_org_settings
  drop column if exists genie_patient_data_changed_at,
  drop column if exists genie_patient_data_changed_by,
  drop column if exists genie_patient_data;

update public.ps_ai_models
set is_default = (provider = 'openrouter' and model_id = 'z-ai/glm-5.2')
where model_type = 'standard';
alter table public.ps_ai_models drop column if exists genie_enabled;

commit;
