-- SOPs: review dates, review log and reminders
--
-- Needs 20261105160100_sop_production_readiness.sql. Safe to run more than once.
--
-- 1. Every SOP has a review interval (default 12 months) and a next review
--    date. Publishing sets the next review date from today. A manager can
--    also record "reviewed, no changes needed" (ps_sop_mark_reviewed), which
--    moves the date on without a new version.
-- 2. ps_sop_reviews keeps the review history (who, when, which version, the
--    outcome and a note) for inspections. Insert-only, written by the
--    database functions.
-- 3. Reminders (pg_cron, daily 08:00 UK):
--    - SOP managers are told when an SOP is due for review within 14 days
--      or overdue (once per due date).
--    - Every Monday, staff who still have assigned SOPs to read and sign get
--      a personal nudge.
--
-- Rollback: supabase/rollbacks/rollback_20261109140500_sop_reviews_and_reminders.sql

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Review columns
-- ─────────────────────────────────────────────────────────────

alter table public.ps_sop_documents
  add column if not exists review_interval_months integer not null default 12,
  add column if not exists next_review_due date,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists last_reviewed_by uuid references ps_user_profiles(id),
  add column if not exists review_reminded_for date;

do $$ begin
  alter table public.ps_sop_documents
    add constraint ps_sop_documents_review_interval_check check (review_interval_months between 1 and 60);
exception when duplicate_object then null; end $$;

-- Published SOPs without a date: a year from when they were published (or today).
update public.ps_sop_documents
   set next_review_due = (coalesce(published_at, now()) + make_interval(months => review_interval_months))::date
 where next_review_due is null and published_at is not null;

-- ─────────────────────────────────────────────────────────────
-- Guard: review dates only change through the database functions.
-- Changing the interval moves the next review date to match.
-- ─────────────────────────────────────────────────────────────

create or replace function public.ps_sop_document_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ps.sop_publishing', true), '') = 'on' or auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    new.version := 1;
    new.status := 'draft';
    new.published_at := null;
    new.has_unpublished_changes := false;
    new.next_review_due := null;
    new.last_reviewed_at := null;
    new.last_reviewed_by := null;
    new.review_reminded_for := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from ps_organisations where id = old.org_id)
       and exists (select 1 from ps_sop_completions where document_id = old.id) then
      raise exception 'This SOP has sign-offs, so it can''t be deleted. Archive it instead.';
    end if;
    return old;
  end if;

  new.org_id := old.org_id;
  new.version := old.version;
  new.published_at := old.published_at;
  new.last_reviewed_at := old.last_reviewed_at;
  new.last_reviewed_by := old.last_reviewed_by;
  new.review_reminded_for := old.review_reminded_for;
  if new.review_interval_months is distinct from old.review_interval_months and old.published_at is not null then
    new.next_review_due := (coalesce(old.last_reviewed_at, old.published_at)
                            + make_interval(months => new.review_interval_months))::date;
    new.review_reminded_for := null;
  else
    new.next_review_due := old.next_review_due;
  end if;
  if new.status = 'published' and old.status <> 'published' then
    raise exception 'Use Publish to publish an SOP';
  end if;
  if old.published_at is not null
     and (new.title is distinct from old.title or new.description is distinct from old.description) then
    new.has_unpublished_changes := true;
  else
    new.has_unpublished_changes := old.has_unpublished_changes;
  end if;
  return new;
end; $$;

-- ─────────────────────────────────────────────────────────────
-- 2. Review log
-- ─────────────────────────────────────────────────────────────

create table if not exists public.ps_sop_reviews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references ps_sop_documents(id) on delete cascade,
  org_id uuid not null references ps_organisations(id) on delete cascade,
  version integer not null,
  outcome text not null check (outcome in ('no_changes', 'new_version', 'first_published')),
  notes text,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid references ps_user_profiles(id),
  reviewer_name text,
  next_review_due date
);
create index if not exists ps_sop_reviews_document_idx on public.ps_sop_reviews(document_id, reviewed_at desc);
alter table public.ps_sop_reviews enable row level security;
drop policy if exists sop_reviews_org_read on public.ps_sop_reviews;
create policy sop_reviews_org_read on public.ps_sop_reviews
  for select to authenticated using (org_id in (select ps_get_user_org_ids()));
revoke insert, update, delete on public.ps_sop_reviews from anon, authenticated;
grant select on public.ps_sop_reviews to authenticated;

create or replace function public.ps_sop_log_review(
  p_doc ps_sop_documents, p_outcome text, p_notes text, p_next date)
returns void language sql security definer set search_path = public as $$
  insert into ps_sop_reviews (document_id, org_id, version, outcome, notes, reviewed_by, reviewer_name, next_review_due)
  values (p_doc.id, p_doc.org_id, p_doc.version, p_outcome, nullif(trim(coalesce(p_notes, '')), ''),
          auth.uid(), (select full_name from ps_user_profiles where id = auth.uid()), p_next);
$$;
revoke all on function public.ps_sop_log_review(ps_sop_documents, text, text, date) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Publish: same as before, plus the review date and log
-- ─────────────────────────────────────────────────────────────

create or replace function public.ps_sop_publish(p_document_id uuid)
returns public.ps_sop_documents
language plpgsql security definer set search_path = public as $$
declare
  v_doc ps_sop_documents%rowtype;
  v_max int;
  v_new int;
  v_targets uuid[];
  v_all boolean;
  v_first boolean;
  v_next date;
begin
  select * into v_doc from ps_sop_documents where id = p_document_id for update;
  if v_doc.id is null or not ps_is_sop_manager(v_doc.org_id) then
    raise exception 'You do not have permission to publish this SOP';
  end if;
  if not exists (select 1 from ps_sop_nodes where document_id = p_document_id) then
    raise exception 'Add at least one section before publishing';
  end if;

  select max(version) into v_max from ps_sop_document_versions where document_id = p_document_id;
  v_first := v_doc.published_at is null and v_max is null;

  if v_max = v_doc.version and not v_doc.has_unpublished_changes then
    v_new := v_doc.version;  -- restoring an archived SOP with no changes
  else
    v_new := greatest(coalesce(v_max, 0) + 1,
                      v_doc.version + case when v_doc.published_at is null then 0 else 1 end);
    insert into ps_sop_document_versions (document_id, org_id, version, title, description, nodes, published_by)
    values (v_doc.id, v_doc.org_id, v_new, v_doc.title, v_doc.description,
            ps_sop_nodes_snapshot(v_doc.id), auth.uid());
  end if;

  -- A new version restarts the review clock; a restore keeps the old date.
  v_next := case when v_new = v_doc.version and not v_first and v_doc.next_review_due is not null
                 then v_doc.next_review_due
                 else (current_date + make_interval(months => v_doc.review_interval_months))::date end;

  perform set_config('ps.sop_publishing', 'on', true);
  update ps_sop_documents
     set status = 'published', version = v_new, published_at = now(),
         has_unpublished_changes = false, updated_at = now(), updated_by = auth.uid(),
         next_review_due = v_next,
         last_reviewed_at = case when v_new <> coalesce(v_max, 0) then now() else last_reviewed_at end,
         last_reviewed_by = case when v_new <> coalesce(v_max, 0) then auth.uid() else last_reviewed_by end,
         review_reminded_for = null
   where id = p_document_id
   returning * into v_doc;
  perform set_config('ps.sop_publishing', 'off', true);

  if v_max is null or v_new > v_max then
    perform ps_sop_log_review(v_doc, case when v_first then 'first_published' else 'new_version' end, null, v_next);
  end if;

  -- A new version after the first: tell assigned staff to re-read.
  if v_new > 1 and v_max is not null and v_new > v_max then
    select bool_or(member_id is null) into v_all from ps_sop_assignments where document_id = p_document_id;
    if v_all is not null then
      if not v_all then
        select array_agg(m.user_id) into v_targets
          from ps_sop_assignments a join ps_organisation_members m on m.id = a.member_id
         where a.document_id = p_document_id and m.user_id is not null;
      end if;
      perform ps_fanout_notification(
        v_doc.org_id, 'sop_assignment', 'SOP updated: please re-read',
        v_doc.title || ' has a new version (v' || v_new || '). Please read and sign it again.',
        '/sops/' || v_doc.id::text || '/read',
        jsonb_build_object('document_id', v_doc.id, 'version', v_new),
        v_targets, case when v_all then 'shared' else 'personal' end);
    end if;
  end if;

  return v_doc;
end; $$;
revoke all on function public.ps_sop_publish(uuid) from public, anon;
grant execute on function public.ps_sop_publish(uuid) to authenticated;

-- "Reviewed, no changes needed": moves the review date on and logs it.
create or replace function public.ps_sop_mark_reviewed(p_document_id uuid, p_notes text default null)
returns public.ps_sop_documents
language plpgsql security definer set search_path = public as $$
declare
  v_doc ps_sop_documents%rowtype;
  v_next date;
begin
  select * into v_doc from ps_sop_documents where id = p_document_id for update;
  if v_doc.id is null or not ps_is_sop_manager(v_doc.org_id) then
    raise exception 'You do not have permission to review this SOP';
  end if;
  if v_doc.status <> 'published' then
    raise exception 'Only a published SOP can be marked as reviewed';
  end if;
  if v_doc.has_unpublished_changes then
    raise exception 'This SOP has changes that are not published. Publish a new version instead.';
  end if;

  v_next := (current_date + make_interval(months => v_doc.review_interval_months))::date;
  perform set_config('ps.sop_publishing', 'on', true);
  update ps_sop_documents
     set next_review_due = v_next, last_reviewed_at = now(), last_reviewed_by = auth.uid(),
         review_reminded_for = null
   where id = p_document_id
   returning * into v_doc;
  perform set_config('ps.sop_publishing', 'off', true);
  perform ps_sop_log_review(v_doc, 'no_changes', p_notes, v_next);
  return v_doc;
end; $$;
revoke all on function public.ps_sop_mark_reviewed(uuid, text) from public, anon;
grant execute on function public.ps_sop_mark_reviewed(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Reminders
-- ─────────────────────────────────────────────────────────────

-- User ids of a pharmacy's SOP managers (same rule as ps_is_sop_manager).
create or replace function public.ps_sop_manager_user_ids(p_org uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
    from ps_organisation_members m
   where m.organisation_id = p_org and m.status = 'active' and m.access_expires_at is null
     and m.user_id is not null
     and (m.role in ('owner', 'manager', 'pharmacist')
          or coalesce(case when jsonb_typeof(m.permissions -> 'sop_upload') = 'boolean'
                           then (m.permissions ->> 'sop_upload')::boolean end,
                      ps_role_default_permission(m.role, 'sop_upload')));
$$;
revoke all on function public.ps_sop_manager_user_ids(uuid) from public, anon, authenticated;

create or replace function public.ps_sop_send_review_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_count int := 0;
  v_targets uuid[];
begin
  for r in
    select d.* from ps_sop_documents d
     where d.status = 'published' and d.next_review_due is not null
       and d.next_review_due <= current_date + 14
       and d.review_reminded_for is distinct from d.next_review_due
  loop
    v_targets := ps_sop_manager_user_ids(r.org_id);
    if array_length(v_targets, 1) is not null then
      perform ps_fanout_notification(
        r.org_id, 'sop_review_due',
        case when r.next_review_due < current_date then 'SOP review overdue' else 'SOP review due soon' end,
        r.title || ' (v' || r.version || ') is due for review on '
          || to_char(r.next_review_due, 'DD Mon YYYY') || '. Review it and publish a new version, or mark it as reviewed.',
        '/sops/' || r.id::text || '/edit',
        jsonb_build_object('document_id', r.id, 'due', r.next_review_due),
        v_targets, 'personal');
    end if;
    update ps_sop_documents set review_reminded_for = r.next_review_due where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public.ps_sop_send_review_reminders() from public, anon, authenticated;

-- Weekly nudge: each staff member with assigned, published SOPs they have not
-- signed at the current version.
create or replace function public.ps_sop_send_outstanding_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    with outstanding as (
      select m.organisation_id as org_id, m.user_id, d.id as document_id, d.title
        from ps_sop_documents d
        join ps_sop_assignments a on a.document_id = d.id
        join ps_organisation_members m
          on m.organisation_id = d.org_id and m.status = 'active' and m.access_expires_at is null
         and (a.member_id is null or a.member_id = m.id)
       where d.status = 'published' and m.user_id is not null
         and not exists (select 1 from ps_sop_completions c
                          where c.document_id = d.id and c.member_id = m.id
                            and c.document_version = d.version)
    )
    select org_id, user_id, count(distinct document_id) as n,
           (array_agg(distinct title))[1] as first_title,
           (array_agg(distinct document_id))[1] as first_doc
      from outstanding group by org_id, user_id
  loop
    perform ps_fanout_notification(
      r.org_id, 'sop_assignment',
      case when r.n = 1 then 'You have an SOP to read' else 'You have ' || r.n || ' SOPs to read' end,
      case when r.n = 1 then r.first_title || ' is waiting for you to read and sign.'
           else r.first_title || ' and ' || (r.n - 1) || ' more are waiting for you to read and sign.' end,
      case when r.n = 1 then '/sops/' || r.first_doc::text || '/read' else '/sops' end,
      jsonb_build_object('outstanding', r.n),
      array[r.user_id], 'personal');
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public.ps_sop_send_outstanding_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('ps-sop-review-reminders', 'ps-sop-outstanding-reminders');
    -- 08:00 UTC (08:00 or 09:00 UK time)
    perform cron.schedule('ps-sop-review-reminders', '0 8 * * *', 'select public.ps_sop_send_review_reminders()');
    perform cron.schedule('ps-sop-outstanding-reminders', '0 8 * * 1', 'select public.ps_sop_send_outstanding_reminders()');
  end if;
end $$;

commit;
