-- Searchable activity log: who did what, when, at which pharmacy.
--   * Owners / managers (view_audit, aal2): every pharmacy they run.
--   * Platform admins with p_platform = true: every pharmacy on PharmStation.
-- Read-only. Built from the modules' own records, so it reaches back as far as
-- the data does. ps_activity_scope lists the pharmacies and people for filters.

create or replace function public.ps_activity_org_ids(p_platform boolean)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_platform and ps_is_platform_admin() and ps_session_is_aal2()
      then (select coalesce(array_agg(id), '{}') from ps_organisations)
    else (
      select coalesce(array_agg(m.organisation_id), '{}')
      from ps_organisation_members m
      where m.user_id = auth.uid() and m.status = 'active'
        and ps_member_has_permission(m.organisation_id, 'view_audit')
    )
  end
$$;
revoke all on function public.ps_activity_org_ids(boolean) from public, anon;

create or replace function public.ps_activity_scope(p_platform boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_orgs uuid[] := ps_activity_org_ids(p_platform);
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return jsonb_build_object(
    'organisations', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name), '[]')
      from ps_organisations o where o.id = any (v_orgs)),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name), '[]')
      from (
        select distinct p.id, coalesce(nullif(p.full_name, ''), p.email, 'Unknown') as name
        from ps_organisation_members m
        join ps_user_profiles p on p.id = m.user_id
        where m.organisation_id = any (v_orgs)
      ) x)
  );
end;
$$;
revoke all on function public.ps_activity_scope(boolean) from public, anon;
grant execute on function public.ps_activity_scope(boolean) to authenticated;

create or replace function public.ps_activity_log(
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
  p_org_ids uuid[] default null,
  p_user_id uuid default null,
  p_module text default null,
  p_search text default null,
  p_limit int default 200,
  p_offset int default 0,
  p_platform boolean default false
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
  v_orgs uuid[];
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  v_orgs := ps_activity_org_ids(p_platform);
  if p_org_ids is not null and cardinality(p_org_ids) > 0 then
    select coalesce(array_agg(x), '{}') into v_orgs from unnest(v_orgs) x where x = any (p_org_ids);
  end if;
  p_limit := least(greatest(coalesce(p_limit, 200), 1), 2000);

  return query
  with ev as (
    -- RP sign in / out
    select e.organisation_id as org_id, e.rp_signed_in_at as at, 'rp'::text as module, 'Signed in as RP'::text as action,
           e.entered_by as actor_id, coalesce(e.pharmacist_name, '') ||
             coalesce(' (GPhC ' || e.gphc_number || ')', '') as detail, e.id as record_id
      from ps_register_entries e
     where e.organisation_id = any (v_orgs) and e.register_type = 'RP'
       and e.rp_signed_in_at between p_from and p_to
       and not exists (select 1 from ps_register_entries c where c.corrects_entry_id = e.id)
    union all
    select e.organisation_id, e.rp_signed_out_at, 'rp', 'Signed out as RP', e.entered_by,
           coalesce(e.pharmacist_name, ''), e.id
      from ps_register_entries e
     where e.organisation_id = any (v_orgs) and e.register_type = 'RP'
       and e.rp_signed_out_at between p_from and p_to
       and not exists (select 1 from ps_register_entries c where c.corrects_entry_id = e.id)
    union all
    select a.organisation_id, a.absent_from, 'rp', 'RP absent', a.recorded_by, coalesce(a.reason, ''), a.id
      from ps_rp_absences a
     where a.organisation_id = any (v_orgs) and a.absent_from between p_from and p_to
    union all
    -- CD and returns registers
    select e.organisation_id, e.entered_at, 'cd',
           case when e.entry_type = 'correction' then 'Corrected CD entry'
                when e.entry_type = 'balance_check' then 'Checked CD balance'
                when e.register_type = 'RETURNS' then 'Recorded patient return'
                when coalesce(e.quantity_received, 0) > 0 then 'Received CD'
                else 'Supplied CD' end,
           e.entered_by,
           concat_ws(' · ',
             coalesce(l.drug_name || coalesce(' ' || l.drug_strength, ''), e.return_drug_name),
             case when e.quantity_received > 0 then 'in ' || e.quantity_received
                  when e.quantity_deducted > 0 then 'out ' || e.quantity_deducted end,
             case when e.running_balance is not null then 'balance ' || e.running_balance end,
             nullif(e.correction_reason, '')),
           e.id
      from ps_register_entries e
      left join ps_register_ledgers l on l.id = e.ledger_id
     where e.organisation_id = any (v_orgs) and e.register_type in ('CD', 'RETURNS')
       and e.entered_at between p_from and p_to
    union all
    select b.organisation_id, b.completed_at, 'cd', 'Completed CD balance check', b.completed_by,
           b.checked_count || ' of ' || b.total_registers || ' registers, ' || b.discrepancy_count || ' discrepancies', b.id
      from ps_balance_check_sessions b
     where b.organisation_id = any (v_orgs) and b.completed_at between p_from and p_to
    union all
    -- Logs (fridge, cleaning, visitors, handover, ...)
    select le.org_id, le.created_at, 'logs',
           case when le.supersedes_id is not null then 'Edited log entry' else 'Filled in log' end,
           le.entered_by_user_id,
           coalesce(s.custom_title, t.title, 'Log') || ' for ' || to_char(le.entry_date, 'FMDD Mon YYYY')
             || coalesce(' · reason: ' || nullif(le.edit_reason, ''), ''),
           le.id
      from ps_log_entries le
      join ps_log_subscriptions s on s.id = le.subscription_id
      left join ps_log_templates t on t.id = s.template_id
     where le.org_id = any (v_orgs) and le.created_at between p_from and p_to
    union all
    select le.org_id, le.voided_at, 'logs', 'Voided log entry', le.voided_by,
           coalesce(s.custom_title, t.title, 'Log') || coalesce(' · reason: ' || nullif(le.void_reason, ''), ''), le.id
      from ps_log_entries le
      join ps_log_subscriptions s on s.id = le.subscription_id
      left join ps_log_templates t on t.id = s.template_id
     where le.org_id = any (v_orgs) and le.voided_at between p_from and p_to
    union all
    -- Bookings
    select a.org_id, a.created_at, 'appointments', 'Booking made', a.booked_by_user_id,
           concat_ws(' · ', sv.name, 'for ' || to_char(sl.start_time at time zone 'Europe/London', 'FMDD Mon HH24:MI'), a.source), a.id
      from ps_appointments a
      left join ps_services sv on sv.id = a.service_id
      left join ps_appointment_slots sl on sl.id = a.slot_id
     where a.org_id = any (v_orgs) and a.created_at between p_from and p_to
    union all
    select a.org_id, a.cancelled_at, 'appointments', 'Booking cancelled', null::uuid,
           concat_ws(' · ', sv.name, 'by ' || a.cancelled_by), a.id
      from ps_appointments a
      left join ps_services sv on sv.id = a.service_id
     where a.org_id = any (v_orgs) and a.cancelled_at between p_from and p_to
    union all
    -- Services delivered
    select d.org_id, coalesce(d.completed_at, d.created_at), 'services',
           case when d.status = 'completed' then 'Delivered service' else 'Started service record' end,
           d.delivered_by, coalesce(sv.name, 'Service'), d.id
      from ps_service_deliveries d
      left join ps_services sv on sv.id = d.service_id
     where d.org_id = any (v_orgs) and coalesce(d.completed_at, d.created_at) between p_from and p_to
    union all
    -- Delivery rounds
    select r.organisation_id, r.created_at, 'deliveries', 'Planned delivery round', r.created_by,
           r.title || ' for ' || to_char(r.scheduled_date, 'FMDD Mon'), r.id
      from ps_delivery_rounds r
     where r.organisation_id = any (v_orgs) and r.created_at between p_from and p_to
    union all
    select r.organisation_id, r.started_at, 'deliveries', 'Started delivery round', (select dm.user_id from ps_organisation_members dm where dm.id = r.driver_id), r.title, r.id
      from ps_delivery_rounds r
     where r.organisation_id = any (v_orgs) and r.started_at between p_from and p_to
    union all
    select r.organisation_id, r.completed_at, 'deliveries', 'Completed delivery round', (select dm.user_id from ps_organisation_members dm where dm.id = r.driver_id), r.title, r.id
      from ps_delivery_rounds r
     where r.organisation_id = any (v_orgs) and r.completed_at between p_from and p_to
    union all
    -- SOP sign-offs
    select c.org_id, c.completed_at, 'sops', 'Signed SOP', c.user_id,
           coalesce(doc.title, 'SOP') || ' v' || c.document_version || coalesce(' · ' || c.signer_name, ''), c.id
      from ps_sop_completions c
      left join ps_sop_documents doc on doc.id = c.document_id
     where c.org_id = any (v_orgs) and c.completed_at between p_from and p_to
    union all
    -- Shop orders
    select o.org_id, o.created_at, 'shop', 'Shop order placed', null::uuid,
           o.order_number || ' · £' || to_char(o.total_pence / 100.0, 'FM999990.00') || ' · ' || o.fulfilment_method, o.id
      from ps_shop_orders o
     where o.org_id = any (v_orgs) and o.created_at between p_from and p_to
    union all
    select o.org_id, o.reviewed_at, 'shop', 'Reviewed shop order', o.reviewed_by,
           o.order_number || ' · ' || coalesce(o.review_status, '') || coalesce(' · ' || o.reviewed_by_name, ''), o.id
      from ps_shop_orders o
     where o.org_id = any (v_orgs) and o.reviewed_at between p_from and p_to
    union all
    -- Patient safety
    select r.org_id, r.created_at, 'safety', 'Started patient safety report', r.created_by,
           coalesce(r.reference || ' · ', '') || coalesce(r.title, ''), r.id
      from ps_patient_safety_reports r
     where r.org_id = any (v_orgs) and r.created_at between p_from and p_to
    union all
    select r.org_id, r.submitted_at, 'safety', 'Submitted patient safety report', r.created_by,
           coalesce(r.reference || ' · ', '') || coalesce(r.title, ''), r.id
      from ps_patient_safety_reports r
     where r.org_id = any (v_orgs) and r.submitted_at between p_from and p_to
    union all
    -- NHS 111
    select n.org_id, n.received_at, 'nhs111', 'NHS 111 referral received', null::uuid,
           concat_ws(' · ', n.case_ref, n.urgency), n.id
      from ps_nhs111_referrals n
     where n.org_id = any (v_orgs) and n.received_at between p_from and p_to
    union all
    select n.org_id, n.actioned_at, 'nhs111', 'Actioned NHS 111 referral', n.actioned_by, coalesce(n.case_ref, ''), n.id
      from ps_nhs111_referrals n
     where n.org_id = any (v_orgs) and n.actioned_at between p_from and p_to
    union all
    -- Sign-ins, team changes, two-step
    select ae.organisation_id, ae.created_at, 'staff',
           case ae.event when 'sign_in' then 'Signed in'
                         when 'failed_sign_in' then 'Failed sign-in'
                         when 'sign_out' then 'Signed out'
                         when 'idle_sign_out' then 'Signed out (idle)'
                         when 'member_added' then 'Joined the team'
                         when 'two_step_on' then 'Turned on two-step sign-in'
                         else initcap(replace(ae.event, '_', ' ')) end,
           coalesce(ae.user_id, ae.created_by),
           coalesce(ae.email, ''), ae.id
      from ps_auth_events ae
     where ae.organisation_id = any (v_orgs) and ae.created_at between p_from and p_to
  )
  select ev.at, ev.org_id, o.name, ev.module, ev.action, ev.actor_id,
         coalesce(nullif(p.full_name, ''), p.email, case when ev.actor_id is null then 'Patient or system' else 'Unknown' end),
         nullif(ev.detail, ''), ev.record_id
    from ev
    join ps_organisations o on o.id = ev.org_id
    left join ps_user_profiles p on p.id = ev.actor_id
   where ev.at is not null
     and (p_module is null or ev.module = p_module)
     and (p_user_id is null or ev.actor_id = p_user_id)
     and (v_search is null
          or ev.action ilike '%' || v_search || '%'
          or ev.detail ilike '%' || v_search || '%'
          or p.full_name ilike '%' || v_search || '%'
          or o.name ilike '%' || v_search || '%')
   order by ev.at desc
   limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.ps_activity_log(timestamptz, timestamptz, uuid[], uuid, text, text, int, int, boolean) from public, anon;
grant execute on function public.ps_activity_log(timestamptz, timestamptz, uuid[], uuid, text, text, int, int, boolean) to authenticated;
