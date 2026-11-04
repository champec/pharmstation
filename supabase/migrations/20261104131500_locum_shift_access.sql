-- Booked locums can sign in at the shift pharmacy
--
-- A locum with an APPROVED booking can sign in to the pharmacy's computers
-- from 1 hour before the shift starts until 2 hours after it ends, without
-- a manager adding them as staff. They get a normal 'locum' membership that
-- carries access_expires_at; a pg_cron job revokes it once that passes.
--
-- Rules
--  - Only approved bookings on shifts that aren't cancelled, and only for
--    locums whose compliance review is approved.
--  - Never touches a permanent membership (access_expires_at is null): if a
--    manager suspended or removed someone, a booking doesn't undo that.
--  - Shift dates and times are UK local time; a shift ending at or before its
--    start time runs past midnight.
--
-- Rollback: supabase/rollbacks/rollback_20261104131500_locum_shift_access.sql

begin;

alter table public.ps_organisation_members
  add column if not exists access_expires_at timestamptz,
  add column if not exists shift_booking_id uuid references public.ps_locum_bookings(id) on delete set null;

comment on column public.ps_organisation_members.access_expires_at is
  'Set for temporary shift access (booked locums). Null means permanent membership.';

create or replace function public.ps_locum_claim_shift_access(p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_booking_id uuid;
  v_until timestamptz;
  v_member ps_organisation_members%rowtype;
  v_has_row boolean;
begin
  if v_uid is null then return false; end if;

  select b.id,
         ((s.date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end) at time zone 'Europe/London') + interval '2 hours'
    into v_booking_id, v_until
  from ps_locum_bookings b
  join ps_locum_shifts s on s.id = b.shift_id
  join ps_locum_profiles lp on lp.id = b.locum_id
  where lp.user_id = v_uid
    and lp.compliance_status = 'approved'
    and s.org_id = p_org_id
    and b.status = 'approved'
    and coalesce(s.status, 'open') <> 'cancelled'
    and now() between ((s.date + s.start_time) at time zone 'Europe/London') - interval '1 hour'
                  and ((s.date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end) at time zone 'Europe/London') + interval '2 hours'
  order by s.date, s.start_time
  limit 1;

  if v_booking_id is null then return false; end if;

  select * into v_member from ps_organisation_members
  where organisation_id = p_org_id and user_id = v_uid
  for update;
  v_has_row := found;

  if v_has_row and v_member.access_expires_at is null then
    -- Permanent membership: leave it exactly as the pharmacy set it.
    return v_member.status = 'active';
  end if;

  insert into ps_user_profiles (id, full_name, email, default_role)
  select u.id,
         coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)),
         u.email, 'locum'
  from auth.users u where u.id = v_uid
  on conflict (id) do nothing;

  if v_has_row then
    update ps_organisation_members
       set role = 'locum', permissions = '{}'::jsonb, status = 'active', is_locum = true,
           access_expires_at = greatest(coalesce(access_expires_at, v_until), v_until),
           shift_booking_id = v_booking_id
     where id = v_member.id;
  else
    insert into ps_organisation_members
      (organisation_id, user_id, role, permissions, status, is_locum, approved_at, access_expires_at, shift_booking_id)
    values
      (p_org_id, v_uid, 'locum', '{}'::jsonb, 'active', true, now(), v_until, v_booking_id);
  end if;
  return true;
end;
$$;
revoke all on function public.ps_locum_claim_shift_access(uuid) from public, anon;
grant execute on function public.ps_locum_claim_shift_access(uuid) to authenticated;

-- Revoke shift access once it runs out.
create or replace function public.ps_expire_shift_access()
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    update ps_organisation_members
       set status = 'revoked'
     where access_expires_at is not null
       and access_expires_at <= now()
       and status = 'active'
    returning 1
  )
  select count(*)::integer from expired
$$;
revoke all on function public.ps_expire_shift_access() from public, anon, authenticated;

select cron.schedule('ps-expire-shift-access', '*/5 * * * *', $$select public.ps_expire_shift_access()$$);

commit;
