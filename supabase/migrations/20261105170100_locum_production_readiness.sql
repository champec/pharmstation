-- Locum module: production readiness, phase 1 (security and data integrity)
--
-- Plan: /mnt/project-files/locum/production-readiness-plan.md (approved 5 Nov 2026)
--
-- What this changes
--  1.1  Compliance review: 'rejected' is now an allowed status (the admin page
--       already used it, so rejecting failed). Admins can also suspend.
--  1.2  Locums can no longer write bookings directly. Booking and cancelling go
--       only through ps_locum_book_shift / ps_locum_cancel_booking, which run
--       the compliance, blacklist, clash and criteria checks.
--  1.3  Sign-in and sign-out go through ps_locum_sign_in / ps_locum_sign_out,
--       using server time, for an approved booking, inside the shift window
--       (1 hour before start to 2 hours after end, UK time, overnight aware;
--       same window as ps_locum_claim_shift_access). Signing out completes the
--       booking and the shift.
--  1.4  sop-pdfs storage and locum SOP policies: handled by the SOP module
--       migration 20261105160000_sop_production_readiness.sql (PR #36).
--  1.5  Pharmacies that can approve locums can open a locum's documents once
--       that locum has applied to one of their shifts.
--  1.6  Pharmacy confirm / reject / cancel / no-show are single transactions
--       (ps_org_review_booking, ps_org_cancel_shift, ps_org_mark_booking).
--  1.7  Open shifts, shift criteria and locum services are readable only by
--       locums and the owning pharmacy, not every signed-in user.
--  1.8  A locum whose GPhC, indemnity or DBS has expired by the shift date
--       cannot book or be confirmed. Changing GPhC/DBS number or indemnity
--       provider after approval sends the profile back for review.
--  1.9  Pharmacy-side writes need the approve_locums permission (owner and
--       manager by default, two-step sign-in required), not just membership.
--       Notes, reviews, blacklist and money tables are also limited to it, so
--       a locum with temporary shift access cannot read them.
--  Also: ps_org_shift_locums() gives the pharmacy the names of locums who
--  applied (ps_user_profiles RLS hid them, so pages showed the wrong name or
--  "Unknown").
--
-- Needs: 20261104123000_role_permissions_foundation.sql (ps_member_has_permission)
--        20261104131500_locum_shift_access.sql (shift-access window)
-- Rollback: supabase/rollbacks/rollback_20261105170100_locum_production_readiness.sql

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.ps_can_manage_locums(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ps_member_has_permission(p_org_id, 'approve_locums')
$$;
revoke all on function public.ps_can_manage_locums(uuid) from public, anon;
grant execute on function public.ps_can_manage_locums(uuid) to authenticated, service_role;

-- Shift start/end as real timestamps (dates and times are UK local; a shift
-- ending at or before its start runs past midnight).
create or replace function public.ps_locum_shift_window(p_date date, p_start time, p_end time)
returns tstzrange language sql stable set search_path = public as $$
  select tstzrange(
    (p_date + p_start) at time zone 'Europe/London',
    (p_date + p_end + case when p_end <= p_start then interval '1 day' else interval '0' end) at time zone 'Europe/London',
    '[)')
$$;

-- Has this locum applied to (or been booked at) a shift of this org?
create or replace function public.ps_locum_has_booking_at(p_locum_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ps_locum_bookings b
    join ps_locum_shifts s on s.id = b.shift_id
    where b.locum_id = p_locum_id and s.org_id = p_org_id
  )
$$;
revoke all on function public.ps_locum_has_booking_at(uuid, uuid) from public, anon;
grant execute on function public.ps_locum_has_booking_at(uuid, uuid) to authenticated, service_role;

-- Can the caller (pharmacy side) see this locum? approve_locums at an org the
-- locum has applied to.
create or replace function public.ps_org_can_view_locum(p_locum_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ps_locum_bookings b
    join ps_locum_shifts s on s.id = b.shift_id
    where b.locum_id = p_locum_id
      and s.org_id in (select ps_get_user_org_ids())
      and ps_member_has_permission(s.org_id, 'approve_locums')
  )
$$;
revoke all on function public.ps_org_can_view_locum(uuid) from public, anon;
grant execute on function public.ps_org_can_view_locum(uuid) to authenticated, service_role;

-- Same, keyed on the locum's auth user id as text (storage paths start with
-- it; text so a malformed folder name can't make the policy error).
create or replace function public.ps_org_can_view_locum_user(p_user_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ps_locum_profiles lp
    where lp.user_id::text = p_user_id and ps_org_can_view_locum(lp.id)
  )
$$;
revoke all on function public.ps_org_can_view_locum_user(text) from public, anon;
grant execute on function public.ps_org_can_view_locum_user(text) to authenticated, service_role;

-- Expired compliance on a given date (null expiry = not declared, not blocked)
create or replace function public.ps_locum_expired_items(p_locum_id uuid, p_on date)
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when lp.gphc_expiry is not null and lp.gphc_expiry < p_on then 'GPhC registration' end,
    case when lp.indemnity_expiry is not null and lp.indemnity_expiry < p_on then 'indemnity insurance' end,
    case when lp.dbs_expiry is not null and lp.dbs_expiry < p_on then 'DBS check' end
  ], null)
  from ps_locum_profiles lp where lp.id = p_locum_id
$$;
revoke all on function public.ps_locum_expired_items(uuid, date) from public, anon;
grant execute on function public.ps_locum_expired_items(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1.1 Compliance statuses and admin review
-- ---------------------------------------------------------------------------

alter table public.ps_locum_profiles drop constraint if exists ps_locum_profiles_compliance_status_check;
alter table public.ps_locum_profiles add constraint ps_locum_profiles_compliance_status_check
  check (compliance_status in ('pending', 'approved', 'rejected', 'changes_requested', 'suspended'));

create or replace function public.ps_admin_set_locum_compliance(
  p_locum_id uuid, p_status text, p_notes text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'approved', 'rejected', 'suspended') then
    raise exception 'Invalid status %', p_status;
  end if;
  if p_status in ('rejected', 'suspended') and coalesce(trim(p_notes), '') = '' then
    raise exception 'Give the locum a reason';
  end if;
  if exists (select 1 from ps_locum_profiles where id = p_locum_id and user_id = auth.uid()) then
    raise exception 'You cannot review your own locum profile';
  end if;

  update ps_locum_profiles
  set compliance_status = p_status,
      compliance_review_notes = nullif(trim(p_notes), ''),
      compliance_reviewed_at = case when p_status = 'pending' then null else now() end,
      compliance_reviewed_by = case when p_status = 'pending' then null else auth.uid() end,
      updated_at = now()
  where id = p_locum_id;

  if not found then
    raise exception 'Locum not found';
  end if;

  -- A suspended locum loses upcoming confirmed and pending bookings.
  if p_status = 'suspended' then
    update ps_locum_shifts s set status = 'open', updated_at = now()
    from ps_locum_bookings b
    where b.shift_id = s.id and b.locum_id = p_locum_id
      and b.status = 'approved' and s.status = 'filled' and s.date >= current_date;
    update ps_locum_bookings b
    set status = 'cancelled', cancellation_reason = 'Locum suspended by PharmStation'
    from ps_locum_shifts s
    where s.id = b.shift_id and b.locum_id = p_locum_id
      and b.status in ('pending', 'approved') and s.date >= current_date;
  end if;
end;
$$;
revoke execute on function public.ps_admin_set_locum_compliance(uuid, text, text) from public, anon;
grant execute on function public.ps_admin_set_locum_compliance(uuid, text, text) to authenticated, service_role;

-- 1.8 Locum edits to identity/insurance details after approval need review again.
create or replace function public.ps_protect_locum_compliance_status()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.compliance_status <> 'pending'
       or new.onboarding_complete <> false
       or new.compliance_reviewed_at is not null
       or new.compliance_reviewed_by is not null then
      raise exception 'New locum profiles must begin pending compliance review';
    end if;
  elsif auth.uid() is not null and auth.uid() = old.user_id then
    if new.compliance_status is distinct from old.compliance_status
       or new.onboarding_complete is distinct from old.onboarding_complete
       or new.compliance_reviewed_at is distinct from old.compliance_reviewed_at
       or new.compliance_reviewed_by is distinct from old.compliance_reviewed_by
       or new.compliance_review_notes is distinct from old.compliance_review_notes then
      raise exception 'Compliance review fields cannot be changed by the locum';
    end if;
    if old.compliance_status = 'approved' and (
         new.gphc_number is distinct from old.gphc_number
         or new.dbs_number is distinct from old.dbs_number
         or new.indemnity_provider is distinct from old.indemnity_provider) then
      new.compliance_status := 'pending';
      new.compliance_review_notes := 'Details changed after approval: waiting for review';
      new.compliance_reviewed_at := null;
      new.compliance_reviewed_by := null;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.2 / 1.8 Booking (locum side)
-- ---------------------------------------------------------------------------

create or replace function public.ps_locum_book_shift(p_shift_id uuid)
returns ps_locum_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_locum_id uuid;
  v_shift public.ps_locum_shifts%rowtype;
  v_booking public.ps_locum_bookings%rowtype;
  v_required_services uuid[];
  v_compliance_status text;
  v_expired text[];
begin
  select id, compliance_status into v_locum_id, v_compliance_status
  from public.ps_locum_profiles where user_id = auth.uid() limit 1;

  if v_locum_id is null then
    raise exception 'A locum profile is required to book shifts';
  end if;
  if v_compliance_status <> 'approved' then
    raise exception 'Your compliance profile must be approved before you can book shifts';
  end if;

  select * into v_shift from public.ps_locum_shifts where id = p_shift_id for update;

  if not found or v_shift.status <> 'open'
     or upper(ps_locum_shift_window(v_shift.date, v_shift.start_time, v_shift.end_time)) <= now() then
    raise exception 'This shift is no longer available';
  end if;

  v_expired := ps_locum_expired_items(v_locum_id, v_shift.date);
  if coalesce(array_length(v_expired, 1), 0) > 0 then
    raise exception 'Your % will have expired by this shift. Update your profile first.', array_to_string(v_expired, ', ');
  end if;

  if exists (select 1 from public.ps_locum_blacklist where org_id = v_shift.org_id and locum_id = v_locum_id) then
    raise exception 'This shift is not available to your profile';
  end if;

  if exists (
    select 1 from public.ps_locum_bookings b
    join public.ps_locum_shifts s on s.id = b.shift_id
    where b.locum_id = v_locum_id
      and b.status in ('pending', 'approved')
      and b.shift_id <> v_shift.id
      and ps_locum_shift_window(s.date, s.start_time, s.end_time)
          && ps_locum_shift_window(v_shift.date, v_shift.start_time, v_shift.end_time)
  ) then
    raise exception 'This shift clashes with an existing booking';
  end if;

  select coalesce(required_service_ids, '{}'::uuid[]) into v_required_services
  from public.ps_locum_shift_criteria where shift_id = v_shift.id;

  if coalesce(array_length(v_required_services, 1), 0) > 0 and exists (
    select 1 from unnest(v_required_services) required_id
    where not exists (
      select 1 from public.ps_locum_services service
      where service.locum_id = v_locum_id and service.service_library_id = required_id
    )
  ) then
    raise exception 'Your profile does not meet this shift''s service criteria';
  end if;

  select * into v_booking from public.ps_locum_bookings
  where shift_id = v_shift.id and locum_id = v_locum_id for update;

  if found then
    if v_booking.status not in ('cancelled', 'rejected') then
      raise exception 'You already have a booking for this shift';
    end if;
    update public.ps_locum_bookings
    set status = case when v_shift.booking_mode = 'auto' then 'approved' else 'pending' end,
        applied_at = now(), reviewed_at = null, reviewed_by = null, cancellation_reason = null
    where id = v_booking.id
    returning * into v_booking;
  else
    insert into public.ps_locum_bookings (shift_id, locum_id, status, applied_at)
    values (v_shift.id, v_locum_id,
            case when v_shift.booking_mode = 'auto' then 'approved' else 'pending' end, now())
    returning * into v_booking;
  end if;

  if v_shift.booking_mode = 'auto' then
    update public.ps_locum_shifts set status = 'filled', updated_at = now() where id = v_shift.id;
  end if;

  return v_booking;
end;
$$;
revoke all on function public.ps_locum_book_shift(uuid) from public, anon;
grant execute on function public.ps_locum_book_shift(uuid) to authenticated;

revoke all on function public.ps_locum_cancel_booking(uuid) from public, anon;
grant execute on function public.ps_locum_cancel_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1.6 / 1.9 Pharmacy actions
-- ---------------------------------------------------------------------------

-- Confirm or turn down an application.
create or replace function public.ps_org_review_booking(p_booking_id uuid, p_action text, p_reason text default null)
returns ps_locum_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_booking ps_locum_bookings%rowtype;
  v_shift ps_locum_shifts%rowtype;
  v_status text;
  v_expired text[];
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'Invalid action %', p_action;
  end if;

  select * into v_booking from ps_locum_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  select * into v_shift from ps_locum_shifts where id = v_booking.shift_id for update;
  if not ps_can_manage_locums(v_shift.org_id) then
    raise exception 'You need permission to approve locums (and two-step sign-in) to do this' using errcode = '42501';
  end if;
  if v_booking.status <> 'pending' then
    raise exception 'This application has already been dealt with';
  end if;

  if p_action = 'reject' then
    update ps_locum_bookings
    set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
        cancellation_reason = nullif(trim(p_reason), '')
    where id = v_booking.id returning * into v_booking;
    return v_booking;
  end if;

  if v_shift.status <> 'open' then
    raise exception 'This shift is no longer open';
  end if;
  if upper(ps_locum_shift_window(v_shift.date, v_shift.start_time, v_shift.end_time)) <= now() then
    raise exception 'This shift has already finished';
  end if;

  select compliance_status into v_status from ps_locum_profiles where id = v_booking.locum_id;
  if v_status <> 'approved' then
    raise exception 'This locum is not currently approved by PharmStation';
  end if;
  v_expired := ps_locum_expired_items(v_booking.locum_id, v_shift.date);
  if coalesce(array_length(v_expired, 1), 0) > 0 then
    raise exception 'This locum''s % will have expired by the shift date', array_to_string(v_expired, ', ');
  end if;
  if exists (select 1 from ps_locum_blacklist where org_id = v_shift.org_id and locum_id = v_booking.locum_id) then
    raise exception 'This locum is on your blocked list';
  end if;
  if exists (
    select 1 from ps_locum_bookings b
    join ps_locum_shifts s on s.id = b.shift_id
    where b.locum_id = v_booking.locum_id and b.status = 'approved' and b.id <> v_booking.id
      and ps_locum_shift_window(s.date, s.start_time, s.end_time)
          && ps_locum_shift_window(v_shift.date, v_shift.start_time, v_shift.end_time)
  ) then
    raise exception 'This locum is already booked elsewhere at that time';
  end if;

  update ps_locum_bookings
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = v_booking.id returning * into v_booking;

  update ps_locum_bookings
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
      cancellation_reason = 'Shift filled'
  where shift_id = v_shift.id and status = 'pending' and id <> v_booking.id;

  update ps_locum_shifts set status = 'filled', updated_at = now() where id = v_shift.id;

  return v_booking;
end;
$$;
revoke all on function public.ps_org_review_booking(uuid, text, text) from public, anon;
grant execute on function public.ps_org_review_booking(uuid, text, text) to authenticated;

-- Cancel a shift; every live application or booking on it ends.
create or replace function public.ps_org_cancel_shift(p_shift_id uuid, p_reason text default null)
returns ps_locum_shifts
language plpgsql security definer set search_path = public as $$
declare
  v_shift ps_locum_shifts%rowtype;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Shift cancelled by the pharmacy');
begin
  select * into v_shift from ps_locum_shifts where id = p_shift_id for update;
  if not found then raise exception 'Shift not found'; end if;
  if not ps_can_manage_locums(v_shift.org_id) then
    raise exception 'You need permission to approve locums (and two-step sign-in) to do this' using errcode = '42501';
  end if;
  if v_shift.status in ('cancelled', 'completed') then
    raise exception 'This shift is already %', v_shift.status;
  end if;

  update ps_locum_bookings
  set status = case when status = 'pending' then 'rejected' else 'cancelled' end,
      reviewed_at = now(), reviewed_by = auth.uid(), cancellation_reason = v_reason
  where shift_id = v_shift.id and status in ('pending', 'approved');

  update ps_locum_shifts set status = 'cancelled', updated_at = now()
  where id = v_shift.id returning * into v_shift;
  return v_shift;
end;
$$;
revoke all on function public.ps_org_cancel_shift(uuid, text) from public, anon;
grant execute on function public.ps_org_cancel_shift(uuid, text) to authenticated;

-- After the shift: confirm it happened, or record a no-show.
create or replace function public.ps_org_mark_booking(p_booking_id uuid, p_status text)
returns ps_locum_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_booking ps_locum_bookings%rowtype;
  v_shift ps_locum_shifts%rowtype;
begin
  if p_status not in ('completed', 'no_show') then
    raise exception 'Invalid status %', p_status;
  end if;
  select * into v_booking from ps_locum_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  select * into v_shift from ps_locum_shifts where id = v_booking.shift_id for update;
  if not ps_can_manage_locums(v_shift.org_id) then
    raise exception 'You need permission to approve locums (and two-step sign-in) to do this' using errcode = '42501';
  end if;
  if v_booking.status not in ('approved', 'completed', 'no_show') then
    raise exception 'Only a confirmed booking can be marked';
  end if;
  if lower(ps_locum_shift_window(v_shift.date, v_shift.start_time, v_shift.end_time)) > now() then
    raise exception 'The shift has not started yet';
  end if;
  if p_status = 'no_show' and exists (select 1 from ps_locum_sign_ins where booking_id = v_booking.id) then
    raise exception 'This locum signed in for the shift, so it cannot be a no-show';
  end if;

  update ps_locum_bookings set status = p_status, reviewed_at = now(), reviewed_by = auth.uid()
  where id = v_booking.id returning * into v_booking;
  update ps_locum_shifts set status = 'completed', updated_at = now() where id = v_shift.id;
  return v_booking;
end;
$$;
revoke all on function public.ps_org_mark_booking(uuid, text) from public, anon;
grant execute on function public.ps_org_mark_booking(uuid, text) to authenticated;

-- Names and compliance summary of locums who applied to this pharmacy.
-- Any member sees names (staff need to know who is coming); contact details
-- and compliance only with approve_locums.
create or replace function public.ps_org_shift_locums(p_org_id uuid, p_locum_ids uuid[])
returns table(
  locum_id uuid, user_id uuid, full_name text, email text, phone text,
  gphc_number text, gphc_expiry date, indemnity_provider text, indemnity_expiry date,
  dbs_expiry date, smart_card_held boolean, compliance_status text
)
language sql stable security definer set search_path = public as $$
  select lp.id, lp.user_id,
         coalesce(nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), u.full_name, 'Locum'),
         case when m.can_manage then u.email end,
         case when m.can_manage then u.phone end,
         lp.gphc_number,
         case when m.can_manage then lp.gphc_expiry end,
         case when m.can_manage then lp.indemnity_provider end,
         case when m.can_manage then lp.indemnity_expiry end,
         case when m.can_manage then lp.dbs_expiry end,
         case when m.can_manage then lp.smart_card_held end,
         case when m.can_manage then lp.compliance_status end
  from (select ps_member_has_permission(p_org_id, 'approve_locums') as can_manage) m,
       ps_locum_profiles lp
  left join ps_user_profiles u on u.id = lp.user_id
  where p_org_id in (select ps_get_user_org_ids())
    and lp.id = any(p_locum_ids)
    and ps_locum_has_booking_at(lp.id, p_org_id)
$$;
revoke all on function public.ps_org_shift_locums(uuid, uuid[]) from public, anon;
grant execute on function public.ps_org_shift_locums(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 1.3 Sign-in / sign-out
-- ---------------------------------------------------------------------------

create or replace function public.ps_locum_sign_in(p_booking_id uuid)
returns ps_locum_sign_ins
language plpgsql security definer set search_path = public as $$
declare
  v_booking ps_locum_bookings%rowtype;
  v_shift ps_locum_shifts%rowtype;
  v_win tstzrange;
  v_row ps_locum_sign_ins%rowtype;
begin
  select * into v_booking from ps_locum_bookings
  where id = p_booking_id and locum_id = ps_get_my_locum_id() for update;
  if not found then raise exception 'Booking not found'; end if;
  if v_booking.status <> 'approved' then
    raise exception 'Only a confirmed booking can be signed in to';
  end if;

  select * into v_shift from ps_locum_shifts where id = v_booking.shift_id;
  if v_shift.status = 'cancelled' then raise exception 'This shift was cancelled'; end if;
  v_win := ps_locum_shift_window(v_shift.date, v_shift.start_time, v_shift.end_time);
  if now() < lower(v_win) - interval '1 hour' then
    raise exception 'You can sign in from 1 hour before the shift starts';
  end if;
  if now() > upper(v_win) + interval '2 hours' then
    raise exception 'This shift has finished';
  end if;

  if exists (select 1 from ps_locum_sign_ins where booking_id = v_booking.id) then
    raise exception 'You have already signed in for this shift';
  end if;

  insert into ps_locum_sign_ins (booking_id, locum_id, org_id, signed_in_at)
  values (v_booking.id, v_booking.locum_id, v_shift.org_id, now())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.ps_locum_sign_in(uuid) from public, anon;
grant execute on function public.ps_locum_sign_in(uuid) to authenticated;

create or replace function public.ps_locum_sign_out(p_booking_id uuid)
returns ps_locum_sign_ins
language plpgsql security definer set search_path = public as $$
declare
  v_row ps_locum_sign_ins%rowtype;
begin
  select * into v_row from ps_locum_sign_ins
  where booking_id = p_booking_id and locum_id = ps_get_my_locum_id() for update;
  if not found then raise exception 'You have not signed in for this shift'; end if;
  if v_row.signed_out_at is not null then raise exception 'You have already signed out'; end if;

  update ps_locum_sign_ins set signed_out_at = now()
  where id = v_row.id returning * into v_row;

  update ps_locum_bookings set status = 'completed' where id = p_booking_id and status = 'approved';
  update ps_locum_shifts s set status = 'completed', updated_at = now()
  from ps_locum_bookings b where b.id = p_booking_id and s.id = b.shift_id and s.status in ('open', 'filled');
  return v_row;
end;
$$;
revoke all on function public.ps_locum_sign_out(uuid) from public, anon;
grant execute on function public.ps_locum_sign_out(uuid) to authenticated;

-- Duration from server timestamps only.
create or replace function public.ps_locum_sign_in_duration()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.signed_out_at is not null then
    new.duration_minutes := greatest(0, round(extract(epoch from (new.signed_out_at - new.signed_in_at)) / 60))::int;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- Shifts
drop policy if exists authenticated_read_open_shifts on public.ps_locum_shifts;
drop policy if exists org_members_crud_shifts on public.ps_locum_shifts;
drop policy if exists locum_read_open_shifts on public.ps_locum_shifts;
drop policy if exists org_members_read_shifts on public.ps_locum_shifts;
drop policy if exists org_managers_insert_shifts on public.ps_locum_shifts;
drop policy if exists org_managers_update_shifts on public.ps_locum_shifts;
drop policy if exists org_managers_delete_shifts on public.ps_locum_shifts;
create policy locum_read_open_shifts on public.ps_locum_shifts for select to authenticated
  using (status = 'open' and ps_get_my_locum_id() is not null);
create policy org_members_read_shifts on public.ps_locum_shifts for select to authenticated
  using (org_id in (select ps_get_user_org_ids()));
create policy org_managers_insert_shifts on public.ps_locum_shifts for insert to authenticated
  with check (ps_can_manage_locums(org_id) and status = 'open');
-- Editing details only; status changes that touch bookings go through the RPCs.
create policy org_managers_update_shifts on public.ps_locum_shifts for update to authenticated
  using (ps_can_manage_locums(org_id))
  with check (ps_can_manage_locums(org_id));
create policy org_managers_delete_shifts on public.ps_locum_shifts for delete to authenticated
  using (ps_can_manage_locums(org_id)
         and not exists (select 1 from ps_locum_bookings b where b.shift_id = ps_locum_shifts.id));

-- Shift criteria
drop policy if exists authenticated_read_shift_criteria on public.ps_locum_shift_criteria;
drop policy if exists org_members_crud_shift_criteria on public.ps_locum_shift_criteria;
drop policy if exists shift_criteria_read on public.ps_locum_shift_criteria;
drop policy if exists shift_criteria_manage on public.ps_locum_shift_criteria;
create policy shift_criteria_read on public.ps_locum_shift_criteria for select to authenticated
  using (exists (select 1 from ps_locum_shifts s where s.id = shift_id));  -- inherits shift visibility
create policy shift_criteria_manage on public.ps_locum_shift_criteria for all to authenticated
  using (exists (select 1 from ps_locum_shifts s where s.id = shift_id and ps_can_manage_locums(s.org_id)))
  with check (exists (select 1 from ps_locum_shifts s where s.id = shift_id and ps_can_manage_locums(s.org_id)));

-- Bookings: reads only; every write goes through a function.
drop policy if exists locum_insert_own_bookings on public.ps_locum_bookings;
drop policy if exists locum_cancel_own_bookings on public.ps_locum_bookings;
drop policy if exists org_members_manage_bookings on public.ps_locum_bookings;
drop policy if exists org_members_read_bookings on public.ps_locum_bookings;
create policy org_members_read_bookings on public.ps_locum_bookings for select to authenticated
  using (shift_id in (select s.id from ps_locum_shifts s where s.org_id in (select ps_get_user_org_ids())));

-- Sign-ins: reads only; writes through ps_locum_sign_in / ps_locum_sign_out.
drop policy if exists locum_insert_own_sign_in on public.ps_locum_sign_ins;
drop policy if exists locum_update_own_sign_in on public.ps_locum_sign_ins;
drop policy if exists org_members_read_sign_ins on public.ps_locum_sign_ins;
create policy org_members_read_sign_ins on public.ps_locum_sign_ins for select to authenticated
  using (org_id in (select ps_get_user_org_ids()));

-- Locum profile, services, documents: pharmacy sees them only with approve_locums
drop policy if exists org_members_read_locum_profiles on public.ps_locum_profiles;
drop policy if exists org_managers_read_locum_profiles on public.ps_locum_profiles;
create policy org_managers_read_locum_profiles on public.ps_locum_profiles for select to authenticated
  using (ps_org_can_view_locum(id));

drop policy if exists authenticated_read_locum_services on public.ps_locum_services;
drop policy if exists org_members_read_locum_services on public.ps_locum_services;
drop policy if exists org_managers_read_locum_services on public.ps_locum_services;
create policy org_managers_read_locum_services on public.ps_locum_services for select to authenticated
  using (ps_org_can_view_locum(locum_id));

drop policy if exists org_members_read_locum_documents on public.ps_locum_documents;
drop policy if exists org_managers_read_locum_documents on public.ps_locum_documents;
create policy org_managers_read_locum_documents on public.ps_locum_documents for select to authenticated
  using (ps_org_can_view_locum(locum_id));

-- Pharmacy-private tables: approve_locums only
drop policy if exists org_members_crud_blacklist on public.ps_locum_blacklist;
drop policy if exists org_managers_crud_blacklist on public.ps_locum_blacklist;
create policy org_managers_crud_blacklist on public.ps_locum_blacklist for all to authenticated
  using (ps_can_manage_locums(org_id)) with check (ps_can_manage_locums(org_id));

drop policy if exists org_members_crud_locum_notes on public.ps_locum_notes;
drop policy if exists org_managers_crud_locum_notes on public.ps_locum_notes;
create policy org_managers_crud_locum_notes on public.ps_locum_notes for all to authenticated
  using (ps_can_manage_locums(org_id)) with check (ps_can_manage_locums(org_id));

drop policy if exists org_members_crud_reviews on public.ps_locum_reviews;
drop policy if exists org_managers_crud_reviews on public.ps_locum_reviews;
create policy org_managers_crud_reviews on public.ps_locum_reviews for all to authenticated
  using (ps_can_manage_locums(org_id)) with check (ps_can_manage_locums(org_id));

drop policy if exists org_members_read_own_feedback on public.ps_locum_pharmacy_feedback;
drop policy if exists org_managers_read_feedback on public.ps_locum_pharmacy_feedback;
create policy org_managers_read_feedback on public.ps_locum_pharmacy_feedback for select to authenticated
  using (ps_can_manage_locums(org_id));

drop policy if exists org_members_manage_mandates on public.ps_locum_payment_mandates;
drop policy if exists org_managers_read_mandates on public.ps_locum_payment_mandates;
create policy org_managers_read_mandates on public.ps_locum_payment_mandates for select to authenticated
  using (ps_can_manage_locums(org_id));

drop policy if exists org_members_read_invoices on public.ps_locum_invoices;
drop policy if exists org_managers_read_invoices on public.ps_locum_invoices;
create policy org_managers_read_invoices on public.ps_locum_invoices for select to authenticated
  using (ps_can_manage_locums(org_id));

drop policy if exists org_members_read_invoice_lines on public.ps_locum_invoice_lines;
drop policy if exists org_managers_read_invoice_lines on public.ps_locum_invoice_lines;
create policy org_managers_read_invoice_lines on public.ps_locum_invoice_lines for select to authenticated
  using (invoice_id in (select i.id from ps_locum_invoices i where ps_can_manage_locums(i.org_id)));

drop policy if exists org_members_read_payment_weeks on public.ps_locum_payment_weeks;
drop policy if exists org_managers_read_payment_weeks on public.ps_locum_payment_weeks;
create policy org_managers_read_payment_weeks on public.ps_locum_payment_weeks for select to authenticated
  using (ps_can_manage_locums(org_id));

drop policy if exists org_members_read_payments on public.ps_locum_payments;
drop policy if exists org_managers_read_payments on public.ps_locum_payments;
create policy org_managers_read_payments on public.ps_locum_payments for select to authenticated
  using (ps_can_manage_locums(org_id));

-- Locum SOP documents, sign-offs and the sop-pdfs bucket are owned by the SOP
-- module migration (20261105160000_sop_production_readiness.sql), which
-- applies the same rules (approve_locums can manage locum SOPs; locums read
-- SOPs of pharmacies they applied to). Not touched here so the two can't
-- overwrite each other.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- 1.5 locum-documents: pharmacies with approve_locums where the locum applied.
drop policy if exists locum_documents_select_org_managers on storage.objects;
create policy locum_documents_select_org_managers on storage.objects for select to authenticated
  using (bucket_id = 'locum-documents'
         and public.ps_org_can_view_locum_user((storage.foldername(name))[1]));

commit;
