-- Shop: pharmacist sign-off and medicine rules (PR 2 of
-- /mnt/project-files/shop/production-readiness-plan.md, items B4 and L2)
--
-- Run AFTER 20261105170000_shop_production_fixes.sql. Safe to run more than once.
--
-- Products
--   medicine_class  general (not a medicine) | gsl | p
--                   Prescription-only medicines can't be listed at all.
--                   A P medicine must have a consultation questionnaire.
--   max_per_order   optional cap on how many of a product one order can have
--                   (for example 2 packs of paracetamol). Enforced at checkout.
--
-- Orders
--   Any order with a P medicine or a consultation product starts with
--   review_status = 'pending'. Until a pharmacist approves it, staff can't
--   move it past "new" (confirm, ready, collect, deliver). Cancelling is
--   always allowed.
--   ps_shop_review_order(order, approve, notes) is the only way to approve or
--   reject. Only an active member of that pharmacy who is a pharmacist
--   (role 'pharmacist', or a GPhC number on their profile) can call it.
--   It records who (name and GPhC number at the time), when and why.
--   Rejecting needs a reason, cancels the order and puts the stock back.
--   The review columns can't be edited directly (staff only have UPDATE on
--   status, org_notes and the delivery round links, from the previous
--   migration).

-- ---------------------------------------------------------------- products

alter table public.ps_shop_products
  add column if not exists medicine_class text not null default 'general',
  add column if not exists max_per_order integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ps_shop_products_medicine_class_check') then
    alter table public.ps_shop_products add constraint ps_shop_products_medicine_class_check
      check (medicine_class in ('general', 'gsl', 'p'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ps_shop_products_max_per_order_check') then
    alter table public.ps_shop_products add constraint ps_shop_products_max_per_order_check
      check (max_per_order is null or max_per_order between 1 and 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ps_shop_products_p_needs_questionnaire') then
    alter table public.ps_shop_products add constraint ps_shop_products_p_needs_questionnaire
      check (medicine_class <> 'p' or questionnaire_id is not null);
  end if;
end $$;

comment on column public.ps_shop_products.medicine_class is
  'general = not a medicine, gsl = general sale list, p = pharmacy medicine (needs questionnaire + pharmacist approval). POMs are not sold.';
comment on column public.ps_shop_products.max_per_order is
  'Optional cap on the quantity of this product in one order.';

-- ---------------------------------------------------------------- orders

alter table public.ps_shop_orders
  add column if not exists review_status text not null default 'not_required',
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_by_gphc text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ps_shop_orders_review_status_check') then
    alter table public.ps_shop_orders add constraint ps_shop_orders_review_status_check
      check (review_status in ('not_required', 'pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists idx_shop_orders_review_pending
  on public.ps_shop_orders (org_id) where review_status = 'pending';

-- ---------------------------------------------------------------- order items: limits + review flag

-- Order items are only inserted by ps_shop_place_order, so this runs once per
-- line at checkout.
create or replace function public.ps_shop_order_item_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_product ps_shop_products%rowtype;
begin
  if new.product_id is null then
    return new;
  end if;
  select * into v_product from ps_shop_products where id = new.product_id;

  if v_product.max_per_order is not null and new.quantity > v_product.max_per_order then
    raise exception 'You can order at most % of %', v_product.max_per_order, v_product.name;
  end if;

  if v_product.medicine_class = 'p' or v_product.questionnaire_id is not null then
    update ps_shop_orders
    set review_status = 'pending'
    where id = new.order_id and review_status = 'not_required';
  end if;

  return new;
end;
$function$;

revoke all on function public.ps_shop_order_item_rules() from public, anon;

drop trigger if exists trg_shop_order_item_rules on public.ps_shop_order_items;
create trigger trg_shop_order_item_rules after insert on public.ps_shop_order_items
  for each row execute function public.ps_shop_order_item_rules();

-- ---------------------------------------------------------------- status guard

create or replace function public.ps_shop_order_review_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status
     and new.status not in ('new', 'cancelled')
     and new.review_status in ('pending', 'rejected') then
    raise exception 'A pharmacist must approve this order before it can move on';
  end if;
  return new;
end;
$function$;

revoke all on function public.ps_shop_order_review_guard() from public, anon;

drop trigger if exists trg_shop_order_review_guard on public.ps_shop_orders;
create trigger trg_shop_order_review_guard before update on public.ps_shop_orders
  for each row execute function public.ps_shop_order_review_guard();

-- ---------------------------------------------------------------- review RPC

create or replace function public.ps_shop_review_order(
  p_order_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order ps_shop_orders%rowtype;
  v_role text;
  v_name text;
  v_gphc text;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to review orders';
  end if;
  if p_approve is null then
    raise exception 'Choose approve or reject';
  end if;

  select * into v_order from ps_shop_orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  select m.role into v_role
  from ps_organisation_members m
  where m.organisation_id = v_order.org_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
  if v_role is null then
    raise exception 'Order not found';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email),
         nullif(trim(p.gphc_number), '')
  into v_name, v_gphc
  from ps_user_profiles p where p.id = auth.uid();

  if v_role <> 'pharmacist' and v_gphc is null then
    raise exception 'Only a pharmacist can approve or reject medicine orders. Add your GPhC number to your profile if you are one.';
  end if;

  if v_order.review_status <> 'pending' then
    raise exception 'This order is not waiting for a pharmacist check';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'This order has been cancelled';
  end if;
  if not p_approve and v_notes is null then
    raise exception 'Please give a reason for rejecting the order';
  end if;
  if v_notes is not null and length(v_notes) > 2000 then
    raise exception 'Notes are too long';
  end if;

  update ps_shop_orders
  set review_status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_by_name = coalesce(v_name, 'Pharmacist'),
      reviewed_by_gphc = v_gphc,
      reviewed_at = now(),
      review_notes = v_notes,
      status = case when p_approve then status else 'cancelled' end,
      org_notes = case when p_approve then org_notes else
        trim(both e'\n' from coalesce(org_notes, '') || e'\n' || '💊 Rejected by pharmacist: ' || v_notes) end
  where id = p_order_id
  returning * into v_order;

  return to_jsonb(v_order);
end;
$function$;

revoke all on function public.ps_shop_review_order(uuid, boolean, text) from public, anon;
grant execute on function public.ps_shop_review_order(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------- delivery rounds

-- Starting a delivery round marks its shop orders out for delivery. Skip any
-- order still waiting for (or refused by) a pharmacist, otherwise the review
-- guard above would stop the whole round from starting.
create or replace function public.ps_shop_sync_order_from_round()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    update ps_shop_orders
    set status = 'out_for_delivery', updated_at = now()
    where delivery_round_id = new.id
      and status in ('new','confirmed','ready')
      and review_status not in ('pending', 'rejected');
  end if;
  return new;
end;
$function$;
