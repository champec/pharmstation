-- Shop: customer texts, order tracking, delivery radius and pharmacy details
-- (PR 4 and PR 5 of /mnt/project-files/shop/production-readiness-plan.md:
-- C1, C2, B7, L1). Safe to run more than once.
--
-- 1. Pharmacy details on the shop front (L1). Turning the shop on needs the
--    pharmacy's GPhC premises number, the pharmacist in charge (name and
--    GPhC number) and a phone number or email for customers.
-- 2. ps_shop_list_orgs returns those details for the shop front.
-- 3. ps_shop_place_order checks the delivery radius when the checkout sends
--    the postcode's coordinates (B7).
-- 4. Customer texts (C1): a trigger asks the shop-notify edge function to
--    text the customer when the order is placed (or paid), ready to collect,
--    out for delivery, or cancelled. Texts use the pharmacy's SMS settings
--    and credits; nothing is sent when the pharmacy has SMS turned off.
-- 5. ps_shop_track_order(order number, phone) for the public tracking page
--    (C2). The phone must match the order, so an order number alone shows
--    nothing.

-- ---------------------------------------------------------------- 1. pharmacy details

alter table public.ps_shop_settings
  add column if not exists pharmacist_in_charge_name text,
  add column if not exists pharmacist_in_charge_gphc text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text;

comment on column public.ps_shop_settings.pharmacist_in_charge_name is
  'Shown on the shop front: the pharmacist responsible for online sales (superintendent or responsible pharmacist).';

create or replace function public.ps_shop_settings_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_premises text;
begin
  new.pharmacist_in_charge_name := nullif(trim(coalesce(new.pharmacist_in_charge_name, '')), '');
  new.pharmacist_in_charge_gphc := nullif(regexp_replace(coalesce(new.pharmacist_in_charge_gphc, ''), '\s', '', 'g'), '');
  new.contact_phone := nullif(trim(coalesce(new.contact_phone, '')), '');
  new.contact_email := nullif(lower(trim(coalesce(new.contact_email, ''))), '');

  if new.pharmacist_in_charge_gphc is not null and new.pharmacist_in_charge_gphc !~ '^[0-9]{7}$' then
    raise exception 'A GPhC registration number has 7 digits';
  end if;
  if new.contact_email is not null and new.contact_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid contact email';
  end if;
  if new.contact_phone is not null and ps_shop_normalise_uk_phone(new.contact_phone) is null then
    raise exception 'Please enter a UK contact phone number';
  end if;
  if length(coalesce(new.pharmacist_in_charge_name, '')) > 120 then
    raise exception 'Pharmacist name is too long';
  end if;

  if new.shop_enabled and (tg_op = 'INSERT' or not old.shop_enabled
      or new.pharmacist_in_charge_name is distinct from old.pharmacist_in_charge_name
      or new.pharmacist_in_charge_gphc is distinct from old.pharmacist_in_charge_gphc
      or new.contact_phone is distinct from old.contact_phone
      or new.contact_email is distinct from old.contact_email) then
    select nullif(trim(coalesce(gphc_premises_number, '')), '') into v_premises
    from ps_organisations where id = new.org_id;
    if v_premises is null then
      raise exception 'Add your GPhC premises number in Settings before opening the shop';
    end if;
    if new.pharmacist_in_charge_name is null or new.pharmacist_in_charge_gphc is null then
      raise exception 'Add the pharmacist in charge (name and GPhC number) before opening the shop';
    end if;
    if new.contact_phone is null and new.contact_email is null then
      raise exception 'Add a phone number or email for customers before opening the shop';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.ps_shop_settings_guard() from public, anon;

drop trigger if exists trg_shop_settings_guard on public.ps_shop_settings;
create trigger trg_shop_settings_guard before insert or update on public.ps_shop_settings
  for each row execute function public.ps_shop_settings_guard();

-- ---------------------------------------------------------------- 2. shop list

drop function if exists public.ps_shop_list_orgs(double precision, double precision);
create function public.ps_shop_list_orgs(
  p_lat double precision default null,
  p_lng double precision default null
)
returns table(
  org_id uuid, name text, slug text, address jsonb, public_logo_url text, public_description text,
  delivery_enabled boolean, delivery_radius_km numeric, delivery_fee_pence integer,
  free_delivery_threshold_pence integer, collection_enabled boolean, distance_km double precision,
  payment_options text, gphc_premises_number text, pharmacist_in_charge_name text,
  pharmacist_in_charge_gphc text, contact_phone text, contact_email text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    o.id, o.name, o.slug, o.address, o.public_logo_url, o.public_description,
    s.delivery_enabled, s.delivery_radius_km, s.delivery_fee_pence,
    s.free_delivery_threshold_pence, s.collection_enabled,
    case
      when p_lat is not null and p_lng is not null and o.geolocation is not null
      then st_distance(o.geolocation, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0
    end,
    case when ps_shop_card_ready(o.id) then s.payment_methods else 'in_store' end,
    o.gphc_premises_number, s.pharmacist_in_charge_name, s.pharmacist_in_charge_gphc,
    s.contact_phone, s.contact_email
  from ps_shop_settings s
  join ps_organisations o on o.id = s.org_id
  where s.shop_enabled = true and o.is_public = true
  order by 12 asc nulls last, o.name;
$function$;

revoke all on function public.ps_shop_list_orgs(double precision, double precision) from public;
grant execute on function public.ps_shop_list_orgs(double precision, double precision) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- 3. place order (delivery radius)

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
  v_distance_km double precision;
  v_lat double precision;
  v_lng double precision;
  v_org_geo geography;
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

  -- Delivery radius (B7). The checkout looks the postcode up (postcodes.io)
  -- and sends its coordinates. When they are present we check the distance
  -- from the pharmacy and refuse addresses outside the delivery area. When
  -- the lookup failed the order still goes through, marked as not checked,
  -- so staff can confirm the address.
  if p_fulfilment_method = 'delivery' then
    begin
      v_lat := (p_delivery_address->>'lat')::double precision;
      v_lng := (p_delivery_address->>'lng')::double precision;
    exception when others then
      v_lat := null; v_lng := null;
    end;
    select o.geolocation into v_org_geo from ps_organisations o where o.id = p_org_id;
    if v_lat between 49 and 61 and v_lng between -9 and 2 and v_org_geo is not null then
      v_distance_km := st_distance(v_org_geo, st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography) / 1000.0;
      if v_distance_km > v_settings.delivery_radius_km then
        raise exception 'Sorry, that address is about % km away. This pharmacy delivers up to % km. You can choose collection instead.',
          round(v_distance_km::numeric, 1), v_settings.delivery_radius_km;
      end if;
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
    case when p_fulfilment_method = 'delivery' then jsonb_strip_nulls(jsonb_build_object(
      'line_1', trim(p_delivery_address->>'line_1'),
      'city', nullif(trim(coalesce(p_delivery_address->>'city', '')), ''),
      'postcode', upper(trim(p_delivery_address->>'postcode')),
      'distance_km', round(v_distance_km::numeric, 1),
      'distance_checked', v_distance_km is not null
    )) end,
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

-- ---------------------------------------------------------------- 4. customer texts

alter table public.ps_shop_orders
  add column if not exists customer_texts jsonb not null default '{}'::jsonb;

comment on column public.ps_shop_orders.customer_texts is
  'Texts sent to the customer, by event (placed, ready, out_for_delivery, cancelled): {event: {at, sent, reason}}. Stops repeats.';

insert into ps_internal_secrets (key, value)
values ('shop_notify_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.ps_shop_order_text_customer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event text;
  v_secret text;
begin
  if tg_op = 'INSERT' then
    -- Card orders are texted once Stripe confirms payment (below).
    if new.payment_method <> 'card' then v_event := 'placed'; end if;
  else
    if new.payment_status = 'paid' and old.payment_status = 'awaiting_payment' and new.status <> 'cancelled' then
      v_event := 'placed';
    elsif new.status is distinct from old.status then
      if new.status = 'ready' and new.fulfilment_method = 'collection' then
        v_event := 'ready';
      elsif new.status = 'out_for_delivery' then
        v_event := 'out_for_delivery';
      elsif new.status = 'cancelled' and old.payment_status is distinct from 'awaiting_payment' then
        -- An unpaid card order that times out is not texted: the customer
        -- left the payment page and never had a confirmed order.
        v_event := 'cancelled';
      end if;
    end if;
  end if;

  if v_event is null or new.customer_texts ? v_event then
    return null;
  end if;

  select value into v_secret from ps_internal_secrets where key = 'shop_notify_secret';
  if v_secret is null then return null; end if;

  perform net.http_post(
    url := 'https://dbgwfdrvqzuevbfrmsdt.supabase.co/functions/v1/shop-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := jsonb_build_object('action', 'order_event', 'order_id', new.id, 'event', v_event)
  );
  return null;
exception when others then
  -- A text must never stop an order being placed or updated.
  raise warning 'shop customer text not queued: %', sqlerrm;
  return null;
end;
$function$;

revoke all on function public.ps_shop_order_text_customer() from public, anon, authenticated;

drop trigger if exists trg_shop_order_text_customer on public.ps_shop_orders;
create trigger trg_shop_order_text_customer after insert or update of status, payment_status on public.ps_shop_orders
  for each row execute function public.ps_shop_order_text_customer();

-- ---------------------------------------------------------------- 5. order tracking

create or replace function public.ps_shop_track_order(p_order_number text, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_number text := upper(regexp_replace(coalesce(p_order_number, ''), '\s', '', 'g'));
  v_phone text := ps_shop_normalise_uk_phone(p_phone);
  v_order ps_shop_orders%rowtype;
  v_patient_phone text;
begin
  if v_number !~ '^PS-[0-9A-F]{8}$' or v_phone is null then
    return null;
  end if;
  select * into v_order from ps_shop_orders where order_number = v_number;
  if not found then return null; end if;

  if v_order.patient_id is not null then
    select ps_shop_normalise_uk_phone(p.phone) into v_patient_phone from ps_patients p where p.id = v_order.patient_id;
  end if;
  if v_phone is distinct from ps_shop_normalise_uk_phone(v_order.guest_phone)
     and v_phone is distinct from v_patient_phone then
    return null;
  end if;

  return (
    select jsonb_build_object(
      'order_number', v_order.order_number,
      'status', v_order.status,
      'review_status', v_order.review_status,
      'payment_method', v_order.payment_method,
      'payment_status', v_order.payment_status,
      'fulfilment_method', v_order.fulfilment_method,
      'subtotal_pence', v_order.subtotal_pence,
      'delivery_fee_pence', v_order.delivery_fee_pence,
      'total_pence', v_order.total_pence,
      'created_at', v_order.created_at,
      'updated_at', v_order.updated_at,
      'postcode', v_order.delivery_address->>'postcode',
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity, 'line_total_pence', i.line_total_pence) order by i.product_name)
        from ps_shop_order_items i where i.order_id = v_order.id), '[]'::jsonb),
      'pharmacy', jsonb_build_object(
        'name', o.name, 'slug', o.slug, 'address', o.address,
        'phone', s.contact_phone, 'email', s.contact_email)
    )
    from ps_organisations o
    left join ps_shop_settings s on s.org_id = o.id
    where o.id = v_order.org_id
  );
end;
$function$;

revoke all on function public.ps_shop_track_order(text, text) from public;
grant execute on function public.ps_shop_track_order(text, text) to anon, authenticated, service_role;
