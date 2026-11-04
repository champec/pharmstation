-- Comms production readiness (4 Nov 2026). Safe to run more than once.
-- 1. Support tickets from the public contact page and the in-app help form.
-- 2. Video access codes: a patient who rejoins is no longer locked out.
-- 3. SMS opt-outs: staff can't silently delete a patient's STOP.
-- 4. Copy existing STOPs into the marketing suppression list.

-- 1. Support tickets -------------------------------------------------------
create table if not exists public.ps_support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  source text not null check (source in ('public', 'app')),
  topic text not null check (topic in ('support', 'sales', 'billing', 'privacy', 'safety', 'other')),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254),
  phone text check (phone is null or char_length(phone) <= 40),
  organisation_name text check (organisation_name is null or char_length(organisation_name) <= 200),
  message text not null check (char_length(message) between 1 and 5000),
  org_id uuid references public.ps_organisations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'open', 'waiting', 'closed')),
  email_forwarded boolean not null default false,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ps_support_tickets_created_idx on public.ps_support_tickets (created_at desc);
create index if not exists ps_support_tickets_ip_idx on public.ps_support_tickets (ip_hash, created_at desc);
create index if not exists ps_support_tickets_email_idx on public.ps_support_tickets (lower(email), created_at desc);

alter table public.ps_support_tickets enable row level security;

-- Inserts only happen through the support-request edge function (service role).
-- Signed-in users can see the tickets they raised.
drop policy if exists support_tickets_own_select on public.ps_support_tickets;
create policy support_tickets_own_select on public.ps_support_tickets
  for select to authenticated using (user_id = auth.uid());

revoke all on public.ps_support_tickets from anon;
revoke insert, update, delete on public.ps_support_tickets from authenticated;

-- 2. Video access codes ----------------------------------------------------
-- Before: every attempt counted, including correct ones, so a patient whose
-- call dropped five times was locked out. Now only wrong codes count, and a
-- correct code resets the counter.
create or replace function public.ps_verify_video_access_code(p_consultation_id uuid, p_access_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row ps_video_consultations%rowtype;
begin
  select * into v_row from ps_video_consultations where id = p_consultation_id for update;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  if v_row.access_code_attempts >= 5 then
    return jsonb_build_object('valid', false, 'reason', 'too_many_attempts');
  end if;

  if v_row.status in ('completed', 'cancelled') then
    return jsonb_build_object('valid', false, 'reason', 'consultation_ended');
  end if;

  if v_row.patient_access_code is distinct from p_access_code then
    update ps_video_consultations
       set access_code_attempts = access_code_attempts + 1
     where id = p_consultation_id;
    return jsonb_build_object('valid', false, 'reason', 'invalid_code');
  end if;

  update ps_video_consultations
     set access_code_attempts = 0,
         status = case when status = 'scheduled' then 'active' else status end,
         started_at = case when status = 'scheduled' then now() else started_at end
   where id = p_consultation_id;

  return jsonb_build_object(
    'valid', true,
    'room_url', v_row.daily_room_url,
    'patient_token', v_row.patient_token,
    'patient_name', v_row.patient_name
  );
end;
$function$;

-- Keep the existing grants: the public patient page calls this as anon.
grant execute on function public.ps_verify_video_access_code(uuid, text) to anon, authenticated;

-- 3. SMS opt-outs ----------------------------------------------------------
-- Before: any member could update or delete opt-outs. Now members can read
-- and add them; only owners and managers can remove one (a START text from
-- the patient still removes it through the webhook).
drop policy if exists sms_opt_outs_members on public.ps_sms_opt_outs;
drop policy if exists sms_opt_outs_member_select on public.ps_sms_opt_outs;
drop policy if exists sms_opt_outs_member_insert on public.ps_sms_opt_outs;
drop policy if exists sms_opt_outs_manager_delete on public.ps_sms_opt_outs;

create policy sms_opt_outs_member_select on public.ps_sms_opt_outs
  for select to authenticated
  using (org_id in (select ps_get_user_org_ids()));

create policy sms_opt_outs_member_insert on public.ps_sms_opt_outs
  for insert to authenticated
  with check (org_id in (select ps_get_user_org_ids()) and source = 'staff');

create policy sms_opt_outs_manager_delete on public.ps_sms_opt_outs
  for delete to authenticated
  using (exists (
    select 1 from ps_organisation_members m
     where m.organisation_id = ps_sms_opt_outs.org_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.role in ('owner', 'manager')
  ));

-- 4. Existing STOPs into marketing suppressions -----------------------------
insert into public.ps_marketing_suppressions (org_id, channel, destination_normalized, reason, source)
select org_id, 'sms', phone_normalized, 'recipient_opt_out', 'sms_keyword'
  from public.ps_sms_opt_outs
on conflict (org_id, channel, destination_normalized) do nothing;
