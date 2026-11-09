-- Deliveries: list the members who can drive, for the "assign driver" pickers
-- and the driver names on the board. Staff can only read their own
-- ps_organisation_members row, so the old client query only ever returned the
-- caller. Returns just id + name, and only to members of that pharmacy.
create or replace function public.ps_delivery_list_drivers(p_org_id uuid)
returns table (member_id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, coalesce(nullif(trim(p.full_name), ''), 'Name not recorded'), m.role::text
  from ps_organisation_members m
  left join ps_user_profiles p on p.id = m.user_id
  where m.organisation_id = p_org_id
    and m.status = 'active'
    and p_org_id in (select public.ps_get_user_org_ids())
    and case
          when jsonb_typeof(m.permissions -> 'delivery_drive') = 'boolean'
            then (m.permissions ->> 'delivery_drive')::boolean
          else public.ps_role_default_permission(m.role::text, 'delivery_drive')
        end
  order by 2
$$;

revoke all on function public.ps_delivery_list_drivers(uuid) from public, anon;
grant execute on function public.ps_delivery_list_drivers(uuid) to authenticated;
