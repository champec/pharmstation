-- Logs: edit a custom log in place (9 Nov 2026, logs thread).
-- The builder's "Edit" used to save a brand new template, so the pharmacy
-- ended up with a copy and the old log kept its entries. This function
-- updates the pharmacy's own template and its fields in one go. Fields are
-- matched by field_key, so existing entries keep their values; a removed
-- field's past values stay in the entries (shown in history and exports).
-- Library templates can't be edited. Re-runnable.

create or replace function public.ps_log_update_template(p_template_id uuid, p_template jsonb, p_fields jsonb)
returns public.ps_log_templates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tpl ps_log_templates;
  v_field jsonb;
  v_keys text[] := '{}';
  v_i int := 0;
  v_key text;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select * into v_tpl from ps_log_templates where id = p_template_id for update;
  if not found or v_tpl.is_library or v_tpl.org_id is null
     or v_tpl.org_id not in (select ps_get_user_org_ids()) then
    raise exception 'You can only edit your pharmacy''s own logs' using errcode = '42501';
  end if;
  if coalesce(trim(p_template->>'title'), '') = '' then raise exception 'Give the log a name'; end if;
  if jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) = 0 then
    raise exception 'Add at least one field';
  end if;

  update ps_log_templates set
    title = left(trim(p_template->>'title'), 120),
    description = left(coalesce(p_template->>'description', ''), 500),
    category = coalesce(p_template->>'category', category),
    schedule_type = coalesce(p_template->>'schedule_type', schedule_type),
    required_days = case
      when coalesce(p_template->>'schedule_type', schedule_type) = 'sporadic' then '{}'::int[]
      else coalesce((select array_agg(x::int) from jsonb_array_elements_text(p_template->'required_days') x), required_days)
    end,
    version = version + 1
  where id = p_template_id
  returning * into v_tpl;

  for v_field in select * from jsonb_array_elements(p_fields) loop
    v_key := nullif(trim(v_field->>'field_key'), '');
    if v_key is null or coalesce(trim(v_field->>'label'), '') = '' then
      raise exception 'Every field needs a name';
    end if;
    if v_key = any(v_keys) then
      raise exception 'Two fields have the same name: %', v_field->>'label';
    end if;
    v_keys := v_keys || v_key;
    v_i := v_i + 1;
    update ps_log_fields set
      label = left(trim(v_field->>'label'), 120),
      field_type = coalesce(v_field->>'field_type', field_type),
      options = case when v_field ? 'options' and v_field->'options' <> 'null'::jsonb then v_field->'options' else null end,
      is_required = coalesce((v_field->>'is_required')::boolean, false),
      column_width = nullif(v_field->>'column_width', ''),
      display_order = v_i
    where template_id = p_template_id and field_key = v_key;
    if not found then
      insert into ps_log_fields (template_id, label, field_key, field_type, options, is_required, column_width, display_order)
      values (p_template_id, left(trim(v_field->>'label'), 120), v_key, coalesce(v_field->>'field_type', 'text'),
              case when v_field->'options' <> 'null'::jsonb then v_field->'options' else null end,
              coalesce((v_field->>'is_required')::boolean, false), nullif(v_field->>'column_width', ''), v_i);
    end if;
  end loop;

  -- Fields taken out of the log: remove them from the form (entries keep their values).
  delete from ps_log_fields where template_id = p_template_id and not (field_key = any(v_keys));

  return v_tpl;
end;
$$;

revoke all on function public.ps_log_update_template(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.ps_log_update_template(uuid, jsonb, jsonb) to authenticated;
