-- Locum module: production readiness, phase 2 (notifications and close-out)
--
-- Plan: /mnt/project-files/locum/production-readiness-plan.md (items 2.1-2.3)
--
--  * Pharmacies hear about locum activity through the normal staff alerts
--    (bell, and SMS / phone if the pharmacy turns them on), under a new
--    'locum' alert type, sent to people who can approve locums:
--      - a locum applies (manual shifts) or books (auto shifts)
--      - a locum withdraws
--      - a finished shift needs "worked" or "no-show" recording
--  * Locums get an email and a phone push (locum-notify edge function):
--      - booking confirmed, application not successful, shift cancelled by
--        the pharmacy, reminder the day before
--  * Saved-search "new shift" pushes now go to locum-notify. They used to go
--    to notifications-dispatch, which only understands staff alerts and
--    rejected every one of them ("Missing notification_id").
--  * Hourly close-out job:
--      - open shifts that ended without a confirmed locum are cancelled and
--        their pending applications turned down
--      - a locum who signed in but never signed out is signed out at the
--        shift end, and the booking and shift complete
--      - a confirmed shift with no sign-in asks the pharmacy, once, to record
--        whether it was worked
--  * Daily reminder job at 17:05 UTC for tomorrow's confirmed shifts.
--
-- Needs: 20261105170100_locum_production_readiness.sql (ps_locum_shift_window)
-- Edge function: supabase/functions/locum-notify (deploy with verify_jwt off;
--   uses NOTIFICATION_DISPATCH_SECRET, RESEND_API, SUPPORT_FROM_EMAIL)
-- Rollback: supabase/rollbacks/rollback_20261106190000_locum_notifications_and_closeout.sql

begin;

alter table public.ps_locum_bookings
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists completion_prompted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Fire-and-forget call to the locum-notify edge function. Never raises: a
-- notification problem must not undo a booking.
create or replace function public.ps_locum_notify(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select value into v_secret from ps_internal_secrets where key = 'notification_dispatch_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://dbgwfdrvqzuevbfrmsdt.supabase.co/functions/v1/locum-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := p_payload
  );
exception when others then
  raise warning 'ps_locum_notify failed: %', sqlerrm;
end;
$$;
revoke all on function public.ps_locum_notify(jsonb) from public, anon, authenticated;

-- Active permanent members of an org who can approve locums.
create or replace function public.ps_locum_org_managers(p_org_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.user_id), '{}')
  from ps_organisation_members m
  where m.organisation_id = p_org_id
    and m.status = 'active'
    and m.access_expires_at is null
    and case when jsonb_typeof(m.permissions -> 'approve_locums') = 'boolean'
             then (m.permissions ->> 'approve_locums')::boolean
             else ps_role_default_permission(m.role, 'approve_locums') end
$$;
revoke all on function public.ps_locum_org_managers(uuid) from public, anon, authenticated;

-- Staff alert to the pharmacy's locum managers. Never raises.
create or replace function public.ps_locum_alert_pharmacy(
  p_org_id uuid, p_title text, p_body text, p_shift_id uuid, p_metadata jsonb default '{}'
) returns void language plpgsql security definer set search_path = public as $$
declare v_targets uuid[] := ps_locum_org_managers(p_org_id);
begin
  if coalesce(array_length(v_targets, 1), 0) = 0 then return; end if;
  perform ps_fanout_notification(
    p_org_id, 'locum', p_title, p_body, '/shifts/' || p_shift_id::text,
    coalesce(p_metadata, '{}') || jsonb_build_object('shift_id', p_shift_id), v_targets, 'shared');
exception when others then
  raise warning 'ps_locum_alert_pharmacy failed: %', sqlerrm;
end;
$$;
revoke all on function public.ps_locum_alert_pharmacy(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.ps_locum_display_name(p_locum_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), u.full_name, 'A locum')
  from ps_locum_profiles lp left join ps_user_profiles u on u.id = lp.user_id
  where lp.id = p_locum_id
$$;
revoke all on function public.ps_locum_display_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Booking events
-- ---------------------------------------------------------------------------

create or replace function public.ps_locum_booking_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_shift ps_locum_shifts%rowtype;
  v_name text;
  v_when text;
  v_old text := case when tg_op = 'INSERT' then null else old.status end;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;

  select * into v_shift from ps_locum_shifts where id = new.shift_id;
  v_name := ps_locum_display_name(new.locum_id);
  v_when := to_char(v_shift.date, 'Dy DD Mon') || ' ' || to_char(v_shift.start_time, 'HH24:MI') || '–' || to_char(v_shift.end_time, 'HH24:MI');

  -- Pharmacy side
  if new.status = 'pending' and v_old is distinct from 'pending' then
    perform ps_locum_alert_pharmacy(v_shift.org_id, 'New locum application',
      v_name || ' applied for ' || v_when || '. Review it to confirm.', v_shift.id,
      jsonb_build_object('booking_id', new.id));
  elsif new.status = 'approved' and v_old is distinct from 'pending' and new.reviewed_by is null then
    -- auto-confirm shifts book straight to approved
    perform ps_locum_alert_pharmacy(v_shift.org_id, 'Locum booked',
      v_name || ' booked ' || v_when || '.', v_shift.id, jsonb_build_object('booking_id', new.id));
  elsif new.status = 'cancelled' and new.cancellation_reason = 'Withdrawn by locum' then
    perform ps_locum_alert_pharmacy(v_shift.org_id,
      case when v_old = 'approved' then 'Locum cancelled a booked shift' else 'Locum withdrew an application' end,
      v_name || ' withdrew from ' || v_when || case when v_old = 'approved' then '. The shift is open again.' else '.' end,
      v_shift.id, jsonb_build_object('booking_id', new.id));
  end if;

  -- Locum side
  if new.status = 'approved' and v_old is distinct from 'approved' then
    perform ps_locum_notify(jsonb_build_object('kind', 'booking', 'event', 'confirmed', 'booking_id', new.id));
  elsif new.status = 'rejected' and v_old = 'pending' then
    perform ps_locum_notify(jsonb_build_object('kind', 'booking', 'event', 'rejected', 'booking_id', new.id));
  elsif new.status = 'cancelled' and v_old = 'approved'
        and coalesce(new.cancellation_reason, '') <> 'Withdrawn by locum' then
    perform ps_locum_notify(jsonb_build_object('kind', 'booking', 'event', 'cancelled', 'booking_id', new.id));
  end if;

  return new;
end;
$$;

drop trigger if exists ps_locum_booking_events_trigger on public.ps_locum_bookings;
create trigger ps_locum_booking_events_trigger
  after insert or update of status on public.ps_locum_bookings
  for each row execute function public.ps_locum_booking_events();

-- ---------------------------------------------------------------------------
-- Saved-search pushes go to locum-notify
-- ---------------------------------------------------------------------------

create or replace function public.ps_queue_locum_shift_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user_ids uuid[];
begin
  if new.status <> 'open' or new.date < current_date then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'open' then return new; end if;
  select array_agg(distinct lp.user_id) into v_user_ids
  from ps_locum_saved_searches ss
  join ps_locum_profiles lp on lp.id = ss.locum_id
  where lp.compliance_status = 'approved'
    and ps_locum_saved_search_matches_shift(ss, new)
    and exists (select 1 from ps_mobile_push_tokens t where t.user_id = lp.user_id and t.enabled);
  if coalesce(array_length(v_user_ids, 1), 0) = 0 then return new; end if;
  perform ps_locum_notify(jsonb_build_object('kind', 'new_shift', 'shift_id', new.id, 'target_user_ids', to_jsonb(v_user_ids)));
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs
-- ---------------------------------------------------------------------------

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

create or replace function public.ps_locum_send_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select b.id from ps_locum_bookings b
    join ps_locum_shifts s on s.id = b.shift_id
    where b.status = 'approved' and b.reminder_sent_at is null
      and s.status <> 'cancelled'
      and s.date = (now() at time zone 'Europe/London')::date + 1
  loop
    perform ps_locum_notify(jsonb_build_object('kind', 'booking', 'event', 'reminder', 'booking_id', r.id));
    update ps_locum_bookings set reminder_sent_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.ps_locum_send_reminders() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('ps-locum-close-out', 'ps-locum-reminders');
end $$;
select cron.schedule('ps-locum-close-out', '7 * * * *', $$select public.ps_locum_close_out()$$);
select cron.schedule('ps-locum-reminders', '5 17 * * *', $$select public.ps_locum_send_reminders()$$);

-- Pharmacies get locum alerts in the bell by default; SMS and phone are opt-in
-- per pharmacy in alert settings (same as other alert types).

commit;
