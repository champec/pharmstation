-- ============================================================
-- Appointments: secure public booking (production readiness, Phase 1)
--
-- Before: the public booking page inserted straight into ps_appointments as
-- anon. The INSERT policy only checked the service was public, so a crafted
-- request could book a paid service as 'confirmed' without paying, attach a
-- booking to any pharmacy, or use up any pharmacy's slots.
--
-- After: anon can no longer write appointments. Public bookings go through
-- the `appointments` edge function (Turnstile + client IP), which calls
-- ps_book_public_appointment() with the service role. That function checks
-- org/service/slot belong together, picks or creates the patient safely,
-- always saves 'pending', rate limits, and puts a payment hold on paid
-- bookings. pg_cron releases holds that were never paid.
--
-- Also: patient portal sign-up now links the account to a patient record,
-- patients can't move their record to another pharmacy, and paid services are
-- hidden from the public site until the pharmacy's Stripe account can take
-- payments.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Appointment columns
-- ------------------------------------------------------------
alter table public.ps_appointments
  add column if not exists hold_expires_at timestamptz,
  add column if not exists manage_token uuid not null default gen_random_uuid(),
  add column if not exists patient_review_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists source text not null default 'staff';

-- Video services: booking one creates a video consultation (Phase 2 wiring).
alter table public.ps_services
  add column if not exists is_video boolean not null default false;

do $$ begin
  alter table public.ps_appointments
    add constraint ps_appointments_cancelled_by_check
    check (cancelled_by is null or cancelled_by in ('patient', 'pharmacy', 'system'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ps_appointments
    add constraint ps_appointments_source_check
    check (source in ('staff', 'public', 'portal'));
exception when duplicate_object then null; end $$;

create unique index if not exists ps_appointments_manage_token_key
  on public.ps_appointments (manage_token);
create index if not exists ps_appointments_hold_idx
  on public.ps_appointments (hold_expires_at)
  where status = 'pending' and hold_expires_at is not null;

comment on column public.ps_appointments.hold_expires_at is
  'Set on unpaid bookings of paid services. pg_cron cancels the booking (freeing the slot) once this passes. Cleared when payment succeeds.';
comment on column public.ps_appointments.manage_token is
  'Secret for the patient''s manage link (/booking/manage/<token>). Never expose to other patients.';
comment on column public.ps_appointments.patient_review_reason is
  'Why staff should check which patient record this booking belongs to (e.g. NHS number matched but date of birth did not).';

-- Stamp cancelled_at whenever a booking becomes cancelled.
create or replace function public.ps_appointments_stamp_cancel()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, 'pharmacy');
    new.hold_expires_at := null;
  end if;
  return new;
end $$;

drop trigger if exists ps_appointments_stamp_cancel on public.ps_appointments;
create trigger ps_appointments_stamp_cancel
  before update of status on public.ps_appointments
  for each row execute function public.ps_appointments_stamp_cancel();

-- ------------------------------------------------------------
-- 2. Close the anon write path
-- ------------------------------------------------------------
drop policy if exists anon_insert_public_appointments on public.ps_appointments;
-- Patients now cancel through the edge function (ownership + refund rules).
drop policy if exists patients_cancel_own_appointments on public.ps_appointments;

revoke execute on function public.ps_public_find_or_create_patient(uuid, text, text, text, text, date, text)
  from anon, authenticated, public;

-- ------------------------------------------------------------
-- 3. Rate limiting for public bookings
-- ------------------------------------------------------------
create table if not exists public.ps_public_booking_attempts (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  ip text,
  phone_normalized text,
  email text,
  created_at timestamptz not null default now()
);
alter table public.ps_public_booking_attempts enable row level security;
-- No policies: only the service role (edge function) touches this table.
create index if not exists ps_public_booking_attempts_ip_idx on public.ps_public_booking_attempts (ip, created_at);
create index if not exists ps_public_booking_attempts_phone_idx on public.ps_public_booking_attempts (phone_normalized, created_at);
create index if not exists ps_public_booking_attempts_email_idx on public.ps_public_booking_attempts (email, created_at);

-- ------------------------------------------------------------
-- 4. Can this pharmacy take card payments?
-- ------------------------------------------------------------
create or replace function public.ps_org_can_take_payments(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select b.charges_enabled and b.stripe_account_id is not null
    from ps_org_billing b where b.org_id = p_org_id
  ), false)
$$;
revoke execute on function public.ps_org_can_take_payments(uuid) from public;
grant execute on function public.ps_org_can_take_payments(uuid) to anon, authenticated, service_role;

-- Hide paid services from the public site until the pharmacy can be paid.
-- (Slots follow automatically: their anon policy reads ps_services.)
drop policy if exists anon_read_public_services on public.ps_services;
create policy anon_read_public_services on public.ps_services
  for select using (
    is_public = true
    and is_active = true
    and org_id in (select id from ps_organisations where is_public = true)
    and (
      not is_chargeable
      or coalesce(price_pence, 0) <= 0
      or public.ps_org_can_take_payments(org_id)
    )
  );

-- ------------------------------------------------------------
-- 5. The booking function
-- ------------------------------------------------------------
create or replace function public.ps_book_public_appointment(
  p_org_id uuid,
  p_service_id uuid,
  p_slot_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text default null,
  p_phone text default null,
  p_dob date default null,
  p_nhs_number text default null,
  p_form_id uuid default null,
  p_form_data jsonb default null,
  p_notes text default null,
  p_ip text default null,
  p_auth_user_id uuid default null,
  p_hold_minutes integer default 40
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_service ps_services%rowtype;
  v_slot ps_appointment_slots%rowtype;
  v_first text := nullif(trim(coalesce(p_first_name, '')), '');
  v_last text := nullif(trim(coalesce(p_last_name, '')), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_phone_norm text := public.ps_normalize_phone(p_phone);
  v_nhs text := nullif(regexp_replace(coalesce(p_nhs_number, ''), '\s', '', 'g'), '');
  v_patient_id uuid;
  v_existing ps_patients%rowtype;
  v_review text;
  v_paid boolean;
  v_hold timestamptz;
  v_appt_id uuid := gen_random_uuid();
  v_token uuid;
  v_source text := case when p_auth_user_id is null then 'public' else 'portal' end;
begin
  -- Input
  if v_first is null or v_last is null then
    raise exception 'First and last name are required' using errcode = 'P0001';
  end if;
  if length(v_first) > 100 or length(v_last) > 100 then
    raise exception 'Name is too long' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone_norm is null then
    raise exception 'Please give a mobile number or email so the pharmacy can contact you' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Please check your email address' using errcode = 'P0001';
  end if;
  if v_nhs is not null and v_nhs !~ '^\d{10}$' then
    raise exception 'NHS number must be 10 digits' using errcode = 'P0001';
  end if;
  if p_dob is not null and (p_dob > current_date or p_dob < date '1900-01-01') then
    raise exception 'Please check your date of birth' using errcode = 'P0001';
  end if;
  if p_notes is not null and length(p_notes) > 2000 then
    raise exception 'Notes are too long' using errcode = 'P0001';
  end if;
  if p_form_data is not null and length(p_form_data::text) > 50000 then
    raise exception 'Form answers are too long' using errcode = 'P0001';
  end if;

  -- Rate limits (successful bookings in the last hour)
  if p_ip is not null and (select count(*) from ps_public_booking_attempts
      where ip = p_ip and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many bookings from this connection. Please try again later or call the pharmacy.' using errcode = 'P0002';
  end if;
  if v_phone_norm is not null and (select count(*) from ps_public_booking_attempts
      where phone_normalized = v_phone_norm and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many bookings for this phone number. Please try again later or call the pharmacy.' using errcode = 'P0002';
  end if;
  if v_email is not null and (select count(*) from ps_public_booking_attempts
      where email = v_email and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many bookings for this email. Please try again later or call the pharmacy.' using errcode = 'P0002';
  end if;

  -- Pharmacy, service and slot must all belong together
  if not exists (select 1 from ps_organisations
                 where id = p_org_id and is_public = true and coalesce(is_active, true)) then
    raise exception 'This pharmacy is not taking online bookings' using errcode = 'P0001';
  end if;

  select * into v_service from ps_services
  where id = p_service_id and org_id = p_org_id and is_public = true and is_active = true;
  if not found then
    raise exception 'This service is not available for online booking' using errcode = 'P0001';
  end if;

  select * into v_slot from ps_appointment_slots
  where id = p_slot_id and org_id = p_org_id and service_id = p_service_id and is_active = true
  for update;
  if not found then
    raise exception 'That time is no longer available. Please pick another.' using errcode = 'P0001';
  end if;
  if v_slot.start_time <= now() then
    raise exception 'That time has already passed. Please pick another.' using errcode = 'P0001';
  end if;
  if v_slot.booked_count >= v_slot.max_bookings then
    raise exception 'That time has just been taken. Please pick another.' using errcode = 'P0001';
  end if;

  v_paid := coalesce(v_service.is_chargeable, false) and coalesce(v_service.price_pence, 0) > 0;
  if v_paid and not public.ps_org_can_take_payments(p_org_id) then
    raise exception 'This pharmacy can''t take online payments yet. Please call them to book.' using errcode = 'P0001';
  end if;

  if p_form_id is not null and not exists (
    select 1 from ps_service_forms where id = p_form_id and service_id = p_service_id) then
    raise exception 'Form does not belong to this service' using errcode = 'P0001';
  end if;

  -- Patient
  if p_auth_user_id is not null then
    -- Signed-in portal patient: use (or create) their record at this pharmacy.
    select id into v_patient_id from ps_patients
    where auth_user_id = p_auth_user_id and organisation_id = p_org_id
    order by created_at limit 1;
  end if;

  if v_patient_id is null and v_nhs is not null then
    select * into v_existing from ps_patients
    where organisation_id = p_org_id and nhs_number = v_nhs limit 1;
    if found then
      if p_dob is not null and v_existing.dob = p_dob
         and lower(v_existing.last_name) = lower(v_last)
         and (v_existing.auth_user_id is null or v_existing.auth_user_id = p_auth_user_id) then
        v_patient_id := v_existing.id;
      else
        -- Don't attach the booking to someone else's record. Keep the NHS
        -- number off the new record (it's unique per pharmacy) and flag it.
        v_review := format(
          'NHS number %s was entered, which matches an existing patient, but the name or date of birth did not match. Check which patient this is and merge if needed.',
          v_nhs);
        v_nhs := null;
      end if;
    end if;
  end if;

  if v_patient_id is null and v_review is null and p_dob is not null then
    -- Same person booking again without an NHS number: exact name + DOB +
    -- contact match only.
    select id into v_patient_id from ps_patients
    where organisation_id = p_org_id
      and lower(first_name) = lower(v_first) and lower(last_name) = lower(v_last)
      and dob = p_dob
      and ((v_phone_norm is not null and phone_normalized = v_phone_norm)
           or (v_email is not null and lower(email) = v_email))
      and (auth_user_id is null or auth_user_id = p_auth_user_id)
    order by created_at limit 1;
  end if;

  if v_patient_id is null then
    insert into ps_patients (organisation_id, first_name, last_name, email, phone, dob, nhs_number, auth_user_id)
    values (p_org_id, v_first, v_last, v_email, v_phone, p_dob, v_nhs, p_auth_user_id)
    returning id into v_patient_id;
  else
    -- Fill gaps in contact details without overwriting what the pharmacy has.
    update ps_patients set
      email = coalesce(email, v_email),
      phone = coalesce(phone, v_phone),
      dob = coalesce(dob, p_dob)
    where id = v_patient_id;
  end if;

  -- Appointment (slot count is taken by ps_appointment_slot_increment)
  v_hold := case when v_paid then now() + make_interval(mins => greatest(p_hold_minutes, 31)) else null end;

  insert into ps_appointments (
    id, org_id, patient_id, service_id, slot_id, form_id, form_data, status, notes,
    hold_expires_at, patient_review_reason, source
  ) values (
    v_appt_id, p_org_id, v_patient_id, p_service_id, p_slot_id, p_form_id,
    coalesce(p_form_data, '{}'::jsonb), 'pending', nullif(trim(coalesce(p_notes, '')), ''),
    v_hold, v_review, v_source
  ) returning manage_token into v_token;

  insert into ps_public_booking_attempts (org_id, ip, phone_normalized, email)
  values (p_org_id, p_ip, v_phone_norm, v_email);

  return jsonb_build_object(
    'appointment_id', v_appt_id,
    'patient_id', v_patient_id,
    'manage_token', v_token,
    'requires_payment', v_paid,
    'hold_expires_at', v_hold,
    'start_time', v_slot.start_time,
    'end_time', v_slot.end_time
  );
end $$;

revoke execute on function public.ps_book_public_appointment(
  uuid, uuid, uuid, text, text, text, text, date, text, uuid, jsonb, text, text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.ps_book_public_appointment(
  uuid, uuid, uuid, text, text, text, text, date, text, uuid, jsonb, text, text, uuid, integer
) to service_role;

-- ------------------------------------------------------------
-- 6. Release unpaid holds (every 5 minutes)
-- ------------------------------------------------------------
create or replace function public.ps_expire_appointment_holds()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update ps_appointments
     set status = 'cancelled', cancelled_by = 'system'
   where status = 'pending'
     and hold_expires_at is not null
     and hold_expires_at < now();
  get diagnostics v_count = row_count;

  -- Keep the rate-limit table small.
  delete from ps_public_booking_attempts where created_at < now() - interval '2 days';
  return v_count;
end $$;
revoke execute on function public.ps_expire_appointment_holds() from public, anon, authenticated;
grant execute on function public.ps_expire_appointment_holds() to service_role;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'ps-expire-appointment-holds';
select cron.schedule('ps-expire-appointment-holds', '*/5 * * * *', $$select public.ps_expire_appointment_holds()$$);

-- ------------------------------------------------------------
-- 7. System-sent texts (booking confirmations) have no staff author
-- ------------------------------------------------------------
alter table public.ps_messages alter column created_by_user_id drop not null;

-- ------------------------------------------------------------
-- 8. Patient portal accounts
-- ------------------------------------------------------------
-- Link a confirmed patient account to its patient records: any unlinked
-- record with the same email, plus a new record at the pharmacy the patient
-- chose at sign-up if they don't have one there yet. Only runs once the
-- email is confirmed, so nobody can claim someone else's bookings by
-- signing up with their address.
create or replace function public.ps_link_patient_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  u auth.users%rowtype;
  v_org uuid;
  v_first text;
  v_last text;
begin
  select * into u from auth.users where id = p_user_id;
  if not found or u.email_confirmed_at is null then return; end if;
  if coalesce(u.raw_user_meta_data->>'account_type', '') <> 'patient' then return; end if;

  update ps_patients set auth_user_id = u.id
   where auth_user_id is null and email is not null and lower(email) = lower(u.email);

  begin
    v_org := (u.raw_user_meta_data->>'organisation_id')::uuid;
  exception when others then v_org := null;
  end;
  v_first := nullif(trim(coalesce(u.raw_user_meta_data->>'first_name', '')), '');
  v_last := nullif(trim(coalesce(u.raw_user_meta_data->>'last_name', '')), '');

  if v_org is not null
     and exists (select 1 from ps_organisations where id = v_org and is_public = true)
     and not exists (select 1 from ps_patients where auth_user_id = u.id and organisation_id = v_org) then
    insert into ps_patients (organisation_id, auth_user_id, first_name, last_name, email)
    values (v_org, u.id, coalesce(v_first, split_part(u.email, '@', 1)), coalesce(v_last, ''), lower(u.email));
  end if;
end $$;
revoke execute on function public.ps_link_patient_account(uuid) from public, anon, authenticated;

create or replace function public.ps_on_auth_user_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform public.ps_link_patient_account(new.id);
  end if;
  return new;
end $$;

drop trigger if exists ps_on_auth_user_confirmed on auth.users;
create trigger ps_on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.ps_on_auth_user_confirmed();

-- Let a signed-in patient call it for themselves (covers accounts confirmed
-- before this migration).
create or replace function public.ps_link_my_patient_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform public.ps_link_patient_account(auth.uid());
end $$;
revoke execute on function public.ps_link_my_patient_account() from public, anon;
grant execute on function public.ps_link_my_patient_account() to authenticated;

-- A patient editing their own record can change contact details only, not
-- which pharmacy or account it belongs to, or its NHS number.
create or replace function public.ps_patients_guard_self_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and old.auth_user_id = auth.uid()
     and not exists (select 1 from ps_get_user_org_ids() o where o = old.organisation_id) then
    new.organisation_id := old.organisation_id;
    new.auth_user_id := old.auth_user_id;
    new.nhs_number := old.nhs_number;
    new.dob := coalesce(old.dob, new.dob);
  end if;
  return new;
end $$;

drop trigger if exists ps_patients_guard_self_edit on public.ps_patients;
create trigger ps_patients_guard_self_edit
  before update on public.ps_patients
  for each row execute function public.ps_patients_guard_self_edit();
