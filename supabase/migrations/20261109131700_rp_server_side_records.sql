-- RP log: every RP record is written by a server function (9 Nov 2026, logs thread).
-- Before this, a late record or a correction sent the pharmacist's name and
-- GPhC number from the browser through ps_make_register_entry. Now:
--   * ps_rp_record_late: a missed session, always in the caller's own name
--     and GPhC number from their profile, refused if it overlaps another session.
--   * ps_rp_correct: a correction of a session, with a reason, validated times
--     and a 7 digit GPhC number; the corrector is recorded as authorised_by.
--   * A trigger refuses RP rows written any other way by a signed-in user.
-- Re-runnable.

begin;

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
  perform set_config('ps.rp_rpc', 'on', true);
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

create or replace function public.ps_rp_overlaps(p_organisation_id uuid, p_from timestamptz, p_to timestamptz, p_except_root uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select v.pharmacist_name
  from ps_register_entries n
  cross join lateral public.ps_rp_current_version(n.id) v
  where n.organisation_id = p_organisation_id
    and n.register_type = 'RP' and n.entry_type = 'normal'
    and n.id is distinct from p_except_root
    and v.rp_signed_in_at is not null
    and v.rp_signed_in_at < p_to
    and coalesce(v.rp_signed_out_at, 'infinity'::timestamptz) > p_from
  limit 1;
$$;

create or replace function public.ps_rp_record_late(
  p_organisation_id uuid,
  p_signed_in_at timestamptz,
  p_signed_out_at timestamptz,
  p_reason text,
  p_notes text default null
) returns public.ps_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile ps_user_profiles;
  v_ledger ps_register_ledgers;
  v_clash text;
  v_new ps_register_entries;
  v_notes text;
begin
  perform set_config('ps.rp_rpc', 'on', true);
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not ps_member_has_permission(p_organisation_id, 'rp_log_sign') then
    raise exception 'Only pharmacists can add to the RP log' using errcode = '42501';
  end if;
  select * into v_profile from ps_user_profiles where id = v_uid;
  if coalesce(trim(v_profile.gphc_number), '') = '' then
    raise exception 'Add your GPhC number to your profile first';
  end if;
  if p_signed_in_at is null or p_signed_out_at is null then
    raise exception 'Add both the start and end time';
  end if;
  if p_signed_out_at <= p_signed_in_at then
    raise exception 'The end time must be after the start time';
  end if;
  if p_signed_out_at > now() + interval '2 minutes' then
    raise exception 'A late record must have already ended. To start a session now, use Sign in as RP.';
  end if;
  if p_signed_in_at < now() - interval '400 days' then
    raise exception 'That date is too far back';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why this is being recorded late';
  end if;

  v_ledger := public.ps_rp_ledger(p_organisation_id);
  perform 1 from ps_register_ledgers where id = v_ledger.id for update;

  v_clash := public.ps_rp_overlaps(p_organisation_id, p_signed_in_at, p_signed_out_at, null);
  if v_clash is not null then
    raise exception 'That time overlaps a session already recorded for %', v_clash;
  end if;

  v_notes := left('Recorded late: ' || trim(p_reason) || coalesce(nullif(' · ' || trim(coalesce(p_notes, '')), ' · '), ''), 320);

  select * into v_new from ps_make_register_entry(
    p_ledger_id => v_ledger.id,
    p_register_type => 'RP',
    p_entry_type => 'normal',
    p_date_of_transaction => (p_signed_in_at at time zone 'Europe/London')::date,
    p_notes => v_notes,
    p_source => 'manual',
    p_authorised_by => v_profile.full_name,
    p_pharmacist_name => v_profile.full_name,
    p_gphc_number => trim(v_profile.gphc_number),
    p_rp_signed_in_at => p_signed_in_at,
    p_rp_signed_out_at => p_signed_out_at
  );
  return v_new;
end;
$$;

create or replace function public.ps_rp_correct(
  p_entry_id uuid,
  p_signed_in_at timestamptz,
  p_signed_out_at timestamptz,
  p_pharmacist_name text,
  p_gphc_number text,
  p_notes text,
  p_reason text
) returns public.ps_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_root uuid;
  v_cur ps_register_entries;
  v_me ps_user_profiles;
  v_clash text;
  v_new ps_register_entries;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  perform set_config('ps.rp_rpc', 'on', true);
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  v_root := public.ps_rp_root_entry(p_entry_id);
  v_cur := public.ps_rp_current_version(v_root);
  if v_cur.id is null or v_cur.organisation_id not in (select ps_get_user_org_ids()) then
    raise exception 'RP record not found' using errcode = '42501';
  end if;
  if not ps_member_has_permission(v_cur.organisation_id, 'rp_log_sign') then
    raise exception 'Only pharmacists can correct the RP log' using errcode = '42501';
  end if;
  if length(v_reason) < 3 then raise exception 'Say what was wrong'; end if;
  -- Keep corrections distinguishable from sign-out records.
  if v_reason ilike 'signed out%' then v_reason := 'Correction: ' || v_reason; end if;
  if coalesce(trim(p_pharmacist_name), '') = '' then raise exception 'Pharmacist name is required'; end if;
  if coalesce(trim(p_gphc_number), '') !~ '^[0-9]{7}$' then raise exception 'GPhC number must be 7 digits'; end if;
  if p_signed_in_at is null then raise exception 'When did they become RP?'; end if;
  if p_signed_in_at > now() + interval '2 minutes' then raise exception 'The start time cannot be in the future'; end if;
  if p_signed_out_at is not null and p_signed_out_at <= p_signed_in_at then
    raise exception 'The end time must be after the start time';
  end if;
  if p_signed_out_at is not null and p_signed_out_at > now() + interval '2 minutes' then
    raise exception 'The end time cannot be in the future';
  end if;
  if v_cur.rp_signed_out_at is not null and p_signed_out_at is null then
    raise exception 'A finished session needs an end time';
  end if;
  if coalesce(length(p_notes), 0) > 200 then raise exception 'Notes must be 200 characters or fewer'; end if;

  perform 1 from ps_register_ledgers where id = v_cur.ledger_id for update;
  v_clash := public.ps_rp_overlaps(v_cur.organisation_id, p_signed_in_at, coalesce(p_signed_out_at, now()), v_root);
  if v_clash is not null then
    raise exception 'Those times overlap a session already recorded for %', v_clash;
  end if;

  select * into v_me from ps_user_profiles where id = v_uid;

  select * into v_new from ps_make_register_entry(
    p_ledger_id => v_cur.ledger_id,
    p_register_type => 'RP',
    p_entry_type => 'correction',
    p_date_of_transaction => (p_signed_in_at at time zone 'Europe/London')::date,
    p_notes => nullif(trim(coalesce(p_notes, '')), ''),
    p_source => 'manual',
    p_corrects_entry_id => v_root,
    p_correction_reason => left(v_reason, 300),
    p_authorised_by => v_me.full_name,
    p_pharmacist_name => trim(p_pharmacist_name),
    p_gphc_number => trim(p_gphc_number),
    p_rp_signed_in_at => p_signed_in_at,
    p_rp_signed_out_at => p_signed_out_at
  );
  return v_new;
end;
$$;

-- Refuse RP rows that don't come through the RP functions above.
create or replace function public.ps_rp_entries_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.register_type = 'RP'
     and auth.uid() is not null
     and coalesce(current_setting('ps.rp_rpc', true), '') <> 'on' then
    raise exception 'RP log records are made with Sign in, Sign out, Late record or Correct' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists ps_rp_entries_guard on public.ps_register_entries;
create trigger ps_rp_entries_guard before insert on public.ps_register_entries
  for each row execute function public.ps_rp_entries_guard();

revoke all on function public.ps_rp_overlaps(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.ps_rp_entries_guard() from public, anon, authenticated;
revoke all on function public.ps_rp_record_late(uuid, timestamptz, timestamptz, text, text) from public, anon;
revoke all on function public.ps_rp_correct(uuid, timestamptz, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.ps_rp_record_late(uuid, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.ps_rp_correct(uuid, timestamptz, timestamptz, text, text, text, text) to authenticated;

commit;
