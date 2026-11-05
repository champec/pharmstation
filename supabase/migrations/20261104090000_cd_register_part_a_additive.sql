-- CD register hardening, part A (additive only).
--
-- Safe to run before the new web app is deployed: it only adds things.
-- Nothing the current app does is refused by this file.
--
--   1. 'opening_balance' becomes a valid transaction type, so an opening
--      balance is a real register line instead of a number written onto the
--      ledger.
--   2. ps_role_default_permission / ps_member_has_permission: the database's
--      copy of DEFAULT_ROLE_PERMISSIONS in packages/types/src/index.ts, so the
--      server can enforce cd_register_read / _write / _correct. Keep the two in
--      step.
--   3. ps_create_cd_register: adds a drug to the pharmacy's CD register in one
--      transaction (list entry + ledger + signed opening balance line).
--
-- Part B (20261104090100_cd_register_part_b_lockdown.sql) does the
-- enforcement and must run after the web app from the same PR is live.

begin;

-- 1. Opening balance transaction type ---------------------------------------
alter table public.ps_register_entries
  drop constraint if exists ps_register_entries_transaction_type_check;
alter table public.ps_register_entries
  add constraint ps_register_entries_transaction_type_check
  check (transaction_type = any (array[
    'receipt', 'supply', 'return_to_supplier', 'patient_return', 'disposal',
    'correction', 'transfer_in', 'transfer_out', 'balance_check', 'opening_balance'
  ]));

-- 2. Permissions -------------------------------------------------------------
-- Role defaults for the permissions the database enforces. Mirrors
-- DEFAULT_ROLE_PERMISSIONS (packages/types/src/index.ts).
create or replace function public.ps_role_default_permission(p_role text, p_permission text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce((
    case p_role
      when 'owner' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":false,"ai_scan_use":true}'
      when 'manager' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":false,"ai_scan_use":true}'
      when 'pharmacist' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":true,"ai_scan_use":true}'
      when 'technician' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":false,"ai_scan_use":true}'
      when 'locum' then '{"cd_register_read":true,"cd_register_write":true,"cd_register_correct":true,"ai_scan_use":true}'
      else '{}'
    end
  )::jsonb ->> p_permission, 'false')::boolean
$$;

-- Does the signed-in user have this permission in this pharmacy?
-- Per-member overrides in ps_organisation_members.permissions win over the
-- role default, exactly like resolvePermissions() in the app.
create or replace function public.ps_member_has_permission(p_organisation_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when jsonb_typeof(m.permissions -> p_permission) = 'boolean'
        then (m.permissions ->> p_permission)::boolean
      else ps_role_default_permission(m.role, p_permission)
    end
    from ps_organisation_members m
    where m.organisation_id = p_organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
    limit 1
  ), false)
$$;

revoke all on function public.ps_role_default_permission(text, text) from public, anon;
revoke all on function public.ps_member_has_permission(uuid, text) from public, anon;
grant execute on function public.ps_role_default_permission(text, text) to authenticated, service_role;
grant execute on function public.ps_member_has_permission(uuid, text) to authenticated, service_role;

-- 3. Add a drug to the CD register --------------------------------------------
-- Creates (or reuses) the list entry and the ledger, and, when the ledger has
-- no entries yet, writes a signed "Opening balance" line through
-- ps_make_register_entry so it is numbered, audited and immutable.
create or replace function public.ps_create_cd_register(
  p_organisation_id uuid,
  p_drug_id uuid,
  p_opening_balance numeric default 0,
  p_reason text default null
)
returns public.ps_register_ledgers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drug cdr_drugs_unique;
  v_ledger ps_register_ledgers;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not ps_member_has_permission(p_organisation_id, 'cd_register_write') then
    raise exception 'You do not have permission to add CD registers' using errcode = '42501';
  end if;
  if p_opening_balance is null or p_opening_balance < 0 then
    raise exception 'Opening balance must be 0 or more';
  end if;

  select * into v_drug from cdr_drugs_unique where id = p_drug_id;
  if not found then
    raise exception 'Drug not found: %', p_drug_id;
  end if;

  insert into ps_subscribed_registers (
    organisation_id, drug_id, drug_brand, drug_form, drug_strength, drug_class, drug_type, created_by
  ) values (
    p_organisation_id, v_drug.id, coalesce(v_drug.drug_brand, ''), coalesce(v_drug.drug_form, ''),
    coalesce(v_drug.drug_strength, ''), coalesce(v_drug.drug_class, ''), coalesce(v_drug.drug_type, ''), auth.uid()
  )
  on conflict (organisation_id, drug_id) do nothing;

  select * into v_ledger from ps_register_ledgers
  where organisation_id = p_organisation_id and register_type = 'CD' and drug_id = p_drug_id
  for update;

  if not found then
    insert into ps_register_ledgers (
      organisation_id, register_type, drug_id, drug_name, drug_form, drug_strength, drug_class,
      current_balance, entry_count, lock_version, created_by
    ) values (
      p_organisation_id, 'CD', v_drug.id, v_drug.drug_brand, v_drug.drug_form, v_drug.drug_strength,
      v_drug.drug_class, 0, 0, 0, auth.uid()
    )
    returning * into v_ledger;
  end if;

  if v_ledger.entry_count = 0 then
    v_note := 'Opening balance' || coalesce(' — ' || nullif(trim(p_reason), ''), '');
    perform ps_make_register_entry(
      p_ledger_id => v_ledger.id,
      p_register_type => 'CD',
      p_entry_type => 'normal',
      p_date_of_transaction => (now() at time zone 'Europe/London')::date,
      p_notes => v_note,
      p_source => 'manual',
      p_expected_lock_version => v_ledger.lock_version,
      p_transaction_type => 'opening_balance',
      p_quantity_received => p_opening_balance
    );
    select * into v_ledger from ps_register_ledgers where id = v_ledger.id;
  end if;

  return v_ledger;
end;
$$;

revoke all on function public.ps_create_cd_register(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.ps_create_cd_register(uuid, uuid, numeric, text) to authenticated, service_role;

commit;
