-- PEPS: Phase 2 of /mnt/project-files/peps/production-readiness-plan.md
-- Make writing and dispensing reliable. Run AFTER 20261105160300_peps_phase1_access.sql.
-- Safe to run more than once.
--
-- 1. One server call writes a prescription: ps_peps_create_prescription(jsonb)
--    inserts the prescription, its items and its audit events in one transaction.
--    The server makes the reference (PX-XXXX-XXXXX, last character is a check
--    character), sets unique_code and expires_at, and checks the prescriber is
--    active, there is at least one item and any target pharmacy is verified.
--    Browsers can no longer insert prescriptions or items directly.
-- 2. Cancel: ps_peps_cancel(id, reason) for the prescriber (or a platform admin)
--    while the prescription is available or held. The holding pharmacy is notified.
-- 3. Expiry: expires_at = prescription date + 6 months (Phase 3 shortens this to
--    28 days for Schedule 2-4 CDs). Claim, download, dispense, release and transfer
--    refuse an expired prescription.
-- 4. Dispense records what was supplied (optional p_supplied jsonb) on the event.
-- 5. The prescriber can log CD evidence they attach just after writing.
begin;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.ps_peps_prescriptions
  add column if not exists expires_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancel_reason text;

update public.ps_peps_prescriptions
   set expires_at = (prescription_date + interval '6 months')::date + interval '1 day' - interval '1 second'
 where expires_at is null;

create index if not exists ps_peps_prescriptions_ref_upper on public.ps_peps_prescriptions (upper(prescription_ref));

-- ---------------------------------------------------------------------------
-- Reference generator: PX-XXXX-XXXXX, 31-character alphabet (no 0/O/1/I/L),
-- last character is a weighted check character so typos are caught.
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_new_ref()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea;
  body text;
  sum int;
  i int;
  ref text;
begin
  loop
    b := uuid_send(gen_random_uuid());
    body := '';
    for i in 0..7 loop
      body := body || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
    end loop;
    sum := 0;
    for i in 1..8 loop
      sum := sum + (position(substr(body, i, 1) in alphabet) - 1) * (i + 1);
    end loop;
    body := body || substr(alphabet, (sum % 31) + 1, 1);
    ref := 'PX-' || substr(body, 1, 4) || '-' || substr(body, 5, 5);
    exit when not exists (select 1 from ps_peps_prescriptions where upper(prescription_ref) = ref);
  end loop;
  return ref;
end;
$$;
revoke execute on function public.ps_peps_new_ref() from public, anon, authenticated;

create or replace function public.ps_peps_assert_not_expired(rx ps_peps_prescriptions)
returns void language plpgsql stable set search_path = public as $$
begin
  if rx.expires_at is not null and rx.expires_at < now() then
    raise exception 'This prescription expired on %', to_char(rx.expires_at, 'DD/MM/YYYY');
  end if;
end;
$$;
revoke execute on function public.ps_peps_assert_not_expired(ps_peps_prescriptions) from public, anon;

-- ---------------------------------------------------------------------------
-- 1. Create
-- Payload keys: patient_id, patient_snapshot, prescribing_org_id,
-- prescribing_org_snapshot, origin_org_id, prescription_type, animal_name,
-- animal_owner, cascade_wording, repeats, assigned_org_id,
-- items: [{drug_name, quantity, dosage, dmd_code, dmd_type, strength, form, notes}],
-- created_metadata: {...}   (controlled-drug declaration etc.)
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
  v_item jsonb;
  v_n int := 0;
begin
  select * into pr from ps_peps_prescribers where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Your prescriber account is not active'; end if;

  if v_assigned is not null and not ps_org_is_verified(v_assigned) then
    raise exception 'Prescriptions can only be sent to a verified pharmacy';
  end if;
  -- origin org is just a label; only record it if the prescriber belongs to it
  if v_origin is not null and not exists (select 1 from ps_get_user_org_ids() x where x = v_origin) then
    v_origin := null;
  end if;
  if v_repeats < 0 or v_repeats > 6 then raise exception 'Repeats must be between 0 and 6'; end if;
  if jsonb_typeof(p->'items') <> 'array' then raise exception 'Add at least one item'; end if;
  if not exists (
    select 1 from jsonb_array_elements(p->'items') it
    where length(trim(coalesce(it->>'drug_name', ''))) > 0 and length(trim(coalesce(it->>'quantity', ''))) > 0
  ) then
    raise exception 'Add at least one item with a drug name and quantity';
  end if;
  if length(trim(coalesce(p->'patient_snapshot'->>'full_name', ''))) < 2 then
    raise exception 'Enter the patient''s name';
  end if;

  v_ref := ps_peps_new_ref();

  insert into ps_peps_prescriptions (
    prescription_ref, unique_code, prescriber_id, prescriber_snapshot, written_by, origin_org_id,
    patient_id, patient_snapshot, prescribing_org_id, prescribing_org_snapshot, prescription_type,
    animal_name, animal_owner, cascade_wording, repeats, signature_data, status, assigned_org_id,
    prescription_date, expires_at
  ) values (
    v_ref, v_ref, pr.id,
    jsonb_build_object('full_name', pr.full_name, 'prescriber_type', pr.prescriber_type,
      'registration_number', pr.registration_number, 'registration_body', pr.registration_body,
      'address', pr.address),
    auth.uid(), v_origin,
    nullif(p->>'patient_id', '')::uuid, coalesce(p->'patient_snapshot', '{}'::jsonb),
    nullif(p->>'prescribing_org_id', '')::uuid, coalesce(p->'prescribing_org_snapshot', '{}'::jsonb),
    v_type,
    case when v_type = 'vet' then nullif(trim(p->>'animal_name'), '') end,
    case when v_type = 'vet' then nullif(trim(p->>'animal_owner'), '') end,
    case when v_type = 'vet' then nullif(p->>'cascade_wording', '') end,
    v_repeats, pr.signature_data, 'available', v_assigned,
    current_date, (current_date + interval '6 months')::date + interval '1 day' - interval '1 second'
  ) returning * into rx;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    continue when length(trim(coalesce(v_item->>'drug_name', ''))) = 0 or length(trim(coalesce(v_item->>'quantity', ''))) = 0;
    insert into ps_peps_prescription_items (prescription_id, line_order, dmd_code, dmd_type, drug_name,
      strength, form, quantity, dosage, notes)
    values (rx.id, v_n, nullif(v_item->>'dmd_code', ''),
      coalesce(nullif(v_item->>'dmd_type', ''), 'free_text'), trim(v_item->>'drug_name'),
      nullif(v_item->>'strength', ''), nullif(v_item->>'form', ''), trim(v_item->>'quantity'),
      nullif(trim(coalesce(v_item->>'dosage', '')), ''), nullif(v_item->>'notes', ''));
    v_n := v_n + 1;
  end loop;

  insert into ps_peps_events (prescription_id, event_type, to_org_id, actor_user_id, metadata)
  values (rx.id, 'created', null, auth.uid(), coalesce(p->'created_metadata', '{}'::jsonb));
  insert into ps_peps_events (prescription_id, event_type, to_org_id, actor_user_id)
  values (rx.id, case when v_assigned is null then 'sent_to_spine' else 'directed' end, v_assigned, auth.uid());

  return rx;
end;
$$;
revoke execute on function public.ps_peps_create_prescription(jsonb) from public, anon;
grant execute on function public.ps_peps_create_prescription(jsonb) to authenticated;

-- No more direct inserts from the browser.
drop policy if exists peps_rx_insert on public.ps_peps_prescriptions;
drop policy if exists peps_items_insert on public.ps_peps_prescription_items;
revoke insert, update, delete on public.ps_peps_prescriptions from anon, authenticated;
revoke insert, update, delete on public.ps_peps_prescription_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cancel
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_cancel(p_id uuid, p_reason text)
returns ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare rx ps_peps_prescriptions;
begin
  select * into rx from ps_peps_prescriptions where id = p_id for update;
  if not found then raise exception 'Prescription not found'; end if;
  if rx.written_by is distinct from auth.uid() and not ps_is_platform_admin() then
    raise exception 'Only the prescriber can cancel this prescription';
  end if;
  if rx.status not in ('available', 'held') then
    raise exception 'A % prescription cannot be cancelled', rx.status;
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for cancelling'; end if;

  update ps_peps_prescriptions
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_id;
  insert into ps_peps_events (prescription_id, event_type, from_org_id, actor_user_id, metadata)
  values (p_id, 'cancelled', rx.assigned_org_id, auth.uid(),
          jsonb_build_object('reason', trim(p_reason), 'remaining_issues', rx.repeats + 1 - rx.repeats_dispensed));

  if rx.assigned_org_id is not null then
    perform ps_fanout_notification(
      rx.assigned_org_id, 'peps', 'Private prescription cancelled',
      'Rx ' || rx.prescription_ref || ' was cancelled by the prescriber. Do not dispense it.',
      '/peps/' || rx.id::text, jsonb_build_object('prescription_id', rx.id));
  end if;

  select * into rx from ps_peps_prescriptions where id = p_id;
  return rx;
end;
$$;
revoke execute on function public.ps_peps_cancel(uuid, text) from public, anon;
grant execute on function public.ps_peps_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3/4. Expiry checks on every move, and a supply record on dispense
-- ---------------------------------------------------------------------------
drop function if exists public.ps_peps_dispense(uuid);
create or replace function public.ps_peps_dispense(p_id uuid, p_supplied jsonb default null)
returns ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare rx ps_peps_prescriptions; total_issues integer;
begin
  select * into rx from ps_peps_prescriptions where id = p_id for update;
  if not found then raise exception 'Prescription not found'; end if;
  if rx.status <> 'held' then raise exception 'Only held prescriptions can be dispensed'; end if;
  perform ps_peps_assert_member(rx.assigned_org_id);
  perform ps_peps_assert_not_expired(rx);
  total_issues := rx.repeats + 1;
  update ps_peps_prescriptions
     set repeats_dispensed = rx.repeats_dispensed + 1, dispensed_at = now(), dispensed_by = auth.uid(),
         status = case when rx.repeats_dispensed + 1 >= total_issues then 'dispensed' else 'held' end
   where id = p_id;
  insert into ps_peps_events (prescription_id, event_type, from_org_id, actor_user_id, metadata)
  values (p_id, 'dispensed', rx.assigned_org_id, auth.uid(),
          jsonb_build_object('issue', rx.repeats_dispensed + 1, 'of', total_issues)
          || case when p_supplied is not null then jsonb_build_object('supplied', p_supplied) else '{}'::jsonb end);
  select * into rx from ps_peps_prescriptions where id = p_id;
  return rx;
end;
$$;
revoke execute on function public.ps_peps_dispense(uuid, jsonb) from public, anon;
grant execute on function public.ps_peps_dispense(uuid, jsonb) to authenticated;

create or replace function public.ps_peps_release(p_id uuid)
returns ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare rx ps_peps_prescriptions;
begin
  select * into rx from ps_peps_prescriptions where id = p_id for update;
  if not found then raise exception 'Prescription not found'; end if;
  if rx.status <> 'held' then raise exception 'Only held prescriptions can be released'; end if;
  perform ps_peps_assert_member(rx.assigned_org_id);
  perform ps_peps_assert_not_expired(rx);
  update ps_peps_prescriptions set status = 'available', assigned_org_id = null, downloaded_at = null where id = p_id;
  insert into ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id)
  values (p_id, 'released', rx.assigned_org_id, null, auth.uid());
  select * into rx from ps_peps_prescriptions where id = p_id;
  return rx;
end;
$$;

create or replace function public.ps_peps_transfer(p_id uuid, p_to_org_id uuid)
returns ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare rx ps_peps_prescriptions;
begin
  select * into rx from ps_peps_prescriptions where id = p_id for update;
  if not found then raise exception 'Prescription not found'; end if;
  if rx.status <> 'held' then raise exception 'Only held prescriptions can be transferred'; end if;
  perform ps_peps_assert_member(rx.assigned_org_id);
  perform ps_peps_assert_not_expired(rx);
  if p_to_org_id is null or not ps_org_is_verified(p_to_org_id) then
    raise exception 'Prescriptions can only be transferred to a verified pharmacy';
  end if;
  if p_to_org_id = rx.assigned_org_id then raise exception 'Already held by this pharmacy'; end if;
  update ps_peps_prescriptions set status = 'available', assigned_org_id = p_to_org_id, downloaded_at = null where id = p_id;
  insert into ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id)
  values (p_id, 'transferred', rx.assigned_org_id, p_to_org_id, auth.uid());
  select * into rx from ps_peps_prescriptions where id = p_id;
  return rx;
end;
$$;

create or replace function public.ps_peps_download(p_org_id uuid, p_ids uuid[] default null)
returns setof ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare r ps_peps_prescriptions;
begin
  perform ps_peps_assert_member(p_org_id);
  for r in
    select * from ps_peps_prescriptions
    where status = 'available' and assigned_org_id = p_org_id and (p_ids is null or id = any(p_ids))
      and (expires_at is null or expires_at >= now())
    for update
  loop
    update ps_peps_prescriptions set status = 'held', downloaded_at = now() where id = r.id;
    insert into ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id)
    values (r.id, 'downloaded', r.assigned_org_id, p_org_id, auth.uid());
    return query select * from ps_peps_prescriptions where id = r.id;
  end loop;
end;
$$;

-- Claim: same as phase 1, plus expiry (an expired match counts as no match).
create or replace function public.ps_peps_claim(p_org_id uuid, p_ref text, p_check text)
returns ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare
  rx ps_peps_prescriptions;
  v_check text := lower(trim(coalesce(p_check, '')));
  v_date date;
  v_surname text;
  v_ok boolean := false;
begin
  perform ps_peps_assert_member(p_org_id);

  if (select count(*) from ps_peps_claim_attempts
      where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many failed attempts. Try again in an hour.';
  end if;

  if length(trim(coalesce(p_ref, ''))) < 6 or length(v_check) < 2 then
    raise exception 'Enter the prescription reference and the patient''s surname or date of birth';
  end if;

  select * into rx from ps_peps_prescriptions
  where upper(prescription_ref) = upper(trim(p_ref))
  for update;

  if found and rx.status = 'available' and rx.assigned_org_id is null
     and (rx.expires_at is null or rx.expires_at >= now()) then
    v_surname := lower(trim(coalesce(
      nullif(rx.patient_snapshot->>'last_name', ''),
      regexp_replace(trim(coalesce(rx.patient_snapshot->>'full_name', '')), '^.*\s', '')
    )));
    begin
      v_date := case
        when v_check ~ '^\d{4}-\d{2}-\d{2}$' then v_check::date
        when v_check ~ '^\d{1,2}/\d{1,2}/\d{4}$' then to_date(v_check, 'DD/MM/YYYY')
        else null end;
    exception when others then v_date := null;
    end;
    v_ok := (v_surname <> '' and v_surname = v_check)
         or (v_date is not null and coalesce(rx.patient_snapshot->>'dob', '') <> ''
             and left(rx.patient_snapshot->>'dob', 10) = to_char(v_date, 'YYYY-MM-DD'));
  end if;

  if not v_ok then
    insert into ps_peps_claim_attempts (user_id, org_id, ref) values (auth.uid(), p_org_id, left(p_ref, 32));
    return null;
  end if;

  update ps_peps_prescriptions
     set status = 'held', assigned_org_id = p_org_id, downloaded_at = now()
   where id = rx.id;
  insert into ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id)
  values (rx.id, 'claimed', null, p_org_id, auth.uid());
  select * into rx from ps_peps_prescriptions where id = rx.id;
  return rx;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Event logging: the prescriber may also log CD evidence within an hour of writing.
-- 'created', 'sent_to_spine' and 'directed' are now written by the create RPC.
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_log_event(p_id uuid, p_event_type text, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare rx ps_peps_prescriptions;
begin
  select * into rx from ps_peps_prescriptions where id = p_id;
  if not found then raise exception 'Prescription not found'; end if;

  if p_event_type = 'cd_evidence_attached' and rx.written_by = auth.uid() then
    if rx.created_at < now() - interval '1 hour' then raise exception 'Too late to record this event'; end if;
    insert into ps_peps_events (prescription_id, event_type, actor_user_id, metadata)
    values (p_id, p_event_type, auth.uid(), coalesce(p_metadata, '{}'::jsonb) || '{"source":"prescriber"}'::jsonb);
  elsif p_event_type in ('printed', 'cd_evidence_attached') then
    perform ps_peps_assert_member(rx.assigned_org_id);
    insert into ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id, metadata)
    values (p_id, p_event_type, rx.assigned_org_id, rx.assigned_org_id, auth.uid(), coalesce(p_metadata, '{}'::jsonb));
  else
    raise exception 'Event type % cannot be recorded from the app', p_event_type;
  end if;
end;
$$;

revoke execute on function public.ps_peps_release(uuid) from public, anon;
revoke execute on function public.ps_peps_transfer(uuid, uuid) from public, anon;
revoke execute on function public.ps_peps_download(uuid, uuid[]) from public, anon;
revoke execute on function public.ps_peps_claim(uuid, text, text) from public, anon;
revoke execute on function public.ps_peps_log_event(uuid, text, jsonb) from public, anon;
grant execute on function public.ps_peps_release(uuid) to authenticated;
grant execute on function public.ps_peps_transfer(uuid, uuid) to authenticated;
grant execute on function public.ps_peps_download(uuid, uuid[]) to authenticated;
grant execute on function public.ps_peps_claim(uuid, text, text) to authenticated;
grant execute on function public.ps_peps_log_event(uuid, text, jsonb) to authenticated;

commit;
