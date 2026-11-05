-- PEPS: Phase 1 of /mnt/project-files/peps/production-readiness-plan.md
-- Close the data-exposure holes. Safe to run more than once.
--
-- Phase 0 (read-only check of London, 5 Nov 2026) found:
--   * peps_rx_read / peps_items_read / peps_events_read still let ANY signed-in
--     user (patients included) read every open-pool prescription.
--   * peps_prescribers_read was `true` (prescriber phone, email, signature open).
--   * The prescriber vetting guard (pen test C1) and the ps_admin_*_prescriber
--     RPCs were never applied, so prescribers can set themselves 'active' and the
--     /me/admin/prescribers page has no RPCs to call.
--
-- This migration:
--   1. Prescriber vetting: guard trigger + admin RPCs (from security/prescriber_approval.sql).
--   2. Only members of VERIFIED pharmacies can see or act on PEPS prescriptions.
--   3. The open pool can't be listed. A pharmacy claims an open prescription with
--      its reference plus the patient's surname or date of birth (ps_peps_claim),
--      with a limit of 10 failed attempts per user per hour (ps_peps_claim_attempts).
--      ps_peps_download only claims prescriptions directed to that pharmacy.
--   4. Spine search only matches an exact reference.
--   5. Audit events are written only by server functions. The browser calls
--      ps_peps_log_event for the few events it records (print, CD evidence,
--      write-time declaration), which checks who may log what.
--   6. Transfers and directed prescriptions can only target verified pharmacies.
begin;

-- ---------------------------------------------------------------------------
-- 1. Prescriber vetting (pen test C1)
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_prescribers_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- Trusted callers: service role, and the admin RPC below (runs as the function owner).
  if coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;

  new.status := old.status;
  new.approved_by := old.approved_by;
  new.approved_at := old.approved_at;
  if new.full_name is distinct from old.full_name
     or new.prescriber_type is distinct from old.prescriber_type
     or new.registration_number is distinct from old.registration_number
     or new.registration_body is distinct from old.registration_body
     or new.user_id is distinct from old.user_id then
    new.status := 'pending';
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists ps_peps_prescribers_guard on public.ps_peps_prescribers;
create trigger ps_peps_prescribers_guard
  before insert or update on public.ps_peps_prescribers
  for each row execute function public.ps_peps_prescribers_guard();

create or replace function public.ps_admin_list_prescribers(p_status text default 'pending')
returns table (id uuid, user_id uuid, full_name text, prescriber_type text, registration_number text,
               registration_body text, email text, phone text, status text, approved_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden'; end if;
  return query
    select p.id, p.user_id, p.full_name, p.prescriber_type::text, p.registration_number, p.registration_body,
           p.email, p.phone, p.status::text, p.approved_at, p.created_at
    from ps_peps_prescribers p
    where p_status is null or p.status::text = p_status
    order by p.created_at desc;
end;
$$;
revoke execute on function public.ps_admin_list_prescribers(text) from public, anon;
grant execute on function public.ps_admin_list_prescribers(text) to authenticated;

create or replace function public.ps_admin_set_prescriber_status(p_prescriber_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden'; end if;
  if p_status not in ('pending', 'active', 'suspended', 'revoked') then raise exception 'Invalid status'; end if;
  update ps_peps_prescribers
     set status = p_status,
         approved_by = case when p_status = 'active' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'active' then now() else approved_at end
   where id = p_prescriber_id;
  if not found then raise exception 'Prescriber not found'; end if;
end;
$$;
revoke execute on function public.ps_admin_set_prescriber_status(uuid, text) from public, anon;
grant execute on function public.ps_admin_set_prescriber_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Verified-pharmacy membership
-- ---------------------------------------------------------------------------
create or replace function public.ps_peps_user_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.organisation_id
  from ps_organisation_members m
  join ps_organisations o on o.id = m.organisation_id
  where m.user_id = auth.uid() and m.status = 'active' and o.verification_status = 'verified'
$$;
revoke execute on function public.ps_peps_user_org_ids() from public, anon;
grant execute on function public.ps_peps_user_org_ids() to authenticated, service_role;

-- Used by dispense / release / transfer / download / claim.
create or replace function public.ps_peps_assert_member(p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_org_id is null or not exists (select 1 from ps_peps_user_org_ids() x where x = p_org_id) then
    raise exception 'You must be an active member of a verified pharmacy to do this';
  end if;
end;
$$;
revoke execute on function public.ps_peps_assert_member(uuid) from public, anon;
grant execute on function public.ps_peps_assert_member(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Read policies: writer, or a verified pharmacy the prescription is assigned to.
--    The open pool (assigned_org_id is null) is no longer listable by anyone.
-- ---------------------------------------------------------------------------
drop policy if exists peps_rx_read on public.ps_peps_prescriptions;
create policy peps_rx_read on public.ps_peps_prescriptions for select to authenticated using (
  written_by = auth.uid() or assigned_org_id in (select ps_peps_user_org_ids())
);

drop policy if exists peps_items_read on public.ps_peps_prescription_items;
create policy peps_items_read on public.ps_peps_prescription_items for select to authenticated using (
  prescription_id in (
    select p.id from ps_peps_prescriptions p
    where p.written_by = auth.uid() or p.assigned_org_id in (select ps_peps_user_org_ids())
  )
);

drop policy if exists peps_events_read on public.ps_peps_events;
create policy peps_events_read on public.ps_peps_events for select to authenticated using (
  prescription_id in (
    select p.id from ps_peps_prescriptions p
    where p.written_by = auth.uid() or p.assigned_org_id in (select ps_peps_user_org_ids())
  )
  or from_org_id in (select ps_peps_user_org_ids())
  or to_org_id in (select ps_peps_user_org_ids())
);

-- Prescriber directory: yourself, or members of a verified pharmacy.
drop policy if exists peps_prescribers_read on public.ps_peps_prescribers;
create policy peps_prescribers_read on public.ps_peps_prescribers for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from ps_peps_user_org_ids())
);

-- Directed prescriptions may only target a verified pharmacy.
drop policy if exists peps_rx_insert on public.ps_peps_prescriptions;
create policy peps_rx_insert on public.ps_peps_prescriptions for insert to authenticated with check (
  written_by = auth.uid()
  and status = 'available'
  and prescriber_id in (select id from ps_peps_prescribers where user_id = auth.uid() and status = 'active')
  and (assigned_org_id is null or ps_org_is_verified(assigned_org_id))
);

-- ---------------------------------------------------------------------------
-- 4. Audit events: server-side only.
-- ---------------------------------------------------------------------------
drop policy if exists peps_events_insert on public.ps_peps_events;
revoke insert, update, delete on public.ps_peps_events from anon, authenticated;

alter table public.ps_peps_events drop constraint if exists ps_peps_events_event_type_check;
alter table public.ps_peps_events add constraint ps_peps_events_event_type_check check (event_type = any (array[
  'created', 'sent_to_spine', 'directed', 'downloaded', 'claimed', 'released', 'transferred',
  'dispensed', 'cancelled', 'printed', 'cd_evidence_attached'
]));

-- Browser-recorded events.
--   writer of the prescription:  created, sent_to_spine, directed (once each, within 1 hour of writing)
--   holding verified pharmacy:   printed, cd_evidence_attached
create or replace function public.ps_peps_log_event(p_id uuid, p_event_type text, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare rx ps_peps_prescriptions;
begin
  select * into rx from ps_peps_prescriptions where id = p_id;
  if not found then raise exception 'Prescription not found'; end if;

  if p_event_type in ('created', 'sent_to_spine', 'directed') then
    if rx.written_by is distinct from auth.uid() then raise exception 'Only the prescriber can record this'; end if;
    if rx.created_at < now() - interval '1 hour' then raise exception 'Too late to record this event'; end if;
    if exists (select 1 from ps_peps_events e where e.prescription_id = p_id and e.event_type = p_event_type) then
      raise exception 'Event already recorded';
    end if;
    insert into ps_peps_events (prescription_id, event_type, to_org_id, actor_user_id, metadata)
    values (p_id, p_event_type, rx.assigned_org_id, auth.uid(), coalesce(p_metadata, '{}'::jsonb));
  elsif p_event_type in ('printed', 'cd_evidence_attached') then
    perform ps_peps_assert_member(rx.assigned_org_id);
    insert into ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id, metadata)
    values (p_id, p_event_type, rx.assigned_org_id, rx.assigned_org_id, auth.uid(), coalesce(p_metadata, '{}'::jsonb));
  else
    raise exception 'Event type % cannot be recorded from the app', p_event_type;
  end if;
end;
$$;
revoke execute on function public.ps_peps_log_event(uuid, text, jsonb) from public, anon;
grant execute on function public.ps_peps_log_event(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Claiming and moving prescriptions
-- ---------------------------------------------------------------------------

-- Directed prescriptions only. Open-pool prescriptions need ps_peps_claim.
create or replace function public.ps_peps_download(p_org_id uuid, p_ids uuid[] default null)
returns setof ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare r ps_peps_prescriptions;
begin
  perform ps_peps_assert_member(p_org_id);
  for r in
    select * from ps_peps_prescriptions
    where status = 'available' and assigned_org_id = p_org_id and (p_ids is null or id = any(p_ids))
    for update
  loop
    update ps_peps_prescriptions set status = 'held', downloaded_at = now() where id = r.id;
    insert into ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id)
    values (r.id, 'downloaded', r.assigned_org_id, p_org_id, auth.uid());
    return query select * from ps_peps_prescriptions where id = r.id;
  end loop;
end;
$$;

-- Failed claim attempts, for rate limiting. Server-only.
create table if not exists public.ps_peps_claim_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  org_id uuid,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists ps_peps_claim_attempts_user_time on public.ps_peps_claim_attempts (user_id, created_at);
alter table public.ps_peps_claim_attempts enable row level security;
revoke all on public.ps_peps_claim_attempts from anon, authenticated;

-- Claim one open-pool prescription with its reference + patient surname or DOB.
-- p_check may be a surname (case-insensitive) or a date (YYYY-MM-DD or DD/MM/YYYY).
-- Returns the claimed prescription, or NULL if nothing matched (no exception, so the
-- failed attempt is kept for the rate limit). The caller can't tell whether the
-- reference exists.
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

  if found and rx.status = 'available' and rx.assigned_org_id is null then
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
revoke execute on function public.ps_peps_claim(uuid, text, text) from public, anon;
grant execute on function public.ps_peps_claim(uuid, text, text) to authenticated;

create or replace function public.ps_peps_transfer(p_id uuid, p_to_org_id uuid)
returns ps_peps_prescriptions language plpgsql security definer set search_path = public as $$
declare rx ps_peps_prescriptions;
begin
  select * into rx from ps_peps_prescriptions where id = p_id for update;
  if not found then raise exception 'Prescription not found'; end if;
  if rx.status <> 'held' then raise exception 'Only held prescriptions can be transferred'; end if;
  perform ps_peps_assert_member(rx.assigned_org_id);
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

-- Verified, active pharmacies only.
create or replace function public.ps_peps_pharmacy_search(p_query text)
returns table (id uuid, name text, ods_code text, address jsonb)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.ods_code, o.address
  from ps_organisations o
  where o.is_active = true
    and o.verification_status = 'verified'
    and length(trim(p_query)) >= 2
    and (o.name ilike '%' || p_query || '%' or o.ods_code ilike '%' || p_query || '%')
  order by o.name
  limit 12;
$$;

-- "Where is it?" by exact reference only, for verified pharmacy members.
create or replace function public.ps_peps_spine_search(p_query text)
returns table (id uuid, prescription_ref text, patient_name text, prescription_date date, status text, location text, is_open boolean)
language sql stable security definer set search_path = public as $$
  select rx.id, rx.prescription_ref,
    -- Patient name only when the caller's pharmacy holds it or wrote it.
    case when rx.assigned_org_id in (select ps_peps_user_org_ids()) or rx.written_by = auth.uid()
         then coalesce(rx.patient_snapshot->>'full_name', trim(concat(rx.patient_snapshot->>'first_name', ' ', rx.patient_snapshot->>'last_name')))
         else null end as patient_name,
    rx.prescription_date, rx.status,
    case when rx.status = 'available' and rx.assigned_org_id is null then 'Spine (unclaimed)'
         when rx.status = 'dispensed' then 'Dispensed'
         when rx.status = 'cancelled' then 'Cancelled'
         else coalesce(org.name, 'A pharmacy') end as location,
    (rx.status = 'available' and rx.assigned_org_id is null) as is_open
  from ps_peps_prescriptions rx
  left join ps_organisations org on org.id = rx.assigned_org_id
  where exists (select 1 from ps_peps_user_org_ids())
    and p_query is not null
    and upper(rx.prescription_ref) = upper(trim(p_query))
  limit 1;
$$;

revoke execute on function public.ps_peps_download(uuid, uuid[]) from public, anon;
revoke execute on function public.ps_peps_transfer(uuid, uuid) from public, anon;
revoke execute on function public.ps_peps_pharmacy_search(text) from public, anon;
revoke execute on function public.ps_peps_spine_search(text) from public, anon;
revoke execute on function public.ps_peps_dispense(uuid) from public, anon;
revoke execute on function public.ps_peps_release(uuid) from public, anon;
grant execute on function public.ps_peps_download(uuid, uuid[]) to authenticated;
grant execute on function public.ps_peps_transfer(uuid, uuid) to authenticated;
grant execute on function public.ps_peps_pharmacy_search(text) to authenticated;
grant execute on function public.ps_peps_spine_search(text) to authenticated;
grant execute on function public.ps_peps_dispense(uuid) to authenticated;
grant execute on function public.ps_peps_release(uuid) to authenticated;

commit;
