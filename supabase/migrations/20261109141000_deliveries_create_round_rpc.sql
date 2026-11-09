-- Deliveries: create a round with all its stops and medicines in one transaction.
-- Used by the mobile app (manager screens) and the website, so a dropped
-- connection can't leave a half-built round. SECURITY INVOKER: the caller's
-- RLS policies (delivery_manage) still decide whether each insert is allowed.
--
-- p_stops is a JSON array of
--   { "patient_id": uuid, "notes": text?, "address": { "line1","line2","city","postcode" }?,
--     "medications": [ { "patient_medication_id": uuid, "quantity": int? } ] }
create or replace function public.ps_delivery_create_round(
  p_org_id uuid,
  p_title text,
  p_scheduled_date date,
  p_time_start time,
  p_time_end time,
  p_notes text,
  p_driver_id uuid,
  p_stops jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_round_id uuid;
  v_stop jsonb;
  v_stop_id uuid;
  v_med jsonb;
  v_order int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.ps_member_has_permission(p_org_id, 'delivery_manage') then
    raise exception 'You do not have permission to create deliveries';
  end if;
  if p_time_start is not null and p_time_end is not null and p_time_end <= p_time_start then
    raise exception 'The end time must be after the start time';
  end if;

  insert into ps_delivery_rounds (organisation_id, title, status, scheduled_date,
    scheduled_time_start, scheduled_time_end, notes, created_by, driver_id)
  values (p_org_id, nullif(trim(p_title), ''),
    case when p_scheduled_date is null then 'draft' else 'scheduled' end,
    p_scheduled_date, p_time_start, p_time_end, nullif(trim(p_notes), ''), auth.uid(), p_driver_id)
  returning id into v_round_id;

  for v_stop in select * from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) loop
    v_order := v_order + 1;
    insert into ps_delivery_round_patients (round_id, patient_id, organisation_id, delivery_order,
      notes, delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_postcode)
    values (v_round_id, (v_stop->>'patient_id')::uuid, p_org_id, v_order,
      nullif(trim(v_stop->>'notes'), ''),
      nullif(trim(v_stop->'address'->>'line1'), ''),
      nullif(trim(v_stop->'address'->>'line2'), ''),
      nullif(trim(v_stop->'address'->>'city'), ''),
      nullif(trim(v_stop->'address'->>'postcode'), ''))
    returning id into v_stop_id;

    for v_med in select * from jsonb_array_elements(coalesce(v_stop->'medications', '[]'::jsonb)) loop
      insert into ps_delivery_patient_medications (delivery_round_patient_id, patient_medication_id, quantity)
      values (v_stop_id, (v_med->>'patient_medication_id')::uuid, nullif(v_med->>'quantity', '')::int);
    end loop;
  end loop;

  return v_round_id;
end;
$$;

revoke all on function public.ps_delivery_create_round(uuid, text, date, time, time, text, uuid, jsonb) from public, anon;
grant execute on function public.ps_delivery_create_round(uuid, text, date, time, time, text, uuid, jsonb) to authenticated;
