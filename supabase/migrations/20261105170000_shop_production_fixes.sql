-- Shop: production fixes (PR 1 of /mnt/project-files/shop/production-readiness-plan.md)
--
-- Run AFTER 20261105160000_shop_baseline.sql. Safe to run more than once.
--
-- B1  Guest checkout works again. Logged-out visitors can place an order
--     (they had no EXECUTE on ps_shop_place_order on London, so the
--     "order with your name and phone" checkout always failed). To stop the
--     shop being flooded with fake orders:
--       - the phone number must be a UK number and is stored normalised
--         (07700 900123 / +44 7700 900123 -> 07700900123)
--       - at most 5 orders an hour per phone number, 10 an hour per
--         connection (IP, stored only as a hash) and 10 an hour per signed-in
--         patient, across all pharmacies
--       - at most 30 lines and 50 of any one item per order; names, notes and
--         address fields have length limits
--     It also now refuses collection when the pharmacy has turned collection
--     off, which was shown in the shop settings but never checked.
-- B2  Cancelling an order puts its stock back, once. A cancelled order can no
--     longer be moved back to another status (that would double the stock).
-- B3  Questionnaire answers are checked properly. Every consultation product
--     in the order needs exactly one response for that product's own
--     questionnaire; every required question must be answered; yes/no and
--     choice answers must be one of the allowed options; answers to products
--     that are not in the order, or to unknown questions, are refused. The
--     question labels are stored from the questionnaire, not from the browser.
-- H1  Product images: 5 MB limit, JPEG/PNG/WebP/GIF only.
-- H2  Staff can no longer delete orders or order items, or insert them
--     directly (orders only come in through ps_shop_place_order). Staff can
--     still read and update orders; cancelling replaces deleting.
--
-- Not in this migration: B6 (only list/accept orders for pharmacies whose plan
-- includes the shop). ps_org_subscriptions does not exist on London yet; it
-- will be added with the billing work.

-- ---------------------------------------------------------------- columns

alter table public.ps_shop_orders
  add column if not exists client_ip_hash text,
  add column if not exists stock_restored_at timestamptz;

comment on column public.ps_shop_orders.client_ip_hash is
  'sha256 of the caller''s IP, only used to rate-limit order placement. Never the raw IP.';
comment on column public.ps_shop_orders.stock_restored_at is
  'Set when cancelling the order returned its items to stock, so it only happens once.';

create index if not exists idx_shop_orders_guest_phone_created
  on public.ps_shop_orders (guest_phone, created_at) where guest_phone is not null;
create index if not exists idx_shop_orders_ip_created
  on public.ps_shop_orders (client_ip_hash, created_at) where client_ip_hash is not null;
create index if not exists idx_shop_orders_patient_created
  on public.ps_shop_orders (patient_id, created_at) where patient_id is not null;
create index if not exists idx_shop_order_items_product
  on public.ps_shop_order_items (product_id);

-- ---------------------------------------------------------------- helpers

-- UK phone number to a canonical national form (07700900123), or null if it
-- is not a plausible UK number.
create or replace function public.ps_shop_normalise_uk_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v text := regexp_replace(coalesce(p_phone, ''), '[\s\-\(\)\.]', '', 'g');
begin
  if v like '+44%' then
    v := '0' || substr(v, 4);
  elsif v like '0044%' then
    v := '0' || substr(v, 5);
  end if;
  v := regexp_replace(v, '^00?0', '0');      -- "+44 (0)7700..." -> "07700..."
  if v ~ '^0[1-9][0-9]{8,9}$' then
    return v;
  end if;
  return null;
end;
$function$;

-- The caller's IP from the API gateway headers, hashed. Null outside an API
-- request (e.g. the SQL editor).
create or replace function public.ps_shop_client_ip_hash()
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_headers json;
  v_ip text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  if v_headers is null then
    return null;
  end if;
  v_ip := coalesce(
    nullif(trim(split_part(v_headers->>'x-forwarded-for', ',', 1)), ''),
    nullif(trim(v_headers->>'x-real-ip'), ''),
    nullif(trim(v_headers->>'cf-connecting-ip'), '')
  );
  if v_ip is null then
    return null;
  end if;
  return encode(sha256(convert_to(v_ip, 'UTF8')), 'hex');
end;
$function$;

-- ---------------------------------------------------------------- B1 + B3: place order

create or replace function public.ps_shop_place_order(
  p_org_id uuid,
  p_items jsonb,
  p_fulfilment_method text default 'collection',
  p_delivery_address jsonb default null,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_customer_notes text default null,
  p_responses jsonb default null
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
    fulfilment_method, delivery_address, customer_notes, client_ip_hash)
  values (p_org_id, v_order_number, v_patient_id, v_guest_name, v_guest_phone,
    p_fulfilment_method,
    case when p_fulfilment_method = 'delivery' then jsonb_build_object(
      'line_1', trim(p_delivery_address->>'line_1'),
      'city', nullif(trim(coalesce(p_delivery_address->>'city', '')), ''),
      'postcode', upper(trim(p_delivery_address->>'postcode'))
    ) end,
    v_notes, v_ip_hash)
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

  -- Staff alert (bell + optional SMS via org alert settings, event 'shop_order')
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

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal_pence', v_subtotal,
    'delivery_fee_pence', v_delivery_fee,
    'total_pence', v_subtotal + v_delivery_fee
  );
end;
$function$;

revoke all on function public.ps_shop_place_order(uuid, jsonb, text, jsonb, text, text, text, jsonb) from public;
grant execute on function public.ps_shop_place_order(uuid, jsonb, text, jsonb, text, text, text, jsonb)
  to anon, authenticated, service_role;

-- The helpers are only called inside ps_shop_place_order.
revoke all on function public.ps_shop_normalise_uk_phone(text) from public, anon;
grant execute on function public.ps_shop_normalise_uk_phone(text) to authenticated, service_role;
revoke all on function public.ps_shop_client_ip_hash() from public, anon;
grant execute on function public.ps_shop_client_ip_hash() to authenticated, service_role;

-- ---------------------------------------------------------------- B2: restock on cancel

create or replace function public.ps_shop_order_status_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'A cancelled order cannot be reopened. Ask the customer to place a new order.';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and new.stock_restored_at is null then
    update ps_shop_products p
    set stock_quantity = p.stock_quantity + i.qty,
        updated_at = now()
    from (
      select product_id, sum(quantity)::integer as qty
      from ps_shop_order_items
      where order_id = new.id and product_id is not null
      group by product_id
    ) i
    where p.id = i.product_id;
    new.stock_restored_at := now();
  end if;

  -- Only the database sets these.
  if new.stock_restored_at is distinct from old.stock_restored_at
     and not (new.status = 'cancelled' and old.status is distinct from 'cancelled') then
    new.stock_restored_at := old.stock_restored_at;
  end if;
  new.client_ip_hash := old.client_ip_hash;

  return new;
end;
$function$;

revoke all on function public.ps_shop_order_status_guard() from public, anon;

drop trigger if exists trg_shop_order_status_guard on public.ps_shop_orders;
create trigger trg_shop_order_status_guard before update on public.ps_shop_orders
  for each row execute function public.ps_shop_order_status_guard();

-- ---------------------------------------------------------------- H2: no deleting order history

drop policy if exists org_members_crud_shop_orders on public.ps_shop_orders;
drop policy if exists org_members_read_shop_orders on public.ps_shop_orders;
create policy org_members_read_shop_orders on public.ps_shop_orders
  for select using (org_id in (select public.ps_get_user_org_ids()));
drop policy if exists org_members_update_shop_orders on public.ps_shop_orders;
create policy org_members_update_shop_orders on public.ps_shop_orders
  for update using (org_id in (select public.ps_get_user_org_ids()))
  with check (org_id in (select public.ps_get_user_org_ids()));

drop policy if exists org_members_crud_shop_order_items on public.ps_shop_order_items;
drop policy if exists org_members_read_shop_order_items on public.ps_shop_order_items;
create policy org_members_read_shop_order_items on public.ps_shop_order_items
  for select using (
    order_id in (
      select id from public.ps_shop_orders
      where org_id in (select public.ps_get_user_org_ids())
    )
  );

-- Staff can't edit the money or the customer's own details on an order,
-- only its status, notes and delivery round links.
revoke update on public.ps_shop_orders from anon, authenticated;
grant update (status, org_notes, delivery_round_id, delivery_round_patient_id)
  on public.ps_shop_orders to authenticated;
revoke insert, delete on public.ps_shop_orders from anon, authenticated;
revoke insert, update, delete on public.ps_shop_order_items from anon, authenticated;
revoke insert, update, delete on public.ps_shop_questionnaire_responses from anon, authenticated;

-- ---------------------------------------------------------------- H1: image limits

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'shop-products';
