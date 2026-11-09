-- ============================================================
-- PharmStation prepaid text message (SMS) credits
-- Run in the SQL editor of the project the app uses (London). Safe to re-run.
-- 1 credit = 1 SMS segment (up to 160 characters; longer texts use more).
-- Pharmacies buy packs in Settings > Plan & billing (Stripe Checkout).
-- Sending only checks the balance once SMS_CREDITS_ENFORCED=true is set on
-- the sms-works and notifications-dispatch edge functions.
-- ============================================

create table if not exists public.ps_sms_credit_ledger (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.ps_organisations(id) on delete cascade,
  delta                       integer not null check (delta <> 0),
  reason                      text not null check (reason in ('purchase', 'send', 'refund', 'adjustment', 'grant')),
  message_id                  uuid,
  stripe_checkout_session_id  text unique,
  payment_id                  uuid,
  note                        text,
  created_at                  timestamptz not null default now()
);

create index if not exists ps_sms_credit_ledger_org_idx
  on public.ps_sms_credit_ledger (org_id, created_at desc);

alter table public.ps_sms_credit_ledger enable row level security;

drop policy if exists org_read_own_sms_credits on public.ps_sms_credit_ledger;
create policy org_read_own_sms_credits on public.ps_sms_credit_ledger
  for select to authenticated
  using (
    org_id in (select public.ps_get_user_org_ids())
    or org_id in (select o.id from public.ps_organisations o where o.auth_user_id = auth.uid())
  );
-- Only edge functions (service role) write.
revoke insert, update, delete, truncate on public.ps_sms_credit_ledger from anon, authenticated;
grant select on public.ps_sms_credit_ledger to authenticated;

-- Current balance. Members of the org (or the service role) only.
create or replace function public.ps_sms_credit_balance(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::integer
  from public.ps_sms_credit_ledger
  where org_id = p_org_id
    and (
      auth.role() = 'service_role'
      or p_org_id in (select public.ps_get_user_org_ids())
      or p_org_id in (select o.id from public.ps_organisations o where o.auth_user_id = auth.uid())
    );
$$;
revoke all on function public.ps_sms_credit_balance(uuid) from public, anon;
grant execute on function public.ps_sms_credit_balance(uuid) to authenticated, service_role;

-- Take credits for one text. Returns false (and takes nothing) if the
-- balance is too low. Serialised per org so two sends can't both pass.
create or replace function public.ps_sms_spend_credits(p_org_id uuid, p_credits integer, p_message_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_credits is null or p_credits <= 0 then
    return true;
  end if;
  perform pg_advisory_xact_lock(hashtext('ps_sms_credits:' || p_org_id::text));
  select coalesce(sum(delta), 0) into v_balance from public.ps_sms_credit_ledger where org_id = p_org_id;
  if v_balance < p_credits then
    return false;
  end if;
  insert into public.ps_sms_credit_ledger (org_id, delta, reason, message_id)
  values (p_org_id, -p_credits, 'send', p_message_id);
  return true;
end $$;
revoke all on function public.ps_sms_spend_credits(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.ps_sms_spend_credits(uuid, integer, uuid) to service_role;

-- Add (or, with a negative amount, remove) credits. A Stripe Checkout
-- session can only ever add credits once.
create or replace function public.ps_sms_add_credits(
  p_org_id uuid,
  p_credits integer,
  p_reason text,
  p_checkout_session_id text default null,
  p_payment_id uuid default null,
  p_message_id uuid default null,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_credits is null or p_credits = 0 then
    return false;
  end if;
  insert into public.ps_sms_credit_ledger
    (org_id, delta, reason, stripe_checkout_session_id, payment_id, message_id, note)
  values
    (p_org_id, p_credits, p_reason, p_checkout_session_id, p_payment_id, p_message_id, p_note)
  on conflict (stripe_checkout_session_id) do nothing;
  return found;
end $$;
revoke all on function public.ps_sms_add_credits(uuid, integer, text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ps_sms_add_credits(uuid, integer, text, text, uuid, uuid, text) to service_role;

-- To give a pharmacy free credits by hand:
--   select ps_sms_add_credits('<org id>', 100, 'grant', null, null, null, 'Welcome credits');
