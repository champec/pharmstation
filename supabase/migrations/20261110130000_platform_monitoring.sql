-- Platform monitoring: error tracking + usage analytics for PharmStation
-- platform admins. Everything stays on the London project (UK data residency).
--
-- * ps_monitor_errors  - one row per captured error (web, mobile app, edge functions)
-- * ps_monitor_issues  - errors grouped by fingerprint, with status + "how to fix" notes
-- * ps_monitor_events  - lightweight usage events (page / screen views, sign-ins)
--
-- Health data rule: no patient data in telemetry. Clients scrub before sending,
-- and the triggers below scrub again server side (emails, phone numbers,
-- NHS numbers, postcodes, dates of birth, long digit runs, tokens, ids in paths).
-- Only platform admins can read any of it. Rows are kept 90 / 180 days.

-- ---------------------------------------------------------------------------
-- Scrubbing helpers
-- ---------------------------------------------------------------------------
create or replace function public.ps_monitor_scrub(p text)
returns text language sql immutable set search_path = public as $$
  select case when p is null then null else
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(p,
      'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', '<token>', 'g'),       -- JWTs
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<email>', 'g'),                    -- emails
      '\m(\+44\s?7\d{3}|07\d{3}|\+44\s?\d{2,4}|0\d{2,4})\s?\d{3}\s?\d{3,4}\M', '<phone>', 'g'), -- UK phones
      '\m\d{3}[ -]?\d{3}[ -]?\d{4}\M', '<nhs>', 'g'),                                       -- NHS numbers / 10 digits
      '\m[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}\M', '<postcode>', 'g'),                 -- UK postcodes
      '\m\d{1,2}[/.-]\d{1,2}[/.-](19|20)\d{2}\M', '<date>', 'g'),                           -- dd/mm/yyyy
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id', 'g'), -- uuids
      '\d{6,}', '<n>', 'g')                                                                 -- other long numbers
  end
$$;

-- Paths: drop query strings / hashes, then scrub ids.
create or replace function public.ps_monitor_clean_path(p text)
returns text language sql immutable set search_path = public as $$
  select case when p is null then null
    else left(regexp_replace(public.ps_monitor_scrub(split_part(split_part(p, '?', 1), '#', 1)), '/\d+(/|$)', '/:n\1', 'g'), 300)
  end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.ps_monitor_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source text not null check (source in ('web', 'mobile', 'edge')),
  title text not null,
  culprit text,                     -- page, screen or edge function where it happens
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  event_count integer not null default 0,
  last_release text,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  regressed boolean not null default false,
  fix_note text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create index if not exists ps_monitor_issues_last_seen_idx on public.ps_monitor_issues (last_seen desc);

create table if not exists public.ps_monitor_errors (
  id bigint generated always as identity primary key,
  issue_id uuid references public.ps_monitor_issues(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('web', 'mobile', 'edge')),
  message text not null check (length(message) <= 2000),
  stack text check (length(stack) <= 8000),
  route text check (length(route) <= 500),
  release text check (length(release) <= 80),
  device text check (length(device) <= 300),
  user_id uuid default auth.uid(),
  organisation_id uuid,
  session_id text check (length(session_id) <= 64),
  context jsonb check (context is null or pg_column_size(context) <= 4000)
);
create index if not exists ps_monitor_errors_issue_idx on public.ps_monitor_errors (issue_id, occurred_at desc);
create index if not exists ps_monitor_errors_time_idx on public.ps_monitor_errors (occurred_at desc);

create table if not exists public.ps_monitor_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('web', 'mobile')),
  name text not null check (name ~ '^[a-z][a-z0-9_.]{1,59}$'),
  path text check (length(path) <= 500),
  user_id uuid default auth.uid(),
  organisation_id uuid,
  session_id text check (length(session_id) <= 64),
  release text check (length(release) <= 80),
  device text check (length(device) <= 300)
);
create index if not exists ps_monitor_events_time_idx on public.ps_monitor_events (occurred_at desc);
create index if not exists ps_monitor_events_user_idx on public.ps_monitor_events (user_id, occurred_at desc);
create index if not exists ps_monitor_events_org_idx on public.ps_monitor_events (organisation_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Triggers: scrub, validate org, group errors into issues
-- ---------------------------------------------------------------------------
create or replace function public.ps_monitor_errors_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_frame text;
  v_fp text;
  v_issue uuid;
begin
  -- Edge functions write with the service role and may name any user/org;
  -- browsers and the app can only name themselves and their own pharmacies.
  if auth.role() is distinct from 'service_role' then
    new.user_id := auth.uid();
    if new.organisation_id is not null
       and not exists (select 1 from ps_get_user_org_ids() o where o = new.organisation_id)
       and not exists (select 1 from ps_organisations o where o.id = new.organisation_id and o.auth_user_id = auth.uid()) then
      new.organisation_id := null;
    end if;
  end if;

  new.message := left(ps_monitor_scrub(new.message), 2000);
  new.stack := left(ps_monitor_scrub(new.stack), 8000);
  new.route := ps_monitor_clean_path(new.route);
  new.device := left(new.device, 300);
  if new.context is not null then
    begin
      new.context := ps_monitor_scrub(new.context::text)::jsonb;
    exception when others then
      -- scrubbing a bare number can leave invalid JSON; keep it as text instead
      new.context := jsonb_build_object('scrubbed', left(ps_monitor_scrub(new.context::text), 3000));
    end;
  end if;
  new.occurred_at := now();

  -- Fingerprint: source + message with numbers/ids flattened + first stack frame
  v_frame := coalesce(substring(new.stack from '(?:at |@)([^\n]{1,200})'), new.route, '');
  v_frame := regexp_replace(v_frame, ':\d+(:\d+)?', '', 'g');  -- line/col numbers change between builds
  v_frame := regexp_replace(v_frame, '[-.][0-9a-zA-Z_-]{8}\.(js|mjs)', '.\1', 'g'); -- hashed bundle names
  v_fp := md5(new.source || '|' || regexp_replace(lower(left(new.message, 300)), '[0-9]+', '#', 'g') || '|' || v_frame);

  insert into ps_monitor_issues as i (fingerprint, source, title, culprit, event_count, last_release)
  values (v_fp, new.source, left(new.message, 300), new.route, 1, new.release)
  on conflict (fingerprint) do update
    set last_seen = now(),
        event_count = i.event_count + 1,
        last_release = coalesce(excluded.last_release, i.last_release),
        culprit = coalesce(excluded.culprit, i.culprit),
        -- A resolved issue that comes back is reopened and flagged.
        regressed = i.regressed or i.status = 'resolved',
        status = case when i.status = 'resolved' then 'open' else i.status end
  returning id into v_issue;

  new.issue_id := v_issue;
  return new;
end $$;

drop trigger if exists ps_monitor_errors_before_insert on public.ps_monitor_errors;
create trigger ps_monitor_errors_before_insert before insert on public.ps_monitor_errors
  for each row execute function public.ps_monitor_errors_before_insert();

create or replace function public.ps_monitor_events_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then
    new.user_id := auth.uid();
    if new.organisation_id is not null
       and not exists (select 1 from ps_get_user_org_ids() o where o = new.organisation_id)
       and not exists (select 1 from ps_organisations o where o.id = new.organisation_id and o.auth_user_id = auth.uid()) then
      new.organisation_id := null;
    end if;
  end if;
  new.path := ps_monitor_clean_path(new.path);
  new.occurred_at := now();
  return new;
end $$;

drop trigger if exists ps_monitor_events_before_insert on public.ps_monitor_events;
create trigger ps_monitor_events_before_insert before insert on public.ps_monitor_events
  for each row execute function public.ps_monitor_events_before_insert();

-- ---------------------------------------------------------------------------
-- RLS: anyone may report an error, signed-in people may record usage,
-- only platform admins read or manage.
-- ---------------------------------------------------------------------------
alter table public.ps_monitor_issues enable row level security;
alter table public.ps_monitor_errors enable row level security;
alter table public.ps_monitor_events enable row level security;

revoke all on public.ps_monitor_issues, public.ps_monitor_errors, public.ps_monitor_events from anon, authenticated;
grant insert (source, message, stack, route, release, device, organisation_id, session_id, context)
  on public.ps_monitor_errors to anon, authenticated;
grant insert (source, name, path, organisation_id, session_id, release, device)
  on public.ps_monitor_events to authenticated;
grant select on public.ps_monitor_errors, public.ps_monitor_events, public.ps_monitor_issues to authenticated;
grant update (status, fix_note, regressed, resolved_at, resolved_by) on public.ps_monitor_issues to authenticated;
grant delete on public.ps_monitor_issues to authenticated;

drop policy if exists monitor_errors_insert on public.ps_monitor_errors;
create policy monitor_errors_insert on public.ps_monitor_errors for insert to anon, authenticated
  with check (source in ('web', 'mobile'));
drop policy if exists monitor_errors_admin_read on public.ps_monitor_errors;
create policy monitor_errors_admin_read on public.ps_monitor_errors for select to authenticated
  using (ps_is_platform_admin());

drop policy if exists monitor_events_insert on public.ps_monitor_events;
create policy monitor_events_insert on public.ps_monitor_events for insert to authenticated
  with check (true);
drop policy if exists monitor_events_admin_read on public.ps_monitor_events;
create policy monitor_events_admin_read on public.ps_monitor_events for select to authenticated
  using (ps_is_platform_admin());

drop policy if exists monitor_issues_admin_read on public.ps_monitor_issues;
create policy monitor_issues_admin_read on public.ps_monitor_issues for select to authenticated
  using (ps_is_platform_admin());
drop policy if exists monitor_issues_admin_update on public.ps_monitor_issues;
create policy monitor_issues_admin_update on public.ps_monitor_issues for update to authenticated
  using (ps_is_platform_admin()) with check (ps_is_platform_admin());
drop policy if exists monitor_issues_admin_delete on public.ps_monitor_issues;
create policy monitor_issues_admin_delete on public.ps_monitor_issues for delete to authenticated
  using (ps_is_platform_admin());

-- ---------------------------------------------------------------------------
-- Dashboard summary for platform admins
-- ---------------------------------------------------------------------------
create or replace function public.ps_admin_monitoring_overview(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 14), 90));
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v_result jsonb;
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden'; end if;

  select jsonb_build_object(
    'generated_at', now(),
    'days', v_days,
    'totals', jsonb_build_object(
      'users_1d', (select count(distinct user_id) from ps_monitor_events where occurred_at > now() - interval '1 day'),
      'users_7d', (select count(distinct user_id) from ps_monitor_events where occurred_at > now() - interval '7 days'),
      'users_30d', (select count(distinct user_id) from ps_monitor_events where occurred_at > now() - interval '30 days'),
      'pharmacies_7d', (select count(distinct organisation_id) from ps_monitor_events where occurred_at > now() - interval '7 days'),
      'web_users_7d', (select count(distinct user_id) from ps_monitor_events where source = 'web' and occurred_at > now() - interval '7 days'),
      'mobile_users_7d', (select count(distinct user_id) from ps_monitor_events where source = 'mobile' and occurred_at > now() - interval '7 days'),
      'errors_24h', (select count(*) from ps_monitor_errors where occurred_at > now() - interval '1 day'),
      'users_hit_by_errors_24h', (select count(distinct user_id) from ps_monitor_errors where occurred_at > now() - interval '1 day'),
      'open_issues', (select count(*) from ps_monitor_issues where status = 'open'),
      'regressed_issues', (select count(*) from ps_monitor_issues where status = 'open' and regressed)
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'users', d.users, 'events', d.events, 'errors', d.errors) order by d.day)
      from (
        select g.day::date as day,
          (select count(distinct user_id) from ps_monitor_events e where e.occurred_at >= g.day and e.occurred_at < g.day + interval '1 day') as users,
          (select count(*) from ps_monitor_events e where e.occurred_at >= g.day and e.occurred_at < g.day + interval '1 day') as events,
          (select count(*) from ps_monitor_errors x where x.occurred_at >= g.day and x.occurred_at < g.day + interval '1 day') as errors
        from generate_series(v_since, date_trunc('day', now()), interval '1 day') as g(day)
      ) d), '[]'::jsonb),
    'top_pages', coalesce((
      select jsonb_agg(t) from (
        select source, path, count(*) as views, count(distinct user_id) as users
        from ps_monitor_events
        where occurred_at >= v_since and name in ('page_view', 'screen_view') and path is not null
        group by source, path order by count(*) desc limit 20
      ) t), '[]'::jsonb),
    'pharmacies', coalesce((
      select jsonb_agg(t) from (
        select e.organisation_id as id, o.name, count(distinct e.user_id) as users, count(*) as events,
          max(e.occurred_at) as last_seen,
          bool_or(e.source = 'mobile') as uses_app,
          (select count(*) from ps_monitor_errors x where x.organisation_id = e.organisation_id and x.occurred_at >= v_since) as errors
        from ps_monitor_events e left join ps_organisations o on o.id = e.organisation_id
        where e.occurred_at >= v_since and e.organisation_id is not null
        group by e.organisation_id, o.name order by max(e.occurred_at) desc limit 100
      ) t), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(t) from (
        select e.user_id as id, coalesce(nullif(p.full_name, ''), p.email, 'Unknown') as name,
          (select o.name from ps_organisations o where o.id = (array_agg(e.organisation_id order by e.occurred_at desc) filter (where e.organisation_id is not null))[1]) as pharmacy,
          count(*) as events, count(distinct e.session_id) as sessions, max(e.occurred_at) as last_seen,
          string_agg(distinct e.source, ', ') as platforms,
          (select count(*) from ps_monitor_errors x where x.user_id = e.user_id and x.occurred_at >= v_since) as errors
        from ps_monitor_events e left join ps_user_profiles p on p.id = e.user_id
        where e.occurred_at >= v_since and e.user_id is not null
        group by e.user_id, p.full_name, p.email order by max(e.occurred_at) desc limit 100
      ) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.ps_admin_monitoring_overview(integer) from public, anon;
grant execute on function public.ps_admin_monitoring_overview(integer) to authenticated;
revoke all on function public.ps_monitor_errors_before_insert() from public, anon, authenticated;
revoke all on function public.ps_monitor_events_before_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ps-monitor-retention';
    perform cron.schedule('ps-monitor-retention', '17 3 * * *', $job$
      delete from public.ps_monitor_errors where occurred_at < now() - interval '90 days';
      delete from public.ps_monitor_events where occurred_at < now() - interval '180 days';
      delete from public.ps_monitor_issues i where i.last_seen < now() - interval '90 days'
        and not exists (select 1 from public.ps_monitor_errors e where e.issue_id = i.id);
    $job$);
  end if;
end $$;
