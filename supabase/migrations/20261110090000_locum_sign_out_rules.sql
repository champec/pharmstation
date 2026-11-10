-- Locum: safer sign-out (QA #91) and shift sign-in from the RP log (QA #93).
--
-- * A locum can't sign out before the shift starts.
-- * Signing out records the time only. It no longer marks the booking worked
--   or the shift completed on its own. The pharmacy confirms ("Confirm shift
--   worked"), or the hourly close-out confirms it once the shift has ended,
--   if the locum was on site for the booked hours give or take 30 minutes.
--   A short shift is left for the pharmacy, who is asked once.
-- * A booked locum signing in as Responsible Pharmacist at that pharmacy,
--   within the shift window, is signed in to the shift at the same time.
--
-- Rollback: re-run ps_locum_sign_out from 20261105170100 and ps_locum_close_out
-- from 20261106190000; drop trigger ps_locum_rp_sign_in_trigger on
-- ps_register_entries and function ps_locum_rp_sign_in().

create or replace function public.ps_locum_sign_out(p_booking_id uuid)
returns ps_locum_sign_ins
language plpgsql security definer set search_path = public as $$
declare
  v_row ps_locum_sign_ins%rowtype;
  v_shift ps_locum_shifts%rowtype;
  v_start timestamptz;
begin
  select * into v_row from ps_locum_sign_ins
  where booking_id = p_booking_id and locum_id = ps_get_my_locum_id() for update;
  if not found then raise exception 'You have not signed in for this shift'; end if;
  if v_row.signed_out_at is not null then raise exception 'You have already signed out'; end if;

  select s.* into v_shift from ps_locum_shifts s join ps_locum_bookings b on b.shift_id = s.id where b.id = p_booking_id;
  v_start := (v_shift.date + v_shift.start_time) at time zone 'Europe/London';
  if now() < v_start then
    raise exception 'Your shift starts at %. You can sign out once it has started.', to_char(v_shift.start_time, 'HH24:MI');
  end if;

  update ps_locum_sign_ins set signed_out_at = now()
  where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.ps_locum_sign_out(uuid) from public, anon;
grant execute on function public.ps_locum_sign_out(uuid) to authenticated;

create or replace function public.ps_locum_close_out()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cancelled int := 0; v_signed_out int := 0; v_prompted int := 0;
  r record;
begin
  -- 1. Open shifts that finished with nobody confirmed
  for r in
    select s.id from ps_locum_shifts s
    where s.status = 'open'
      and upper(ps_locum_shift_window(s.date, s.start_time, s.end_time)) + interval '2 hours' < now()
    for update skip locked
  loop
    update ps_locum_bookings set status = 'rejected', reviewed_at = now(),
           cancellation_reason = 'The shift date passed without a confirmation'
    where shift_id = r.id and status = 'pending';
    update ps_locum_shifts set status = 'cancelled', updated_at = now() where id = r.id;
    v_cancelled := v_cancelled + 1;
  end loop;

  -- 2. Signed in but never signed out: sign out at the shift end
  for r in
    select si.id as sign_in_id, b.id as booking_id, s.id as shift_id,
           upper(ps_locum_shift_window(s.date, s.start_time, s.end_time)) as shift_end
    from ps_locum_sign_ins si
    join ps_locum_bookings b on b.id = si.booking_id
    join ps_locum_shifts s on s.id = b.shift_id
    where si.signed_out_at is null and b.status = 'approved'
      and upper(ps_locum_shift_window(s.date, s.start_time, s.end_time)) + interval '2 hours' < now()
  loop
    update ps_locum_sign_ins set signed_out_at = greatest(r.shift_end, signed_in_at) where id = r.sign_in_id;
    update ps_locum_bookings set status = 'completed' where id = r.booking_id and status = 'approved';
    update ps_locum_shifts set status = 'completed', updated_at = now() where id = r.shift_id and status in ('open', 'filled');
    v_signed_out := v_signed_out + 1;
  end loop;

  -- 2b. Signed out but not yet confirmed. On time (within 30 minutes of the
  --     booked hours): confirm automatically. Short: ask the pharmacy once.
  for r in
    select b.id as booking_id, b.locum_id, s.id as shift_id, s.org_id, s.date, s.start_time, s.end_time,
           si.signed_in_at, si.signed_out_at,
           extract(epoch from (upper(ps_locum_shift_window(s.date, s.start_time, s.end_time))
                               - lower(ps_locum_shift_window(s.date, s.start_time, s.end_time)))) / 60 - 180 as booked_minutes
    from ps_locum_sign_ins si
    join ps_locum_bookings b on b.id = si.booking_id
    join ps_locum_shifts s on s.id = b.shift_id
    where si.signed_out_at is not null and b.status = 'approved'
      and upper(ps_locum_shift_window(s.date, s.start_time, s.end_time)) < now()
  loop
    if extract(epoch from (r.signed_out_at - r.signed_in_at)) / 60 >= r.booked_minutes - 30 then
      update ps_locum_bookings set status = 'completed' where id = r.booking_id and status = 'approved';
      update ps_locum_shifts set status = 'completed', updated_at = now() where id = r.shift_id and status in ('open', 'filled');
      v_signed_out := v_signed_out + 1;
    elsif (select completion_prompted_at from ps_locum_bookings where id = r.booking_id) is null then
      perform ps_locum_alert_pharmacy(r.org_id, 'Check a locum''s hours',
        ps_locum_display_name(r.locum_id) || ' was booked ' || to_char(r.start_time, 'HH24:MI') || '–' || to_char(r.end_time, 'HH24:MI')
          || ' on ' || to_char(r.date, 'Dy DD Mon') || ' but signed in at ' || to_char(r.signed_in_at at time zone 'Europe/London', 'HH24:MI')
          || ' and out at ' || to_char(r.signed_out_at at time zone 'Europe/London', 'HH24:MI') || '. Confirm the shift was worked or record a no-show.',
        r.shift_id, jsonb_build_object('booking_id', r.booking_id));
      update ps_locum_bookings set completion_prompted_at = now() where id = r.booking_id;
      v_prompted := v_prompted + 1;
    end if;
  end loop;

  -- 3. Confirmed, never signed in: ask the pharmacy once
  for r in
    select b.id as booking_id, b.locum_id, s.id as shift_id, s.org_id, s.date, s.start_time, s.end_time
    from ps_locum_bookings b
    join ps_locum_shifts s on s.id = b.shift_id
    where b.status = 'approved' and b.completion_prompted_at is null
      and upper(ps_locum_shift_window(s.date, s.start_time, s.end_time)) + interval '2 hours' < now()
      and not exists (select 1 from ps_locum_sign_ins si where si.booking_id = b.id)
  loop
    perform ps_locum_alert_pharmacy(r.org_id, 'Did the locum work this shift?',
      ps_locum_display_name(r.locum_id) || ' didn''t sign in for ' || to_char(r.date, 'Dy DD Mon') || ' '
        || to_char(r.start_time, 'HH24:MI') || '–' || to_char(r.end_time, 'HH24:MI')
        || '. Record it as worked or as a no-show.',
      r.shift_id, jsonb_build_object('booking_id', r.booking_id));
    update ps_locum_bookings set completion_prompted_at = now() where id = r.booking_id;
    v_prompted := v_prompted + 1;
  end loop;

  return jsonb_build_object('cancelled_open_shifts', v_cancelled, 'auto_signed_out', v_signed_out, 'completion_prompts', v_prompted);
end;
$$;
revoke all on function public.ps_locum_close_out() from public, anon, authenticated;

create or replace function public.ps_locum_rp_sign_in()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_booking uuid; v_locum uuid;
begin
  if new.register_type <> 'RP' or new.rp_signed_in_at is null or new.corrects_entry_id is not null or new.entered_by is null then
    return new;
  end if;
  select id into v_locum from ps_locum_profiles where user_id = new.entered_by;
  if v_locum is null then return new; end if;
  select b.id into v_booking
  from ps_locum_bookings b join ps_locum_shifts s on s.id = b.shift_id
  where b.locum_id = v_locum and b.status = 'approved' and s.org_id = new.organisation_id
    and new.rp_signed_in_at <@ ps_locum_shift_window(s.date, s.start_time, s.end_time)
    and not exists (select 1 from ps_locum_sign_ins si where si.booking_id = b.id)
  order by s.date, s.start_time limit 1;
  if v_booking is not null then
    insert into ps_locum_sign_ins (booking_id, locum_id, org_id, signed_in_at, rp_entry_id)
    values (v_booking, v_locum, new.organisation_id, new.rp_signed_in_at, new.id);
  end if;
  return new;
exception when others then
  raise warning 'ps_locum_rp_sign_in failed: %', sqlerrm;
  return new;
end;
$$;
revoke all on function public.ps_locum_rp_sign_in() from public, anon, authenticated;

drop trigger if exists ps_locum_rp_sign_in_trigger on public.ps_register_entries;
create trigger ps_locum_rp_sign_in_trigger
  after insert on public.ps_register_entries
  for each row execute function public.ps_locum_rp_sign_in();
