-- Public SEO pages: readable URLs for shop products and bookable services,
-- plus one public pharmacy directory for the patient hub and /book search.
--
--   /shop/<pharmacy>/<product-slug>   e.g. /shop/test-pharmacy/ibuprofen-200mg-tablets-16
--   /book/<pharmacy>/<service-slug>   e.g. /book/test-pharmacy/weight-management
--
-- Slugs are made once from the name and then kept, so a rename never breaks a link
-- that has been indexed or used in an ad. Old UUID links keep working in the web app.

-- 1. Slug helper -------------------------------------------------------------
create or replace function public.ps_slugify(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    trim(both '-' from regexp_replace(
      regexp_replace(lower(coalesce(p_text, '')), '&', ' and ', 'g'),
      '[^a-z0-9]+', '-', 'g'
    )),
    ''
  );
$$;

-- 2. Columns -----------------------------------------------------------------
alter table public.ps_shop_products add column if not exists slug text;
alter table public.ps_services add column if not exists slug text;

-- 3. Unique slug per pharmacy, set on insert (or when missing) ---------------
-- Words the web app uses as fixed path segments under /shop/:org and /book/:org.
create or replace function public.ps_set_public_slug()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_base text;
  v_candidate text;
  v_n int := 1;
  v_exists boolean;
begin
  -- A slug that was given is kept (normalised); otherwise one is made from the name.
  -- Same format as pharmacy slugs: ^[a-z0-9]+(-[a-z0-9]+)*$, at most 60 characters.
  v_base := public.ps_slugify(coalesce(nullif(new.slug, ''), new.name));
  v_base := trim(both '-' from left(coalesce(v_base, 'item'), 60));
  if length(v_base) < 3 then
    v_base := v_base || '-item';
  end if;
  -- Words the web app uses as fixed path segments under /shop/:org and /book/:org.
  if v_base in ('payment-result', 'confirm', 'order', 'terms') then
    v_base := v_base || '-1';
  end if;
  v_candidate := v_base;

  loop
    execute format('select exists(select 1 from %I.%I where org_id = $1 and slug = $2 and id <> $3)', tg_table_schema, tg_table_name)
      into v_exists using new.org_id, v_candidate, new.id;
    exit when not v_exists;
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  end loop;

  new.slug := v_candidate;
  return new;
end;
$$;

drop trigger if exists ps_shop_products_slug on public.ps_shop_products;
create trigger ps_shop_products_slug
  before insert or update of slug on public.ps_shop_products
  for each row execute function public.ps_set_public_slug();

drop trigger if exists ps_services_slug on public.ps_services;
create trigger ps_services_slug
  before insert or update of slug on public.ps_services
  for each row execute function public.ps_set_public_slug();

-- 4. Backfill existing rows (oldest first keeps the shortest slug) -------------
do $$
declare r record;
begin
  for r in select id from public.ps_shop_products where slug is null order by created_at, id loop
    update public.ps_shop_products set slug = null where id = r.id; -- fires the trigger with slug null
  end loop;
  for r in select id from public.ps_services where slug is null order by created_at, id loop
    update public.ps_services set slug = null where id = r.id;
  end loop;
end $$;

create unique index if not exists ps_shop_products_org_slug_key on public.ps_shop_products (org_id, slug);
create unique index if not exists ps_services_org_slug_key on public.ps_services (org_id, slug);

-- 5. Public pharmacy directory ------------------------------------------------
-- Every public pharmacy with what a patient can do there: shop, delivery, and the
-- services bookable online (same rules as the anon_read_public_services policy).
create or replace function public.ps_public_pharmacy_directory(
  p_lat double precision default null,
  p_lng double precision default null
)
returns table(
  org_id uuid,
  name text,
  slug text,
  address jsonb,
  public_logo_url text,
  public_description text,
  distance_km double precision,
  latitude double precision,
  longitude double precision,
  shop_enabled boolean,
  delivery_enabled boolean,
  product_count integer,
  services jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.name,
    o.slug,
    o.address,
    o.public_logo_url,
    o.public_description,
    case
      when p_lat is not null and p_lng is not null and o.geolocation is not null
      then st_distance(o.geolocation, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0
    end as distance_km,
    case when o.geolocation is not null then st_y(o.geolocation::geometry) end,
    case when o.geolocation is not null then st_x(o.geolocation::geometry) end,
    coalesce(s.shop_enabled, false),
    coalesce(s.shop_enabled, false) and coalesce(s.delivery_enabled, false),
    coalesce((
      select count(*)::int from ps_shop_products p
      where p.org_id = o.id and p.is_active and coalesce(s.shop_enabled, false)
    ), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'slug', sv.slug, 'name', sv.name,
               'price_pence', case when sv.is_chargeable then sv.price_pence end,
               'duration_minutes', sv.duration_minutes, 'is_video', sv.is_video
             ) order by sv.name)
      from ps_services sv
      where sv.org_id = o.id and sv.is_public and sv.is_active and sv.archived_at is null
        and ((not sv.is_chargeable) or coalesce(sv.price_pence, 0) <= 0 or ps_org_can_take_payments(o.id))
    ), '[]'::jsonb)
  from ps_organisations o
  left join ps_shop_settings s on s.org_id = o.id
  where o.is_public = true and o.is_active = true
  order by 7 asc nulls last, o.name;
$$;

revoke all on function public.ps_public_pharmacy_directory(double precision, double precision) from public;
grant execute on function public.ps_public_pharmacy_directory(double precision, double precision) to anon, authenticated;
grant execute on function public.ps_slugify(text) to anon, authenticated;
