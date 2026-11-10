-- RP log: sessions left open overnight (QA #94, 10 Nov 2026, logs thread).
--
-- 1. ps_rp_is_stale: a session is "stale" once it has run more than 12 hours,
--    or more than 8 hours across midnight (UK). Mirrored in apps/web/src/lib/rpLog.ts
--    and apps/mobile/src/lib/rp-log.ts.
-- 2. ps_rp_sign_in: taking over from a stale session is refused (RP_STALE) so the
--    app asks when the previous RP really finished and signs them out at that
--    time first (ps_rp_sign_out with p_at and a reason, kept as a correction).
-- 3. Reminders, hourly by pg_cron: after 10 hours the signed-in RP gets a
--    "still signed in?" alert (personal); after 14 hours the whole pharmacy does.
--    Event type 'rp_reminder', mobile push on by default.
-- Re-runnable.

create or replace function public.ps_rp_is_stale(p_signed_in_at timestamptz, p_at timestamptz default now())
returns boolean
language sql
immutable
as $$
  select p_signed_in_at is not null and (
    p_at - p_signed_in_at > interval '12 hours'
    or ((p_signed_in_at at time zone 'Europe/London')::date < (p_at at time zone 'Europe/London')::date
        and p_at - p_signed_in_at > interval '8 hours')
  );
$$;

create or replace function public.ps_rp_sign_in(p_organisation_id uuid, p_take_over boolean default false, p_notes text default null)
returns public.ps_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile ps_user_profiles;
  v_ledger ps_register_ledgers;
  v_open ps_register_entries;
  v_now timestamptz := now();
  v_new ps_register_entries;
  v_elsewhere text;
begin
  perform set_config('ps.rp_rpc', 'on', true);
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not ps_member_has_permission(p_organisation_id, 'rp_log_sign') then
    raise exception 'Only pharmacists can sign in as the Responsible Pharmacist' using errcode = '42501';
  end if;

  select * into v_profile from ps_user_profiles where id = v_uid;
  if coalesce(trim(v_profile.gphc_number), '') = '' then
    raise exception 'Add your GPhC number to your profile before signing in as RP';
  end if;

  -- A pharmacist can only be RP at one pharmacy at a time.
  select o.name into v_elsewhere
  from ps_organisation_members m
  join ps_organisations o on o.id = m.organisation_id
  cross join lateral public.ps_rp_open_sessions(m.organisation_id) s
  where m.user_id = v_uid and m.organisation_id <> p_organisation_id
    and s.gphc_number = v_profile.gphc_number
  limit 1;
  if v_elsewhere is not null then
    raise exception 'You are still signed in as RP at %. Sign out there first.', v_elsewhere;
  end if;

  v_ledger := public.ps_rp_ledger(p_organisation_id);
  perform 1 from ps_register_ledgers where id = v_ledger.id for update;

  for v_open in select * from public.ps_rp_open_sessions(p_organisation_id) loop
    if v_open.gphc_number = v_profile.gphc_number then
      raise exception 'You are already signed in as RP';
    end if;
    if p_take_over and public.ps_rp_is_stale(v_open.rp_signed_in_at, v_now) then
      raise exception 'RP_STALE: % has been signed in since %. Record when they finished first.',
        v_open.pharmacist_name, to_char(v_open.rp_signed_in_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI');
    end if;
    if not p_take_over then
      raise exception 'RP_ON_DUTY: % is still signed in as RP', v_open.pharmacist_name;
    end if;
    perform public.ps_rp_close_session(
      public.ps_rp_root_entry(v_open.id), v_now,
      format('Signed out at handover to %s', v_profile.full_name));
  end loop;

  select * into v_new from ps_make_register_entry(
    p_ledger_id => v_ledger.id,
    p_register_type => 'RP',
    p_entry_type => 'normal',
    p_date_of_transaction => (v_now at time zone 'Europe/London')::date,
    p_notes => nullif(left(trim(coalesce(p_notes, '')), 200), ''),
    p_source => 'manual',
    p_authorised_by => v_profile.full_name,
    p_pharmacist_name => v_profile.full_name,
    p_gphc_number => trim(v_profile.gphc_number),
    p_rp_signed_in_at => v_now,
    p_rp_signed_out_at => null
  );
  return v_new;
end;
$$;

create table if not exists public.ps_rp_reminders (
  root_id uuid not null,
  kind text not null check (kind in ('rp', 'pharmacy')),
  sent_at timestamptz not null default now(),
  primary key (root_id, kind)
);
alter table public.ps_rp_reminders enable row level security;

create or replace function public.ps_rp_send_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org record;
  v_s ps_register_entries;
  v_root uuid;
  v_hours numeric;
  v_uid uuid;
  v_since text;
  v_count int := 0;
begin
  for v_org in
    select distinct n.organisation_id as id
    from ps_register_entries n
    where n.register_type = 'RP' and n.entry_type = 'normal'
      and n.date_of_transaction >= (now() at time zone 'Europe/London')::date - 2
      and n.rp_signed_in_at is not null and n.rp_signed_out_at is null
  loop
    for v_s in select * from public.ps_rp_open_sessions(v_org.id) loop
      v_root := public.ps_rp_root_entry(v_s.id);
      v_hours := extract(epoch from now() - v_s.rp_signed_in_at) / 3600;
      v_since := to_char(v_s.rp_signed_in_at at time zone 'Europe/London', 'HH24:MI')
        || case when (v_s.rp_signed_in_at at time zone 'Europe/London')::date < (now() at time zone 'Europe/London')::date
                then ' ' || to_char(v_s.rp_signed_in_at at time zone 'Europe/London', 'Dy DD Mon') else '' end;

      if v_hours >= 10 and not exists (select 1 from ps_rp_reminders where root_id = v_root and kind = 'rp') then
        select m.user_id into v_uid
        from ps_organisation_members m join ps_user_profiles p on p.id = m.user_id
        where m.organisation_id = v_org.id and m.status = 'active'
          and trim(p.gphc_number) = trim(v_s.gphc_number)
        limit 1;
        insert into ps_rp_reminders (root_id, kind) values (v_root, 'rp');
        if v_uid is not null then
          perform ps_fanout_notification(
            v_org.id, 'rp_reminder', 'Still signed in as RP?',
            'You have been the Responsible Pharmacist since ' || v_since || '. If you have finished for the day, sign out of the RP log.',
            '/registers/rp', jsonb_build_object('entry_id', v_root), array[v_uid], 'personal');
          v_count := v_count + 1;
        end if;
      end if;

      if v_hours >= 14 and not exists (select 1 from ps_rp_reminders where root_id = v_root and kind = 'pharmacy') then
        insert into ps_rp_reminders (root_id, kind) values (v_root, 'pharmacy');
        perform ps_fanout_notification(
          v_org.id, 'rp_reminder', 'RP still signed in from ' || v_since,
          v_s.pharmacist_name || ' is still signed in as Responsible Pharmacist. If they have left, record when they finished on the RP log.',
          '/registers/rp', jsonb_build_object('entry_id', v_root), null, 'shared');
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ps_rp_send_reminders() from public, anon, authenticated;
grant execute on function public.ps_rp_is_stale(timestamptz, timestamptz) to authenticated;

-- RP reminders go to phones by default (the org can change it in alert settings).
update public.ps_org_alert_settings
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('rp_reminder',
  jsonb_build_object('web', true, 'sms', false, 'mobile', true, 'desktop', false))
where not coalesce(settings ? 'rp_reminder', false);

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ps-rp-reminders';
    perform cron.schedule('ps-rp-reminders', '5 * * * *', 'select public.ps_rp_send_reminders()');
  end if;
end $$;
