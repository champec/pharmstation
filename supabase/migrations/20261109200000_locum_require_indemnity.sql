-- Locum: booking (and confirming an applicant) needs a GPhC number and
-- indemnity insurance on file, and nothing expired by the shift date.
-- QA issue #40: a locum with no indemnity on file was auto-booked.
-- Rollback: re-run ps_locum_expired_items, ps_locum_book_shift and
-- ps_org_review_booking from 20261105170100_locum_production_readiness.sql.

create or replace function public.ps_locum_expired_items(p_locum_id uuid, p_on date)
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when nullif(trim(lp.gphc_number), '') is null then 'GPhC number missing'
         when lp.gphc_expiry is not null and lp.gphc_expiry < p_on then 'GPhC registration expires before the shift' end,
    case when nullif(trim(lp.indemnity_provider), '') is null or lp.indemnity_expiry is null then 'indemnity insurance details missing'
         when lp.indemnity_expiry < p_on then 'indemnity insurance expires before the shift' end,
    case when lp.dbs_expiry is not null and lp.dbs_expiry < p_on then 'DBS check expires before the shift' end
  ], null)
  from ps_locum_profiles lp where lp.id = p_locum_id
$$;
revoke all on function public.ps_locum_expired_items(uuid, date) from public, anon;
grant execute on function public.ps_locum_expired_items(uuid, date) to authenticated, service_role;

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
    raise exception 'Before you can book this shift, update your locum profile: %.', array_to_string(v_expired, '; ');
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
    raise exception 'This locum can''t be confirmed: %.', array_to_string(v_expired, '; ');
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
