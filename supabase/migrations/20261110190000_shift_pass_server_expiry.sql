-- Shift pass (packages/supabase-client/src/shift-pass.ts): a parked
-- two-step-verified session must not outlive the shift. The browser only
-- holds the tokens encrypted with a password-derived key; this table records
-- which auth sessions are parked and until when, so the server ends them.

create table if not exists public.ps_shift_pass_sessions (
  session_id uuid primary key,
  user_id uuid not null,
  org_id uuid not null references public.ps_organisations(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists ps_shift_pass_sessions_org_idx on public.ps_shift_pass_sessions(org_id);
create index if not exists ps_shift_pass_sessions_exp_idx on public.ps_shift_pass_sessions(expires_at);
alter table public.ps_shift_pass_sessions enable row level security;
revoke all on public.ps_shift_pass_sessions from anon, authenticated;

-- Called by the person (user client) just before their session is parked.
create or replace function public.ps_shift_pass_register(p_org_id uuid, p_until timestamptz)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  v_until timestamptz := least(coalesce(p_until, now() + interval '12 hours'), now() + interval '12 hours');
begin
  if auth.uid() is null or v_session is null then raise exception 'Not signed in'; end if;
  if coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then raise exception 'Two-step sign-in required'; end if;
  if not exists (select 1 from ps_organisation_members m
                 where m.organisation_id = p_org_id and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'Not a member of this pharmacy';
  end if;
  insert into ps_shift_pass_sessions(session_id, user_id, org_id, expires_at)
  values (v_session, auth.uid(), p_org_id, v_until)
  on conflict (session_id) do update
    set expires_at = least(ps_shift_pass_sessions.expires_at, excluded.expires_at);
  return (select expires_at from ps_shift_pass_sessions where session_id = v_session);
end $$;

-- Called by the pharmacy (org client) when the pharmacy signs out: every
-- session parked on its computers ends now.
create or replace function public.ps_shift_pass_end_all(p_org_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if not exists (select 1 from ps_organisations o where o.id = p_org_id and o.auth_user_id = auth.uid())
     and not exists (select 1 from ps_organisation_members m
                     where m.organisation_id = p_org_id and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'Forbidden';
  end if;
  delete from auth.sessions s using ps_shift_pass_sessions p
   where p.org_id = p_org_id and s.id = p.session_id;
  delete from ps_shift_pass_sessions where org_id = p_org_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Cron: end parked sessions whose shift is over.
create or replace function public.ps_shift_pass_expire()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from auth.sessions s using ps_shift_pass_sessions p
   where s.id = p.session_id and p.expires_at < now();
  delete from ps_shift_pass_sessions p
   where p.expires_at < now()
      or not exists (select 1 from auth.sessions s where s.id = p.session_id);
end $$;

revoke all on function public.ps_shift_pass_register(uuid, timestamptz) from public, anon;
revoke all on function public.ps_shift_pass_end_all(uuid) from public, anon;
revoke all on function public.ps_shift_pass_expire() from public, anon, authenticated;
grant execute on function public.ps_shift_pass_register(uuid, timestamptz) to authenticated;
grant execute on function public.ps_shift_pass_end_all(uuid) to authenticated;

select cron.schedule('ps-shift-pass-expire', '*/10 * * * *', $$select public.ps_shift_pass_expire()$$);
