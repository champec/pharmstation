-- Organisation oversight dashboard (owners / managers across one or more pharmacies).
-- One read-only RPC that summarises every organisation where the caller holds the
-- view_audit permission (owner + manager by default; needs two-step sign-in).
-- Returns per-pharmacy status (RP, CD, logs, bookings, deliveries, SOPs, staff,
-- safety, shop, NHS 111), a list of alerts, and a recent activity feed.

create or replace function public.ps_org_oversight(p_activity_limit int default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/London')::date;
  v_dow int := extract(dow from (now() at time zone 'Europe/London'))::int;
  v_day_start timestamptz := (v_today::timestamp at time zone 'Europe/London');
  v_org_ids uuid[];
  v_orgs jsonb;
  v_activity jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select coalesce(array_agg(m.organisation_id), '{}')
    into v_org_ids
  from ps_organisation_members m
  where m.user_id = v_uid
    and m.status = 'active'
    and ps_member_has_permission(m.organisation_id, 'view_audit');

  with orgs as (
    select o.id, o.name, o.address
    from ps_organisations o
    where o.id = any (v_org_ids)
  ),
  rp as (
    select distinct on (e.organisation_id)
      e.organisation_id, e.pharmacist_name, e.rp_signed_in_at
    from ps_register_entries e
    where e.organisation_id = any (v_org_ids)
      and e.register_type = 'RP'
      and e.rp_signed_in_at > now() - interval '36 hours'
      and e.rp_signed_out_at is null
      and not exists (select 1 from ps_register_entries c where c.corrects_entry_id = e.id)
    order by e.organisation_id, e.rp_signed_in_at desc
  ),
  rp_last as (
    select distinct on (e.organisation_id)
      e.organisation_id, e.pharmacist_name, coalesce(e.rp_signed_out_at, e.rp_signed_in_at) as at
    from ps_register_entries e
    where e.organisation_id = any (v_org_ids)
      and e.register_type = 'RP'
      and not exists (select 1 from ps_register_entries c where c.corrects_entry_id = e.id)
    order by e.organisation_id, e.entered_at desc
  ),
  cd_check as (
    select distinct on (b.organisation_id)
      b.organisation_id, b.completed_at, b.discrepancy_count
    from ps_balance_check_sessions b
    where b.organisation_id = any (v_org_ids) and b.status = 'completed'
    order by b.organisation_id, b.completed_at desc nulls last
  ),
  cd_counts as (
    select e.organisation_id,
      count(*) filter (where e.entered_at >= now() - interval '7 days') as entries_7d,
      count(*) filter (where e.entered_at >= now() - interval '7 days' and e.entry_type = 'correction') as corrections_7d
    from ps_register_entries e
    where e.organisation_id = any (v_org_ids) and e.register_type = 'CD'
    group by e.organisation_id
  ),
  logs_due as (
    select s.org_id, s.id as subscription_id, coalesce(s.custom_title, t.title) as title,
      exists (
        select 1 from ps_log_entries le
        where le.subscription_id = s.id and le.entry_date = v_today
          and le.voided_at is null and le.superseded_at is null
      ) as done
    from ps_log_subscriptions s
    join ps_log_templates t on t.id = s.template_id
    where s.org_id = any (v_org_ids)
      and s.is_active
      and (t.schedule_type = 'daily'
           or (t.schedule_type = 'custom_days' and v_dow = any (t.required_days)))
  ),
  logs_sum as (
    select org_id,
      count(*) as due_today,
      count(*) filter (where done) as done_today,
      coalesce(jsonb_agg(title order by title) filter (where not done), '[]') as missing
    from logs_due group by org_id
  ),
  appts as (
    select a.org_id,
      count(*) filter (where sl.start_time >= v_day_start and sl.start_time < v_day_start + interval '1 day'
                         and a.status in ('pending','confirmed','completed','no_show')) as today,
      count(*) filter (where sl.start_time >= now() and sl.start_time < now() + interval '7 days'
                         and a.status in ('pending','confirmed')) as upcoming_7d,
      count(*) filter (where a.status = 'pending' and sl.start_time >= now()) as awaiting_confirmation,
      count(*) filter (where a.status = 'no_show' and sl.start_time >= now() - interval '7 days') as no_shows_7d
    from ps_appointments a
    join ps_appointment_slots sl on sl.id = a.slot_id
    where a.org_id = any (v_org_ids)
    group by a.org_id
  ),
  rounds as (
    select r.organisation_id,
      count(*) filter (where r.scheduled_date = v_today) as today,
      count(*) filter (where r.status = 'in_progress') as in_progress,
      count(*) filter (where r.status = 'completed' and r.completed_at >= v_day_start) as completed_today,
      count(*) filter (where r.status in ('scheduled','draft') and r.scheduled_date < v_today) as overdue
    from ps_delivery_rounds r
    where r.organisation_id = any (v_org_ids)
    group by r.organisation_id
  ),
  sops as (
    select a.org_id, count(*) as outstanding
    from ps_sop_assignments a
    join ps_organisation_members m on m.id = a.member_id and m.status = 'active'
    where a.org_id = any (v_org_ids)
      and not exists (
        select 1 from ps_sop_completions c
        where c.document_id = a.document_id and c.member_id = a.member_id
      )
    group by a.org_id
  ),
  staff as (
    select m.organisation_id,
      count(*) as active,
      count(*) filter (where m.last_active_at >= v_day_start) as active_today
    from ps_organisation_members m
    where m.organisation_id = any (v_org_ids) and m.status = 'active'
    group by m.organisation_id
  ),
  auth_ev as (
    select ae.organisation_id,
      count(*) filter (where ae.event = 'sign_in' and ae.created_at >= v_day_start) as sign_ins_today,
      count(*) filter (where ae.event = 'failed_sign_in' and ae.created_at >= now() - interval '7 days') as failed_7d
    from ps_auth_events ae
    where ae.organisation_id = any (v_org_ids)
    group by ae.organisation_id
  ),
  safety as (
    select r.org_id, count(*) filter (where r.status = 'draft') as drafts
    from ps_patient_safety_reports r
    where r.org_id = any (v_org_ids)
    group by r.org_id
  ),
  shop as (
    select o.org_id,
      count(*) filter (where o.review_status = 'pending') as to_review,
      count(*) filter (where o.status not in ('completed','cancelled','refunded','collected','delivered')) as open_orders
    from ps_shop_orders o
    where o.org_id = any (v_org_ids)
    group by o.org_id
  ),
  n111 as (
    select r.org_id, count(*) as open
    from ps_nhs111_referrals r
    where r.org_id = any (v_org_ids) and r.status not in ('completed','rejected','cancelled')
    group by r.org_id
  ),
  per_org as (
    select o.id, o.name,
      jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'town', coalesce(o.address->>'town', o.address->>'city'),
        'rp', case when rp.organisation_id is null then null
                   else jsonb_build_object('name', rp.pharmacist_name, 'since', rp.rp_signed_in_at) end,
        'rp_last', case when rp_last.organisation_id is null then null
                   else jsonb_build_object('name', rp_last.pharmacist_name, 'at', rp_last.at) end,
        'cd', jsonb_build_object(
          'last_check_at', cd_check.completed_at,
          'last_check_discrepancies', coalesce(cd_check.discrepancy_count, 0),
          'entries_7d', coalesce(cd_counts.entries_7d, 0),
          'corrections_7d', coalesce(cd_counts.corrections_7d, 0)),
        'logs', jsonb_build_object(
          'due_today', coalesce(logs_sum.due_today, 0),
          'done_today', coalesce(logs_sum.done_today, 0),
          'missing', coalesce(logs_sum.missing, '[]'::jsonb)),
        'appointments', jsonb_build_object(
          'today', coalesce(appts.today, 0),
          'upcoming_7d', coalesce(appts.upcoming_7d, 0),
          'awaiting_confirmation', coalesce(appts.awaiting_confirmation, 0),
          'no_shows_7d', coalesce(appts.no_shows_7d, 0)),
        'deliveries', jsonb_build_object(
          'today', coalesce(rounds.today, 0),
          'in_progress', coalesce(rounds.in_progress, 0),
          'completed_today', coalesce(rounds.completed_today, 0),
          'overdue', coalesce(rounds.overdue, 0)),
        'sops', jsonb_build_object('outstanding', coalesce(sops.outstanding, 0)),
        'staff', jsonb_build_object(
          'active', coalesce(staff.active, 0),
          'active_today', coalesce(staff.active_today, 0),
          'sign_ins_today', coalesce(auth_ev.sign_ins_today, 0),
          'failed_sign_ins_7d', coalesce(auth_ev.failed_7d, 0)),
        'safety', jsonb_build_object('drafts', coalesce(safety.drafts, 0)),
        'shop', jsonb_build_object(
          'to_review', coalesce(shop.to_review, 0),
          'open_orders', coalesce(shop.open_orders, 0)),
        'nhs111', jsonb_build_object('open', coalesce(n111.open, 0)),
        'alerts', (
          select coalesce(jsonb_agg(a order by (a->>'level') = 'info', (a->>'level') = 'warning'), '[]'::jsonb)
          from (
            select jsonb_build_object('level', 'warning', 'module', 'rp', 'text', 'No responsible pharmacist signed in') a
              where rp.organisation_id is null
            union all
            select jsonb_build_object('level', 'warning', 'module', 'rp',
                     'text', 'RP signed in for over 14 hours, check they signed out')
              where rp.rp_signed_in_at < now() - interval '14 hours'
            union all
            select jsonb_build_object('level', case when cd_check.completed_at is null then 'warning' else 'warning' end,
                     'module', 'cd',
                     'text', case when cd_check.completed_at is null then 'No CD balance check recorded yet'
                                  else 'CD balance check overdue (last ' || to_char(cd_check.completed_at at time zone 'Europe/London', 'FMDD Mon') || ')' end)
              where cd_check.completed_at is null or cd_check.completed_at < now() - interval '7 days'
            union all
            select jsonb_build_object('level', 'error', 'module', 'cd',
                     'text', cd_check.discrepancy_count || ' discrepancy found at the last CD balance check')
              where coalesce(cd_check.discrepancy_count, 0) > 0
            union all
            select jsonb_build_object('level', 'warning', 'module', 'logs',
                     'text', (logs_sum.due_today - logs_sum.done_today) || ' log(s) not filled in today')
              where logs_sum.due_today > logs_sum.done_today
            union all
            select jsonb_build_object('level', 'error', 'module', 'deliveries',
                     'text', rounds.overdue || ' delivery round(s) from earlier days not started')
              where rounds.overdue > 0
            union all
            select jsonb_build_object('level', 'warning', 'module', 'appointments',
                     'text', appts.awaiting_confirmation || ' booking(s) waiting to be confirmed')
              where appts.awaiting_confirmation > 0
            union all
            select jsonb_build_object('level', 'warning', 'module', 'sops',
                     'text', sops.outstanding || ' SOP sign-off(s) outstanding')
              where sops.outstanding > 0
            union all
            select jsonb_build_object('level', 'error', 'module', 'staff',
                     'text', auth_ev.failed_7d || ' failed sign-in attempt(s) in the last 7 days')
              where auth_ev.failed_7d >= 3
            union all
            select jsonb_build_object('level', 'warning', 'module', 'safety',
                     'text', safety.drafts || ' patient safety report(s) still in draft')
              where safety.drafts > 0
            union all
            select jsonb_build_object('level', 'warning', 'module', 'shop',
                     'text', shop.to_review || ' shop order(s) waiting for pharmacist review')
              where shop.to_review > 0
            union all
            select jsonb_build_object('level', 'error', 'module', 'nhs111',
                     'text', n111.open || ' NHS 111 referral(s) not yet completed')
              where n111.open > 0
          ) x
        )
      ) as data
    from orgs o
    left join rp on rp.organisation_id = o.id
    left join rp_last on rp_last.organisation_id = o.id
    left join cd_check on cd_check.organisation_id = o.id
    left join cd_counts on cd_counts.organisation_id = o.id
    left join logs_sum on logs_sum.org_id = o.id
    left join appts on appts.org_id = o.id
    left join rounds on rounds.organisation_id = o.id
    left join sops on sops.org_id = o.id
    left join staff on staff.organisation_id = o.id
    left join auth_ev on auth_ev.organisation_id = o.id
    left join safety on safety.org_id = o.id
    left join shop on shop.org_id = o.id
    left join n111 on n111.org_id = o.id
  )
  select coalesce(jsonb_agg(data order by name), '[]'::jsonb) into v_orgs from per_org;

  with ev as (
    -- RP sign in / out
    (select e.organisation_id as org_id, e.rp_signed_in_at as at, 'rp' as module,
            coalesce(e.pharmacist_name, 'Pharmacist') || ' signed in as RP' as text
       from ps_register_entries e
      where e.organisation_id = any (v_org_ids) and e.register_type = 'RP'
        and e.rp_signed_in_at > now() - interval '7 days'
        and not exists (select 1 from ps_register_entries c where c.corrects_entry_id = e.id)
      order by 2 desc limit p_activity_limit)
    union all
    (select e.organisation_id, e.rp_signed_out_at, 'rp',
            coalesce(e.pharmacist_name, 'Pharmacist') || ' signed out as RP'
       from ps_register_entries e
      where e.organisation_id = any (v_org_ids) and e.register_type = 'RP'
        and e.rp_signed_out_at > now() - interval '7 days'
        and not exists (select 1 from ps_register_entries c where c.corrects_entry_id = e.id)
      order by 2 desc limit p_activity_limit)
    union all
    -- CD register entries
    (select e.organisation_id, e.entered_at, 'cd',
            case when e.entry_type = 'correction' then 'CD entry corrected: '
                 when e.entry_type = 'balance_check' then 'CD balance checked: '
                 when coalesce(e.quantity_received, 0) > 0 then 'CD received: '
                 else 'CD supplied: ' end
            || coalesce(l.drug_name, 'item')
            || coalesce(' by ' || p.full_name, '')
       from ps_register_entries e
       left join ps_register_ledgers l on l.id = e.ledger_id
       left join ps_user_profiles p on p.id = e.entered_by
      where e.organisation_id = any (v_org_ids) and e.register_type = 'CD'
        and e.entered_at > now() - interval '7 days'
      order by 2 desc limit p_activity_limit)
    union all
    -- Log entries
    (select le.org_id, le.created_at, 'logs',
            coalesce(s.custom_title, t.title, 'Log') || ' filled in' || coalesce(' by ' || p.full_name, '')
       from ps_log_entries le
       join ps_log_subscriptions s on s.id = le.subscription_id
       left join ps_log_templates t on t.id = s.template_id
       left join ps_user_profiles p on p.id = le.entered_by_user_id
      where le.org_id = any (v_org_ids) and le.created_at > now() - interval '7 days'
      order by 2 desc limit p_activity_limit)
    union all
    -- Bookings made
    (select a.org_id, a.created_at, 'appointments',
            'New booking' || case when a.source is not null then ' (' || a.source || ')' else '' end
       from ps_appointments a
      where a.org_id = any (v_org_ids) and a.created_at > now() - interval '7 days'
      order by 2 desc limit p_activity_limit)
    union all
    -- Delivery rounds
    (select r.organisation_id, coalesce(r.completed_at, r.started_at), 'deliveries',
            'Delivery round "' || r.title || '" ' || case when r.completed_at is not null then 'completed' else 'started' end
       from ps_delivery_rounds r
      where r.organisation_id = any (v_org_ids)
        and coalesce(r.completed_at, r.started_at) > now() - interval '7 days'
      order by 2 desc limit p_activity_limit)
    union all
    -- Sign-ins and security events
    (select ae.organisation_id, ae.created_at, 'staff',
            coalesce(p.full_name, ae.email, 'Someone') || ' ' ||
            case ae.event when 'sign_in' then 'signed in'
                          when 'failed_sign_in' then 'failed to sign in'
                          when 'sign_out' then 'signed out'
                          when 'idle_sign_out' then 'was signed out after being idle'
                          when 'member_added' then 'joined the team'
                          when 'two_step_on' then 'turned on two-step sign-in'
                          else replace(ae.event, '_', ' ') end
       from ps_auth_events ae
       left join ps_user_profiles p on p.id = ae.user_id
      where ae.organisation_id = any (v_org_ids) and ae.created_at > now() - interval '7 days'
      order by 2 desc limit p_activity_limit)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'org_id', ev.org_id, 'org_name', o.name, 'at', ev.at, 'module', ev.module, 'text', ev.text)
           order by ev.at desc), '[]'::jsonb)
    into v_activity
  from (select * from ev where at is not null order by at desc limit p_activity_limit) ev
  join ps_organisations o on o.id = ev.org_id;

  return jsonb_build_object(
    'generated_at', now(),
    'organisations', v_orgs,
    'activity', v_activity
  );
end;
$$;

revoke all on function public.ps_org_oversight(int) from public, anon;
grant execute on function public.ps_org_oversight(int) to authenticated;

comment on function public.ps_org_oversight(int) is
  'Oversight summary for every organisation where the caller has view_audit (owners/managers, aal2). Read-only.';
