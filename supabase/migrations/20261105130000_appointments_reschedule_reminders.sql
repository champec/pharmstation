-- ============================================================
-- Appointments Phase 2: rescheduling keeps slot counts right, reminder
-- texts (and video links) are sent by a scheduled job.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Moving a booking to another slot adjusts both slots' counts
-- ------------------------------------------------------------
-- Before: only INSERT took a place and only a change to 'cancelled' gave
-- one back, so changing slot_id left the old slot full and the new one
-- over capacity. This covers staff edits and the reschedule action alike.
create or replace function public.ps_appointment_slot_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.slot_id is not distinct from old.slot_id then return new; end if;
  -- A cancelled booking holds no place, so only an active one moves.
  if old.status = 'cancelled' or new.status = 'cancelled' then return new; end if;

  if new.slot_id is not null then
    update ps_appointment_slots set booked_count = booked_count + 1
     where id = new.slot_id and is_active and booked_count < max_bookings;
    if not found then
      raise exception 'That time is fully booked. Please pick another.' using errcode = 'P0001';
    end if;
  end if;
  if old.slot_id is not null then
    update ps_appointment_slots set booked_count = greatest(booked_count - 1, 0)
     where id = old.slot_id;
  end if;
  -- A moved booking needs a fresh reminder.
  new.reminder_sent_at := null;
  return new;
end $$;

drop trigger if exists ps_appointment_slot_move on public.ps_appointments;
create trigger ps_appointment_slot_move
  before update of slot_id on public.ps_appointments
  for each row execute function public.ps_appointment_slot_move();

-- ------------------------------------------------------------
-- 2. Reminder job: pg_cron calls the appointments function every 15 min
-- ------------------------------------------------------------
-- The function reads the same secret from ps_internal_secrets, so there is
-- nothing to copy into edge function secrets.
insert into ps_internal_secrets (key, value)
values ('appointments_cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.ps_run_appointment_jobs()
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select value into v_secret from ps_internal_secrets where key = 'appointments_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://dbgwfdrvqzuevbfrmsdt.supabase.co/functions/v1/appointments',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := jsonb_build_object('action', 'run_jobs')
  );
end $$;
revoke execute on function public.ps_run_appointment_jobs() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ps-appointment-jobs';
select cron.schedule('ps-appointment-jobs', '*/15 * * * *', $$select public.ps_run_appointment_jobs()$$);

create index if not exists ps_appointments_reminder_idx
  on public.ps_appointments (status)
  where reminder_sent_at is null and status in ('pending', 'confirmed');
