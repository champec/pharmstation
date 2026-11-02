-- ============================================================
-- Pharmacy Network + patient SMS: make them sellable (2 Nov 2026)
--
-- Run once in the SQL editor (London project first; PharmEx too if the
-- web app is merged before cutover). Safe to re-run.
--
-- 1. Network messages: the old "netmsg_participant FOR ALL" policy let any
--    pharmacy insert a message with to_org_id = itself and from_org_id = ANY
--    other pharmacy (sender spoofing), and let recipients edit or delete
--    what they were sent. Replaced with per-command policies plus a trigger.
-- 2. Sender / recipient names are stored on the message, because
--    ps_organisations RLS hides other pharmacies' rows (inbox showed "—").
-- 3. ps_network_messages joins the realtime publication (live inbox never
--    fired because the table was not published).
-- 4. Opting out of the network (network_enabled = false) is now enforced
--    for new conversations, and opted-out pharmacies drop out of search.
-- 5. SMS ping bookkeeping columns (sent by the sms-works edge function).
-- 6. ps_sms_opt_outs: patients who texted STOP are skipped by broadcasts.
-- ============================================================

-- ---------- 2 + 5. new columns ----------
alter table public.ps_network_messages
  add column if not exists from_org_name   text,
  add column if not exists to_org_name     text,
  add column if not exists sms_ping_status text,
  add column if not exists sms_ping_sent_at timestamptz,
  add column if not exists sms_ping_count  integer not null default 0;

do $$ begin
  alter table public.ps_network_messages add constraint network_msg_ping_status
    check (sms_ping_status is null or sms_ping_status in
      ('processing','sent','failed','recipient_disabled','no_contacts_available','rate_limited'));
exception when duplicate_object then null; end $$;

update public.ps_network_messages m
   set from_org_name = coalesce(m.from_org_name, (select name from public.ps_organisations where id = m.from_org_id)),
       to_org_name   = coalesce(m.to_org_name,   (select name from public.ps_organisations where id = m.to_org_id))
 where m.from_org_name is null or m.to_org_name is null;

create index if not exists ps_network_messages_to_unread_idx
  on public.ps_network_messages (to_org_id) where is_read = false;
create index if not exists ps_network_messages_thread_idx
  on public.ps_network_messages (thread_id, created_at);
create index if not exists ps_network_messages_ping_rate_idx
  on public.ps_network_messages (from_org_id, to_org_id, sms_ping_sent_at)
  where sms_ping_sent_at is not null;

-- ---------- 1. who may send what ----------
-- True when p_from (a pharmacy the caller belongs to, checked by the policy)
-- may post this message to p_to.
create or replace function public.ps_network_can_send(
  p_from uuid, p_to uuid, p_thread uuid, p_id uuid
) returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_from is null or p_to is null or p_from = p_to then
    return false;
  end if;

  if p_thread is distinct from p_id then
    -- A reply: the thread must already exist between these two pharmacies.
    -- Replies are allowed even if the recipient has since left the network.
    return exists (
      select 1 from ps_network_messages
       where thread_id = p_thread
         and ((from_org_id = p_from and to_org_id = p_to)
           or (from_org_id = p_to and to_org_id = p_from))
    );
  end if;

  -- A new conversation: recipient must be on the network and not opted out.
  return exists (select 1 from ps_org_pharmacy_link where org_id = p_to)
     and coalesce((select network_enabled from ps_network_settings where org_id = p_to), true);
end;
$$;
revoke all on function public.ps_network_can_send(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.ps_network_can_send(uuid, uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists netmsg_participant on public.ps_network_messages;
drop policy if exists netmsg_select on public.ps_network_messages;
drop policy if exists netmsg_insert on public.ps_network_messages;
drop policy if exists netmsg_update_recipient on public.ps_network_messages;

create policy netmsg_select on public.ps_network_messages
  for select to authenticated
  using (from_org_id in (select ps_get_user_org_ids()) or to_org_id in (select ps_get_user_org_ids()));

create policy netmsg_insert on public.ps_network_messages
  for insert to authenticated
  with check (
    from_org_id in (select ps_get_user_org_ids())
    and ps_network_can_send(from_org_id, to_org_id, thread_id, id)
  );

-- Recipients may only mark messages read (column guard below). No DELETE policy:
-- network messages are a record of professional communication.
create policy netmsg_update_recipient on public.ps_network_messages
  for update to authenticated
  using (to_org_id in (select ps_get_user_org_ids()))
  with check (to_org_id in (select ps_get_user_org_ids()));

-- BEFORE INSERT: stamp names, clear server-owned ping fields.
-- BEFORE UPDATE: users may change is_read / read_at only.
create or replace function public.ps_network_messages_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  -- current_user is the function owner here (security definer), so look at the
  -- JWT role and the connecting session instead. API calls connect as
  -- 'authenticator'; the SQL editor and migrations do not.
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role' or session_user <> 'authenticator';
begin
  if TG_OP = 'INSERT' then
    NEW.from_org_name := (select name from ps_organisations where id = NEW.from_org_id);
    NEW.to_org_name   := (select name from ps_organisations where id = NEW.to_org_id);
    if not v_is_service then
      NEW.is_read := false;
      NEW.read_at := null;
      NEW.sms_ping_status := null;
      NEW.sms_ping_sent_at := null;
      NEW.sms_ping_count := 0;
      NEW.created_at := now();
    end if;
    return NEW;
  end if;

  if not v_is_service and (
       NEW.id               is distinct from OLD.id
    or NEW.from_org_id      is distinct from OLD.from_org_id
    or NEW.to_org_id        is distinct from OLD.to_org_id
    or NEW.thread_id        is distinct from OLD.thread_id
    or NEW.broadcast_id     is distinct from OLD.broadcast_id
    or NEW.subject          is distinct from OLD.subject
    or NEW.body             is distinct from OLD.body
    or NEW.label            is distinct from OLD.label
    or NEW.request_sms_ping is distinct from OLD.request_sms_ping
    or NEW.created_at       is distinct from OLD.created_at
    or NEW.from_org_name    is distinct from OLD.from_org_name
    or NEW.to_org_name      is distinct from OLD.to_org_name
    or NEW.sms_ping_status  is distinct from OLD.sms_ping_status
    or NEW.sms_ping_sent_at is distinct from OLD.sms_ping_sent_at
    or NEW.sms_ping_count   is distinct from OLD.sms_ping_count
  ) then
    raise exception 'Network messages cannot be edited; only read status can change';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_ps_network_messages_guard on public.ps_network_messages;
create trigger trg_ps_network_messages_guard
  before insert or update on public.ps_network_messages
  for each row execute function public.ps_network_messages_guard();

-- ---------- 3. realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.ps_network_messages;
exception when duplicate_object then null; end $$;

-- ---------- 4. search respects membership and opt-out ----------
create or replace function public.search_network_pharmacies(
  p_org_id uuid, p_search text default '', p_radius_km double precision default 10.0,
  p_only_platform boolean default false, p_limit integer default 50
)
returns table(pharmacy_id integer, ods_code text, organisation_name text, address1 text, address2 text,
              city text, postcode text, latitude numeric, longitude numeric, distance_km double precision,
              is_on_platform boolean, linked_org_id uuid, linked_org_name text)
language plpgsql security definer set search_path = public
as $function$
declare
  v_location geometry;
begin
  if not exists (select 1 from ps_get_user_org_ids() g where g = p_org_id)
     and not exists (select 1 from ps_organisations where id = p_org_id and auth_user_id = auth.uid()) then
    raise exception 'You do not have access to this organisation';
  end if;

  select geolocation into v_location from ps_organisations where id = p_org_id;

  return query
  select
    ph.id, ph.ods_code, ph.organisation_name, ph.address1, ph.address2, ph.city, ph.postcode,
    ph.latitude, ph.longitude,
    (ST_Distance(ph.location::geography, v_location::geography) / 1000.0)::float,
    (opl.org_id is not null), opl.org_id, pso.name
  from pharmacies ph
  left join (
    ps_org_pharmacy_link opl
    join ps_organisations pso on pso.id = opl.org_id
    left join ps_network_settings ns on ns.org_id = opl.org_id
  ) on opl.pharmacy_id = ph.id and coalesce(ns.network_enabled, true)
  where (opl.org_id is null or opl.org_id <> p_org_id)
    and (coalesce(p_search, '') = ''
         or ph.organisation_name ilike '%' || p_search || '%'
         or ph.postcode ilike '%' || p_search || '%'
         or ph.ods_code ilike '%' || p_search || '%')
    and (v_location is null or ST_DWithin(ph.location::geography, v_location::geography, p_radius_km * 1000))
    and (not p_only_platform or opl.org_id is not null)
  order by case when v_location is not null then ST_Distance(ph.location::geography, v_location::geography) else 0 end,
           ph.organisation_name
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;

-- ---------- 6. patient SMS opt-outs ----------
create table if not exists public.ps_sms_opt_outs (
  org_id           uuid not null references public.ps_organisations(id) on delete cascade,
  phone_normalized text not null,
  source           text not null default 'sms_keyword' check (source in ('sms_keyword', 'staff')),
  keyword          text,
  opted_out_at     timestamptz not null default now(),
  created_by       uuid,
  primary key (org_id, phone_normalized)
);
alter table public.ps_sms_opt_outs enable row level security;
drop policy if exists sms_opt_outs_members on public.ps_sms_opt_outs;
create policy sms_opt_outs_members on public.ps_sms_opt_outs
  for all to authenticated
  using (org_id in (select ps_get_user_org_ids()))
  with check (org_id in (select ps_get_user_org_ids()));
