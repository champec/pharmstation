-- PEPS: Phase 3 of /mnt/project-files/peps/production-readiness-plan.md
-- Legal guardrails. Run AFTER 20261106090700_peps_phase2_reliability.sql.
-- Safe to run more than once.
--
-- 1. Required fields (Human Medicines Regulations 2012 reg 217/218):
--    human:  patient name, address and date of birth (age matters under 12)
--    vet:    animal name, owner name and owner address
--    every:  prescriber address (set in Prescriber setup)
-- 2. Controlled drugs worked out from dm+d, not a tick box:
--    - human prescriptions must use dm+d items (VMP/AMP)
--    - dm+d CD category 0001-0007 (Schedules 1, 2 and 3) is blocked: private
--      Sch 2/3 prescriptions must be on the paper FP10PCD form
--    - 0008/0009 (Schedule 4) -> expiry 28 days; 0010 (Schedule 5) -> 6 months
--    - vet free-text lines need an explicit "not a Schedule 1-3 CD" confirmation
--    - each item stores its cd_category
-- 3. Signing: the prescriber sets a 6-digit signing PIN (stored as a bcrypt hash
--    in a server-only table). Sending needs the PIN (5 wrong tries = 15 min lock).
--    The server stores a SHA-256 hash of the prescription content; anyone who can
--    see the prescription can check it with ps_peps_verify(id).
-- 4. A prescription from a suspended or revoked prescriber can't be claimed,
--    downloaded or dispensed, and pharmacies holding one are notified.
-- 5. ps_peps_dmd_search(p_query, p_include_cd) returns CD category too.
begin;

-- ---------------------------------------------------------------------------
-- Columns / tables
-- ---------------------------------------------------------------------------
alter table public.ps_peps_prescriptions
  add column if not exists content_hash text,
  add column if not exists signed_at timestamptz;
alter table public.ps_peps_prescription_items
  add column if not exists cd_category text;

create table if not exists public.ps_peps_signing_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.ps_peps_signing_keys enable row level security;
revoke all on public.ps_peps_signing_keys from anon, authenticated;

-- ---------------------------------------------------------------------------
-- dm+d search with CD category
-- ---------------------------------------------------------------------------
drop function if exists public.ps_peps_dmd_search(text);
drop function if exists public.ps_peps_dmd_search(text, boolean);
create or replace function public.ps_peps_dmd_search(p_query text, p_include_cd boolean default false)
returns table (code text, dmd_type text, name text, cd_category text)
language sql stable security definer set search_path = public as $$
  with q as (select trim(p_query) as term)
  select * from (
    select v.vpid as code, 'vmp'::text as dmd_type, v.nm as name, coalesce(v.cat_cd, '0000') as cd_category
    from dmd_vmp v, q
    where q.term <> '' and length(q.term) >= 2 and v.invalid is distinct from '1'
      and (p_include_cd or v.cat_cd is null or v.cat_cd = '0000')
      and v.nm ilike '%' || q.term || '%'
    union all
    select a.apid, 'amp'::text, a.nm, coalesce(av.cat_cd, '0000')
    from dmd_amp a join dmd_vmp av on av.vpid = a.vpid, q
    where q.term <> '' and length(q.term) >= 2 and a.invalid is distinct from '1'
      and (p_include_cd or av.cat_cd is null or av.cat_cd = '0000')
      and a.nm ilike '%' || q.term || '%'
  ) results
  order by (name ilike p_query || '%') desc, length(name), name
  limit 30;
$$;
revoke execute on function public.ps_peps_dmd_search(text, boolean) from public, anon;
grant execute on function public.ps_peps_dmd_search(text, boolean) to authenticated;

-- CD category for a dm+d code (VMP or AMP). NULL when the code is unknown.
create or replace function public.ps_peps_dmd_cd_category(p_code text, p_type text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(v.cat_cd, '0000')
  from dmd_vmp v
  where (p_type = 'vmp' and v.vpid = p_code)
     or (p_type = 'amp' and v.vpid = (select a.vpid from dmd_amp a where a.apid = p_code limit 1))
  limit 1
$$;
revoke execute on function public.ps_peps_dmd_cd_category(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signing PIN
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_has_signing_pin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ps_peps_signing_keys where user_id = auth.uid())
$$;
revoke execute on function public.ps_peps_has_signing_pin() from public, anon;
grant execute on function public.ps_peps_has_signing_pin() to authenticated;

-- Set the PIN the first time, or change it with the current PIN.
create or replace function public.ps_peps_set_signing_pin(p_new_pin text, p_current_pin text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k ps_peps_signing_keys;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from ps_peps_prescribers where user_id = auth.uid()) then
    raise exception 'Register as a prescriber first';
  end if;
  if coalesce(p_new_pin, '') !~ '^\d{6}$' then raise exception 'Your signing PIN must be 6 digits'; end if;
  if p_new_pin ~ '^(\d)\1{5}$' or p_new_pin in ('123456', '654321', '012345', '123123') then
    raise exception 'Choose a less obvious PIN';
  end if;
  select * into k from ps_peps_signing_keys where user_id = auth.uid() for update;
  if found then
    if k.locked_until is not null and k.locked_until > now() then
      raise exception 'Too many wrong PINs. Try again after %', to_char(k.locked_until, 'HH24:MI');
    end if;
    if p_current_pin is null or extensions.crypt(p_current_pin, k.pin_hash) <> k.pin_hash then
      raise exception 'Your current PIN is not right';
    end if;
    update ps_peps_signing_keys
       set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)), failed_count = 0,
           locked_until = null, updated_at = now()
     where user_id = auth.uid();
  else
    insert into ps_peps_signing_keys (user_id, pin_hash)
    values (auth.uid(), extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)));
  end if;
end;
$$;
revoke execute on function public.ps_peps_set_signing_pin(text, text) from public, anon;
grant execute on function public.ps_peps_set_signing_pin(text, text) to authenticated;

-- Platform admin: clear a forgotten PIN so the prescriber can set a new one.
create or replace function public.ps_admin_reset_signing_pin(p_prescriber_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden'; end if;
  delete from ps_peps_signing_keys
   where user_id = (select user_id from ps_peps_prescribers where id = p_prescriber_id);
end;
$$;
revoke execute on function public.ps_admin_reset_signing_pin(uuid) from public, anon;
grant execute on function public.ps_admin_reset_signing_pin(uuid) to authenticated;

-- Internal: check the caller's PIN. Records failures (the caller must not raise
-- afterwards, or the failure count is rolled back).
create or replace function public.ps_peps_check_pin(p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare k ps_peps_signing_keys;
begin
  select * into k from ps_peps_signing_keys where user_id = auth.uid() for update;
  if not found then return 'no_pin'; end if;
  if k.locked_until is not null and k.locked_until > now() then return 'locked'; end if;
  if p_pin is not null and extensions.crypt(p_pin, k.pin_hash) = k.pin_hash then
    update ps_peps_signing_keys set failed_count = 0, locked_until = null where user_id = auth.uid();
    return 'ok';
  end if;
  update ps_peps_signing_keys
     set locked_until = case when failed_count + 1 >= 5 then now() + interval '15 minutes' else null end,
         failed_count = case when failed_count + 1 >= 5 then 0 else failed_count + 1 end
   where user_id = auth.uid();
  return 'wrong';
end;
$$;
revoke execute on function public.ps_peps_check_pin(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Content hash (tamper evidence)
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_content_hash(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select encode(extensions.digest(jsonb_build_object(
      'ref', rx.prescription_ref,
      'date', rx.prescription_date,
      'type', rx.prescription_type,
      'prescriber_id', rx.prescriber_id,
      'prescriber', rx.prescriber_snapshot,
      'patient', rx.patient_snapshot,
      'prescribing_org', rx.prescribing_org_snapshot,
      'animal_name', rx.animal_name,
      'animal_owner', rx.animal_owner,
      'cascade', rx.cascade_wording,
      'repeats', rx.repeats,
      'expires_at', rx.expires_at,
      'signed_at', rx.signed_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line', i.line_order, 'dmd_code', i.dmd_code, 'dmd_type', i.dmd_type, 'drug', i.drug_name,
          'strength', i.strength, 'form', i.form, 'qty', i.quantity, 'dosage', i.dosage, 'notes', i.notes,
          'cd', i.cd_category) order by i.line_order)
        from ps_peps_prescription_items i where i.prescription_id = rx.id), '[]'::jsonb)
    )::text, 'sha256'), 'hex')
  from ps_peps_prescriptions rx where rx.id = p_id
$$;
revoke execute on function public.ps_peps_content_hash(uuid) from public, anon, authenticated;

-- Anyone who can see the prescription can check it hasn't changed since signing.
create or replace function public.ps_peps_verify(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rx ps_peps_prescriptions;
begin
  select * into rx from ps_peps_prescriptions where id = p_id;
  if not found then raise exception 'Prescription not found'; end if;
  if rx.written_by is distinct from auth.uid()
     and not (rx.assigned_org_id in (select ps_peps_user_org_ids()))
     and not ps_is_platform_admin() then
    raise exception 'Prescription not found';
  end if;
  if rx.content_hash is null then
    return jsonb_build_object('status', 'unsigned');
  end if;
  return jsonb_build_object(
    'status', case when ps_peps_content_hash(p_id) = rx.content_hash then 'verified' else 'altered' end,
    'signed_at', rx.signed_at,
    'prescriber_status', (select status from ps_peps_prescribers where id = rx.prescriber_id));
end;
$$;
revoke execute on function public.ps_peps_verify(uuid) from public, anon;
grant execute on function public.ps_peps_verify(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Create (replaces the Phase 2 version)
-- Extra payload keys: pin (6 digits), confirm_no_sch123 (boolean, needed for
-- any free-text item). Returns NULL when the PIN is wrong (failure is kept).
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_create_prescription(p jsonb)
returns ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare
  pr ps_peps_prescribers;
  rx ps_peps_prescriptions;
  v_ref text;
  v_assigned uuid := nullif(p->>'assigned_org_id', '')::uuid;
  v_origin uuid := nullif(p->>'origin_org_id', '')::uuid;
  v_type text := coalesce(nullif(p->>'prescription_type', ''), 'private');
  v_repeats int := coalesce((p->>'repeats')::int, 0);
  v_patient jsonb := coalesce(p->'patient_snapshot', '{}'::jsonb);
  v_item jsonb;
  v_n int := 0;
  v_cd text;
  v_dmd_type text;
  v_has_sch4 boolean := false;
  v_has_free_text boolean := false;
  v_pin text;
  v_dob date;
  v_expires timestamptz;
  v_signed timestamptz := now();
begin
  if v_type not in ('private', 'vet') then raise exception 'Unknown prescription type'; end if;

  select * into pr from ps_peps_prescribers where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Your prescriber account is not active'; end if;
  if length(trim(coalesce(pr.address, ''))) < 5 then
    raise exception 'Add your practice address in Prescriber setup before prescribing';
  end if;

  -- Validate everything before checking the PIN, so a wrong PIN is the only
  -- path that returns NULL.
  if v_assigned is not null and not ps_org_is_verified(v_assigned) then
    raise exception 'Prescriptions can only be sent to a verified pharmacy';
  end if;
  if v_origin is not null and not exists (select 1 from ps_get_user_org_ids() x where x = v_origin) then
    v_origin := null;
  end if;
  if v_repeats < 0 or v_repeats > 6 then raise exception 'Repeats must be between 0 and 6'; end if;

  if length(trim(coalesce(v_patient->>'full_name', ''))) < 2 then
    raise exception '%', case when v_type = 'vet' then 'Enter the owner''s name' else 'Enter the patient''s name' end;
  end if;
  if length(trim(coalesce(v_patient->>'address', ''))) < 5 then
    raise exception '%', case when v_type = 'vet' then 'Enter the owner''s address' else 'Enter the patient''s address' end;
  end if;
  if v_type = 'private' then
    begin
      v_dob := nullif(v_patient->>'dob', '')::date;
    exception when others then v_dob := null;
    end;
    if v_dob is null then raise exception 'Enter the patient''s date of birth'; end if;
    if v_dob > current_date or v_dob < current_date - interval '130 years' then
      raise exception 'Check the patient''s date of birth';
    end if;
  else
    if length(trim(coalesce(p->>'animal_name', ''))) < 1 then raise exception 'Enter the animal''s name'; end if;
  end if;

  if jsonb_typeof(p->'items') <> 'array' then raise exception 'Add at least one item'; end if;
  for v_item in select * from jsonb_array_elements(p->'items') loop
    continue when length(trim(coalesce(v_item->>'drug_name', ''))) = 0 and length(trim(coalesce(v_item->>'quantity', ''))) = 0;
    if length(trim(coalesce(v_item->>'drug_name', ''))) = 0 or length(trim(coalesce(v_item->>'quantity', ''))) = 0 then
      raise exception 'Every item needs a drug and a quantity';
    end if;
    v_dmd_type := coalesce(nullif(v_item->>'dmd_type', ''), 'free_text');
    if v_dmd_type in ('vmp', 'amp') and nullif(v_item->>'dmd_code', '') is not null then
      v_cd := ps_peps_dmd_cd_category(v_item->>'dmd_code', v_dmd_type);
      if v_cd is null then raise exception '% is not in the dm+d dictionary', v_item->>'drug_name'; end if;
      if v_cd in ('0001', '0002', '0003', '0004', '0005', '0006', '0007') then
        raise exception '% is a Schedule 1, 2 or 3 controlled drug. Private prescriptions for these must be written on the paper FP10PCD form.', v_item->>'drug_name';
      end if;
      if v_cd in ('0008', '0009') then v_has_sch4 := true; end if;
    else
      if v_type = 'private' then
        raise exception 'Choose % from the dm+d list. Free-text items are only allowed on veterinary prescriptions.', v_item->>'drug_name';
      end if;
      v_has_free_text := true;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Add at least one item with a drug name and quantity'; end if;
  if v_has_free_text and coalesce((p->>'confirm_no_sch123')::boolean, false) is not true then
    raise exception 'Confirm that no free-text item is a Schedule 1, 2 or 3 controlled drug';
  end if;

  -- PIN last: a wrong PIN returns NULL so its failure count is kept.
  v_pin := ps_peps_check_pin(p->>'pin');
  if v_pin = 'no_pin' then raise exception 'Set your signing PIN in Prescriber setup first'; end if;
  if v_pin = 'locked' then raise exception 'Too many wrong PINs. Try again in 15 minutes.'; end if;
  if v_pin <> 'ok' then return null; end if;

  v_expires := case when v_has_sch4
    then (current_date + 27) + interval '1 day' - interval '1 second'
    else (current_date + interval '6 months')::date + interval '1 day' - interval '1 second' end;
  v_ref := ps_peps_new_ref();

  insert into ps_peps_prescriptions (
    prescription_ref, unique_code, prescriber_id, prescriber_snapshot, written_by, origin_org_id,
    patient_id, patient_snapshot, prescribing_org_id, prescribing_org_snapshot, prescription_type,
    animal_name, animal_owner, cascade_wording, repeats, signature_data, status, assigned_org_id,
    prescription_date, expires_at, signed_at
  ) values (
    v_ref, v_ref, pr.id,
    jsonb_build_object('full_name', pr.full_name, 'prescriber_type', pr.prescriber_type,
      'registration_number', pr.registration_number, 'registration_body', pr.registration_body,
      'address', pr.address),
    auth.uid(), v_origin,
    nullif(p->>'patient_id', '')::uuid, v_patient,
    nullif(p->>'prescribing_org_id', '')::uuid, coalesce(p->'prescribing_org_snapshot', '{}'::jsonb),
    v_type,
    case when v_type = 'vet' then nullif(trim(p->>'animal_name'), '') end,
    case when v_type = 'vet' then coalesce(nullif(trim(p->>'animal_owner'), ''), v_patient->>'full_name') end,
    case when v_type = 'vet' then nullif(p->>'cascade_wording', '') end,
    v_repeats, pr.signature_data, 'available', v_assigned,
    current_date, v_expires, v_signed
  ) returning * into rx;

  v_n := 0;
  for v_item in select * from jsonb_array_elements(p->'items') loop
    continue when length(trim(coalesce(v_item->>'drug_name', ''))) = 0;
    v_dmd_type := coalesce(nullif(v_item->>'dmd_type', ''), 'free_text');
    insert into ps_peps_prescription_items (prescription_id, line_order, dmd_code, dmd_type, drug_name,
      strength, form, quantity, dosage, notes, cd_category)
    values (rx.id, v_n,
      case when v_dmd_type = 'free_text' then null else nullif(v_item->>'dmd_code', '') end,
      v_dmd_type, trim(v_item->>'drug_name'),
      nullif(v_item->>'strength', ''), nullif(v_item->>'form', ''), trim(v_item->>'quantity'),
      nullif(trim(coalesce(v_item->>'dosage', '')), ''), nullif(v_item->>'notes', ''),
      case when v_dmd_type = 'free_text' then null else ps_peps_dmd_cd_category(v_item->>'dmd_code', v_dmd_type) end);
    v_n := v_n + 1;
  end loop;

  update ps_peps_prescriptions set content_hash = ps_peps_content_hash(rx.id) where id = rx.id;

  insert into ps_peps_events (prescription_id, event_type, to_org_id, actor_user_id, metadata)
  values (rx.id, 'created', null, auth.uid(),
          coalesce(p->'created_metadata', '{}'::jsonb)
          || jsonb_build_object('signed_with_pin', true, 'schedule_4', v_has_sch4,
                                'confirm_no_sch123', coalesce((p->>'confirm_no_sch123')::boolean, false)));
  insert into ps_peps_events (prescription_id, event_type, to_org_id, actor_user_id)
  values (rx.id, case when v_assigned is null then 'sent_to_spine' else 'directed' end, v_assigned, auth.uid());

  select * into rx from ps_peps_prescriptions where id = rx.id;
  return rx;
end;
$$;
revoke execute on function public.ps_peps_create_prescription(jsonb) from public, anon;
grant execute on function public.ps_peps_create_prescription(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Suspended / revoked prescribers
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_prescription_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  -- Moving into a pharmacy's hands, or dispensing an issue
  if (new.status in ('held', 'dispensed') and new.status is distinct from old.status)
     or new.repeats_dispensed is distinct from old.repeats_dispensed then
    select status into v_status from ps_peps_prescribers where id = new.prescriber_id;
    if v_status in ('suspended', 'revoked') then
      raise exception 'The prescriber of % is %. Do not dispense it; contact the prescriber or the patient.',
        new.prescription_ref, v_status;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ps_peps_prescription_guard on public.ps_peps_prescriptions;
create trigger ps_peps_prescription_guard
  before update on public.ps_peps_prescriptions
  for each row execute function public.ps_peps_prescription_guard();

create or replace function public.ps_admin_set_prescriber_status(p_prescriber_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden'; end if;
  if p_status not in ('pending', 'active', 'suspended', 'revoked') then raise exception 'Invalid status'; end if;
  update ps_peps_prescribers
     set status = p_status,
         approved_by = case when p_status = 'active' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'active' then now() else approved_at end
   where id = p_prescriber_id;
  if not found then raise exception 'Prescriber not found'; end if;

  if p_status in ('suspended', 'revoked') then
    for r in
      select id, prescription_ref, assigned_org_id from ps_peps_prescriptions
      where prescriber_id = p_prescriber_id and status in ('available', 'held') and assigned_org_id is not null
    loop
      perform ps_fanout_notification(
        r.assigned_org_id, 'peps', 'Prescriber ' || p_status,
        'The prescriber of Rx ' || r.prescription_ref || ' has been ' || p_status || '. Do not dispense it.',
        '/peps/' || r.id::text, jsonb_build_object('prescription_id', r.id));
    end loop;
  end if;
end;
$$;
revoke execute on function public.ps_admin_set_prescriber_status(uuid, text) from public, anon;
grant execute on function public.ps_admin_set_prescriber_status(uuid, text) to authenticated;

-- Existing prescriptions: record their hash now so later changes are detectable.
update public.ps_peps_prescriptions
   set signed_at = coalesce(signed_at, created_at)
 where content_hash is null;
update public.ps_peps_prescriptions
   set content_hash = public.ps_peps_content_hash(id)
 where content_hash is null;

commit;
