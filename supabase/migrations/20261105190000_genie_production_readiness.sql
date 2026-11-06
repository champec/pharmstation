-- Genie production readiness
--
-- 1. Model allowlist: ps_ai_models.genie_enabled. Genie only uses models with
--    this flag. Claude Haiku 5.5 (via OpenRouter) becomes the only Genie model
--    and the default standard model. Other models are untouched (AI scan keeps
--    its own scan_model_id).
-- 2. Patient data switch: ps_ai_org_settings.genie_patient_data, off by
--    default. Only a PharmStation platform admin can turn it on or off
--    (ps_admin_set_genie_patient_data). While it is off, Genie never receives
--    patient names, prescriber names, register notes or staff emails.
-- 3. Monthly usage: ps_ai_usage_monthly (one row per pharmacy per month).
--    Staff can read their pharmacy's row; only the server writes it, through
--    ps_genie_claim_message (atomic cap + per-user rate limit) and
--    ps_genie_record_usage (tokens, refunds).
--
-- Rollback: supabase/rollbacks/rollback_20261105190000_genie_production_readiness.sql

begin;

-- 1. Model allowlist -------------------------------------------------------------
alter table public.ps_ai_models
  add column if not exists genie_enabled boolean not null default false;

comment on column public.ps_ai_models.genie_enabled is
  'Genie (ai-chat) only uses models with this flag set.';

insert into public.ps_ai_models (
  provider, model_id, display_name, model_type, capabilities, context_window,
  max_output_tokens, input_cost_per_1k, output_cost_per_1k, is_active,
  is_default, sort_order, genie_enabled
) values (
  'openrouter', 'anthropic/claude-haiku-5.5', 'Claude Haiku 5.5', 'standard',
  '["text", "function_calling", "streaming"]'::jsonb, 1000000,
  4096, 0.0001, 0.0005, true,
  false, 0, true
)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  model_type = excluded.model_type,
  capabilities = excluded.capabilities,
  input_cost_per_1k = excluded.input_cost_per_1k,
  output_cost_per_1k = excluded.output_cost_per_1k,
  is_active = true,
  genie_enabled = true,
  updated_at = now();

update public.ps_ai_models
set genie_enabled = (provider = 'openrouter' and model_id = 'anthropic/claude-haiku-5.5'),
    updated_at = now()
where genie_enabled is distinct from (provider = 'openrouter' and model_id = 'anthropic/claude-haiku-5.5');

update public.ps_ai_models
set is_default = (provider = 'openrouter' and model_id = 'anthropic/claude-haiku-5.5'),
    updated_at = now()
where model_type = 'standard'
  and is_default is distinct from (provider = 'openrouter' and model_id = 'anthropic/claude-haiku-5.5');

-- 2. Patient data switch -----------------------------------------------------------
alter table public.ps_ai_org_settings
  add column if not exists genie_patient_data boolean not null default false,
  add column if not exists genie_patient_data_changed_by uuid,
  add column if not exists genie_patient_data_changed_at timestamptz;

comment on column public.ps_ai_org_settings.genie_patient_data is
  'When true, Genie may send patient names and other patient data to the AI provider. Only platform admins can change it.';

-- Pharmacy staff can still edit their own AI settings, but not this switch.
create or replace function public.ps_ai_org_settings_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not ps_is_platform_admin() then
    if tg_op = 'INSERT' then
      if new.genie_patient_data then
        raise exception 'Only PharmStation admins can turn on patient data for Genie' using errcode = '42501';
      end if;
      new.genie_patient_data_changed_by := null;
      new.genie_patient_data_changed_at := null;
    else
      if new.genie_patient_data is distinct from old.genie_patient_data
         or new.genie_patient_data_changed_by is distinct from old.genie_patient_data_changed_by
         or new.genie_patient_data_changed_at is distinct from old.genie_patient_data_changed_at then
        raise exception 'Only PharmStation admins can change patient data for Genie' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ps_ai_org_settings_guard on public.ps_ai_org_settings;
create trigger ps_ai_org_settings_guard
  before insert or update on public.ps_ai_org_settings
  for each row execute function public.ps_ai_org_settings_guard();

create or replace function public.ps_admin_set_genie_patient_data(p_org_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not ps_is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from ps_organisations where id = p_org_id) then
    raise exception 'Pharmacy not found' using errcode = 'P0002';
  end if;

  insert into ps_ai_org_settings (organisation_id, genie_patient_data, genie_patient_data_changed_by, genie_patient_data_changed_at)
  values (p_org_id, p_enabled, auth.uid(), now())
  on conflict (organisation_id) do update set
    genie_patient_data = excluded.genie_patient_data,
    genie_patient_data_changed_by = excluded.genie_patient_data_changed_by,
    genie_patient_data_changed_at = excluded.genie_patient_data_changed_at,
    updated_at = now();
end;
$$;

create or replace function public.ps_admin_list_genie_patient_data()
returns table (organisation_id uuid, genie_patient_data boolean, changed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ps_is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
    select s.organisation_id, s.genie_patient_data, s.genie_patient_data_changed_at
    from ps_ai_org_settings s
    where s.genie_patient_data or s.genie_patient_data_changed_at is not null;
end;
$$;

revoke all on function public.ps_admin_set_genie_patient_data(uuid, boolean) from public, anon;
revoke all on function public.ps_admin_list_genie_patient_data() from public, anon;
grant execute on function public.ps_admin_set_genie_patient_data(uuid, boolean) to authenticated;
grant execute on function public.ps_admin_list_genie_patient_data() to authenticated;

-- 3. Monthly usage ------------------------------------------------------------------
create table if not exists public.ps_ai_usage_monthly (
  organisation_id uuid not null references public.ps_organisations(id) on delete cascade,
  month date not null,
  messages integer not null default 0 check (messages >= 0),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organisation_id, month)
);

comment on table public.ps_ai_usage_monthly is
  'Genie messages and tokens per pharmacy per month (UK calendar month). Written only by the ai-chat edge function.';

alter table public.ps_ai_usage_monthly enable row level security;

drop policy if exists ps_ai_usage_monthly_select on public.ps_ai_usage_monthly;
create policy ps_ai_usage_monthly_select on public.ps_ai_usage_monthly
  for select to authenticated
  using (organisation_id in (select ps_get_user_org_ids()));

revoke all on public.ps_ai_usage_monthly from anon;
revoke insert, update, delete, truncate on public.ps_ai_usage_monthly from authenticated;
grant select on public.ps_ai_usage_monthly to authenticated;
grant all on public.ps_ai_usage_monthly to service_role;

-- Atomically takes one message from this month's allowance, after checking the
-- per-user rate limit. Returns {allowed, reason, used, limit}.
create or replace function public.ps_genie_claim_message(
  p_organisation_id uuid,
  p_user_id uuid,
  p_monthly_limit integer,
  p_per_minute integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := (date_trunc('month', now() at time zone 'Europe/London'))::date;
  v_recent integer;
  v_used integer;
begin
  select count(*) into v_recent
  from ps_chat_messages m
  join ps_chat_conversations c on c.id = m.conversation_id
  where c.user_id = p_user_id
    and c.organisation_id = p_organisation_id
    and m.role = 'user'
    and m.created_at > now() - interval '1 minute';

  if v_recent >= p_per_minute then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited', 'used', null, 'limit', p_monthly_limit);
  end if;

  insert into ps_ai_usage_monthly (organisation_id, month)
  values (p_organisation_id, v_month)
  on conflict do nothing;

  update ps_ai_usage_monthly
  set messages = messages + 1, updated_at = now()
  where organisation_id = p_organisation_id
    and month = v_month
    and messages < p_monthly_limit
  returning messages into v_used;

  if v_used is null then
    select messages into v_used from ps_ai_usage_monthly
    where organisation_id = p_organisation_id and month = v_month;
    return jsonb_build_object('allowed', false, 'reason', 'monthly_limit', 'used', v_used, 'limit', p_monthly_limit);
  end if;

  return jsonb_build_object('allowed', true, 'reason', null, 'used', v_used, 'limit', p_monthly_limit);
end;
$$;

-- Adds tokens to this month's row. p_refund_message gives a message back when
-- Genie failed before answering.
create or replace function public.ps_genie_record_usage(
  p_organisation_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_refund_message boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := (date_trunc('month', now() at time zone 'Europe/London'))::date;
begin
  update ps_ai_usage_monthly
  set input_tokens = input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = output_tokens + greatest(coalesce(p_output_tokens, 0), 0),
      messages = case when p_refund_message then greatest(messages - 1, 0) else messages end,
      updated_at = now()
  where organisation_id = p_organisation_id and month = v_month;
end;
$$;

revoke all on function public.ps_genie_claim_message(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.ps_genie_record_usage(uuid, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.ps_genie_claim_message(uuid, uuid, integer, integer) to service_role;
grant execute on function public.ps_genie_record_usage(uuid, integer, integer, boolean) to service_role;

commit;
