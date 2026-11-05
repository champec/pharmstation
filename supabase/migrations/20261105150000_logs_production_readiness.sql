-- Logs module production readiness (5 Nov 2026, logs thread).
--
-- 1. Pen test F2: nobody outside a pharmacy can change or delete the shared
--    library logs (this was still open on London on 5 Nov 2026).
-- 2. Fridge, cleaning and other logs become append-only: an edit saves a new
--    version with a reason, a removal is a "void" with a reason, and the
--    person who made the entry is always the signed-in user. Saves go through
--    ps_log_save_entry / ps_log_void_entry. The table becomes read-only to the
--    app in the follow-up lockdown migration.
-- 3. Library fridge log: 2 to 8 °C range on each fridge reading.
-- 4. RP log: server-side sign in / sign out / take over (times from the
--    server clock, name and GPhC number from the pharmacist's profile), and
--    RP absences (ps_rp_absences).
--
-- Safe to re-run, and safe to run before the new web app is deployed (the
-- old app keeps working). Needs ps_member_has_permission.

begin;

-- ─── 1. Library templates and fields (pen test F2) ──────────────────────────
alter policy org_members_crud_log_templates on public.ps_log_templates
  to authenticated
  using (org_id in (select ps_get_user_org_ids()))
  with check (org_id in (select ps_get_user_org_ids()));

alter policy org_members_crud_log_fields on public.ps_log_fields
  to authenticated
  using (template_id in (select id from ps_log_templates where org_id in (select ps_get_user_org_ids())))
  with check (template_id in (select id from ps_log_templates where org_id in (select ps_get_user_org_ids())));

alter policy org_members_crud_subscriptions on public.ps_log_subscriptions
  to authenticated
  using (org_id in (select ps_get_user_org_ids()))
  with check (org_id in (select ps_get_user_org_ids()));

revoke insert, update, delete, truncate on public.ps_log_templates from anon;
revoke insert, update, delete, truncate on public.ps_log_fields from anon;
revoke all on public.ps_log_subscriptions from anon;

-- ─── 2. Append-only log entries ─────────────────────────────────────────────
alter table public.ps_log_entries
  add column if not exists root_id uuid,
  add column if not exists supersedes_id uuid references public.ps_log_entries(id),
  add column if not exists superseded_at timestamptz,
  add column if not exists edit_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.ps_user_profiles(id),
  add column if not exists void_reason text;

update public.ps_log_entries set root_id = id where root_id is null;
alter table public.ps_log_entries alter column root_id set not null;
alter table public.ps_log_entries alter column entered_by_user_id set default auth.uid();

create index if not exists ps_log_entries_current_idx
  on public.ps_log_entries (subscription_id, entry_date)
  where superseded_at is null;
create index if not exists ps_log_entries_root_idx on public.ps_log_entries (root_id);
create index if not exists ps_log_entries_org_date_idx on public.ps_log_entries (org_id, entry_date);

-- Rows written by the older web app (direct inserts) still get a root_id.
create or replace function public.ps_log_entries_set_root()
returns trigger language plpgsql set search_path = public as $$
begin
  new.root_id := coalesce(new.root_id, new.id);
  return new;
end;
$$;
drop trigger if exists ps_log_entries_set_root on public.ps_log_entries;
create trigger ps_log_entries_set_root before insert on public.ps_log_entries
  for each row execute function public.ps_log_entries_set_root();

drop policy if exists ps_log_entries_select on public.ps_log_entries;
create policy ps_log_entries_select on public.ps_log_entries
  for select to authenticated
  using (org_id in (select ps_get_user_org_ids()));
revoke all on public.ps_log_entries from anon;

-- Direct writes are switched off in 20261105150100_logs_entries_lockdown.sql,
-- run once the web app that saves through ps_log_save_entry is live.

-- Save a new entry, or a new version of an existing one (p_replaces_id).
create or replace function public.ps_log_save_entry(
  p_subscription_id uuid,
  p_entry_date date,
  p_data jsonb,
  p_replaces_id uuid default null,
  p_edit_reason text default null
) returns public.ps_log_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sub ps_log_subscriptions;
  v_template ps_log_templates;
  v_old ps_log_entries;
  v_new ps_log_entries;
  v_id uuid := gen_random_uuid();
  v_today date := (now() at time zone 'Europe/London')::date;
  v_field record;
  v_val jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_sub from ps_log_subscriptions where id = p_subscription_id for update;
  if not found or v_sub.org_id not in (select ps_get_user_org_ids()) then
    raise exception 'Log not found' using errcode = '42501';
  end if;
  if not v_sub.is_active then
    raise exception 'This log has been removed from your pharmacy';
  end if;

  select * into v_template from ps_log_templates where id = v_sub.template_id;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Entry data must be an object';
  end if;
  if pg_column_size(p_data) > 1500000 then
    raise exception 'Entry is too large (signatures are limited in size)';
  end if;

  -- Required fields
  for v_field in
    select label, field_key from ps_log_fields
    where template_id = v_sub.template_id and is_required
      and field_type not in ('heading', 'info')
  loop
    v_val := p_data -> v_field.field_key;
    if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb or v_val = '[]'::jsonb then
      raise exception 'Please fill in "%"', v_field.label;
    end if;
  end loop;

  if p_replaces_id is not null then
    select * into v_old from ps_log_entries where id = p_replaces_id for update;
    if not found or v_old.subscription_id <> p_subscription_id then
      raise exception 'Entry not found';
    end if;
    if v_old.superseded_at is not null then
      raise exception 'CONFLICT: someone else changed this entry first. Refresh and try again.';
    end if;
    if v_old.voided_at is not null then
      raise exception 'This entry was removed and cannot be changed';
    end if;
    if coalesce(length(trim(p_edit_reason)), 0) < 3 then
      raise exception 'Please give a reason for the change';
    end if;

    insert into ps_log_entries (id, subscription_id, org_id, entry_date, data, entered_by_user_id,
                                root_id, supersedes_id, edit_reason)
    values (v_id, p_subscription_id, v_sub.org_id, v_old.entry_date, p_data, v_uid,
            v_old.root_id, v_old.id, left(trim(p_edit_reason), 500))
    returning * into v_new;

    update ps_log_entries set superseded_at = now() where id = v_old.id;
    return v_new;
  end if;

  if p_entry_date is null then
    p_entry_date := v_today;
  end if;
  if p_entry_date > v_today then
    raise exception 'You cannot log a future date';
  end if;

  if v_template.schedule_type in ('daily', 'custom_days') and exists (
    select 1 from ps_log_entries
    where subscription_id = p_subscription_id and entry_date = p_entry_date
      and superseded_at is null and voided_at is null
  ) then
    raise exception 'ALREADY_LOGGED: this day already has an entry. Edit it instead.';
  end if;

  insert into ps_log_entries (id, subscription_id, org_id, entry_date, data, entered_by_user_id, root_id)
  values (v_id, p_subscription_id, v_sub.org_id, p_entry_date, p_data, v_uid, v_id)
  returning * into v_new;
  return v_new;
end;
$$;

-- Remove an entry from the log. It stays in the history with the reason.
create or replace function public.ps_log_void_entry(p_entry_id uuid, p_reason text)
returns public.ps_log_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_entry ps_log_entries;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_entry from ps_log_entries where id = p_entry_id for update;
  if not found or v_entry.org_id not in (select ps_get_user_org_ids()) then
    raise exception 'Entry not found' using errcode = '42501';
  end if;
  if v_entry.superseded_at is not null or v_entry.voided_at is not null then
    raise exception 'CONFLICT: this entry has already changed. Refresh and try again.';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Please give a reason for removing this entry';
  end if;

  select role into v_role from ps_organisation_members
  where organisation_id = v_entry.org_id and user_id = v_uid and status = 'active';
  if v_entry.entered_by_user_id <> v_uid and coalesce(v_role, '') not in ('owner', 'manager', 'pharmacist', 'locum') then
    raise exception 'Only the person who made this entry, a pharmacist or a manager can remove it' using errcode = '42501';
  end if;

  update ps_log_entries
  set voided_at = now(), voided_by = v_uid, void_reason = left(trim(p_reason), 500)
  where id = p_entry_id
  returning * into v_entry;
  return v_entry;
end;
$$;

revoke all on function public.ps_log_save_entry(uuid, date, jsonb, uuid, text) from public, anon;
revoke all on function public.ps_log_void_entry(uuid, text) from public, anon;
grant execute on function public.ps_log_save_entry(uuid, date, jsonb, uuid, text) to authenticated;
grant execute on function public.ps_log_void_entry(uuid, text) to authenticated;

-- ─── 3. Library fridge log: safe range ──────────────────────────────────────
update public.ps_log_fields
set options = '{"min": 2, "max": 8, "unit": "°C"}'::jsonb
where template_id = '00000000-0000-0000-0001-000000000003'
  and field_key in ('fridge_1', 'fridge_2', 'fridge_3')
  and options is null;

update public.ps_log_templates
set description = 'Record each fridge''s temperature every working day. Safe range is 2 to 8 °C.'
where id = '00000000-0000-0000-0001-000000000003'
  and description = 'Daily fridge temperature recording';

-- ─── 4. RP log ──────────────────────────────────────────────────────────────
create table if not exists public.ps_rp_absences (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.ps_organisations(id) on delete cascade,
  rp_entry_id uuid not null references public.ps_register_entries(id),
  absent_from timestamptz not null,
  returned_at timestamptz,
  reason text,
  recorded_by uuid not null references public.ps_user_profiles(id),
  returned_recorded_by uuid references public.ps_user_profiles(id),
  created_at timestamptz not null default now(),
  constraint ps_rp_absences_order check (returned_at is null or returned_at >= absent_from),
  constraint ps_rp_absences_reason_len check (reason is null or length(reason) <= 300)
);
create index if not exists ps_rp_absences_entry_idx on public.ps_rp_absences (rp_entry_id);
create index if not exists ps_rp_absences_org_idx on public.ps_rp_absences (organisation_id, absent_from);

alter table public.ps_rp_absences enable row level security;
drop policy if exists ps_rp_absences_select on public.ps_rp_absences;
create policy ps_rp_absences_select on public.ps_rp_absences
  for select to authenticated
  using (organisation_id in (select ps_get_user_org_ids()));
revoke all on public.ps_rp_absences from anon;
revoke insert, update, delete, truncate on public.ps_rp_absences from authenticated;

-- Follows corrections back to the original RP record.
create or replace function public.ps_rp_root_entry(p_entry_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select id, corrects_entry_id, entry_type, 0 as depth from ps_register_entries where id = p_entry_id
    union all
    select e.id, e.corrects_entry_id, e.entry_type, c.depth + 1
    from ps_register_entries e join chain c on e.id = c.corrects_entry_id
    where c.depth < 100
  )
  select id from chain where entry_type = 'normal' order by depth limit 1;
$$;

-- Current version of an RP session: the newest record in its correction chain.
create or replace function public.ps_rp_current_version(p_root_id uuid)
returns public.ps_register_entries
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain(id) as (
    select id from ps_register_entries where id = p_root_id
    union
    select e.id from ps_register_entries e join chain c on e.corrects_entry_id = c.id
  )
  select e.* from ps_register_entries e
  where e.id in (select id from chain)
  order by e.entry_number desc
  limit 1;
$$;

-- Open RP sessions (signed in, not signed out) for a pharmacy.
create or replace function public.ps_rp_open_sessions(p_organisation_id uuid)
returns setof public.ps_register_entries
language sql
stable
security definer
set search_path = public
as $$
  select v.* from ps_register_entries n
  cross join lateral public.ps_rp_current_version(n.id) v
  where n.organisation_id = p_organisation_id
    and n.register_type = 'RP' and n.entry_type = 'normal'
    and n.date_of_transaction >= (now() at time zone 'Europe/London')::date - 2
    and v.rp_signed_in_at is not null and v.rp_signed_out_at is null
  order by v.rp_signed_in_at;
$$;

create or replace function public.ps_rp_ledger(p_organisation_id uuid)
returns public.ps_register_ledgers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger ps_register_ledgers;
begin
  if p_organisation_id not in (select ps_get_user_org_ids()) then
    raise exception 'Not a member of this pharmacy' using errcode = '42501';
  end if;
  select * into v_ledger from ps_register_ledgers
  where organisation_id = p_organisation_id and register_type = 'RP' and drug_id is null;
  if not found then
    insert into ps_register_ledgers (organisation_id, register_type, drug_name, created_by)
    values (p_organisation_id, 'RP', 'Responsible Pharmacist Log', auth.uid())
    on conflict do nothing;
    select * into v_ledger from ps_register_ledgers
    where organisation_id = p_organisation_id and register_type = 'RP' and drug_id is null;
  end if;
  return v_ledger;
end;
$$;

-- Internal: write the sign-out correction for an open session.
create or replace function public.ps_rp_close_session(p_root_id uuid, p_at timestamptz, p_reason text)
returns public.ps_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur ps_register_entries;
  v_new ps_register_entries;
begin
  v_cur := public.ps_rp_current_version(p_root_id);
  if v_cur.id is null then raise exception 'RP record not found'; end if;
  if v_cur.rp_signed_out_at is not null then
    raise exception 'This RP has already signed out';
  end if;
  if p_at < v_cur.rp_signed_in_at then
    raise exception 'Sign-out time cannot be before the sign-in time';
  end if;

  update ps_rp_absences
  set returned_at = greatest(p_at, absent_from), returned_recorded_by = auth.uid()
  where rp_entry_id = p_root_id and returned_at is null;

  select * into v_new from ps_make_register_entry(
    p_ledger_id => v_cur.ledger_id,
    p_register_type => 'RP',
    p_entry_type => 'correction',
    p_date_of_transaction => v_cur.date_of_transaction,
    p_notes => v_cur.notes,
    p_source => 'manual',
    p_corrects_entry_id => p_root_id,
    p_correction_reason => p_reason,
    p_authorised_by => v_cur.authorised_by,
    p_pharmacist_name => v_cur.pharmacist_name,
    p_gphc_number => v_cur.gphc_number,
    p_rp_signed_in_at => v_cur.rp_signed_in_at,
    p_rp_signed_out_at => p_at
  );
  return v_new;
end;
$$;

-- Sign the current user in as RP, now. With p_take_over, anyone still signed
-- in at this pharmacy is signed out at the same moment (handover).
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

-- Sign an RP session out. Defaults to now; a pharmacist can give an earlier
-- time (e.g. forgot to sign out) with a reason.
create or replace function public.ps_rp_sign_out(p_entry_id uuid, p_at timestamptz default null, p_reason text default null)
returns public.ps_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root uuid;
  v_cur ps_register_entries;
  v_at timestamptz := coalesce(p_at, now());
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  v_root := public.ps_rp_root_entry(p_entry_id);
  v_cur := public.ps_rp_current_version(v_root);
  if v_cur.id is null or v_cur.organisation_id not in (select ps_get_user_org_ids()) then
    raise exception 'RP record not found' using errcode = '42501';
  end if;
  if not ps_member_has_permission(v_cur.organisation_id, 'rp_log_sign') then
    raise exception 'Only pharmacists can sign the RP out' using errcode = '42501';
  end if;
  if v_at > now() + interval '2 minutes' then
    raise exception 'Sign-out time cannot be in the future';
  end if;
  if p_at is not null and p_at < now() - interval '5 minutes' and coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Please give a reason for recording an earlier sign-out time';
  end if;
  perform 1 from ps_register_ledgers where id = v_cur.ledger_id for update;
  return public.ps_rp_close_session(
    v_root, v_at,
    coalesce(nullif(trim(p_reason), ''), 'Signed out'));
end;
$$;

-- RP absence: start (RP steps out) and end (RP is back).
create or replace function public.ps_rp_start_absence(p_entry_id uuid, p_reason text default null, p_at timestamptz default null)
returns public.ps_rp_absences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root uuid;
  v_cur ps_register_entries;
  v_at timestamptz := coalesce(p_at, now());
  v_row ps_rp_absences;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  v_root := public.ps_rp_root_entry(p_entry_id);
  v_cur := public.ps_rp_current_version(v_root);
  if v_cur.id is null or v_cur.organisation_id not in (select ps_get_user_org_ids()) then
    raise exception 'RP record not found' using errcode = '42501';
  end if;
  if not ps_member_has_permission(v_cur.organisation_id, 'rp_log_sign') then
    raise exception 'Only pharmacists can record RP absences' using errcode = '42501';
  end if;
  if v_cur.rp_signed_out_at is not null then
    raise exception 'This RP has already signed out';
  end if;
  if v_at < v_cur.rp_signed_in_at or v_at > now() + interval '2 minutes' then
    raise exception 'The absence must start after sign-in and not in the future';
  end if;
  if exists (select 1 from ps_rp_absences where rp_entry_id = v_root and returned_at is null) then
    raise exception 'The RP is already recorded as absent';
  end if;
  insert into ps_rp_absences (organisation_id, rp_entry_id, absent_from, reason, recorded_by)
  values (v_cur.organisation_id, v_root, v_at, nullif(left(trim(coalesce(p_reason, '')), 300), ''), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.ps_rp_end_absence(p_absence_id uuid, p_at timestamptz default null)
returns public.ps_rp_absences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row ps_rp_absences;
  v_at timestamptz := coalesce(p_at, now());
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select * into v_row from ps_rp_absences where id = p_absence_id for update;
  if not found or v_row.organisation_id not in (select ps_get_user_org_ids()) then
    raise exception 'Absence not found' using errcode = '42501';
  end if;
  if not ps_member_has_permission(v_row.organisation_id, 'rp_log_sign') then
    raise exception 'Only pharmacists can record RP absences' using errcode = '42501';
  end if;
  if v_row.returned_at is not null then
    raise exception 'The RP is already back';
  end if;
  if v_at < v_row.absent_from or v_at > now() + interval '2 minutes' then
    raise exception 'The return time must be after the absence started and not in the future';
  end if;
  update ps_rp_absences set returned_at = v_at, returned_recorded_by = auth.uid()
  where id = p_absence_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.ps_rp_root_entry(uuid) from public, anon, authenticated;
revoke all on function public.ps_rp_current_version(uuid) from public, anon, authenticated;
revoke all on function public.ps_rp_open_sessions(uuid) from public, anon, authenticated;
revoke all on function public.ps_rp_close_session(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.ps_rp_ledger(uuid) from public, anon;
revoke all on function public.ps_rp_sign_in(uuid, boolean, text) from public, anon;
revoke all on function public.ps_rp_sign_out(uuid, timestamptz, text) from public, anon;
revoke all on function public.ps_rp_start_absence(uuid, text, timestamptz) from public, anon;
revoke all on function public.ps_rp_end_absence(uuid, timestamptz) from public, anon;
grant execute on function public.ps_rp_ledger(uuid) to authenticated;
grant execute on function public.ps_rp_sign_in(uuid, boolean, text) to authenticated;
grant execute on function public.ps_rp_sign_out(uuid, timestamptz, text) to authenticated;
grant execute on function public.ps_rp_start_absence(uuid, text, timestamptz) to authenticated;
grant execute on function public.ps_rp_end_absence(uuid, timestamptz) to authenticated;

commit;
