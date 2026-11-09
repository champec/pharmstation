-- ============================================================
-- Pharmacy Network: production completeness (9 Nov 2026)
--
-- 1. One PharmStation account per NHS pharmacy. Without this, any verified
--    org could link itself to a pharmacy someone else already linked and
--    receive that pharmacy's network messages.
-- 2. Linking a pharmacy fills the org's location from the NHS record when
--    it has none, so "nearby pharmacies" works without a separate setup.
-- 3. ps_network_search (replaces search_network_pharmacies in the apps): falls back to the linked pharmacy's
--    location, only counts verified orgs as on the network, and reports
--    whether each pharmacy accepts urgent text alerts.
-- ============================================================

create unique index if not exists ps_org_pharmacy_link_pharmacy_id_key
  on public.ps_org_pharmacy_link (pharmacy_id);

create or replace function public.ps_org_pharmacy_link_fill_location()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update ps_organisations o
     set geolocation = ph.location
    from pharmacies ph
   where o.id = NEW.org_id
     and ph.id = NEW.pharmacy_id
     and o.geolocation is null
     and ph.location is not null;
  return NEW;
end;
$$;

create or replace trigger trg_ps_org_pharmacy_link_fill_location
  after insert or update of pharmacy_id on public.ps_org_pharmacy_link
  for each row execute function public.ps_org_pharmacy_link_fill_location();

-- New name rather than replacing search_network_pharmacies, because the
-- result columns change (accepts_sms_pings). The old function is left for
-- any client still on an older build.
create or replace function public.ps_network_search(
  p_org_id uuid, p_search text default '', p_radius_km double precision default 10.0,
  p_only_platform boolean default false, p_limit integer default 50
)
returns table(pharmacy_id integer, ods_code text, organisation_name text, address1 text, address2 text,
              city text, postcode text, latitude numeric, longitude numeric, distance_km double precision,
              is_on_platform boolean, linked_org_id uuid, linked_org_name text, accepts_sms_pings boolean)
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_location geography;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not exists (select 1 from ps_get_user_org_ids() g where g = p_org_id)
     and not exists (select 1 from ps_organisations where id = p_org_id and auth_user_id = auth.uid()) then
    raise exception 'You do not have access to this organisation';
  end if;

  select coalesce(o.geolocation, ph.location) into v_location
    from ps_organisations o
    left join ps_org_pharmacy_link l on l.org_id = o.id
    left join pharmacies ph on ph.id = l.pharmacy_id
   where o.id = p_org_id;

  return query
  select
    ph.id, ph.ods_code, ph.organisation_name, ph.address1, ph.address2, ph.city, ph.postcode,
    ph.latitude, ph.longitude,
    case when v_location is not null and ph.location is not null
         then (ST_Distance(ph.location, v_location) / 1000.0)::float end,
    (net.org_id is not null), net.org_id, net.name,
    coalesce(net.sms_pings_enabled, false)
  from pharmacies ph
  left join lateral (
    select opl.org_id, pso.name, ns.sms_pings_enabled
      from ps_org_pharmacy_link opl
      join ps_organisations pso on pso.id = opl.org_id
      left join ps_network_settings ns on ns.org_id = opl.org_id
     where opl.pharmacy_id = ph.id
       and coalesce(ns.network_enabled, true)
       and ps_org_is_verified(opl.org_id)
     limit 1
  ) net on true
  where (net.org_id is null or net.org_id <> p_org_id)
    and (v_search is null
         or ph.organisation_name ilike '%' || v_search || '%'
         or ph.postcode ilike '%' || v_search || '%'
         or replace(ph.postcode, ' ', '') ilike '%' || replace(v_search, ' ', '') || '%'
         or ph.ods_code ilike '%' || v_search || '%'
         or ph.city ilike '%' || v_search || '%'
         or net.name ilike '%' || v_search || '%')
    and (v_search is not null or v_location is null or ST_DWithin(ph.location, v_location, p_radius_km * 1000))
    and (not p_only_platform or net.org_id is not null)
  order by (net.org_id is null),
           case when v_location is not null and ph.location is not null then ST_Distance(ph.location, v_location) end nulls last,
           ph.organisation_name
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;

revoke all on function public.ps_network_search(uuid, text, double precision, boolean, integer) from public, anon;
grant execute on function public.ps_network_search(uuid, text, double precision, boolean, integer) to authenticated, service_role;
