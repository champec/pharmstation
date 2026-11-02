-- ============================================================================
-- Pharmacy self-sign-up, staff invites and team management (2 Nov 2026)
--
-- Run once in the SQL editor of the project the web app points at (London
-- "Pharmstation", and PharmEx too if it is still live). Safe to re-run.
--
-- What it does
--   1. ps_organisations gets verification_status. Existing pharmacies are
--      marked 'verified'; new self-sign-ups start 'pending' until a platform
--      admin checks the GPhC premises register. Pending pharmacies can use
--      their own workspace but cannot send network messages, link to an NHS
--      pharmacy in the network, or list themselves publicly.
--   2. A guard trigger stops a pharmacy account changing its own verification,
--      auth_user_id, subscription_tier or organisation_type from the browser.
--   3. ps_organisation_invites: email-bound, single-use, 7-day invite links.
--      Only the token's SHA-256 is stored.
--   4. RPCs for invites, the member list and member changes. Owners manage
--      everyone; managers manage pharmacist/technician/dispenser/locum only.
--      Nobody can change their own role or status, and the last owner can't
--      be removed.
--   5. Owner bootstrap: a brand-new pending pharmacy with no owner can issue
--      one owner invite from the workstation session, which the owner's
--      personal account then accepts.
--   6. Drops the ps_members_insert policy. Before this, any active member of
--      an org (even a dispenser) could insert membership rows with any role,
--      including 'owner'. All membership writes now go through the RPCs.
--   7. Platform admin RPCs to list and verify pharmacies.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Platform admins (identical to security/prescriber_approval.sql, so either
--    script can run first)
-- ---------------------------------------------------------------------------
create table if not exists public.ps_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.ps_platform_admins enable row level security;
revoke all on public.ps_platform_admins from anon, authenticated;

create or replace function public.ps_is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ps_platform_admins where user_id = auth.uid())
$$;
revoke execute on function public.ps_is_platform_admin() from public, anon;
grant execute on function public.ps_is_platform_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Organisation verification
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ps_organisations' and column_name = 'verification_status'
  ) then
    alter table public.ps_organisations
      add column verification_status text not null default 'pending',
      add column verified_at timestamptz,
      add column verified_by uuid references auth.users(id) on delete set null,
      add column verification_note text;
    alter table public.ps_organisations
      add constraint ps_organisations_verification_status_check
      check (verification_status in ('pending', 'verified', 'rejected'));
    -- Everything that exists today was set up by hand, so it is trusted.
    update public.ps_organisations set verification_status = 'verified', verified_at = now();
  end if;
end $$;

create or replace function public.ps_org_is_verified(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select verification_status = 'verified' from ps_organisations where id = p_org_id), false)
$$;
revoke execute on function public.ps_org_is_verified(uuid) from public, anon;
grant execute on function public.ps_org_is_verified(uuid) to authenticated, service_role;

-- Guard trigger. SECURITY INVOKER on purpose: inside a SECURITY DEFINER
-- function current_user is always the owner, so the trusted-caller check
-- below would always pass. As invoker, current_user is 'authenticated' for
-- browser calls and 'postgres' when the change comes from our own
-- SECURITY DEFINER RPCs or the auth sign-up trigger.
create or replace function public.ps_organisations_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'pending';
    new.verified_at := null;
    new.verified_by := null;
    new.verification_note := null;
    new.is_public := false;
    return new;
  end if;

  new.verification_status := old.verification_status;
  new.verified_at := old.verified_at;
  new.verified_by := old.verified_by;
  new.verification_note := old.verification_note;
  new.auth_user_id := old.auth_user_id;
  new.subscription_tier := old.subscription_tier;
  new.organisation_type := old.organisation_type;

  if coalesce(new.is_public, false) and not coalesce(old.is_public, false)
     and old.verification_status <> 'verified' then
    raise exception 'Your pharmacy must be verified before it can be listed publicly'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.ps_organisations_guard() from public, anon, authenticated;

drop trigger if exists ps_organisations_guard on public.ps_organisations;
create trigger ps_organisations_guard
  before insert or update on public.ps_organisations
  for each row execute function public.ps_organisations_guard();

-- Pending pharmacies can't speak on the network or claim an NHS pharmacy yet.
-- Restrictive policies are ANDed with the existing permissive ones.
drop policy if exists netmsg_verified_sender on public.ps_network_messages;
create policy netmsg_verified_sender on public.ps_network_messages
  as restrictive for insert to authenticated
  with check (public.ps_org_is_verified(from_org_id));

drop policy if exists netlink_verified_insert on public.ps_org_pharmacy_link;
create policy netlink_verified_insert on public.ps_org_pharmacy_link
  as restrictive for insert to authenticated
  with check (public.ps_org_is_verified(org_id));

drop policy if exists netlink_verified_update on public.ps_org_pharmacy_link;
create policy netlink_verified_update on public.ps_org_pharmacy_link
  as restrictive for update to authenticated
  using (true)
  with check (public.ps_org_is_verified(org_id));

-- ---------------------------------------------------------------------------
-- 2. Membership writes only via RPCs
-- ---------------------------------------------------------------------------
drop policy if exists ps_members_insert on public.ps_organisation_members;

-- ---------------------------------------------------------------------------
-- 3. Invites
-- ---------------------------------------------------------------------------
create table if not exists public.ps_organisation_invites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.ps_organisations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null check (role in ('owner', 'manager', 'pharmacist', 'technician', 'dispenser', 'locum')),
  permissions jsonb not null default '{}'::jsonb,
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
create unique index if not exists ps_organisation_invites_one_open
  on public.ps_organisation_invites (organisation_id, email)
  where accepted_at is null and revoked_at is null;
alter table public.ps_organisation_invites enable row level security;
revoke all on public.ps_organisation_invites from anon, authenticated;

create or replace function public.ps_invite_token_hash(p_token text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
$$;
revoke execute on function public.ps_invite_token_hash(text) from public, anon, authenticated;

-- 'owner' | 'manager' | null: how much the caller may change in this org's team.
-- Owners always can (so an org can never lock itself out). Managers can unless
-- manage_users is switched off for them. Any other role needs manage_users = true.
create or replace function public.ps_org_manager_level(p_org_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when m.role = 'owner' then 'owner'
    when m.role = 'manager' and coalesce((m.permissions->>'manage_users')::boolean, true) then 'manager'
    when coalesce((m.permissions->>'manage_users')::boolean, false) then 'manager'
    else null
  end
  from ps_organisation_members m
  where m.organisation_id = p_org_id and m.user_id = auth.uid() and m.status = 'active'
$$;
revoke execute on function public.ps_org_manager_level(uuid) from public, anon;
grant execute on function public.ps_org_manager_level(uuid) to authenticated, service_role;

create or replace function public.ps_assert_permission_overrides(p_permissions jsonb)
returns void language plpgsql immutable set search_path = public as $$
declare k text; v jsonb;
begin
  if p_permissions is null then return; end if;
  if jsonb_typeof(p_permissions) <> 'object' then
    raise exception 'Permissions must be an object of true/false values';
  end if;
  for k, v in select * from jsonb_each(p_permissions) loop
    if jsonb_typeof(v) <> 'boolean' or k !~ '^[a-z_]{1,64}$' then
      raise exception 'Invalid permission %', k;
    end if;
  end loop;
end;
$$;
revoke execute on function public.ps_assert_permission_overrides(jsonb) from public, anon, authenticated;

create or replace function public.ps_org_create_invite(
  p_org_id uuid, p_email text, p_role text, p_permissions jsonb default null
) returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_level text := ps_org_manager_level(p_org_id);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
  v_org ps_organisations%rowtype;
begin
  if v_level is null then raise exception 'You do not have permission to invite staff' using errcode = '42501'; end if;
  select * into v_org from ps_organisations where id = p_org_id;
  if v_org.organisation_type is distinct from 'pharmacy' then
    raise exception 'Staff invites are for pharmacies. Use the care home invite for care homes.';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid email address';
  end if;
  if p_role not in ('owner', 'manager', 'pharmacist', 'technician', 'dispenser', 'locum') then
    raise exception 'Choose a role';
  end if;
  if v_level <> 'owner' and p_role in ('owner', 'manager') then
    raise exception 'Only an owner can invite owners or managers' using errcode = '42501';
  end if;
  if p_permissions is not null and p_permissions <> '{}'::jsonb and v_level <> 'owner' then
    raise exception 'Only an owner can set custom permissions' using errcode = '42501';
  end if;
  perform ps_assert_permission_overrides(p_permissions);

  if exists (
    select 1 from ps_organisation_members m join auth.users u on u.id = m.user_id
    where m.organisation_id = p_org_id and m.status = 'active' and lower(u.email) = v_email
  ) then
    raise exception 'That person is already an active member of this pharmacy';
  end if;
  if (select count(*) from ps_organisation_invites i
      where i.organisation_id = p_org_id and i.accepted_at is null and i.revoked_at is null
        and i.expires_at > now()) >= 100 then
    raise exception 'Too many open invites. Revoke some first.';
  end if;

  -- A new invite to the same email replaces the old link.
  update ps_organisation_invites i set revoked_at = now()
  where i.organisation_id = p_org_id and i.email = v_email and i.accepted_at is null and i.revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  return query
    insert into ps_organisation_invites as i (organisation_id, email, role, permissions, token_hash, invited_by)
    values (p_org_id, v_email, p_role, coalesce(p_permissions, '{}'::jsonb), ps_invite_token_hash(v_token), auth.uid())
    returning i.id, v_token, i.expires_at;
end;
$$;
revoke execute on function public.ps_org_create_invite(uuid, text, text, jsonb) from public, anon;
grant execute on function public.ps_org_create_invite(uuid, text, text, jsonb) to authenticated, service_role;

create or replace function public.ps_org_list_invites(p_org_id uuid)
returns table (id uuid, email text, role text, created_at timestamptz, expires_at timestamptz, invited_by_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if ps_org_manager_level(p_org_id) is null then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query
    select i.id, i.email, i.role, i.created_at, i.expires_at, p.full_name
    from ps_organisation_invites i
    left join ps_user_profiles p on p.id = i.invited_by
    where i.organisation_id = p_org_id and i.accepted_at is null and i.revoked_at is null
    order by i.created_at desc;
end;
$$;
revoke execute on function public.ps_org_list_invites(uuid) from public, anon;
grant execute on function public.ps_org_list_invites(uuid) to authenticated, service_role;

create or replace function public.ps_org_revoke_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organisation_id into v_org from ps_organisation_invites where id = p_invite_id;
  if v_org is null or ps_org_manager_level(v_org) is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update ps_organisation_invites set revoked_at = now()
  where id = p_invite_id and accepted_at is null and revoked_at is null;
end;
$$;
revoke execute on function public.ps_org_revoke_invite(uuid) from public, anon;
grant execute on function public.ps_org_revoke_invite(uuid) to authenticated, service_role;

-- Anyone holding the link can see who it is for. The token is 256 random bits
-- and is the only way in, so this is safe to expose to anon (the join page
-- shows it before the person has an account).
create or replace function public.ps_invite_preview(p_token text)
returns table (organisation_name text, role text, email text, status text, expires_at timestamptz, invited_by_name text)
language sql stable security definer set search_path = public as $$
  select o.name, i.role, i.email,
         case when i.revoked_at is not null then 'revoked'
              when i.accepted_at is not null then 'accepted'
              when i.expires_at <= now() then 'expired'
              else 'pending' end,
         i.expires_at, p.full_name
  from ps_organisation_invites i
  join ps_organisations o on o.id = i.organisation_id
  left join ps_user_profiles p on p.id = i.invited_by
  where i.token_hash = ps_invite_token_hash(p_token)
$$;
revoke execute on function public.ps_invite_preview(text) from public;
grant execute on function public.ps_invite_preview(text) to anon, authenticated, service_role;

create or replace function public.ps_accept_org_invite(p_token text)
returns table (organisation_id uuid, organisation_name text, role text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_inv ps_organisation_invites%rowtype;
  v_user auth.users%rowtype;
  v_member ps_organisation_members%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;

  select * into v_inv from ps_organisation_invites where token_hash = ps_invite_token_hash(p_token) for update;
  if not found or v_inv.revoked_at is not null then raise exception 'This invite is no longer valid'; end if;
  if v_inv.accepted_at is not null then raise exception 'This invite has already been used'; end if;
  if v_inv.expires_at <= now() then raise exception 'This invite has expired. Ask for a new one.'; end if;

  select * into v_user from auth.users where id = v_uid;
  if lower(v_user.email) is distinct from v_inv.email then
    raise exception 'This invite was sent to %. Sign in with that email address.', v_inv.email
      using errcode = '42501';
  end if;
  if v_user.email_confirmed_at is null then
    raise exception 'Confirm your email address first, then open the invite link again';
  end if;

  insert into ps_user_profiles (id, full_name, email, default_role)
  values (v_uid,
          coalesce(nullif(v_user.raw_user_meta_data->>'full_name', ''), split_part(v_user.email, '@', 1)),
          v_user.email, v_inv.role)
  on conflict (id) do nothing;

  select * into v_member from ps_organisation_members m
  where m.organisation_id = v_inv.organisation_id and m.user_id = v_uid for update;
  if found and v_member.status = 'active' then
    raise exception 'You are already a member of this pharmacy';
  elsif found then
    update ps_organisation_members m
       set role = v_inv.role, permissions = v_inv.permissions, status = 'active',
           is_locum = (v_inv.role = 'locum'), approved_by = v_inv.invited_by, approved_at = now()
     where m.id = v_member.id;
  else
    insert into ps_organisation_members (organisation_id, user_id, role, permissions, status, is_locum, approved_by, approved_at)
    values (v_inv.organisation_id, v_uid, v_inv.role, v_inv.permissions, 'active', v_inv.role = 'locum', v_inv.invited_by, now());
  end if;

  update ps_organisation_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  return query select o.id, o.name, v_inv.role from ps_organisations o where o.id = v_inv.organisation_id;
end;
$$;
revoke execute on function public.ps_accept_org_invite(text) from public, anon;
grant execute on function public.ps_accept_org_invite(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Owner bootstrap for brand-new pharmacies (called with the WORKSTATION
--    session). Only while the pharmacy is pending, under 30 days old and has
--    no active owner, so it can't be used to take over an established org.
-- ---------------------------------------------------------------------------
create or replace function public.ps_org_needs_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ps_organisations o
    where o.auth_user_id = auth.uid()
      and o.organisation_type = 'pharmacy'
      and o.verification_status = 'pending'
      and o.created_at > now() - interval '30 days'
      and not exists (select 1 from ps_organisation_members m
                      where m.organisation_id = o.id and m.role = 'owner' and m.status = 'active')
  )
$$;
revoke execute on function public.ps_org_needs_owner() from public, anon;
grant execute on function public.ps_org_needs_owner() to authenticated, service_role;

create or replace function public.ps_org_start_owner_claim(p_email text)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
begin
  if not ps_org_needs_owner() then
    raise exception 'This pharmacy already has an owner. Ask them to invite you.' using errcode = '42501';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address'; end if;
  select id into v_org from ps_organisations where auth_user_id = auth.uid();
  if exists (select 1 from auth.users where id = auth.uid() and lower(email) = v_email) then
    raise exception 'Use your own personal email for the owner account, not the pharmacy login email';
  end if;

  update ps_organisation_invites i set revoked_at = now()
  where i.organisation_id = v_org and i.accepted_at is null and i.revoked_at is null and i.role = 'owner';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  return query
    insert into ps_organisation_invites as i (organisation_id, email, role, token_hash, expires_at)
    values (v_org, v_email, 'owner', ps_invite_token_hash(v_token), now() + interval '1 day')
    returning v_token, i.expires_at;
end;
$$;
revoke execute on function public.ps_org_start_owner_claim(text) from public, anon;
grant execute on function public.ps_org_start_owner_claim(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Team list and member changes
-- ---------------------------------------------------------------------------
create or replace function public.ps_org_list_members(p_org_id uuid)
returns table (member_id uuid, user_id uuid, full_name text, email text, gphc_number text, role text,
               status text, is_locum boolean, permissions jsonb, created_at timestamptz, last_active_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_is_org boolean := exists (select 1 from ps_organisations o where o.id = p_org_id and o.auth_user_id = auth.uid());
  v_can_manage boolean := ps_org_manager_level(p_org_id) is not null;
begin
  if not v_is_org and not exists (
    select 1 from ps_organisation_members x where x.organisation_id = p_org_id and x.user_id = auth.uid() and x.status = 'active'
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, coalesce(p.full_name, 'Unknown'),
           case when v_can_manage or m.user_id = auth.uid() then coalesce(p.email, u.email::text) end,
           p.gphc_number, m.role, m.status, m.is_locum,
           case when v_can_manage then m.permissions end,
           m.created_at, m.last_active_at
    from ps_organisation_members m
    left join ps_user_profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.organisation_id = p_org_id
      and (m.status <> 'revoked' or v_can_manage)
    order by case m.status when 'active' then 0 when 'suspended' then 1 else 2 end,
             case m.role when 'owner' then 0 when 'manager' then 1 when 'pharmacist' then 2 else 3 end,
             p.full_name;
end;
$$;
revoke execute on function public.ps_org_list_members(uuid) from public, anon;
grant execute on function public.ps_org_list_members(uuid) to authenticated, service_role;

create or replace function public.ps_org_update_member(
  p_member_id uuid, p_role text default null, p_status text default null, p_permissions jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_m ps_organisation_members%rowtype;
  v_level text;
  v_role text;
  v_status text;
begin
  select * into v_m from ps_organisation_members where id = p_member_id for update;
  if not found then raise exception 'Member not found'; end if;
  v_level := ps_org_manager_level(v_m.organisation_id);
  if v_level is null then raise exception 'You do not have permission to manage staff' using errcode = '42501'; end if;
  if v_m.user_id = auth.uid() then
    raise exception 'You can''t change your own role or access. Ask another owner.' using errcode = '42501';
  end if;

  v_role := coalesce(p_role, v_m.role);
  v_status := coalesce(p_status, v_m.status);
  if v_role not in ('owner', 'manager', 'pharmacist', 'technician', 'dispenser', 'locum', 'carehome_user')
     or (v_role = 'carehome_user' and v_m.role <> 'carehome_user') then
    raise exception 'Invalid role';
  end if;
  if v_status not in ('active', 'suspended', 'revoked') then raise exception 'Invalid status'; end if;
  if v_level <> 'owner' and (v_m.role in ('owner', 'manager') or v_role in ('owner', 'manager')) then
    raise exception 'Only an owner can change owners or managers' using errcode = '42501';
  end if;
  if p_permissions is not null and v_level <> 'owner' then
    raise exception 'Only an owner can set custom permissions' using errcode = '42501';
  end if;
  perform ps_assert_permission_overrides(p_permissions);

  if v_m.role = 'owner' and v_m.status = 'active' and (v_role <> 'owner' or v_status <> 'active')
     and not exists (select 1 from ps_organisation_members
                     where organisation_id = v_m.organisation_id and role = 'owner' and status = 'active' and id <> v_m.id) then
    raise exception 'A pharmacy must keep at least one active owner';
  end if;

  update ps_organisation_members
     set role = v_role,
         status = v_status,
         is_locum = case when p_role is null then is_locum else v_role = 'locum' end,
         permissions = coalesce(p_permissions, permissions),
         approved_by = case when v_status = 'active' and v_m.status <> 'active' then auth.uid() else approved_by end,
         approved_at = case when v_status = 'active' and v_m.status <> 'active' then now() else approved_at end
   where id = p_member_id;
end;
$$;
revoke execute on function public.ps_org_update_member(uuid, text, text, jsonb) from public, anon;
grant execute on function public.ps_org_update_member(uuid, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Platform admin: verify pharmacies against the GPhC premises register
-- ---------------------------------------------------------------------------
create or replace function public.ps_admin_list_organisations(p_status text default 'pending')
returns table (id uuid, name text, gphc_premises_number text, address jsonb, login_email text,
               owner_name text, owner_email text, owner_gphc_number text, member_count bigint,
               verification_status text, verification_note text, created_at timestamptz, verified_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query
    select o.id, o.name, o.gphc_premises_number, o.address, ou.email::text,
           op.full_name, coalesce(op.email, opu.email::text), op.gphc_number,
           (select count(*) from ps_organisation_members m where m.organisation_id = o.id and m.status = 'active'),
           o.verification_status, o.verification_note, o.created_at, o.verified_at
    from ps_organisations o
    left join auth.users ou on ou.id = o.auth_user_id
    left join lateral (
      select m.user_id from ps_organisation_members m
      where m.organisation_id = o.id and m.role = 'owner' and m.status = 'active'
      order by m.created_at limit 1
    ) own on true
    left join ps_user_profiles op on op.id = own.user_id
    left join auth.users opu on opu.id = own.user_id
    where o.organisation_type = 'pharmacy'
      and (p_status is null or o.verification_status = p_status)
    order by o.created_at desc;
end;
$$;
revoke execute on function public.ps_admin_list_organisations(text) from public, anon;
grant execute on function public.ps_admin_list_organisations(text) to authenticated, service_role;

create or replace function public.ps_admin_set_organisation_verification(
  p_org_id uuid, p_status text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_status not in ('pending', 'verified', 'rejected') then raise exception 'Invalid status'; end if;
  update ps_organisations
     set verification_status = p_status,
         verified_at = case when p_status = 'verified' then now() else null end,
         verified_by = case when p_status = 'verified' then auth.uid() else null end,
         verification_note = nullif(trim(coalesce(p_note, '')), ''),
         is_public = case when p_status = 'verified' then is_public else false end,
         updated_at = now()
   where id = p_org_id;
  if not found then raise exception 'Pharmacy not found'; end if;
end;
$$;
revoke execute on function public.ps_admin_set_organisation_verification(uuid, text, text) from public, anon;
grant execute on function public.ps_admin_set_organisation_verification(uuid, text, text) to authenticated, service_role;

commit;

-- After running, make yourself a platform admin (if prescriber_approval.sql
-- hasn't already):
--   insert into public.ps_platform_admins (user_id)
--   select id from auth.users where email = 'YOUR_EMAIL' on conflict do nothing;
