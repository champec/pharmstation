-- Shop: baseline
--
-- Captures the shop's database setup exactly as it ran on London on
-- 5 Nov 2026, so it can be rebuilt and reviewed from the repo. Before this,
-- the tables, functions, triggers, policies and seed data only lived in the
-- live database.
--
-- It changes nothing on London: every statement is "if not exists",
-- "create or replace" or "on conflict do nothing", and the policies are
-- dropped and recreated with the same definitions. Safe to run more than once.
--
-- ps_shop_place_order is defined in the next migration
-- (20261105170000_shop_production_fixes.sql), which replaces it anyway.

-- ---------------------------------------------------------------- tables

create table if not exists public.ps_shop_categories (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  parent_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint ps_shop_categories_pkey primary key (id),
  constraint ps_shop_categories_slug_key unique (slug),
  constraint ps_shop_categories_parent_id_fkey foreign key (parent_id)
    references public.ps_shop_categories(id) on delete set null
);

create table if not exists public.ps_shop_settings (
  org_id uuid not null,
  shop_enabled boolean not null default false,
  delivery_enabled boolean not null default false,
  delivery_radius_km numeric(6,1) not null default 5,
  delivery_fee_pence integer not null default 0,
  free_delivery_threshold_pence integer,
  collection_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ps_shop_settings_pkey primary key (org_id),
  constraint ps_shop_settings_org_id_fkey foreign key (org_id)
    references public.ps_organisations(id) on delete cascade
);

create table if not exists public.ps_shop_questionnaires (
  id uuid not null default gen_random_uuid(),
  org_id uuid,
  name text not null,
  description text,
  questions jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ps_shop_questionnaires_pkey primary key (id),
  constraint ps_shop_questionnaires_org_id_fkey foreign key (org_id)
    references public.ps_organisations(id) on delete cascade
);

create table if not exists public.ps_shop_products (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  category_id uuid,
  name text not null,
  description text,
  image_url text,
  price_pence integer not null,
  stock_quantity integer not null default 0,
  sku text,
  is_active boolean not null default true,
  requires_availability_check boolean not null default false,
  requires_consultation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  questionnaire_id uuid,
  constraint ps_shop_products_pkey primary key (id),
  constraint ps_shop_products_org_id_fkey foreign key (org_id)
    references public.ps_organisations(id) on delete cascade,
  constraint ps_shop_products_category_id_fkey foreign key (category_id)
    references public.ps_shop_categories(id) on delete set null,
  constraint ps_shop_products_questionnaire_id_fkey foreign key (questionnaire_id)
    references public.ps_shop_questionnaires(id) on delete set null,
  constraint ps_shop_products_price_pence_check check (price_pence >= 0),
  constraint ps_shop_products_stock_quantity_check check (stock_quantity >= 0)
);

create table if not exists public.ps_shop_orders (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  order_number text not null,
  patient_id uuid,
  guest_name text,
  guest_phone text,
  status text not null default 'new',
  fulfilment_method text not null default 'collection',
  delivery_address jsonb,
  subtotal_pence integer not null default 0,
  delivery_fee_pence integer not null default 0,
  total_pence integer not null default 0,
  customer_notes text,
  org_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivery_round_id uuid,
  delivery_round_patient_id uuid,
  constraint ps_shop_orders_pkey primary key (id),
  constraint ps_shop_orders_order_number_key unique (order_number),
  constraint ps_shop_orders_org_id_fkey foreign key (org_id)
    references public.ps_organisations(id) on delete cascade,
  constraint ps_shop_orders_patient_id_fkey foreign key (patient_id)
    references public.ps_patients(id) on delete set null,
  constraint ps_shop_orders_delivery_round_id_fkey foreign key (delivery_round_id)
    references public.ps_delivery_rounds(id) on delete set null,
  constraint ps_shop_orders_delivery_round_patient_id_fkey foreign key (delivery_round_patient_id)
    references public.ps_delivery_round_patients(id) on delete set null,
  constraint ps_shop_orders_fulfilment_method_check
    check (fulfilment_method in ('collection', 'delivery')),
  constraint ps_shop_orders_status_check
    check (status in ('new', 'confirmed', 'ready', 'out_for_delivery', 'collected', 'completed', 'cancelled'))
);

create table if not exists public.ps_shop_order_items (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  product_id uuid,
  product_name text not null,
  unit_price_pence integer not null,
  quantity integer not null,
  line_total_pence integer not null,
  created_at timestamptz not null default now(),
  constraint ps_shop_order_items_pkey primary key (id),
  constraint ps_shop_order_items_order_id_fkey foreign key (order_id)
    references public.ps_shop_orders(id) on delete cascade,
  constraint ps_shop_order_items_product_id_fkey foreign key (product_id)
    references public.ps_shop_products(id) on delete set null,
  constraint ps_shop_order_items_quantity_check check (quantity > 0)
);

create table if not exists public.ps_shop_questionnaire_responses (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  product_id uuid,
  questionnaire_id uuid,
  answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint ps_shop_questionnaire_responses_pkey primary key (id),
  constraint ps_shop_questionnaire_responses_order_id_fkey foreign key (order_id)
    references public.ps_shop_orders(id) on delete cascade,
  constraint ps_shop_questionnaire_responses_product_id_fkey foreign key (product_id)
    references public.ps_shop_products(id) on delete set null,
  constraint ps_shop_questionnaire_responses_questionnaire_id_fkey foreign key (questionnaire_id)
    references public.ps_shop_questionnaires(id) on delete set null
);

create index if not exists idx_shop_products_org on public.ps_shop_products (org_id);
create index if not exists idx_shop_products_category on public.ps_shop_products (category_id);
create index if not exists idx_shop_questionnaires_org on public.ps_shop_questionnaires (org_id);
create index if not exists idx_shop_orders_org on public.ps_shop_orders (org_id);
create index if not exists idx_shop_orders_patient on public.ps_shop_orders (patient_id);
create index if not exists idx_shop_order_items_order on public.ps_shop_order_items (order_id);
create index if not exists idx_shop_q_responses_order on public.ps_shop_questionnaire_responses (order_id);

alter table public.ps_shop_categories enable row level security;
alter table public.ps_shop_settings enable row level security;
alter table public.ps_shop_questionnaires enable row level security;
alter table public.ps_shop_products enable row level security;
alter table public.ps_shop_orders enable row level security;
alter table public.ps_shop_order_items enable row level security;
alter table public.ps_shop_questionnaire_responses enable row level security;

-- ---------------------------------------------------------------- policies

drop policy if exists public_read_shop_categories on public.ps_shop_categories;
create policy public_read_shop_categories on public.ps_shop_categories
  for select using (true);

drop policy if exists anon_read_enabled_shop_settings on public.ps_shop_settings;
create policy anon_read_enabled_shop_settings on public.ps_shop_settings
  for select using (
    shop_enabled = true
    and org_id in (select id from public.ps_organisations where is_public = true)
  );
drop policy if exists org_members_crud_shop_settings on public.ps_shop_settings;
create policy org_members_crud_shop_settings on public.ps_shop_settings
  for all using (org_id in (select public.ps_get_user_org_ids()))
  with check (org_id in (select public.ps_get_user_org_ids()));

drop policy if exists anon_read_active_shop_questionnaires on public.ps_shop_questionnaires;
create policy anon_read_active_shop_questionnaires on public.ps_shop_questionnaires
  for select using (
    is_active = true and (
      org_id is null or org_id in (
        select s.org_id from public.ps_shop_settings s
        join public.ps_organisations o on o.id = s.org_id
        where s.shop_enabled = true and o.is_public = true
      )
    )
  );
drop policy if exists org_read_shop_questionnaires on public.ps_shop_questionnaires;
create policy org_read_shop_questionnaires on public.ps_shop_questionnaires
  for select using (org_id is null or org_id in (select public.ps_get_user_org_ids()));
drop policy if exists org_insert_shop_questionnaires on public.ps_shop_questionnaires;
create policy org_insert_shop_questionnaires on public.ps_shop_questionnaires
  for insert with check (org_id in (select public.ps_get_user_org_ids()));
drop policy if exists org_update_shop_questionnaires on public.ps_shop_questionnaires;
create policy org_update_shop_questionnaires on public.ps_shop_questionnaires
  for update using (org_id in (select public.ps_get_user_org_ids()))
  with check (org_id in (select public.ps_get_user_org_ids()));
drop policy if exists org_delete_shop_questionnaires on public.ps_shop_questionnaires;
create policy org_delete_shop_questionnaires on public.ps_shop_questionnaires
  for delete using (org_id in (select public.ps_get_user_org_ids()));

drop policy if exists anon_read_active_shop_products on public.ps_shop_products;
create policy anon_read_active_shop_products on public.ps_shop_products
  for select using (
    is_active = true and org_id in (
      select s.org_id from public.ps_shop_settings s
      join public.ps_organisations o on o.id = s.org_id
      where s.shop_enabled = true and o.is_public = true
    )
  );
drop policy if exists org_members_crud_shop_products on public.ps_shop_products;
create policy org_members_crud_shop_products on public.ps_shop_products
  for all using (org_id in (select public.ps_get_user_org_ids()))
  with check (org_id in (select public.ps_get_user_org_ids()));

-- Orders and order items: the next migration replaces the org-wide "all"
-- policies with read + update only.
drop policy if exists patients_read_own_shop_orders on public.ps_shop_orders;
create policy patients_read_own_shop_orders on public.ps_shop_orders
  for select using (
    patient_id in (select id from public.ps_patients where auth_user_id = auth.uid())
  );

drop policy if exists patients_read_own_shop_order_items on public.ps_shop_order_items;
create policy patients_read_own_shop_order_items on public.ps_shop_order_items
  for select using (
    order_id in (
      select o.id from public.ps_shop_orders o
      join public.ps_patients p on p.id = o.patient_id
      where p.auth_user_id = auth.uid()
    )
  );

drop policy if exists org_read_shop_q_responses on public.ps_shop_questionnaire_responses;
create policy org_read_shop_q_responses on public.ps_shop_questionnaire_responses
  for select using (
    order_id in (
      select id from public.ps_shop_orders
      where org_id in (select public.ps_get_user_org_ids())
    )
  );
drop policy if exists patients_read_own_shop_q_responses on public.ps_shop_questionnaire_responses;
create policy patients_read_own_shop_q_responses on public.ps_shop_questionnaire_responses
  for select using (
    order_id in (
      select o.id from public.ps_shop_orders o
      join public.ps_patients p on p.id = o.patient_id
      where p.auth_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------- functions

create or replace function public.ps_shop_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public.ps_shop_list_orgs(
  p_lat double precision default null,
  p_lng double precision default null
)
returns table(
  org_id uuid, name text, slug text, address jsonb, public_logo_url text,
  public_description text, delivery_enabled boolean, delivery_radius_km numeric,
  delivery_fee_pence integer, free_delivery_threshold_pence integer,
  collection_enabled boolean, distance_km double precision
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
    end as distance_km
  from ps_shop_settings s
  join ps_organisations o on o.id = s.org_id
  where s.shop_enabled = true and o.is_public = true
  order by distance_km asc nulls last, o.name;
$function$;
grant execute on function public.ps_shop_list_orgs(double precision, double precision) to anon, authenticated;

create or replace function public.ps_shop_sync_order_from_stop()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'delivered' then
    update ps_shop_orders
    set status = 'completed', updated_at = now()
    where delivery_round_patient_id = new.id
      and status not in ('completed','cancelled');

  elsif new.status = 'failed' then
    update ps_shop_orders
    set status = 'ready',
        org_notes = trim(both e'\n' from coalesce(org_notes, '') || e'\n' ||
          '🚚 Delivery attempt failed' || coalesce(': ' || new.failure_reason, '') || ' (' || to_char(now(), 'DD Mon HH24:MI') || ')'),
        updated_at = now()
    where delivery_round_patient_id = new.id
      and status not in ('completed','cancelled');

  elsif new.status = 'moved_to_round' and new.moved_to_round_patient_id is not null then
    -- Redelivery: re-point the order at the new stop + its round
    update ps_shop_orders o
    set delivery_round_patient_id = new.moved_to_round_patient_id,
        delivery_round_id = rp.round_id,
        status = case when o.status in ('completed','cancelled') then o.status else 'ready' end,
        updated_at = now()
    from ps_delivery_round_patients rp
    where rp.id = new.moved_to_round_patient_id
      and o.delivery_round_patient_id = new.id;
  end if;

  return new;
end;
$function$;

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
      and status in ('new','confirmed','ready');
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------- triggers

drop trigger if exists trg_shop_settings_touch on public.ps_shop_settings;
create trigger trg_shop_settings_touch before update on public.ps_shop_settings
  for each row execute function public.ps_shop_touch_updated_at();
drop trigger if exists trg_shop_questionnaires_touch on public.ps_shop_questionnaires;
create trigger trg_shop_questionnaires_touch before update on public.ps_shop_questionnaires
  for each row execute function public.ps_shop_touch_updated_at();
drop trigger if exists trg_shop_products_touch on public.ps_shop_products;
create trigger trg_shop_products_touch before update on public.ps_shop_products
  for each row execute function public.ps_shop_touch_updated_at();
drop trigger if exists trg_shop_orders_touch on public.ps_shop_orders;
create trigger trg_shop_orders_touch before update on public.ps_shop_orders
  for each row execute function public.ps_shop_touch_updated_at();

drop trigger if exists trg_shop_sync_order_from_stop on public.ps_delivery_round_patients;
create trigger trg_shop_sync_order_from_stop after update of status on public.ps_delivery_round_patients
  for each row execute function public.ps_shop_sync_order_from_stop();
drop trigger if exists trg_shop_sync_order_from_round on public.ps_delivery_rounds;
create trigger trg_shop_sync_order_from_round after update of status on public.ps_delivery_rounds
  for each row execute function public.ps_shop_sync_order_from_round();

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('shop-products', 'shop-products', true)
on conflict (id) do nothing;

drop policy if exists shop_products_public_read on storage.objects;
create policy shop_products_public_read on storage.objects
  for select using (bucket_id = 'shop-products');
drop policy if exists shop_products_org_upload on storage.objects;
create policy shop_products_org_upload on storage.objects
  for insert with check (
    bucket_id = 'shop-products'
    and (storage.foldername(name))[1] in (select public.ps_get_user_org_ids()::text)
  );
drop policy if exists shop_products_org_update on storage.objects;
create policy shop_products_org_update on storage.objects
  for update using (
    bucket_id = 'shop-products'
    and (storage.foldername(name))[1] in (select public.ps_get_user_org_ids()::text)
  );
drop policy if exists shop_products_org_delete on storage.objects;
create policy shop_products_org_delete on storage.objects
  for delete using (
    bucket_id = 'shop-products'
    and (storage.foldername(name))[1] in (select public.ps_get_user_org_ids()::text)
  );

-- ---------------------------------------------------------------- seed data

insert into public.ps_shop_categories (id, name, slug, parent_id, sort_order) values
  ('ab938b5d-0ef4-4c9d-9809-3f32e64f0d10', 'Medicines & Treatments', 'medicines-treatments', null, 1),
  ('6f5cbace-a3b6-4ce9-a4e8-7aa0b05a8f0c', 'Vitamins & Supplements', 'vitamins-supplements', null, 2),
  ('b0907f7b-5182-4917-894c-038ddc728f60', 'Skin Care', 'skin-care', null, 3),
  ('acd5b6da-8396-458c-8c8e-48b4d6040403', 'Baby & Child', 'baby-child', null, 4),
  ('58065f86-02d4-457d-a88a-2e226bf34ba9', 'Sexual Health', 'sexual-health', null, 5),
  ('68ecf00b-13a2-4f1a-8b94-731534848dc8', 'First Aid', 'first-aid', null, 6),
  ('6632ff45-f145-49a5-bf43-8943bb9ce0e8', 'Toiletries & Personal Care', 'toiletries-personal-care', null, 7),
  ('10b9da8d-1ba5-4f4b-9faf-420d856de395', 'Mobility & Daily Living Aids', 'mobility-daily-living', null, 8),
  ('1257474c-f8af-4cd8-a25f-81a8ea9546f5', 'Health Devices & Tests', 'health-devices-tests', null, 9),
  ('6601bf4d-1c57-4759-a29e-0641d057ec96', 'Uncategorised', 'uncategorised', null, 99),
  ('0d0e0cad-bcca-4e36-8d28-70ae8033d091', 'Emergency Contraception', 'emergency-contraception', '58065f86-02d4-457d-a88a-2e226bf34ba9', 1),
  ('8751ab63-6b07-4dad-aef9-6b64eac54586', 'Pain Relief', 'pain-relief', 'ab938b5d-0ef4-4c9d-9809-3f32e64f0d10', 1),
  ('1f387cf4-e72d-46d9-9dae-4a44ebbe7db5', 'Cold & Flu', 'cold-flu', 'ab938b5d-0ef4-4c9d-9809-3f32e64f0d10', 2),
  ('35f8dae6-68d1-4f47-b220-729421e7e186', 'Erectile Dysfunction', 'erectile-dysfunction', '58065f86-02d4-457d-a88a-2e226bf34ba9', 2),
  ('6da8ff79-0e53-4451-bf61-7cd88bcae609', 'Allergy & Hayfever', 'allergy-hayfever', 'ab938b5d-0ef4-4c9d-9809-3f32e64f0d10', 3),
  ('02e93270-cc9c-4043-a3b4-e413e9b014df', 'Digestive Health', 'digestive-health', 'ab938b5d-0ef4-4c9d-9809-3f32e64f0d10', 4)
on conflict do nothing;

insert into public.ps_shop_questionnaires (id, org_id, name, description, questions, is_active) values
  ('8136b534-70f5-44bc-bf77-430dfc124e9c', null, 'Emergency Contraception (EHC) Suitability', 'Standard suitability questions for the morning-after pill. The pharmacist reviews answers before the sale is completed.', '[{"id": "q1", "type": "text", "label": "What is your date of birth?", "required": true}, {"id": "q2", "type": "text", "label": "When did unprotected sex take place?", "required": true}, {"id": "q3", "type": "yesno", "label": "Was this within the last 72 hours?", "required": true}, {"id": "q4", "type": "yesno", "label": "Have you taken emergency contraception before in this cycle?", "required": true}, {"id": "q5", "type": "text", "label": "Are you currently taking any regular medication?", "required": true}, {"id": "q6", "type": "text", "label": "Do you have any medical conditions (e.g. severe asthma, liver problems)?", "required": false}, {"id": "q7", "type": "yesno", "label": "Is this purchase for your own use?", "required": true}]'::jsonb, true),
  ('a863a51c-cc2f-4922-a246-9960cd0f2262', null, 'General P-Medicine Suitability', 'A general screening form suitable for most pharmacy-only medicines.', '[{"id": "q1", "type": "choice", "label": "Who is this medicine for?", "options": ["Myself", "Someone else"], "required": true}, {"id": "q2", "type": "text", "label": "What symptoms are you treating?", "required": true}, {"id": "q3", "type": "text", "label": "How long have you had these symptoms?", "required": true}, {"id": "q4", "type": "text", "label": "Are you taking any other medicines (including herbal remedies)?", "required": true}, {"id": "q5", "type": "text", "label": "Do you have any medical conditions or allergies?", "required": true}, {"id": "q6", "type": "choice", "label": "Are you pregnant or breastfeeding?", "options": ["No", "Pregnant", "Breastfeeding", "Not applicable"], "required": true}]'::jsonb, true),
  ('eb3503ad-32e4-4083-a904-f8d5d15465df', null, 'Erectile Dysfunction (Sildenafil) Suitability', 'Suitability screening for over-the-counter sildenafil. The pharmacist reviews answers before the sale is completed.', '[{"id": "q1", "type": "text", "label": "What is your date of birth?", "required": true}, {"id": "q2", "type": "yesno", "label": "Do you have any heart problems or have you had a heart attack or stroke?", "required": true}, {"id": "q3", "type": "yesno", "label": "Do you take nitrate medicines (e.g. GTN spray, isosorbide mononitrate)?", "required": true}, {"id": "q4", "type": "yesno", "label": "Do you have low blood pressure or uncontrolled high blood pressure?", "required": true}, {"id": "q5", "type": "yesno", "label": "Do you have severe liver or kidney problems?", "required": true}, {"id": "q6", "type": "text", "label": "List any other medication you take regularly", "required": false}, {"id": "q7", "type": "yesno", "label": "Have you used sildenafil before?", "required": true}, {"id": "q8", "type": "yesno", "label": "Is this purchase for your own use?", "required": true}]'::jsonb, true)
on conflict do nothing;
