-- Shop: card payments (PR 3 of /mnt/project-files/shop/production-readiness-plan.md, P1 to P3)
--
-- Run AFTER 20261105190000_shop_pharmacist_review.sql. Safe to run more than once.
--
-- Each pharmacy chooses how shop customers pay (ps_shop_settings.payment_methods):
--   in_store  pay in store or on delivery (the default, today's behaviour)
--   card      card online only
--   both      the customer chooses at checkout
-- Card needs the pharmacy's Stripe Connect account to be able to take charges
-- (ps_org_billing.charges_enabled). Money goes straight to the pharmacy.
--
-- A card order is created with payment_status 'awaiting_payment'. Its stock
-- is held, staff aren't alerted yet and it can't move past "new".
-- The stripe-checkout edge function (create_shop_checkout) opens a Stripe
-- Checkout session for the order total read from the database, and the
-- existing stripe-webhook updates ps_payments. A trigger on ps_payments then:
--   succeeded  -> order payment_status 'paid', staff alerted as a new order
--                 (if the order was already cancelled, staff are told to refund)
--   canceled   -> (session expired or customer backed out) order cancelled,
--                 stock back, payment_status 'expired'
--   refunded / partially_refunded -> copied onto the order
-- A pg_cron job every 10 minutes cancels card orders still unpaid after
-- 45 minutes (e.g. the customer closed the tab before reaching Stripe).
-- Refunds when staff cancel or a pharmacist rejects a paid order are made by
-- the stripe-checkout edge function (cancel_shop_order).

-- ---------------------------------------------------------------- settings + orders

alter table public.ps_shop_settings
  add column if not exists payment_methods text not null default 'in_store';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ps_shop_settings_payment_methods_check') then
    alter table public.ps_shop_settings add constraint ps_shop_settings_payment_methods_check
      check (payment_methods in ('in_store', 'card', 'both'));
  end if;
end $$;

alter table public.ps_shop_orders
  add column if not exists payment_method text not null default 'in_store',
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists payment_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ps_shop_orders_payment_method_check') then
    alter table public.ps_shop_orders add constraint ps_shop_orders_payment_method_check
      check (payment_method in ('in_store', 'card'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ps_shop_orders_payment_status_check') then
    alter table public.ps_shop_orders add constraint ps_shop_orders_payment_status_check
      check (payment_status in ('not_required', 'awaiting_payment', 'paid', 'refunded', 'partially_refunded', 'expired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ps_shop_orders_payment_id_fkey') then
    alter table public.ps_shop_orders add constraint ps_shop_orders_payment_id_fkey
      foreign key (payment_id) references public.ps_payments(id) on delete set null;
  end if;
end $$;

create index if not exists idx_shop_orders_awaiting_payment
  on public.ps_shop_orders (created_at) where payment_status = 'awaiting_payment';

-- ---------------------------------------------------------------- payments ledger

alter table public.ps_payments
  add column if not exists shop_order_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ps_payments_shop_order_id_fkey') then
    alter table public.ps_payments add constraint ps_payments_shop_order_id_fkey
      foreign key (shop_order_id) references public.ps_shop_orders(id) on delete set null;
  end if;
end $$;
create index if not exists idx_payments_shop_order on public.ps_payments (shop_order_id) where shop_order_id is not null;

alter table public.ps_payments drop constraint if exists ps_payments_kind_check;
alter table public.ps_payments add constraint ps_payments_kind_check
  check (kind in ('service', 'delivery', 'subscription', 'credits', 'locum', 'platform_fee', 'shop', 'other'));

-- ---------------------------------------------------------------- card readiness + storefront listing

create or replace function public.ps_shop_card_ready(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from ps_org_billing b
    where b.org_id = p_org_id and b.charges_enabled = true and b.stripe_account_id is not null
  );
$function$;

revoke all on function public.ps_shop_card_ready(uuid) from public, anon;
grant execute on function public.ps_shop_card_ready(uuid) to authenticated, service_role;

-- Adds payment_options: what the customer can actually choose
-- (in_store | card | both), after checking the pharmacy can take cards.
drop function if exists public.ps_shop_list_orgs(double precision, double precision);
create function public.ps_shop_list_orgs(
  p_lat double precision default null,
  p_lng double precision default null
)
returns table(
  org_id uuid, name text, slug text, address jsonb, public_logo_url text,
  public_description text, delivery_enabled boolean, delivery_radius_km numeric,
  delivery_fee_pence integer, free_delivery_threshold_pence integer,
  collection_enabled boolean, distance_km double precision, payment_options text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    o.id,
    o.name,
    o.slug,
    o.address,
    o.public_logo_url,
    o.public_description,
    s.delivery_enabled,
    s.delivery_radius_km,
    s.delivery_fee_pence,
    s.free_delivery_threshold_pence,
    s.collection_enabled,
    case
      when p_lat is not null and p_lng is not null and o.geolocation is not null
      then st_distance(o.geolocation, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0
      else null
    end as distance_km,
    case when ps_shop_card_ready(o.id) then s.payment_methods else 'in_store' end as payment_options
  from ps_shop_settings s
  join ps_organisations o on o.id = s.org_id
  where s.shop_enabled = true and o.is_public = true
  order by distance_km asc nulls last, o.name;
$function$;
grant execute on function public.ps_shop_list_orgs(double precision, double precision) to anon, authenticated;

-- ---------------------------------------------------------------- place order (adds p_payment_method)

drop function if exists public.ps_shop_place_order(uuid, jsonb, text, jsonb, text, text, text, jsonb);

create or replace function public.ps_shop_place_order(
  p_org_id uuid,
  p_items jsonb,
  p_fulfilment_method text default 'collection',
  p_delivery_address jsonb default null,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_customer_notes text default null,
  p_responses jsonb default null,
  p_payment_method text default 'in_store'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_settings ps_shop_settings%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_patient_id uuid;
  v_item jsonb;
  v_resp jsonb;
  v_answer jsonb;
  v_question jsonb;
  v_product ps_shop_products%rowtype;
  v_questionnaire ps_shop_questionnaires%rowtype;
  v_qty integer;
  v_subtotal integer := 0;
  v_delivery_fee integer := 0;
  v_item_count integer := 0;
  v_has_consultation boolean := false;
  v_payment_method text := coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'in_store');
  v_customer text;
  v_guest_name text := nullif(trim(coalesce(p_guest_name, '')), '');
  v_guest_phone text;
  v_notes text := nullif(trim(coalesce(p_customer_notes, '')), '');
  v_ip_hash text := ps_shop_client_ip_hash();
  v_product_ids uuid[] := '{}';
  v_consult_products uuid[] := '{}';
  v_resp_products uuid[] := '{}';
  v_resp_product uuid;
  v_answer_text text;
  v_clean_answers jsonb;
  v_seen_questions text[];
begin
  -- Pharmacy and fulfilment ------------------------------------------------
  select s.* into v_settings
  from ps_shop_settings s
  join ps_organisations o on o.id = s.org_id
  where s.org_id = p_org_id and s.shop_enabled = true and o.is_public = true;
  if not found then
    raise exception 'Shop is not available for this pharmacy';
  end if;

  if p_fulfilment_method is null or p_fulfilment_method not in ('collection', 'delivery') then
    raise exception 'Invalid fulfilment method';
  end if;
  if p_fulfilment_method = 'collection' and not v_settings.collection_enabled then
    raise exception 'This pharmacy does not offer collection';
  end if;
  if p_fulfilment_method = 'delivery' and not v_settings.delivery_enabled then
    raise exception 'This pharmacy does not offer delivery';
  end if;
  if p_fulfilment_method = 'delivery' then
    if p_delivery_address is null or jsonb_typeof(p_delivery_address) <> 'object'
       or coalesce(trim(p_delivery_address->>'postcode'), '') = ''
       or coalesce(trim(p_delivery_address->>'line_1'), '') = '' then
      raise exception 'Delivery address with first line and postcode is required';
    end if;
    if length(coalesce(p_delivery_address->>'line_1', '')) > 200
       or length(coalesce(p_delivery_address->>'city', '')) > 100
       or length(coalesce(p_delivery_address->>'postcode', '')) > 10 then
      raise exception 'Delivery address is too long';
    end if;
  end if;

  -- Payment ----------------------------------------------------------------
  -- Same rule as ps_shop_list_orgs.payment_options: card only counts once
  -- the pharmacy's Stripe account can take charges.
  if v_payment_method not in ('in_store', 'card') then
    raise exception 'Invalid payment method';
  end if;
  if v_payment_method = 'card' and v_settings.payment_methods = 'in_store' then
    raise exception 'This pharmacy takes payment in store or on delivery only';
  end if;
  if v_payment_method = 'card' and not ps_shop_card_ready(p_org_id) then
    raise exception 'This pharmacy can''t take card payments yet. Please choose to pay in store.';
  end if;
  if v_payment_method = 'in_store' and v_settings.payment_methods = 'card' and ps_shop_card_ready(p_org_id) then
    raise exception 'This pharmacy takes card payment online only';
  end if;

  -- Customer ---------------------------------------------------------------
  if auth.uid() is not null then
    select id into v_patient_id from ps_patients where auth_user_id = auth.uid() limit 1;
  end if;

  if v_guest_name is not null and length(v_guest_name) > 100 then
    raise exception 'Name is too long';
  end if;
  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'Notes are too long (1000 characters max)';
  end if;
  if coalesce(trim(p_guest_phone), '') <> '' then
    v_guest_phone := ps_shop_normalise_uk_phone(p_guest_phone);
    if v_guest_phone is null then
      raise exception 'Please enter a valid UK phone number';
    end if;
  end if;
  if v_patient_id is null and (v_guest_name is null or v_guest_phone is null) then
    raise exception 'Guest orders require a name and phone number';
  end if;

  -- Rate limits (across all pharmacies) -------------------------------------
  if v_guest_phone is not null and (
    select count(*) from ps_shop_orders
    where guest_phone = v_guest_phone and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Too many orders from this phone number. Please try again later or call the pharmacy.';
  end if;
  if v_ip_hash is not null and (
    select count(*) from ps_shop_orders
    where client_ip_hash = v_ip_hash and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many orders from this connection. Please try again later or call the pharmacy.';
  end if;
  if v_patient_id is not null and (
    select count(*) from ps_shop_orders
    where patient_id = v_patient_id and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many orders. Please try again later or call the pharmacy.';
  end if;

  -- Items shape --------------------------------------------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order has no items';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'Too many different items in one order (30 max)';
  end if;
  if p_responses is not null and jsonb_typeof(p_responses) <> 'array' then
    raise exception 'Invalid questionnaire answers';
  end if;

  v_order_number := 'PS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into ps_shop_orders (org_id, order_number, patient_id, guest_name, guest_phone,
    fulfilment_method, delivery_address, customer_notes, client_ip_hash,
    payment_method, payment_status)
  values (p_org_id, v_order_number, v_patient_id, v_guest_name, v_guest_phone,
    p_fulfilment_method,
    case when p_fulfilment_method = 'delivery' then jsonb_build_object(
      'line_1', trim(p_delivery_address->>'line_1'),
      'city', nullif(trim(coalesce(p_delivery_address->>'city', '')), ''),
      'postcode', upper(trim(p_delivery_address->>'postcode'))
    ) end,
    v_notes, v_ip_hash,
    v_payment_method, case when v_payment_method = 'card' then 'awaiting_payment' else 'not_required' end)
  returning id into v_order_id;

  -- Items --------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_qty := coalesce((v_item->>'quantity')::integer, 0);
    exception when others then
      raise exception 'Invalid quantity';
    end;
    if v_qty <= 0 or v_qty > 50 then
      raise exception 'Invalid quantity (1 to 50 of each item)';
    end if;

    select * into v_product from ps_shop_products
    where id = (v_item->>'product_id')::uuid and org_id = p_org_id and is_active = true
    for update;
    if not found then
      raise exception 'Product not found or unavailable';
    end if;
    if v_product.id = any(v_product_ids) then
      raise exception 'The same product appears twice in the order';
    end if;
    v_product_ids := v_product_ids || v_product.id;

    if v_product.stock_quantity < v_qty then
      raise exception 'Insufficient stock for %', v_product.name;
    end if;

    if v_product.questionnaire_id is not null then
      v_has_consultation := true;
      v_consult_products := v_consult_products || v_product.id;
    end if;

    update ps_shop_products set stock_quantity = stock_quantity - v_qty, updated_at = now()
    where id = v_product.id;

    insert into ps_shop_order_items (order_id, product_id, product_name, unit_price_pence, quantity, line_total_pence)
    values (v_order_id, v_product.id, v_product.name, v_product.price_pence, v_qty, v_product.price_pence * v_qty);

    v_subtotal := v_subtotal + v_product.price_pence * v_qty;
    v_item_count := v_item_count + v_qty;
  end loop;

  -- Questionnaire responses --------------------------------------------------
  for v_resp in select * from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb)) loop
    begin
      v_resp_product := (v_resp->>'product_id')::uuid;
    exception when others then
      raise exception 'Invalid questionnaire answers';
    end;
    if v_resp_product is null or not (v_resp_product = any(v_consult_products)) then
      raise exception 'Questionnaire answers were sent for a product that is not in the order';
    end if;
    if v_resp_product = any(v_resp_products) then
      raise exception 'Questionnaire answered twice for the same product';
    end if;
    v_resp_products := v_resp_products || v_resp_product;

    select * into v_product from ps_shop_products where id = v_resp_product;
    if (v_resp->>'questionnaire_id') is distinct from v_product.questionnaire_id::text then
      raise exception 'Questionnaire for % has changed. Please refresh the page and try again.', v_product.name;
    end if;
    select * into v_questionnaire from ps_shop_questionnaires where id = v_product.questionnaire_id;
    if jsonb_typeof(coalesce(v_resp->'answers', 'null'::jsonb)) <> 'array' then
      raise exception 'Invalid questionnaire answers for %', v_product.name;
    end if;

    -- Every answer must be to a question on this questionnaire, once.
    v_seen_questions := '{}';
    for v_answer in select * from jsonb_array_elements(v_resp->'answers') loop
      if not exists (
        select 1 from jsonb_array_elements(v_questionnaire.questions) q
        where q->>'id' = v_answer->>'question_id'
      ) then
        raise exception 'Unknown question in the answers for %', v_product.name;
      end if;
      if (v_answer->>'question_id') = any(v_seen_questions) then
        raise exception 'A question was answered twice for %', v_product.name;
      end if;
      v_seen_questions := v_seen_questions || (v_answer->>'question_id');
    end loop;

    -- Walk the questionnaire's own questions, check each answer and store
    -- them with the questionnaire's labels.
    v_clean_answers := '[]'::jsonb;
    for v_question in select * from jsonb_array_elements(v_questionnaire.questions) loop
      select nullif(trim(coalesce(a->>'answer', '')), '') into v_answer_text
      from jsonb_array_elements(v_resp->'answers') a
      where a->>'question_id' = v_question->>'id'
      limit 1;

      if v_answer_text is null then
        if coalesce((v_question->>'required')::boolean, false) then
          raise exception 'Please answer "%" for %', v_question->>'label', v_product.name;
        end if;
      else
        if length(v_answer_text) > 2000 then
          raise exception 'An answer for % is too long', v_product.name;
        end if;
        if v_question->>'type' = 'yesno' and v_answer_text not in ('Yes', 'No') then
          raise exception 'Please answer Yes or No to "%"', v_question->>'label';
        end if;
        if v_question->>'type' = 'choice' and not exists (
          select 1 from jsonb_array_elements_text(coalesce(v_question->'options', '[]'::jsonb)) o
          where o = v_answer_text
        ) then
          raise exception 'Please choose one of the options for "%"', v_question->>'label';
        end if;
      end if;

      v_clean_answers := v_clean_answers || jsonb_build_array(jsonb_build_object(
        'question_id', v_question->>'id',
        'label', v_question->>'label',
        'answer', coalesce(v_answer_text, '')
      ));
    end loop;

    insert into ps_shop_questionnaire_responses (order_id, product_id, questionnaire_id, answers)
    values (v_order_id, v_product.id, v_product.questionnaire_id, v_clean_answers);
  end loop;

  -- Every consultation product needs a response.
  select p.name into v_customer
  from ps_shop_products p
  where p.id = any(v_consult_products) and not (p.id = any(v_resp_products))
  limit 1;
  if v_customer is not null then
    raise exception 'Questionnaire answers are required for %', v_customer;
  end if;

  -- Totals -------------------------------------------------------------------
  if p_fulfilment_method = 'delivery' then
    v_delivery_fee := v_settings.delivery_fee_pence;
    if v_settings.free_delivery_threshold_pence is not null
       and v_subtotal >= v_settings.free_delivery_threshold_pence then
      v_delivery_fee := 0;
    end if;
  end if;

  update ps_shop_orders
  set subtotal_pence = v_subtotal,
      delivery_fee_pence = v_delivery_fee,
      total_pence = v_subtotal + v_delivery_fee,
      updated_at = now()
  where id = v_order_id;

  -- Staff alert (bell + optional SMS via org alert settings, event 'shop_order').
  -- Card orders alert once Stripe confirms payment (ps_shop_sync_order_payment).
  if v_payment_method = 'in_store' then
  v_customer := coalesce(v_guest_name, 'Registered patient');
  perform ps_fanout_notification(
    p_org_id,
    'shop_order',
    '🛍️ New shop order ' || v_order_number,
    v_customer || ' · ' || v_item_count || ' item' || case when v_item_count = 1 then '' else 's' end
      || ' · £' || to_char((v_subtotal + v_delivery_fee) / 100.0, 'FM990.00')
      || ' · ' || case when p_fulfilment_method = 'delivery' then 'Delivery' else 'Collection' end
      || case when v_has_consultation then ' · Consultation answers to review' else '' end,
    '/shop-admin/orders',
    jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number)
  );
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal_pence', v_subtotal,
    'delivery_fee_pence', v_delivery_fee,
    'total_pence', v_subtotal + v_delivery_fee,
    'payment_method', v_payment_method
  );
end;
$function$;
revoke all on function public.ps_shop_place_order(uuid, jsonb, text, jsonb, text, text, text, jsonb, text) from public;
grant execute on function public.ps_shop_place_order(uuid, jsonb, text, jsonb, text, text, text, jsonb, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------- staff can't move unpaid card orders on

create or replace function public.ps_shop_order_payment_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status
     and new.status not in ('new', 'cancelled')
     and new.payment_status = 'awaiting_payment' then
    raise exception 'This order is waiting for the customer''s card payment';
  end if;
  return new;
end;
$function$;

revoke all on function public.ps_shop_order_payment_guard() from public, anon;

drop trigger if exists trg_shop_order_payment_guard on public.ps_shop_orders;
create trigger trg_shop_order_payment_guard before update on public.ps_shop_orders
  for each row execute function public.ps_shop_order_payment_guard();

-- Starting a delivery round skips orders still waiting for payment or a pharmacist.
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
      and review_status not in ('pending', 'rejected')
      and payment_status <> 'awaiting_payment';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------- payment -> order sync

create or replace function public.ps_shop_sync_order_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order ps_shop_orders%rowtype;
  v_items integer;
begin
  if new.shop_order_id is null or new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_order from ps_shop_orders where id = new.shop_order_id for update;
  if not found then
    return new;
  end if;

  if new.status = 'succeeded' then
    if v_order.status = 'cancelled' then
      update ps_shop_orders set payment_status = 'paid', payment_id = new.id where id = v_order.id;
      perform ps_fanout_notification(
        v_order.org_id, 'shop_order',
        '⚠️ Refund needed: shop order ' || v_order.order_number,
        'The card payment arrived after the order was cancelled. Refund it from Payments.',
        '/payments',
        jsonb_build_object('order_id', v_order.id, 'payment_id', new.id)
      );
    elsif v_order.payment_status <> 'paid' then
      update ps_shop_orders set payment_status = 'paid', payment_id = new.id where id = v_order.id;
      select coalesce(sum(quantity), 0) into v_items from ps_shop_order_items where order_id = v_order.id;
      perform ps_fanout_notification(
        v_order.org_id, 'shop_order',
        '🛍️ New shop order ' || v_order.order_number || ' (paid)',
        coalesce(v_order.guest_name, 'Registered patient') || ' · ' || v_items || ' item'
          || case when v_items = 1 then '' else 's' end
          || ' · £' || to_char(v_order.total_pence / 100.0, 'FM990.00') || ' paid by card'
          || ' · ' || case when v_order.fulfilment_method = 'delivery' then 'Delivery' else 'Collection' end
          || case when v_order.review_status = 'pending' then ' · Pharmacist check needed' else '' end,
        '/shop-admin/orders',
        jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number)
      );
    end if;

  elsif new.status = 'canceled' then
    -- Checkout expired or the customer backed out: release the stock.
    if v_order.payment_status = 'awaiting_payment' then
      update ps_shop_orders
      set payment_status = 'expired',
          status = 'cancelled',
          org_notes = trim(both e'\n' from coalesce(org_notes, '') || e'\n' || '💳 Card payment not completed, order cancelled automatically')
      where id = v_order.id;
    end if;

  elsif new.status in ('refunded', 'partially_refunded') then
    update ps_shop_orders set payment_status = new.status where id = v_order.id;
  end if;

  return new;
end;
$function$;

revoke all on function public.ps_shop_sync_order_payment() from public, anon, authenticated;

drop trigger if exists trg_shop_sync_order_payment on public.ps_payments;
create trigger trg_shop_sync_order_payment after update of status on public.ps_payments
  for each row execute function public.ps_shop_sync_order_payment();

-- ---------------------------------------------------------------- unpaid card orders time out

create or replace function public.ps_shop_expire_unpaid_orders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  update ps_shop_orders o
  set payment_status = 'expired',
      status = 'cancelled',
      org_notes = trim(both e'\n' from coalesce(o.org_notes, '') || e'\n' || '💳 Card payment not completed, order cancelled automatically')
  where o.payment_status = 'awaiting_payment'
    and o.status <> 'cancelled'
    and o.created_at < now() - interval '45 minutes'
    and not exists (
      select 1 from ps_payments p
      where p.shop_order_id = o.id and p.status = 'succeeded'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.ps_shop_expire_unpaid_orders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ps-shop-expire-unpaid-orders';
select cron.schedule(
  'ps-shop-expire-unpaid-orders',
  '*/10 * * * *',
  $$select public.ps_shop_expire_unpaid_orders()$$
);
