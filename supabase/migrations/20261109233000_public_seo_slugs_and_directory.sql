-- Public SEO pages: readable URLs for shop products and bookable services.
-- No new functions are exposed to anon beyond the pure ps_slugify helper; the public
-- pharmacy directory is built in the browser from the existing anon RLS reads.
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

grant execute on function public.ps_slugify(text) to anon, authenticated;
