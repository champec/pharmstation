-- SOPs: production readiness (Phases 1 and 2 of
-- /mnt/project-files/sop/production-readiness-plan.md)
--
-- Needs ps_member_has_permission (20261104090000_cd_register_part_a_additive.sql),
-- which is already on London. Safe to run more than once.
--
-- Phase 1, security
--  1. sop-pdfs storage: until now ANY signed-in user (patients included) could
--     list, download, overwrite and delete every pharmacy's SOP files. Now:
--       read  = active staff of that pharmacy, or a locum with an approved or
--               completed booking there (current locum SOP files only)
--       write = SOP managers of that pharmacy
--     Bucket limited to PDF, JPEG and PNG, 20 MB a file.
--  2. ps_locum_sop_documents: any signed-in user could read every pharmacy's
--     locum SOP list. Now only that pharmacy's staff and locums booked there.
--     Only SOP managers can add, change or remove them (was any staff member).
--  3. Sign-offs can't be edited or deleted. Staff sign only for themselves, only
--     the current published version; the time, signer and name are set by the
--     database. Locums sign only active SOPs at pharmacies they are booked with,
--     at the current version.
--  "SOP manager" = owner, manager or pharmacist (as before), or anyone given the
--  sop_upload permission. ps_sop_* table policies now use the same check.
--
-- Phase 2, trustworthy sign-offs
--  4. Publishing goes through ps_sop_publish(document_id). It freezes a copy of
--     the SOP (title, description, every section) in ps_sop_document_versions.
--     Staff read the frozen copy, so editing a published SOP does not change
--     what staff see until it is published again (which bumps the version and
--     asks everyone to re-read). Version, status 'published' and published_at
--     can no longer be set directly by the app.
--     Existing published SOPs get a frozen copy of their current content.
--  5. Sign-off history is kept: an SOP with sign-offs can't be deleted (archive
--     it), and removing a staff member keeps their sign-offs with their name.
--  6. Locum SOPs can get a new version: changing the file bumps the version by
--     one and keeps the old file in ps_locum_sop_document_versions. A locum SOP
--     with sign-offs can't be deleted (deactivate it).
--  7. Fix: SOP assignment alerts never reached anyone (the trigger passed a
--     member id where a user id is needed). Republishing now also alerts the
--     assigned staff that they need to re-read.
--
-- Rollback: supabase/rollbacks/rollback_20261105160000_sop_production_readiness.sql

begin;

-- ─────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────

create or replace function public.ps_is_sop_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ps_organisation_members
    where user_id = auth.uid() and organisation_id = p_org and status = 'active'
      and role in ('owner', 'manager', 'pharmacist'))
  or ps_member_has_permission(p_org, 'sop_upload');
$$;

create or replace function public.ps_locum_has_booking_with_org(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ps_locum_bookings b
    join ps_locum_shifts s on s.id = b.shift_id
    where b.locum_id = ps_get_my_locum_id()
      and b.status in ('approved', 'completed')
      and s.org_id = p_org);
$$;

-- The pharmacy that owns a sop-pdfs folder: either the folder is the pharmacy id
-- (shift SOPs) or an SOP library document id.
create or replace function public.ps_sop_folder_org(p_folder text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.id from ps_organisations o where o.id::text = p_folder),
    (select d.org_id from ps_sop_documents d where d.id::text = p_folder));
$$;

create or replace function public.ps_sop_file_readable(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    ps_sop_folder_org((storage.foldername(p_name))[1]) in (select ps_get_user_org_ids())
    or exists (
      select 1 from ps_locum_sop_documents l
      where l.file_url = p_name and l.is_active
        and ps_locum_has_booking_with_org(l.org_id));
$$;

create or replace function public.ps_sop_file_writable(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ps_is_sop_manager(ps_sop_folder_org((storage.foldername(p_name))[1])), false);
$$;

revoke all on function public.ps_is_sop_manager(uuid) from public, anon;
revoke all on function public.ps_locum_has_booking_with_org(uuid) from public, anon;
revoke all on function public.ps_sop_folder_org(text) from public, anon;
revoke all on function public.ps_sop_file_readable(text) from public, anon;
revoke all on function public.ps_sop_file_writable(text) from public, anon;
grant execute on function public.ps_is_sop_manager(uuid) to authenticated, service_role;
grant execute on function public.ps_locum_has_booking_with_org(uuid) to authenticated, service_role;
grant execute on function public.ps_sop_folder_org(text) to authenticated, service_role;
grant execute on function public.ps_sop_file_readable(text) to authenticated, service_role;
grant execute on function public.ps_sop_file_writable(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 1. sop-pdfs storage
-- ─────────────────────────────────────────────────────────────

update storage.buckets
   set public = false,
       file_size_limit = 20971520,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
 where id = 'sop-pdfs';

drop policy if exists sop_pdfs_select_authenticated on storage.objects;
drop policy if exists sop_pdfs_insert_authenticated on storage.objects;
drop policy if exists sop_pdfs_update_authenticated on storage.objects;
drop policy if exists sop_pdfs_delete_authenticated on storage.objects;

create policy sop_pdfs_select_authenticated on storage.objects for select to authenticated
  using (bucket_id = 'sop-pdfs' and public.ps_sop_file_readable(name));
create policy sop_pdfs_insert_authenticated on storage.objects for insert to authenticated
  with check (bucket_id = 'sop-pdfs' and public.ps_sop_file_writable(name));
create policy sop_pdfs_update_authenticated on storage.objects for update to authenticated
  using (bucket_id = 'sop-pdfs' and public.ps_sop_file_writable(name))
  with check (bucket_id = 'sop-pdfs' and public.ps_sop_file_writable(name));
create policy sop_pdfs_delete_authenticated on storage.objects for delete to authenticated
  using (bucket_id = 'sop-pdfs' and public.ps_sop_file_writable(name));

-- ─────────────────────────────────────────────────────────────
-- 2. Locum SOP list
-- ─────────────────────────────────────────────────────────────

drop policy if exists authenticated_read_active_sops on public.ps_locum_sop_documents;
drop policy if exists booked_locums_read_active_sops on public.ps_locum_sop_documents;
drop policy if exists org_members_crud_sop_documents on public.ps_locum_sop_documents;
drop policy if exists org_members_read_sop_documents on public.ps_locum_sop_documents;
drop policy if exists sop_managers_write_sop_documents on public.ps_locum_sop_documents;

create policy org_members_read_sop_documents on public.ps_locum_sop_documents
  for select to authenticated
  using (org_id in (select ps_get_user_org_ids()));
create policy booked_locums_read_active_sops on public.ps_locum_sop_documents
  for select to authenticated
  using (is_active and public.ps_locum_has_booking_with_org(org_id));
create policy sop_managers_write_sop_documents on public.ps_locum_sop_documents
  for all to authenticated
  using (public.ps_is_sop_manager(org_id))
  with check (public.ps_is_sop_manager(org_id));

-- ─────────────────────────────────────────────────────────────
-- SOP library table policies: same manager check everywhere
-- ─────────────────────────────────────────────────────────────

alter policy sop_docs_org_write on public.ps_sop_documents
  using (public.ps_is_sop_manager(org_id))
  with check (public.ps_is_sop_manager(org_id));
alter policy sop_nodes_org_write on public.ps_sop_nodes
  using (exists (select 1 from ps_sop_documents d where d.id = document_id and public.ps_is_sop_manager(d.org_id)))
  with check (exists (select 1 from ps_sop_documents d where d.id = document_id and public.ps_is_sop_manager(d.org_id)));
alter policy sop_assignments_org_write on public.ps_sop_assignments
  using (public.ps_is_sop_manager(org_id))
  with check (public.ps_is_sop_manager(org_id)
              and exists (select 1 from ps_sop_documents d where d.id = document_id and d.org_id = ps_sop_assignments.org_id));
alter policy sop_completions_org_read on public.ps_sop_completions
  using (public.ps_is_sop_manager(org_id));

-- ─────────────────────────────────────────────────────────────
-- 3 + 5. Staff sign-offs: insert only, history kept
-- ─────────────────────────────────────────────────────────────

alter table public.ps_sop_completions add column if not exists user_id uuid;
alter table public.ps_sop_completions add column if not exists signer_name text;
alter table public.ps_sop_completions alter column member_id drop not null;
alter table public.ps_sop_completions alter column completed_at set default now();
alter table public.ps_sop_completions alter column completed_at set not null;

-- Fill in who signed the existing rows
update public.ps_sop_completions c
   set user_id = m.user_id,
       signer_name = coalesce(c.signer_name, p.full_name)
  from ps_organisation_members m
  left join ps_user_profiles p on p.id = m.user_id
 where m.id = c.member_id and c.user_id is null;

-- Removing a staff member keeps their sign-offs
alter table public.ps_sop_completions drop constraint if exists ps_sop_completions_member_id_fkey;
alter table public.ps_sop_completions add constraint ps_sop_completions_member_id_fkey
  foreign key (member_id) references ps_organisation_members(id) on delete set null;

create or replace function public.ps_sop_completion_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_doc ps_sop_documents%rowtype;
  v_member ps_organisation_members%rowtype;
begin
  if tg_op <> 'INSERT' then
    -- Only cascades from a deleted pharmacy may remove sign-offs; nothing may edit them.
    if tg_op = 'DELETE' and not exists (select 1 from ps_organisations where id = old.org_id) then
      return old;
    end if;
    if tg_op = 'UPDATE' and new.member_id is null and old.member_id is not null
       and (to_jsonb(new) - 'member_id') = (to_jsonb(old) - 'member_id') then
      return new; -- staff member removed (on delete set null)
    end if;
    raise exception 'SOP sign-offs cannot be changed or deleted';
  end if;

  -- The service role (auth.uid() is null) may backfill; everyone else signs for themselves.
  if auth.uid() is null then
    return new;
  end if;

  select * into v_doc from ps_sop_documents where id = new.document_id;
  select * into v_member from ps_organisation_members where id = new.member_id;
  if v_doc.id is null or v_member.id is null
     or v_member.user_id <> auth.uid() or v_member.status <> 'active'
     or v_member.organisation_id <> v_doc.org_id then
    raise exception 'You can only sign SOPs for yourself in your own pharmacy';
  end if;
  if v_doc.status <> 'published' or new.document_version <> v_doc.version then
    raise exception 'Only the current published version can be signed';
  end if;

  new.org_id := v_doc.org_id;
  new.user_id := auth.uid();
  new.completed_at := now();
  new.signer_name := (select full_name from ps_user_profiles where id = auth.uid());
  return new;
end; $$;

drop trigger if exists ps_sop_completion_guard on public.ps_sop_completions;
create trigger ps_sop_completion_guard
  before insert or update or delete on public.ps_sop_completions
  for each row execute function public.ps_sop_completion_guard();

drop policy if exists sop_completions_own on public.ps_sop_completions;
drop policy if exists sop_completions_own_read on public.ps_sop_completions;
drop policy if exists sop_completions_own_insert on public.ps_sop_completions;
create policy sop_completions_own_read on public.ps_sop_completions
  for select to authenticated
  using (user_id = auth.uid()
         or member_id in (select id from ps_organisation_members where user_id = auth.uid()));
create policy sop_completions_own_insert on public.ps_sop_completions
  for insert to authenticated
  with check (member_id in (select id from ps_organisation_members
                            where user_id = auth.uid() and status = 'active'));

-- Locum sign-offs: insert only, current version of an SOP they can see
create or replace function public.ps_locum_sop_signoff_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sop ps_locum_sop_documents%rowtype;
begin
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' and (
         not exists (select 1 from ps_locum_sop_documents where id = old.sop_id)
      or not exists (select 1 from ps_locum_profiles where id = old.locum_id)) then
      return old; -- cascade from a deleted SOP or locum profile
    end if;
    if tg_op = 'UPDATE' and new.booking_id is null and old.booking_id is not null
       and (to_jsonb(new) - 'booking_id') = (to_jsonb(old) - 'booking_id') then
      return new; -- booking removed (on delete set null)
    end if;
    raise exception 'SOP sign-offs cannot be changed or deleted';
  end if;
  if auth.uid() is null then
    return new;
  end if;
  select * into v_sop from ps_locum_sop_documents where id = new.sop_id;
  if v_sop.id is null or not v_sop.is_active or new.sop_version <> v_sop.version
     or new.locum_id is distinct from ps_get_my_locum_id()
     or not ps_locum_has_booking_with_org(v_sop.org_id) then
    raise exception 'You can only sign the current version of an SOP for a pharmacy you are booked with';
  end if;
  new.signed_at := now();
  return new;
end; $$;

drop trigger if exists ps_locum_sop_signoff_guard on public.ps_locum_sop_signoffs;
create trigger ps_locum_sop_signoff_guard
  before insert or update or delete on public.ps_locum_sop_signoffs
  for each row execute function public.ps_locum_sop_signoff_guard();

drop policy if exists locum_crud_own_signoffs on public.ps_locum_sop_signoffs;
drop policy if exists locum_read_own_signoffs on public.ps_locum_sop_signoffs;
drop policy if exists locum_insert_own_signoffs on public.ps_locum_sop_signoffs;
create policy locum_read_own_signoffs on public.ps_locum_sop_signoffs
  for select to authenticated using (locum_id = ps_get_my_locum_id());
create policy locum_insert_own_signoffs on public.ps_locum_sop_signoffs
  for insert to authenticated with check (locum_id = ps_get_my_locum_id());

-- ─────────────────────────────────────────────────────────────
-- 4. Frozen published versions
-- ─────────────────────────────────────────────────────────────

alter table public.ps_sop_documents
  add column if not exists has_unpublished_changes boolean not null default false;

create table if not exists public.ps_sop_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references ps_sop_documents(id) on delete cascade,
  org_id uuid not null references ps_organisations(id) on delete cascade,
  version integer not null,
  title text not null,
  description text,
  nodes jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now(),
  published_by uuid references ps_user_profiles(id),
  unique (document_id, version)
);
alter table public.ps_sop_document_versions enable row level security;
drop policy if exists sop_versions_org_read on public.ps_sop_document_versions;
create policy sop_versions_org_read on public.ps_sop_document_versions
  for select to authenticated using (org_id in (select ps_get_user_org_ids()));
-- No insert/update/delete policies: only ps_sop_publish writes here.
revoke insert, update, delete on public.ps_sop_document_versions from anon, authenticated;
grant select on public.ps_sop_document_versions to authenticated;

create or replace function public.ps_sop_nodes_snapshot(p_document_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'parent_id', n.parent_id, 'title', n.title,
           'content_type', n.content_type, 'rich_content', n.rich_content,
           'pdf_storage_path', n.pdf_storage_path, 'sort_order', n.sort_order)
         order by n.sort_order, n.created_at), '[]'::jsonb)
  from ps_sop_nodes n where n.document_id = p_document_id;
$$;
revoke all on function public.ps_sop_nodes_snapshot(uuid) from public, anon, authenticated;

-- Frozen copy for SOPs that are already published
insert into public.ps_sop_document_versions (document_id, org_id, version, title, description, nodes, published_at, published_by)
select d.id, d.org_id, d.version, d.title, d.description, public.ps_sop_nodes_snapshot(d.id),
       coalesce(d.published_at, d.updated_at, now()), d.updated_by
  from public.ps_sop_documents d
 where d.status = 'published'
on conflict (document_id, version) do nothing;

-- Guard: version, published status and published_at only change through ps_sop_publish.
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

drop trigger if exists ps_sop_document_guard on public.ps_sop_documents;
create trigger ps_sop_document_guard
  before insert or update or delete on public.ps_sop_documents
  for each row execute function public.ps_sop_document_guard();

-- Any change to the sections of a published SOP marks it as having unpublished changes.
create or replace function public.ps_sop_nodes_mark_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_doc uuid := coalesce(new.document_id, old.document_id);
begin
  if coalesce(current_setting('ps.sop_publishing', true), '') <> 'on' then
    perform set_config('ps.sop_publishing', 'on', true);
    update ps_sop_documents set has_unpublished_changes = true
     where id = v_doc and published_at is not null and not has_unpublished_changes;
    perform set_config('ps.sop_publishing', 'off', true);
  end if;
  return null;
end; $$;

drop trigger if exists ps_sop_nodes_mark_changed on public.ps_sop_nodes;
create trigger ps_sop_nodes_mark_changed
  after insert or update or delete on public.ps_sop_nodes
  for each row execute function public.ps_sop_nodes_mark_changed();

-- Publish (or re-publish) an SOP. A new version is made when the SOP has never
-- been published or has changed since; restoring an archived SOP with no
-- changes keeps its version (so existing sign-offs still count).
create or replace function public.ps_sop_publish(p_document_id uuid)
returns public.ps_sop_documents
language plpgsql security definer set search_path = public as $$
declare
  v_doc ps_sop_documents%rowtype;
  v_max int;
  v_new int;
  v_targets uuid[];
  v_all boolean;
begin
  select * into v_doc from ps_sop_documents where id = p_document_id for update;
  if v_doc.id is null or not ps_is_sop_manager(v_doc.org_id) then
    raise exception 'You do not have permission to publish this SOP';
  end if;
  if not exists (select 1 from ps_sop_nodes where document_id = p_document_id) then
    raise exception 'Add at least one section before publishing';
  end if;

  select max(version) into v_max from ps_sop_document_versions where document_id = p_document_id;

  if v_max = v_doc.version and not v_doc.has_unpublished_changes then
    v_new := v_doc.version;
  else
    v_new := greatest(coalesce(v_max, 0) + 1,
                      v_doc.version + case when v_doc.published_at is null then 0 else 1 end);
    insert into ps_sop_document_versions (document_id, org_id, version, title, description, nodes, published_by)
    values (v_doc.id, v_doc.org_id, v_new, v_doc.title, v_doc.description,
            ps_sop_nodes_snapshot(v_doc.id), auth.uid());
  end if;

  perform set_config('ps.sop_publishing', 'on', true);
  update ps_sop_documents
     set status = 'published', version = v_new, published_at = now(),
         has_unpublished_changes = false, updated_at = now(), updated_by = auth.uid()
   where id = p_document_id
   returning * into v_doc;
  perform set_config('ps.sop_publishing', 'off', true);

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

-- 7. Assignment alerts: pass the staff member's user id, not their membership id.
create or replace function public.ps_notify_sop_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_doc_title text;
  v_user uuid;
begin
  if new.member_id is null then
    return new;
  end if;
  select user_id into v_user from ps_organisation_members where id = new.member_id;
  if v_user is null then
    return new;
  end if;
  select title into v_doc_title from ps_sop_documents where id = new.document_id;
  perform ps_fanout_notification(
    new.org_id, 'sop_assignment', 'SOP assigned to you',
    coalesce(v_doc_title, 'A SOP') || ' has been assigned to you to read and sign.',
    '/sops/' || new.document_id::text || '/read',
    jsonb_build_object('document_id', new.document_id, 'assignment_id', new.id),
    array[v_user], 'personal');
  return new;
end; $$;

-- ─────────────────────────────────────────────────────────────
-- 6. Locum SOP versions
-- ─────────────────────────────────────────────────────────────

create table if not exists public.ps_locum_sop_document_versions (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references ps_locum_sop_documents(id) on delete cascade,
  org_id uuid not null references ps_organisations(id) on delete cascade,
  version integer not null,
  file_url text not null,
  replaced_at timestamptz not null default now(),
  replaced_by uuid,
  unique (sop_id, version)
);
alter table public.ps_locum_sop_document_versions enable row level security;
drop policy if exists locum_sop_versions_org_read on public.ps_locum_sop_document_versions;
create policy locum_sop_versions_org_read on public.ps_locum_sop_document_versions
  for select to authenticated using (org_id in (select ps_get_user_org_ids()));
revoke insert, update, delete on public.ps_locum_sop_document_versions from anon, authenticated;
grant select on public.ps_locum_sop_document_versions to authenticated;

create or replace function public.ps_locum_sop_document_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
    new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    return new;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from ps_organisations where id = old.org_id)
       and exists (select 1 from ps_locum_sop_signoffs where sop_id = old.id) then
      raise exception 'Locums have signed this SOP, so it can''t be deleted. Deactivate it instead.';
    end if;
    return old;
  end if;
  new.org_id := old.org_id;
  if new.file_url is distinct from old.file_url then
    insert into ps_locum_sop_document_versions (sop_id, org_id, version, file_url, replaced_by)
    values (old.id, old.org_id, old.version, old.file_url, auth.uid())
    on conflict (sop_id, version) do nothing;
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists ps_locum_sop_document_guard on public.ps_locum_sop_documents;
create trigger ps_locum_sop_document_guard
  before insert or update or delete on public.ps_locum_sop_documents
  for each row execute function public.ps_locum_sop_document_guard();

revoke all on function public.ps_sop_completion_guard() from public, anon, authenticated;
revoke all on function public.ps_locum_sop_signoff_guard() from public, anon, authenticated;
revoke all on function public.ps_sop_document_guard() from public, anon, authenticated;
revoke all on function public.ps_sop_nodes_mark_changed() from public, anon, authenticated;
revoke all on function public.ps_locum_sop_document_guard() from public, anon, authenticated;
revoke all on function public.ps_notify_sop_assignment() from public, anon, authenticated;

commit;

-- Check afterwards:
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname = 'storage' and policyname like 'sop_pdfs%';
