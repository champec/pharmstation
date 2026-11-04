-- Account self-service and sign-in activity
--
-- 1. ps_user_profiles.email follows auth.users.email, so a confirmed email
--    change shows everywhere (team lists, invites, rotas).
-- 2. "Delete my account" requests: people ask from My profile and a platform
--    admin handles them. Records that must be kept (CD register, RP log,
--    audit) stay attributed; the admin removes or anonymises the rest.
-- 3. Sign-in activity per pharmacy (ps_auth_events): staff sign-ins and
--    sign-outs, automatic sign-outs, failed sign-ins on the pharmacy's
--    computers, password and two-step changes, and every role or status
--    change to a member. Owners and managers (view_audit, which needs
--    two-step sign-in) can read it. Rows can't be edited or deleted by users.
--
-- Rollback: supabase/rollbacks/rollback_20261104133000_account_self_service_and_signin_audit.sql

begin;

-- 1. Email sync ---------------------------------------------------------------
create or replace function public.ps_sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update ps_user_profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists ps_on_auth_user_email_changed on auth.users;
create trigger ps_on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.ps_sync_profile_email();

-- 2. Account deletion requests ----------------------------------------------
create table if not exists public.ps_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  reason text check (char_length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'done', 'declined')),
  admin_note text,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists ps_account_deletion_one_pending
  on public.ps_account_deletion_requests (user_id) where status = 'pending';
alter table public.ps_account_deletion_requests enable row level security;
revoke all on public.ps_account_deletion_requests from anon, authenticated;
grant select on public.ps_account_deletion_requests to authenticated;
drop policy if exists ps_deletion_select_own on public.ps_account_deletion_requests;
create policy ps_deletion_select_own on public.ps_account_deletion_requests
  for select to authenticated using (user_id = auth.uid() or public.ps_is_platform_admin());

create or replace function public.ps_request_account_deletion(p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select id into v_id from ps_account_deletion_requests where user_id = auth.uid() and status = 'pending';
  if v_id is not null then return v_id; end if;
  insert into ps_account_deletion_requests (user_id, email, reason)
  select auth.uid(), u.email, nullif(left(trim(coalesce(p_reason, '')), 1000), '')
  from auth.users u where u.id = auth.uid()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.ps_request_account_deletion(text) from public, anon;
grant execute on function public.ps_request_account_deletion(text) to authenticated;

create or replace function public.ps_cancel_account_deletion()
returns void
language sql
security definer
set search_path = public
as $$
  delete from ps_account_deletion_requests where user_id = auth.uid() and status = 'pending'
$$;
revoke all on function public.ps_cancel_account_deletion() from public, anon;
grant execute on function public.ps_cancel_account_deletion() to authenticated;

create or replace function public.ps_admin_set_deletion_request(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not ps_is_platform_admin() then raise exception 'Platform admins only' using errcode = '42501'; end if;
  if p_status not in ('done', 'declined') then raise exception 'Invalid status'; end if;
  update ps_account_deletion_requests
     set status = p_status, admin_note = p_note, handled_by = auth.uid(), handled_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.ps_admin_set_deletion_request(uuid, text, text) from public, anon;
grant execute on function public.ps_admin_set_deletion_request(uuid, text, text) to authenticated;

-- 3. Sign-in activity ---------------------------------------------------------
create table if not exists public.ps_auth_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.ps_organisations(id) on delete cascade,
  user_id uuid,
  email text,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists ps_auth_events_org_time on public.ps_auth_events (organisation_id, created_at desc);
alter table public.ps_auth_events enable row level security;
revoke all on public.ps_auth_events from anon, authenticated;
-- No policies: read through ps_org_list_auth_events, write through
-- ps_log_auth_event and the member trigger.

create or replace function public.ps_log_auth_event(p_org_id uuid, p_event text, p_email text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_org boolean;
  v_is_member boolean;
begin
  if v_uid is null then return; end if;
  if p_event not in ('sign_in', 'sign_out', 'idle_sign_out', 'failed_sign_in', 'password_changed',
                     'two_step_on', 'two_step_off') then
    raise exception 'Unknown event';
  end if;
  select exists (select 1 from ps_organisations where id = p_org_id and auth_user_id = v_uid) into v_is_org;
  select exists (select 1 from ps_organisation_members where organisation_id = p_org_id and user_id = v_uid) into v_is_member;
  -- Failed sign-ins are logged by the pharmacy's own login (the person isn't
  -- signed in); everything else by the person, at a pharmacy they belong to.
  if p_event = 'failed_sign_in' then
    if not v_is_org then return; end if;
    insert into ps_auth_events (organisation_id, email, event)
    values (p_org_id, left(lower(trim(coalesce(p_email, ''))), 254), p_event);
  else
    if not v_is_member then return; end if;
    insert into ps_auth_events (organisation_id, user_id, email, event)
    select p_org_id, v_uid, u.email, p_event from auth.users u where u.id = v_uid;
  end if;
end;
$$;
revoke all on function public.ps_log_auth_event(uuid, text, text) from public, anon;
grant execute on function public.ps_log_auth_event(uuid, text, text) to authenticated;

create or replace function public.ps_org_list_auth_events(p_org_id uuid, p_limit integer default 200)
returns table (id uuid, created_at timestamptz, event text, email text, full_name text, detail jsonb, by_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ps_member_has_permission(p_org_id, 'view_audit') then
    raise exception 'You need audit access, with two-step sign-in, to see sign-in activity' using errcode = '42501';
  end if;
  return query
    select e.id, e.created_at, e.event, e.email, p.full_name, e.detail, b.full_name
    from ps_auth_events e
    left join ps_user_profiles p on p.id = e.user_id
    left join ps_user_profiles b on b.id = e.created_by
    where e.organisation_id = p_org_id
    order by e.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;
revoke all on function public.ps_org_list_auth_events(uuid, integer) from public, anon;
grant execute on function public.ps_org_list_auth_events(uuid, integer) to authenticated;

create or replace function public.ps_audit_member_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into ps_auth_events (organisation_id, user_id, event, detail)
    values (new.organisation_id, new.user_id, 'member_added',
            jsonb_build_object('role', new.role, 'status', new.status,
                               'temporary_until', new.access_expires_at));
  elsif new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.permissions is distinct from old.permissions then
    insert into ps_auth_events (organisation_id, user_id, event, detail)
    values (new.organisation_id, new.user_id, 'member_changed',
            jsonb_build_object('role', jsonb_build_array(old.role, new.role),
                               'status', jsonb_build_array(old.status, new.status),
                               'permissions_changed', new.permissions is distinct from old.permissions));
  end if;
  return new;
end;
$$;
drop trigger if exists ps_audit_member_change on public.ps_organisation_members;
create trigger ps_audit_member_change
  after insert or update on public.ps_organisation_members
  for each row execute function public.ps_audit_member_change();

-- Two-step resets by a manager are recorded too.
create or replace function public.ps_org_reset_member_mfa(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_m ps_organisation_members%rowtype;
  v_level text;
begin
  select * into v_m from ps_organisation_members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;
  v_level := ps_org_manager_level(v_m.organisation_id);
  if v_level is null then
    raise exception 'Only an owner or manager signed in with two-step sign-in can do this' using errcode = '42501';
  end if;
  if v_m.user_id = auth.uid() then
    raise exception 'You can''t reset your own two-step sign-in. Ask another owner.' using errcode = '42501';
  end if;
  if v_level <> 'owner' and v_m.role in ('owner', 'manager') then
    raise exception 'Only an owner can reset an owner or manager' using errcode = '42501';
  end if;
  delete from auth.mfa_factors where user_id = v_m.user_id;
  insert into ps_auth_events (organisation_id, user_id, event)
  values (v_m.organisation_id, v_m.user_id, 'two_step_reset');
end;
$$;

commit;
