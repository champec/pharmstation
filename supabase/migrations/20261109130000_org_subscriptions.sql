-- ============================================================
-- PharmStation platform subscriptions (Phase 4)
-- Applied to the London project (dbgwfdrvqzuevbfrmsdt) via the Supabase
-- connector as migration "ps_org_subscriptions". Kept here for review and so
-- PharmEx can be brought level if billing ships before the London cutover.
-- Safe to run more than once.
-- ============================================================

-- One row per organisation. Written ONLY by the stripe-billing / stripe-webhook
-- edge functions (service role). Clients can read their own org's row.
create table if not exists public.ps_org_subscriptions (
  org_id                 uuid primary key references public.ps_organisations(id) on delete cascade,
  plan                   text not null default 'network'
                           check (plan in ('network', 'essential', 'complete')),
  -- Stripe subscription status, or 'none' when the org has never subscribed.
  status                 text not null default 'none'
                           check (status in ('none', 'trialing', 'active', 'past_due', 'unpaid',
                                             'canceled', 'incomplete', 'incomplete_expired', 'paused')),
  stripe_subscription_id text unique,
  stripe_price_id        text,
  billing_interval       text check (billing_interval in ('month', 'year')),
  current_period_end     timestamptz,
  trial_end              timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  -- Manual override ("comp"): grants a plan without Stripe, e.g. founding
  -- pharmacies or demos. Null override_until = no expiry.
  override_plan          text check (override_plan in ('network', 'essential', 'complete')),
  override_until         timestamptz,
  override_reason        text,
  -- Founding-member flag (price locked for life in Stripe; shown in the UI).
  is_founding_member     boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.ps_org_subscriptions enable row level security;

drop policy if exists org_read_own_subscription on public.ps_org_subscriptions;
create policy org_read_own_subscription on public.ps_org_subscriptions
  for select to authenticated
  using (
    org_id in (select public.ps_get_user_org_ids())
    or org_id in (select o.id from public.ps_organisations o where o.auth_user_id = auth.uid())
  );
-- No insert/update/delete policies: only the service role writes.

revoke insert, update, delete, truncate on public.ps_org_subscriptions from anon, authenticated;
grant select on public.ps_org_subscriptions to authenticated;

-- Effective plan for an organisation. Single source of truth for server-side
-- gating (edge functions, and RLS policies later).
--   1. An unexpired manual override wins if it is higher than the paid plan.
--   2. A Stripe subscription that is trialing/active (or past_due, which Stripe
--      is still retrying) grants its plan.
--   3. Otherwise the free Network plan.
create or replace function public.ps_org_effective_plan(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select
      case when status in ('trialing', 'active', 'past_due') then plan else 'network' end as paid,
      case when override_plan is not null and (override_until is null or override_until > now())
           then override_plan end as comp
    from public.ps_org_subscriptions
    where org_id = p_org_id
  ),
  ranked as (
    select p, case p when 'complete' then 3 when 'essential' then 2 else 1 end as r
    from (select paid as p from s union all select comp from s where comp is not null) x
  )
  select coalesce((select p from ranked order by r desc limit 1), 'network');
$$;

revoke all on function public.ps_org_effective_plan(uuid) from public, anon;
grant execute on function public.ps_org_effective_plan(uuid) to authenticated, service_role;

-- Keep updated_at fresh.
create or replace function public.ps_org_subscriptions_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_ps_org_subscriptions_touch on public.ps_org_subscriptions;
create trigger trg_ps_org_subscriptions_touch
  before update on public.ps_org_subscriptions
  for each row execute function public.ps_org_subscriptions_touch();

-- Webhook retries: let a failed event be re-processed instead of being
-- skipped as a duplicate (see stripe-webhook).
alter table public.ps_stripe_webhook_events
  add column if not exists attempts integer not null default 1;

-- Existing organisations keep everything they have today: comp them onto
-- Complete until 31 Jan 2027 so switching plan enforcement on locks nobody out.
insert into public.ps_org_subscriptions (org_id, override_plan, override_until, override_reason)
select id, 'complete', '2027-01-31T23:59:59Z', 'Existing organisation before billing launch'
from public.ps_organisations
on conflict (org_id) do nothing;
