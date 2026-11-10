-- Platform activity log for PharmStation platform admins (Monitoring page).
-- One filterable stream across every pharmacy:
--   kind 'action'  - things people did (RP sign in/out, CD entries, logs,
--                    bookings, delivery rounds, sign-ins and staff events);
--                    same sources as the manager oversight feed (ps_org_oversight)
--   kind 'view'    - page / screen views (ps_monitor_events)
--   kind 'error'   - captured errors (ps_monitor_errors)
-- Filters: date range, pharmacy, person, role, module, kind, platform, search.
-- Keyset pagination with p_before. Platform admins only.

create or replace function public.ps_admin_activity_log(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_org_id uuid default null,
  p_user_id uuid default null,
  p_role text default null,
  p_module text default null,
  p_kinds text[] default array['action', 'error'],
  p_platform text default null,           -- 'web' | 'mobile' | 'edge'
  p_search text default null,
  p_before timestamptz default null,
  p_limit int default 100
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_to timestamptz := least(coalesce(p_before, 'infinity'::timestamptz), coalesce(p_to, now() + interval '1 minute'));
  v_from timestamptz := coalesce(p_from, now() - interval '7 days');
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 500));
  v_kinds text[] := coalesce(p_kinds, array['action', 'view', 'error']);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_rows jsonb;
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden'; end if;

  with ev as (
    -- ---------------- actions ----------------
    (select e.rp_signed_in_at as at, 'action'::text as kind, 'rp'::text as module, 'web'::text as platform,
            e.organisation_id as org_id, e.entered_by as user_id,
            coalesce(e.pharmacist_name, 'Pharmacist') || ' signed in as RP' as text
       from ps_register_entries e
      where 'action' = any (v_kinds) and e.register_type = 'RP'
        and e.rp_signed_in_at >= v_from and e.rp_signed_in_at < v_to
        and (p_org_id is null or e.organisation_id = p_org_id)
        and (p_user_id is null or e.entered_by = p_user_id)
      order by 1 desc limit v_limit)
    union all
    (select e.rp_signed_out_at, 'action', 'rp', 'web', e.organisation_id, e.entered_by,
            coalesce(e.pharmacist_name, 'Pharmacist') || ' signed out as RP'
       from ps_register_entries e
      where 'action' = any (v_kinds) and e.register_type = 'RP'
        and e.rp_signed_out_at >= v_from and e.rp_signed_out_at < v_to
        and (p_org_id is null or e.organisation_id = p_org_id)
        and (p_user_id is null or e.entered_by = p_user_id)
      order by 1 desc limit v_limit)
    union all
    (select e.entered_at, 'action', 'cd', 'web', e.organisation_id, e.entered_by,
            case when e.entry_type = 'correction' then 'CD entry corrected: '
                 when e.entry_type = 'balance_check' then 'CD balance checked: '
                 when coalesce(e.quantity_received, 0) > 0 then 'CD received: '
                 else 'CD supplied: ' end || coalesce(l.drug_name, 'item')
       from ps_register_entries e
       left join ps_register_ledgers l on l.id = e.ledger_id
      where 'action' = any (v_kinds) and e.register_type = 'CD'
        and e.entered_at >= v_from and e.entered_at < v_to
        and (p_org_id is null or e.organisation_id = p_org_id)
        and (p_user_id is null or e.entered_by = p_user_id)
      order by 1 desc limit v_limit)
    union all
    (select le.created_at, 'action', 'logs', 'web', le.org_id, le.entered_by_user_id,
            coalesce(s.custom_title, t.title, 'Log') || ' filled in'
       from ps_log_entries le
       join ps_log_subscriptions s on s.id = le.subscription_id
       left join ps_log_templates t on t.id = s.template_id
      where 'action' = any (v_kinds)
        and le.created_at >= v_from and le.created_at < v_to
        and (p_org_id is null or le.org_id = p_org_id)
        and (p_user_id is null or le.entered_by_user_id = p_user_id)
      order by 1 desc limit v_limit)
    union all
    (select a.created_at, 'action', 'appointments', 'web', a.org_id, null::uuid,
            'New booking' || case when a.source is not null then ' (' || a.source || ')' else '' end
       from ps_appointments a
      where 'action' = any (v_kinds) and p_user_id is null
        and a.created_at >= v_from and a.created_at < v_to
        and (p_org_id is null or a.org_id = p_org_id)
      order by 1 desc limit v_limit)
    union all
    (select coalesce(r.completed_at, r.started_at), 'action', 'deliveries', 'web', r.organisation_id, null::uuid,
            'Delivery round "' || r.title || '" ' || case when r.completed_at is not null then 'completed' else 'started' end
       from ps_delivery_rounds r
      where 'action' = any (v_kinds) and p_user_id is null
        and coalesce(r.completed_at, r.started_at) >= v_from and coalesce(r.completed_at, r.started_at) < v_to
        and (p_org_id is null or r.organisation_id = p_org_id)
      order by 1 desc limit v_limit)
    union all
    (select ae.created_at, 'action', 'staff', 'web', ae.organisation_id, ae.user_id,
            case ae.event when 'sign_in' then 'Signed in'
                          when 'failed_sign_in' then 'Failed to sign in'
                          when 'sign_out' then 'Signed out'
                          when 'idle_sign_out' then 'Signed out after being idle'
                          when 'member_added' then 'Joined the team'
                          when 'two_step_on' then 'Turned on two-step sign-in'
                          else initcap(replace(ae.event, '_', ' ')) end
       from ps_auth_events ae
      where 'action' = any (v_kinds)
        and ae.created_at >= v_from and ae.created_at < v_to
        and (p_org_id is null or ae.organisation_id = p_org_id)
        and (p_user_id is null or ae.user_id = p_user_id)
      order by 1 desc limit v_limit)
    union all
    -- ---------------- page / screen views ----------------
    (select m.occurred_at, 'view', coalesce(nullif(split_part(m.path, '/', 2), ''), 'home'), m.source,
            m.organisation_id, m.user_id,
            case when m.source = 'mobile' then 'Opened screen ' else 'Opened page ' end || coalesce(m.path, '/')
       from ps_monitor_events m
      where 'view' = any (v_kinds)
        and m.occurred_at >= v_from and m.occurred_at < v_to
        and (p_org_id is null or m.organisation_id = p_org_id)
        and (p_user_id is null or m.user_id = p_user_id)
        and (p_platform is null or m.source = p_platform)
        and (p_module is null or coalesce(nullif(split_part(m.path, '/', 2), ''), 'home') = p_module)
      order by 1 desc limit v_limit)
    union all
    -- ---------------- errors ----------------
    (select x.occurred_at, 'error',
            case when x.source = 'edge' then coalesce(x.route, 'server') else coalesce(nullif(split_part(x.route, '/', 2), ''), 'home') end,
            x.source, x.organisation_id, x.user_id,
            x.message || coalesce(' (' || x.route || ')', '')
       from ps_monitor_errors x
      where 'error' = any (v_kinds)
        and x.occurred_at >= v_from and x.occurred_at < v_to
        and (p_org_id is null or x.organisation_id = p_org_id)
        and (p_user_id is null or x.user_id = p_user_id)
        and (p_platform is null or x.source = p_platform)
      order by 1 desc limit v_limit)
  ),
  enriched as (
    select ev.*, o.name as org_name,
           coalesce(nullif(p.full_name, ''), p.email) as user_name,
           mem.role as role
      from ev
      left join ps_organisations o on o.id = ev.org_id
      left join ps_user_profiles p on p.id = ev.user_id
      left join lateral (
        select m.role from ps_organisation_members m
         where m.user_id = ev.user_id and m.organisation_id = ev.org_id
         order by (m.status = 'active') desc limit 1
      ) mem on true
     where ev.at is not null
       and (p_platform is null or ev.platform = p_platform)
       and (p_module is null or ev.module = p_module)
       and (p_role is null or mem.role = p_role)
       and (v_search is null
            or ev.text ilike '%' || v_search || '%'
            or o.name ilike '%' || v_search || '%'
            or p.full_name ilike '%' || v_search || '%'
            or p.email ilike '%' || v_search || '%')
     order by ev.at desc
     limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'at', at, 'kind', kind, 'module', module, 'platform', platform, 'text', text,
      'org_id', org_id, 'org_name', org_name, 'user_id', user_id, 'user_name', user_name, 'role', role)
      order by at desc), '[]'::jsonb)
    into v_rows
    from enriched;

  return jsonb_build_object(
    'rows', v_rows,
    'has_more', jsonb_array_length(v_rows) >= v_limit,
    'from', v_from
  );
end $$;

revoke all on function public.ps_admin_activity_log(timestamptz, timestamptz, uuid, uuid, text, text, text[], text, text, timestamptz, int) from public, anon;
grant execute on function public.ps_admin_activity_log(timestamptz, timestamptz, uuid, uuid, text, text, text[], text, text, timestamptz, int) to authenticated;

-- Filter lists for the activity log (all pharmacies and people, not just recently active).
create or replace function public.ps_admin_activity_filters()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden'; end if;
  return jsonb_build_object(
    'pharmacies', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
                              from ps_organisations), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email, 'Unknown')) order by coalesce(nullif(p.full_name, ''), p.email))
                          from ps_user_profiles p), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(distinct role) from ps_organisation_members where role is not null), '[]'::jsonb)
  );
end $$;

revoke all on function public.ps_admin_activity_filters() from public, anon;
grant execute on function public.ps_admin_activity_filters() to authenticated;
