-- Network link disputes (tester #74, #77): own support topic, one open case
-- per pharmacy per organisation, and a way for the apps to show it.

alter table public.ps_support_tickets drop constraint if exists ps_support_tickets_topic_check;
alter table public.ps_support_tickets add constraint ps_support_tickets_topic_check
  check (topic = any (array['support', 'sales', 'billing', 'privacy', 'safety', 'network', 'other']));

update public.ps_support_tickets set topic = 'network' where reference like 'NET-%' and topic = 'other';

create or replace function public.ps_network_dispute_link(p_org_id uuid, p_pharmacy_id integer, p_message text default '')
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_ref text;
  v_email text;
  v_org text;
  v_ph record;
begin
  if not exists (select 1 from ps_get_user_org_ids() g where g = p_org_id) then
    raise exception 'You do not have access to this organisation' using errcode = '42501';
  end if;
  select ph.organisation_name, ph.ods_code, ph.postcode, o.name as holder
    into v_ph
    from pharmacies ph
    left join ps_org_pharmacy_link l on l.pharmacy_id = ph.id
    left join ps_organisations o on o.id = l.org_id
   where ph.id = p_pharmacy_id;
  if not found then
    raise exception 'Pharmacy not found';
  end if;

  -- One open case per pharmacy per organisation.
  select reference into v_ref
    from ps_support_tickets
   where org_id = p_org_id and topic = 'network' and status <> 'closed'
     and message like '%(ODS ' || v_ph.ods_code || ',%'
   order by created_at desc limit 1;
  if v_ref is not null then
    return v_ref;
  end if;

  v_ref := 'NET-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  select email into v_email from auth.users where id = auth.uid();
  select name into v_org from ps_organisations where id = p_org_id;

  insert into ps_support_tickets (reference, source, topic, name, email, organisation_name, message, org_id, user_id)
  values (v_ref, 'app', 'network', left(coalesce(v_org, 'PharmStation user'), 120), coalesce(v_email, 'unknown@pharmstation.co.uk'),
          left(v_org, 200),
          left(format(E'Pharmacy Network link dispute.\n%s says it is the real %s (ODS %s, %s), which is currently linked to %s.\n\n%s',
                      v_org, v_ph.organisation_name, v_ph.ods_code, v_ph.postcode, coalesce(v_ph.holder, 'nobody'),
                      coalesce(nullif(trim(p_message), ''), '(no message)')), 5000),
          p_org_id, auth.uid());
  return v_ref;
end;
$$;

-- Open dispute cases for this organisation, keyed by ODS code.
create or replace function public.ps_network_open_disputes(p_org_id uuid)
returns table(ods_code text, reference text)
language sql stable security definer set search_path = public
as $$
  select distinct on (substring(t.message from '\(ODS ([^,]+),'))
         substring(t.message from '\(ODS ([^,]+),'), t.reference
    from ps_support_tickets t
   where t.org_id = p_org_id and t.topic = 'network' and t.status <> 'closed'
     and exists (select 1 from ps_get_user_org_ids() g where g = p_org_id)
   order by substring(t.message from '\(ODS ([^,]+),'), t.created_at desc
$$;

revoke all on function public.ps_network_open_disputes(uuid) from public, anon;
grant execute on function public.ps_network_open_disputes(uuid) to authenticated;
