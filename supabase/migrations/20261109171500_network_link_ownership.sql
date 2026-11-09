-- ============================================================
-- Network link ownership (tester issues #28, #29)
-- 1. Only owners/managers (org_settings) can link, change or unlink.
-- 2. A link is verified automatically only when the organisation's postcode
--    or ODS code matches the NHS pharmacy record. Anything else waits for
--    platform-admin review and does not count as on the network.
-- 3. A pharmacy whose record is already claimed can dispute it (support ticket).
-- No drop statements on purpose.
-- ============================================================

create or replace function public.ps_normalise_postcode(p text)
returns text language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')), '') $$;

create or replace function public.ps_org_pharmacy_link_matches(p_org_id uuid, p_pharmacy_id integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from ps_organisations o, pharmacies ph
     where o.id = p_org_id and ph.id = p_pharmacy_id
       and ((ps_normalise_postcode(o.address ->> 'postcode') = ps_normalise_postcode(ph.postcode))
         or (nullif(upper(trim(o.ods_code)), '') = upper(trim(ph.ods_code))))
  )
$$;

create or replace function public.ps_org_pharmacy_link_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if TG_OP = 'INSERT' or NEW.pharmacy_id is distinct from OLD.pharmacy_id then
    -- New claim: verified only if the details match; otherwise admin review.
    NEW.is_verified := ps_org_pharmacy_link_matches(NEW.org_id, NEW.pharmacy_id);
    NEW.linked_at := now();
  elsif NEW.is_verified is distinct from OLD.is_verified
        and coalesce(auth.role(), '') in ('authenticated', 'anon')
        and not ps_is_platform_admin() then
    -- Clients cannot approve their own claim.
    NEW.is_verified := OLD.is_verified;
  end if;
  return NEW;
end;
$$;

create or replace trigger trg_ps_org_pharmacy_link_guard
  before insert or update on public.ps_org_pharmacy_link
  for each row execute function public.ps_org_pharmacy_link_guard();

-- Owners and managers only (aal2, as for every org_settings change).
create policy netlink_manager_insert on public.ps_org_pharmacy_link as restrictive
  for insert to authenticated with check (ps_member_has_permission(org_id, 'org_settings') or ps_is_platform_admin());
create policy netlink_manager_update on public.ps_org_pharmacy_link as restrictive
  for update to authenticated using (ps_member_has_permission(org_id, 'org_settings') or ps_is_platform_admin());
create policy netlink_manager_delete on public.ps_org_pharmacy_link as restrictive
  for delete to authenticated using (ps_member_has_permission(org_id, 'org_settings') or ps_is_platform_admin());

-- Re-check every existing link with the new rule.
update public.ps_org_pharmacy_link l
   set is_verified = ps_org_pharmacy_link_matches(l.org_id, l.pharmacy_id);

-- New conversations need a verified link on both sides.
create or replace function public.ps_network_can_send(p_from uuid, p_to uuid, p_thread uuid, p_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $function$
begin
  if p_from is null or p_to is null or p_from = p_to then
    return false;
  end if;

  if p_thread is distinct from p_id then
    -- A reply: the thread must already exist between these two pharmacies.
    return exists (
      select 1 from ps_network_messages
       where thread_id = p_thread
         and ((from_org_id = p_from and to_org_id = p_to)
           or (from_org_id = p_to and to_org_id = p_from))
    );
  end if;

  return exists (select 1 from ps_org_pharmacy_link where org_id = p_from and is_verified)
     and exists (select 1 from ps_org_pharmacy_link where org_id = p_to and is_verified)
     and coalesce((select network_enabled from ps_network_settings where org_id = p_to), true);
end;
$function$;

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
       and opl.is_verified
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

-- Platform admin review of pending links.
create or replace function public.ps_admin_list_network_links(p_pending_only boolean default true)
returns table(org_id uuid, org_name text, org_postcode text, org_gphc text, org_verification text,
              pharmacy_id integer, pharmacy_name text, pharmacy_ods text, pharmacy_postcode text,
              pharmacy_city text, is_verified boolean, linked_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not ps_is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;
  return query
  select o.id, o.name, o.address ->> 'postcode', o.gphc_premises_number::text, o.verification_status::text,
         ph.id, ph.organisation_name, ph.ods_code, ph.postcode, ph.city, l.is_verified, l.linked_at
    from ps_org_pharmacy_link l
    join ps_organisations o on o.id = l.org_id
    join pharmacies ph on ph.id = l.pharmacy_id
   where not p_pending_only or not l.is_verified
   order by l.is_verified, l.linked_at desc;
end;
$$;

create or replace function public.ps_admin_review_network_link(p_org_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not ps_is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;
  if p_approve then
    update ps_org_pharmacy_link set is_verified = true where org_id = p_org_id;
  else
    delete from ps_org_pharmacy_link where org_id = p_org_id;
  end if;
end;
$$;

-- "This is our pharmacy": raises a support ticket for the platform team.
create or replace function public.ps_network_dispute_link(p_org_id uuid, p_pharmacy_id integer, p_message text default '')
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_ref text := 'NET-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  v_email text;
  v_org text;
  v_ph record;
begin
  if not exists (select 1 from ps_get_user_org_ids() g where g = p_org_id) then
    raise exception 'You do not have access to this organisation' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  select name into v_org from ps_organisations where id = p_org_id;
  select ph.organisation_name, ph.ods_code, ph.postcode, o.name as holder
    into v_ph
    from pharmacies ph
    left join ps_org_pharmacy_link l on l.pharmacy_id = ph.id
    left join ps_organisations o on o.id = l.org_id
   where ph.id = p_pharmacy_id;
  if not found then
    raise exception 'Pharmacy not found';
  end if;

  insert into ps_support_tickets (reference, source, topic, name, email, organisation_name, message, org_id, user_id)
  values (v_ref, 'app', 'other', left(coalesce(v_org, 'PharmStation user'), 120), coalesce(v_email, 'unknown@pharmstation.co.uk'),
          left(v_org, 200),
          left(format(E'Pharmacy Network link dispute.\n%s says it is the real %s (ODS %s, %s), which is currently linked to %s.\n\n%s',
                      v_org, v_ph.organisation_name, v_ph.ods_code, v_ph.postcode, coalesce(v_ph.holder, 'nobody'),
                      coalesce(nullif(trim(p_message), ''), '(no message)')), 5000),
          p_org_id, auth.uid());
  return v_ref;
end;
$$;

revoke all on function public.ps_admin_list_network_links(boolean) from public, anon;
revoke all on function public.ps_admin_review_network_link(uuid, boolean) from public, anon;
revoke all on function public.ps_network_dispute_link(uuid, integer, text) from public, anon;
grant execute on function public.ps_admin_list_network_links(boolean) to authenticated;
grant execute on function public.ps_admin_review_network_link(uuid, boolean) to authenticated;
grant execute on function public.ps_network_dispute_link(uuid, integer, text) to authenticated;
