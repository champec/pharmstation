-- CD register hardening, part B (enforcement).
--
-- Run AFTER part A and AFTER the web app from the same PR is deployed. The
-- old app writes CD ledgers and balance checks in ways this file refuses.
--
--   1. ps_make_register_entry checks cd_register_write / cd_register_correct,
--      makes AI scan entries need a pharmacist or technician, and allows an
--      opening balance only as a ledger's first line.
--   2. Register entries: no direct writes from the app (only the function).
--      CD lines need cd_register_read to be seen.
--   3. Ledgers: app users cannot set balance / counters. CD ledgers can only
--      be created through ps_create_cd_register.
--   4. Register list: active members only. Adding needs cd_register_write.
--      Removing needs owner or manager and a zero balance, and is audited.
--   5. Balance checks: need CD permissions. A completed check can no longer
--      be changed.
--   6. The anon role loses every grant on these tables.
--
-- Rollback: supabase/rollbacks/rollback_20261104090100_cd_register_part_b_lockdown.sql
-- (also in project files: cd-register/).

begin;

-- 1. Entry function ----------------------------------------------------------
create or replace function public.ps_is_cd_scan_reviewer(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- UK practice: an AI-read prescription or invoice becomes a CD register line
  -- only after a pharmacist or a pharmacy technician has checked it.
  select exists (
    select 1
    from ps_organisation_members m
    left join ps_user_profiles p on p.id = m.user_id
    where m.organisation_id = p_organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (
        m.role in ('pharmacist', 'technician', 'locum')
        or nullif(trim(p.gphc_number), '') is not null
      )
  )
$$;
revoke all on function public.ps_is_cd_scan_reviewer(uuid) from public, anon;
grant execute on function public.ps_is_cd_scan_reviewer(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ps_make_register_entry(p_ledger_id uuid, p_register_type text, p_entry_type text DEFAULT 'normal'::text, p_date_of_transaction date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_corrects_entry_id uuid DEFAULT NULL::uuid, p_correction_reason text DEFAULT NULL::text, p_scan_image_path text DEFAULT NULL::text, p_entered_by uuid DEFAULT NULL::uuid, p_session_id uuid DEFAULT NULL::uuid, p_expected_lock_version integer DEFAULT NULL::integer, p_transaction_type text DEFAULT NULL::text, p_quantity_received numeric DEFAULT NULL::numeric, p_quantity_deducted numeric DEFAULT NULL::numeric, p_supplier_name text DEFAULT NULL::text, p_invoice_number text DEFAULT NULL::text, p_patient_name text DEFAULT NULL::text, p_patient_address text DEFAULT NULL::text, p_prescriber_name text DEFAULT NULL::text, p_prescriber_address text DEFAULT NULL::text, p_prescription_date date DEFAULT NULL::date, p_prescription_image_path text DEFAULT NULL::text, p_witness_name text DEFAULT NULL::text, p_witness_role text DEFAULT NULL::text, p_authorised_by text DEFAULT NULL::text, p_pharmacist_name text DEFAULT NULL::text, p_gphc_number text DEFAULT NULL::text, p_rp_signed_in_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rp_signed_out_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_return_patient_name text DEFAULT NULL::text, p_return_drug_name text DEFAULT NULL::text, p_return_drug_form text DEFAULT NULL::text, p_return_drug_strength text DEFAULT NULL::text, p_return_quantity numeric DEFAULT NULL::numeric, p_return_reason text DEFAULT NULL::text, p_return_received_by text DEFAULT NULL::text, p_disposal_date date DEFAULT NULL::date, p_disposal_witness text DEFAULT NULL::text, p_disposal_method text DEFAULT NULL::text, p_was_id_requested boolean DEFAULT NULL::boolean, p_was_id_provided boolean DEFAULT NULL::boolean, p_prescriber_registration text DEFAULT NULL::text, p_return_person_role text DEFAULT NULL::text, p_return_received_signature text DEFAULT NULL::text, p_disposal_pharmacist_signature text DEFAULT NULL::text, p_witness_signature text DEFAULT NULL::text, p_return_parent_entry_id uuid DEFAULT NULL::uuid, p_supplier_address text DEFAULT NULL::text, p_collector_type text DEFAULT NULL::text, p_collector_details text DEFAULT NULL::text)
 RETURNS ps_register_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ledger ps_register_ledgers;
  v_previous_entry ps_register_entries;
  v_new_balance NUMERIC;
  v_entry_number INTEGER;
  v_new_entry ps_register_entries;
  v_entered_by uuid;
BEGIN
  SELECT * INTO v_ledger FROM ps_register_ledgers WHERE id = p_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger not found: %', p_ledger_id; END IF;

  -- Only active members of the ledger's pharmacy may write to it, and the
  -- entry is always attributed to the signed-in user (service role may
  -- name the user explicitly).
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM ps_organisation_members om
      WHERE om.organisation_id = v_ledger.organisation_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Not a member of this pharmacy' USING ERRCODE = '42501';
    END IF;
    v_entered_by := auth.uid();

    -- CD permissions (role defaults + per-member overrides).
    IF v_ledger.register_type IN ('CD', 'PRIVATE_CD') THEN
      IF p_entry_type = 'correction' THEN
        IF NOT ps_member_has_permission(v_ledger.organisation_id, 'cd_register_correct') THEN
          RAISE EXCEPTION 'You do not have permission to correct CD register entries' USING ERRCODE = '42501';
        END IF;
      ELSIF NOT ps_member_has_permission(v_ledger.organisation_id, 'cd_register_write') THEN
        RAISE EXCEPTION 'You do not have permission to make CD register entries' USING ERRCODE = '42501';
      END IF;

      IF p_source = 'ai_scan' AND NOT ps_is_cd_scan_reviewer(v_ledger.organisation_id) THEN
        RAISE EXCEPTION 'Scanned entries must be reviewed and approved by a pharmacist or pharmacy technician' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF coalesce(auth.role(), '') = 'service_role' THEN
    v_entered_by := p_entered_by;
  ELSE
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_collector_type IS NOT NULL AND p_collector_type NOT IN ('patient', 'representative', 'hcp') THEN
    RAISE EXCEPTION 'Invalid collector_type: %', p_collector_type;
  END IF;

  IF v_ledger.register_type != p_register_type THEN
    RAISE EXCEPTION 'Register type mismatch. Ledger is %, entry is %', v_ledger.register_type, p_register_type;
  END IF;

  IF p_expected_lock_version IS NOT NULL AND v_ledger.lock_version != p_expected_lock_version THEN
    RAISE EXCEPTION 'CONFLICT: Ledger modified. Expected version %, got %. Refresh and retry.', p_expected_lock_version, v_ledger.lock_version;
  END IF;

  IF p_source NOT IN ('manual', 'ai_scan') THEN
    RAISE EXCEPTION 'Invalid source: %. Must be manual or ai_scan.', p_source;
  END IF;

  IF p_transaction_type = 'opening_balance' THEN
    IF v_ledger.entry_count > 0 THEN
      RAISE EXCEPTION 'An opening balance can only be the first entry in a register';
    END IF;
    IF p_quantity_deducted IS NOT NULL THEN
      RAISE EXCEPTION 'An opening balance cannot deduct stock';
    END IF;
  END IF;

  SELECT * INTO v_previous_entry FROM ps_register_entries WHERE ledger_id = p_ledger_id ORDER BY entry_number DESC LIMIT 1;

  v_entry_number := v_ledger.entry_count + 1;
  v_new_balance := NULL;

  IF p_register_type IN ('CD', 'PRIVATE_CD') THEN
    v_new_balance := v_ledger.current_balance;
    IF p_quantity_received IS NOT NULL THEN v_new_balance := v_new_balance + p_quantity_received; END IF;
    IF p_quantity_deducted IS NOT NULL THEN v_new_balance := v_new_balance - p_quantity_deducted; END IF;
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Negative balance: %. Current: %, deducting: %', v_new_balance, v_ledger.current_balance, p_quantity_deducted;
    END IF;
  END IF;

  IF p_entry_type = 'correction' THEN
    IF p_corrects_entry_id IS NULL OR p_correction_reason IS NULL THEN
      RAISE EXCEPTION 'Corrections require corrects_entry_id and correction_reason';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ps_register_entries WHERE id = p_corrects_entry_id AND ledger_id = p_ledger_id) THEN
      RAISE EXCEPTION 'Corrected entry not found on this ledger';
    END IF;
  END IF;

  IF p_register_type = 'RP' AND p_entry_type = 'normal' THEN
    IF p_pharmacist_name IS NULL OR p_gphc_number IS NULL THEN RAISE EXCEPTION 'RP entries require pharmacist_name and gphc_number'; END IF;
    IF p_rp_signed_in_at IS NULL THEN RAISE EXCEPTION 'RP entries require rp_signed_in_at'; END IF;
  END IF;

  IF p_register_type IN ('CD', 'PRIVATE_CD') AND p_entry_type = 'normal' AND p_transaction_type IS NULL THEN
    RAISE EXCEPTION 'CD entries require transaction_type';
  END IF;

  IF p_entry_type = 'balance_check' AND p_transaction_type IS NULL THEN
    p_transaction_type := 'balance_check';
  END IF;

  INSERT INTO ps_register_entries (
    ledger_id, organisation_id, entry_number, register_type, entry_type,
    date_of_transaction, notes, source, corrects_entry_id, correction_reason, scan_image_path,
    entered_by, session_id, previous_entry_id, ledger_lock_version,
    transaction_type, quantity_received, quantity_deducted, running_balance, previous_balance,
    supplier_name, invoice_number, patient_name, patient_address,
    prescriber_name, prescriber_address, prescription_date, prescription_image_path,
    witness_name, witness_role, authorised_by,
    pharmacist_name, gphc_number, rp_signed_in_at, rp_signed_out_at,
    return_patient_name, return_drug_name, return_drug_form, return_drug_strength,
    return_quantity, return_reason, return_received_by, disposal_date, disposal_witness, disposal_method,
    was_id_requested, was_id_provided, prescriber_registration,
    return_person_role, return_received_signature, disposal_pharmacist_signature, witness_signature,
    return_parent_entry_id, supplier_address, collector_type, collector_details
  ) VALUES (
    p_ledger_id, v_ledger.organisation_id, v_entry_number, p_register_type, p_entry_type,
    p_date_of_transaction, p_notes, p_source, p_corrects_entry_id, p_correction_reason, p_scan_image_path,
    v_entered_by, p_session_id, v_previous_entry.id, v_ledger.lock_version,
    p_transaction_type, p_quantity_received, p_quantity_deducted, v_new_balance, v_ledger.current_balance,
    p_supplier_name, p_invoice_number, p_patient_name, p_patient_address,
    p_prescriber_name, p_prescriber_address, p_prescription_date, p_prescription_image_path,
    p_witness_name, p_witness_role, p_authorised_by,
    p_pharmacist_name, p_gphc_number, p_rp_signed_in_at, p_rp_signed_out_at,
    p_return_patient_name, p_return_drug_name, p_return_drug_form, p_return_drug_strength,
    p_return_quantity, p_return_reason, p_return_received_by, p_disposal_date, p_disposal_witness, p_disposal_method,
    p_was_id_requested, p_was_id_provided, p_prescriber_registration,
    p_return_person_role, p_return_received_signature, p_disposal_pharmacist_signature, p_witness_signature,
    p_return_parent_entry_id, p_supplier_address, p_collector_type, p_collector_details
  ) RETURNING * INTO v_new_entry;

  UPDATE ps_register_ledgers
  SET
    current_balance = COALESCE(v_new_balance, current_balance),
    entry_count = v_entry_number,
    lock_version = lock_version + 1
  WHERE id = p_ledger_id;

  RETURN v_new_entry;
END;
$function$;

-- 2. Register entries ---------------------------------------------------------
drop policy if exists ps_entries_insert on public.ps_register_entries;
drop policy if exists ps_entries_select on public.ps_register_entries;
create policy ps_entries_select on public.ps_register_entries
  for select to authenticated
  using (
    organisation_id in (select ps_get_user_org_ids())
    and (
      register_type not in ('CD', 'PRIVATE_CD')
      or ps_member_has_permission(organisation_id, 'cd_register_read')
    )
  );
revoke all on public.ps_register_entries from anon;
revoke insert, update, delete, truncate on public.ps_register_entries from authenticated;

-- 3. Ledgers ------------------------------------------------------------------
drop policy if exists ps_ledgers_insert on public.ps_register_ledgers;
drop policy if exists ps_ledgers_select on public.ps_register_ledgers;
create policy ps_ledgers_select on public.ps_register_ledgers
  for select to authenticated
  using (
    organisation_id in (select ps_get_user_org_ids())
    and (
      register_type not in ('CD', 'PRIVATE_CD')
      or ps_member_has_permission(organisation_id, 'cd_register_read')
    )
  );
-- RP log and Returns still create their single ledger directly. CD ledgers
-- go through ps_create_cd_register.
create policy ps_ledgers_insert on public.ps_register_ledgers
  for insert to authenticated
  with check (
    organisation_id in (select ps_get_user_org_ids())
    and register_type not in ('CD', 'PRIVATE_CD')
  );
revoke all on public.ps_register_ledgers from anon;
revoke insert, update, delete, truncate on public.ps_register_ledgers from authenticated;
-- Column grant: the app can name a ledger but never set its balance,
-- entry count or lock version.
grant insert (organisation_id, register_type, drug_id, drug_name, drug_form, drug_strength, drug_class, created_by)
  on public.ps_register_ledgers to authenticated;

-- 4. Register list ------------------------------------------------------------
drop policy if exists "Users can view own org subscribed registers" on public.ps_subscribed_registers;
drop policy if exists "Users can insert own org subscribed registers" on public.ps_subscribed_registers;
drop policy if exists "Users can delete own org subscribed registers" on public.ps_subscribed_registers;
drop policy if exists ps_subscribed_select on public.ps_subscribed_registers;
drop policy if exists ps_subscribed_insert on public.ps_subscribed_registers;
drop policy if exists ps_subscribed_delete on public.ps_subscribed_registers;
create policy ps_subscribed_select on public.ps_subscribed_registers
  for select to authenticated
  using (
    organisation_id in (select ps_get_user_org_ids())
    and ps_member_has_permission(organisation_id, 'cd_register_read')
  );
create policy ps_subscribed_insert on public.ps_subscribed_registers
  for insert to authenticated
  with check (
    organisation_id in (select ps_get_user_org_ids())
    and ps_member_has_permission(organisation_id, 'cd_register_write')
  );
-- Removing a drug from the list: owner or manager, and only at zero stock.
-- The ledger and all its entries are kept; the removal is audited.
create policy ps_subscribed_delete on public.ps_subscribed_registers
  for delete to authenticated
  using (
    exists (
      select 1 from ps_organisation_members m
      where m.organisation_id = ps_subscribed_registers.organisation_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'manager')
    )
    and not exists (
      select 1 from ps_register_ledgers l
      where l.organisation_id = ps_subscribed_registers.organisation_id
        and l.register_type = 'CD'
        and l.drug_id = ps_subscribed_registers.drug_id
        and l.current_balance <> 0
    )
  );
revoke all on public.ps_subscribed_registers from anon;
revoke update, truncate on public.ps_subscribed_registers from authenticated;
drop trigger if exists ps_audit_subscribed_registers on public.ps_subscribed_registers;
create trigger ps_audit_subscribed_registers
  after insert or delete on public.ps_subscribed_registers
  for each row execute function ps_audit_trigger();

-- 5. Balance checks -----------------------------------------------------------
drop policy if exists ps_balance_sessions_select on public.ps_balance_check_sessions;
drop policy if exists ps_balance_sessions_insert on public.ps_balance_check_sessions;
drop policy if exists ps_balance_sessions_update on public.ps_balance_check_sessions;
create policy ps_balance_sessions_select on public.ps_balance_check_sessions
  for select to authenticated
  using (
    organisation_id in (select ps_get_user_org_ids())
    and ps_member_has_permission(organisation_id, 'cd_register_read')
  );
create policy ps_balance_sessions_insert on public.ps_balance_check_sessions
  for insert to authenticated
  with check (
    started_by = auth.uid()
    and ps_member_has_permission(organisation_id, 'cd_register_write')
  );
-- Only an in-progress check can change (e.g. to mark it completed).
create policy ps_balance_sessions_update on public.ps_balance_check_sessions
  for update to authenticated
  using (
    status = 'in_progress'
    and ps_member_has_permission(organisation_id, 'cd_register_write')
  )
  with check (ps_member_has_permission(organisation_id, 'cd_register_write'));

drop policy if exists ps_balance_items_select on public.ps_balance_check_items;
drop policy if exists ps_balance_items_insert on public.ps_balance_check_items;
drop policy if exists ps_balance_items_update on public.ps_balance_check_items;
create policy ps_balance_items_select on public.ps_balance_check_items
  for select to authenticated
  using (
    organisation_id in (select ps_get_user_org_ids())
    and ps_member_has_permission(organisation_id, 'cd_register_read')
  );
create policy ps_balance_items_insert on public.ps_balance_check_items
  for insert to authenticated
  with check (
    ps_member_has_permission(organisation_id, 'cd_register_write')
    and exists (
      select 1 from ps_balance_check_sessions s
      where s.id = ps_balance_check_items.session_id
        and s.organisation_id = ps_balance_check_items.organisation_id
    )
  );
create policy ps_balance_items_update on public.ps_balance_check_items
  for update to authenticated
  using (
    ps_member_has_permission(organisation_id, 'cd_register_write')
    and exists (
      select 1 from ps_balance_check_sessions s
      where s.id = ps_balance_check_items.session_id
        and s.status = 'in_progress'
    )
  )
  with check (ps_member_has_permission(organisation_id, 'cd_register_write'));

revoke all on public.ps_balance_check_sessions from anon;
revoke all on public.ps_balance_check_items from anon;
revoke delete, truncate on public.ps_balance_check_sessions from authenticated;
revoke delete, truncate on public.ps_balance_check_items from authenticated;

-- 6. Annotations and the drug catalogue: anon has no business here either.
revoke all on public.ps_entry_annotations from anon;
revoke update, delete, truncate on public.ps_entry_annotations from authenticated;

-- 7. Colleague names on register lines -----------------------------------------
-- ps_profiles_select_org_members was meant to let staff see colleagues'
-- profiles, but its subquery on ps_organisation_members runs under that
-- table's row security (own row only), so staff only ever saw themselves.
-- The CD register's "Entered by" column and printed reports showed "—" for
-- every line made by someone else. Resolve colleagues with a definer helper.
create or replace function public.ps_colleague_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct m.user_id
  from ps_organisation_members m
  where m.organisation_id in (select ps_get_user_org_ids())
$$;
revoke all on function public.ps_colleague_user_ids() from public, anon;
grant execute on function public.ps_colleague_user_ids() to authenticated, service_role;

drop policy if exists ps_profiles_select_org_members on public.ps_user_profiles;
create policy ps_profiles_select_org_members on public.ps_user_profiles
  for select to authenticated
  using (id in (select ps_colleague_user_ids()));

commit;
