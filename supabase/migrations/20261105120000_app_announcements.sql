-- App-wide announcements (5 Nov 2026).
-- PharmStation platform admins post a message that the mobile app shows as a
-- full-screen notice when it is freshly opened (e.g. new features, planned
-- downtime). Dismissible ones are shown once per phone; non-dismissible ones
-- block the app until they end (use for outages only). Safe to run more than once.

-- Needs ps_is_platform_admin() from 20261102180000_locum_compliance_review.sql.

create table if not exists public.ps_app_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  body text not null check (length(body) <= 2000),
  link_url text check (link_url is null or link_url ~ '^https://'),
  link_label text check (link_label is null or length(link_label) <= 40),
  audience text not null default 'mobile' check (audience in ('mobile', 'web', 'all')),
  dismissible boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists ps_app_announcements_active_idx
  on public.ps_app_announcements (starts_at, ends_at);

alter table public.ps_app_announcements enable row level security;

-- Anyone signed in (or not, so the login screen can show outages) sees
-- announcements that are live now.
drop policy if exists app_announcements_read_live on public.ps_app_announcements;
create policy app_announcements_read_live on public.ps_app_announcements
  for select to anon, authenticated
  using (starts_at <= now() and (ends_at is null or ends_at > now()));

-- Platform admins see and manage all of them.
drop policy if exists app_announcements_admin_all on public.ps_app_announcements;
create policy app_announcements_admin_all on public.ps_app_announcements
  for all to authenticated
  using (public.ps_is_platform_admin())
  with check (public.ps_is_platform_admin());

revoke all on public.ps_app_announcements from anon, authenticated;
grant select on public.ps_app_announcements to anon, authenticated;
grant insert, update, delete on public.ps_app_announcements to authenticated;
