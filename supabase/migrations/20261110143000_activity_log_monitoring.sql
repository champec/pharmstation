-- Activity log: optional "Page views" and "Errors" kinds for platform admins,
-- from the platform monitoring tables (ps_monitor_events / ps_monitor_errors).
-- Off by default: they only appear when the admin picks that module, so the
-- normal log stays readable. p_source filters them by web, mobile (app) or edge
-- (server). Safe to run before the monitoring migration: guarded by to_regclass.

alter function public.ps_activity_log(timestamptz, timestamptz, uuid[], uuid, text, text, int, int, boolean)
  rename to ps_activity_log_core;
revoke all on function public.ps_activity_log_core(timestamptz, timestamptz, uuid[], uuid, text, text, int, int, boolean)
  from public, anon, authenticated;

create or replace function public.ps_activity_log(
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
  p_org_ids uuid[] default null,
  p_user_id uuid default null,
  p_module text default null,
  p_search text default null,
  p_limit int default 200,
  p_offset int default 0,
  p_platform boolean default false,
  p_source text default null
)
returns table (
  at timestamptz,
  org_id uuid,
  org_name text,
  module text,
  action text,
  actor_id uuid,
  actor_name text,
  detail text,
  record_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_has_org_filter boolean := p_org_ids is not null and cardinality(p_org_ids) > 0;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;

  if p_module not in ('pageviews', 'errors') or p_module is null then
    return query select * from ps_activity_log_core(p_from, p_to, p_org_ids, p_user_id, p_module, p_search, p_limit, p_offset, p_platform);
    return;
  end if;

  -- Monitoring kinds: platform admins only, and only once the tables exist.
  if not (p_platform and ps_is_platform_admin() and ps_session_is_aal2()) then return; end if;
  p_limit := least(greatest(coalesce(p_limit, 200), 1), 2000);

  if p_module = 'pageviews' and to_regclass('public.ps_monitor_events') is not null then
    return query execute $q$
      select e.occurred_at, e.organisation_id, coalesce(o.name, 'No pharmacy'), 'pageviews'::text,
             case e.source when 'mobile' then 'Opened app screen' else 'Viewed page' end,
             e.user_id,
             coalesce(nullif(p.full_name, ''), p.email, case when e.user_id is null then 'Visitor' else 'Unknown' end),
             concat_ws(' · ', e.path, case e.source when 'mobile' then 'app' else 'web' end, e.device),
             null::uuid
        from ps_monitor_events e
        left join ps_organisations o on o.id = e.organisation_id
        left join ps_user_profiles p on p.id = e.user_id
       where e.name in ('page_view', 'screen_view')
         and e.occurred_at between $1 and $2
         and ($3 is null or e.organisation_id = any ($3))
         and ($4 is null or e.user_id = $4)
         and ($5 is null or e.source = $5)
         and ($6 is null or e.path ilike '%' || $6 || '%' or p.full_name ilike '%' || $6 || '%' or o.name ilike '%' || $6 || '%')
       order by e.occurred_at desc
       limit $7 offset $8 $q$
      using p_from, p_to, case when v_has_org_filter then p_org_ids end, p_user_id, p_source, v_search,
            p_limit, greatest(coalesce(p_offset, 0), 0);
  elsif p_module = 'errors' and to_regclass('public.ps_monitor_errors') is not null then
    return query execute $q$
      select e.occurred_at, e.organisation_id, coalesce(o.name, 'No pharmacy'), 'errors'::text,
             case e.source when 'mobile' then 'App error' when 'edge' then 'Server error' else 'Web error' end,
             e.user_id,
             coalesce(nullif(p.full_name, ''), p.email, case when e.user_id is null then 'Visitor or system' else 'Unknown' end),
             concat_ws(' · ', left(e.message, 300), e.route, e.release),
             null::uuid
        from ps_monitor_errors e
        left join ps_organisations o on o.id = e.organisation_id
        left join ps_user_profiles p on p.id = e.user_id
       where e.occurred_at between $1 and $2
         and ($3 is null or e.organisation_id = any ($3))
         and ($4 is null or e.user_id = $4)
         and ($5 is null or e.source = $5)
         and ($6 is null or e.message ilike '%' || $6 || '%' or e.route ilike '%' || $6 || '%' or p.full_name ilike '%' || $6 || '%')
       order by e.occurred_at desc
       limit $7 offset $8 $q$
      using p_from, p_to, case when v_has_org_filter then p_org_ids end, p_user_id, p_source, v_search,
            p_limit, greatest(coalesce(p_offset, 0), 0);
  end if;
end;
$$;

revoke all on function public.ps_activity_log(timestamptz, timestamptz, uuid[], uuid, text, text, int, int, boolean, text) from public, anon;
grant execute on function public.ps_activity_log(timestamptz, timestamptz, uuid[], uuid, text, text, int, int, boolean, text) to authenticated;
