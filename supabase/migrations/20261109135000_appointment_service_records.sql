-- ============================================================
-- Appointments: link a booking to the service record made for it.
-- Staff press "Start service" on an appointment, deliver the service as
-- usual, and on completion the record is linked and the booking marked
-- completed. The appointment page then shows "View service record".
-- ============================================================

alter table public.ps_service_deliveries
  add column if not exists appointment_id uuid references public.ps_appointments(id) on delete set null;

create index if not exists ps_service_deliveries_appointment_idx
  on public.ps_service_deliveries (appointment_id) where appointment_id is not null;

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

  update ps_service_deliveries set appointment_id = p_appointment_id where id = p_delivery_id;
  update ps_appointments set status = 'completed', updated_at = now()
   where id = p_appointment_id and status in ('pending', 'confirmed', 'no_show');
end $$;

revoke execute on function public.ps_link_delivery_to_appointment(uuid, uuid) from public, anon;
grant execute on function public.ps_link_delivery_to_appointment(uuid, uuid) to authenticated;
