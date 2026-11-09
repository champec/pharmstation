-- Appointments + Services: linking a completed service record to its booking
-- failed with "Completed service records cannot be changed" because the
-- records-protection trigger (20261105160200) locks completed deliveries.
-- The link RPC now opens the services-RPC gate for its own single-column
-- update, and refuses to move a record that is already linked elsewhere.
create or replace function public.ps_link_delivery_to_appointment(p_delivery_id uuid, p_appointment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_delivery ps_service_deliveries%rowtype;
  v_appt ps_appointments%rowtype;
begin
  select * into v_delivery from ps_service_deliveries where id = p_delivery_id;
  select * into v_appt from ps_appointments where id = p_appointment_id for update;
  if v_delivery.id is null or v_appt.id is null then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  if v_delivery.org_id <> v_appt.org_id
     or v_appt.org_id not in (select ps_get_user_org_ids()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_appt.status = 'cancelled' then
    raise exception 'That booking was cancelled' using errcode = 'P0001';
  end if;
  if v_delivery.appointment_id is not null and v_delivery.appointment_id <> p_appointment_id then
    raise exception 'This record is already linked to another appointment' using errcode = 'P0001';
  end if;

  if v_delivery.appointment_id is null then
    -- Only appointment_id changes; the guard trigger keeps every other
    -- column of a completed record as it was.
    perform set_config('ps.services_rpc', 'on', true);
    update ps_service_deliveries set appointment_id = p_appointment_id where id = p_delivery_id;
    perform set_config('ps.services_rpc', '', true);
  end if;

  update ps_appointments set status = 'completed', updated_at = now()
   where id = p_appointment_id and status in ('pending', 'confirmed', 'no_show');
end $$;

revoke execute on function public.ps_link_delivery_to_appointment(uuid, uuid) from public, anon;
grant execute on function public.ps_link_delivery_to_appointment(uuid, uuid) to authenticated;
