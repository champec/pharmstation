-- Rollback for 20261106190000_locum_notifications_and_closeout.sql
-- Removes the booking alerts, close-out and reminder jobs and puts the old
-- saved-search push back. The two new booking columns are left in place
-- (harmless, and dropping them loses history).
begin;

do $$ begin
  perform cron.unschedule('ps-locum-close-out') where exists (select 1 from cron.job where jobname = 'ps-locum-close-out');
  perform cron.unschedule('ps-locum-reminders') where exists (select 1 from cron.job where jobname = 'ps-locum-reminders');
end $$;

drop trigger if exists ps_locum_booking_events_trigger on public.ps_locum_bookings;
drop function if exists public.ps_locum_booking_events();
drop function if exists public.ps_locum_close_out();
drop function if exists public.ps_locum_send_reminders();
drop function if exists public.ps_locum_alert_pharmacy(uuid, text, text, uuid, jsonb);
drop function if exists public.ps_locum_org_managers(uuid);
drop function if exists public.ps_locum_display_name(uuid);

CREATE OR REPLACE FUNCTION public.ps_queue_locum_shift_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret text;
  v_user_ids uuid[];
begin
  if new.status <> 'open' or new.date < current_date then return new; end if;
  if tg_op='UPDATE' and old.status='open' then return new; end if;
  select array_agg(distinct lp.user_id) into v_user_ids
  from public.ps_locum_saved_searches ss
  join public.ps_locum_profiles lp on lp.id=ss.locum_id
  where public.ps_locum_saved_search_matches_shift(ss,new)
    and exists (select 1 from public.ps_mobile_push_tokens t where t.user_id=lp.user_id and t.enabled);
  if v_user_ids is null or array_length(v_user_ids,1) is null then return new; end if;
  select value into v_secret from public.ps_internal_secrets where key='notification_dispatch_secret';
  if v_secret is not null then
    perform net.http_post(
      url := 'https://dbgwfdrvqzuevbfrmsdt.supabase.co/functions/v1/notifications-dispatch',
      headers := jsonb_build_object('Content-Type','application/json','x-internal-secret',v_secret),
      body := jsonb_build_object('shift_id',new.id,'target_user_ids',v_user_ids)
    );
  end if;
  return new;
end;
$function$;

drop function if exists public.ps_locum_notify(jsonb);

commit;
