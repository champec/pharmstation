-- CD register: Schedule 6 fields (supplier address, person collecting)
-- and tenant check on ps_make_register_entry.
ALTER TABLE public.ps_register_entries
  ADD COLUMN IF NOT EXISTS supplier_address text,
  ADD COLUMN IF NOT EXISTS collector_type text,
  ADD COLUMN IF NOT EXISTS collector_details text;

ALTER TABLE public.ps_register_entries
  DROP CONSTRAINT IF EXISTS ps_register_entries_collector_type_check;
ALTER TABLE public.ps_register_entries
  ADD CONSTRAINT ps_register_entries_collector_type_check
  CHECK (collector_type IS NULL OR collector_type IN ('patient', 'representative', 'hcp'));

COMMENT ON COLUMN public.ps_register_entries.supplier_address IS 'MDR 2001 Sch 6: address of supplier on receipts';
COMMENT ON COLUMN public.ps_register_entries.collector_type IS 'MDR 2001 Sch 6: who collected a supply (patient, representative, hcp)';
COMMENT ON COLUMN public.ps_register_entries.collector_details IS 'Name, and address if a healthcare professional, of the person collecting';

-- Retire the old signature without dropping it (a second overload would make
-- PostgREST calls ambiguous): rename it and remove every grant.
ALTER FUNCTION public.ps_make_register_entry(uuid,text,text,date,text,text,uuid,text,text,uuid,uuid,integer,text,numeric,numeric,text,text,text,text,text,text,date,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,numeric,text,text,date,text,text,boolean,boolean,text,text,text,text,text,uuid) RENAME TO ps_make_register_entry_retired;
REVOKE ALL ON FUNCTION public.ps_make_register_entry_retired FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.ps_make_register_entry(p_ledger_id uuid, p_register_type text, p_entry_type text DEFAULT 'normal'::text, p_date_of_transaction date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_corrects_entry_id uuid DEFAULT NULL::uuid, p_correction_reason text DEFAULT NULL::text, p_scan_image_path text DEFAULT NULL::text, p_entered_by uuid DEFAULT NULL::uuid, p_session_id uuid DEFAULT NULL::uuid, p_expected_lock_version integer DEFAULT NULL::integer, p_transaction_type text DEFAULT NULL::text, p_quantity_received numeric DEFAULT NULL::numeric, p_quantity_deducted numeric DEFAULT NULL::numeric, p_supplier_name text DEFAULT NULL::text, p_invoice_number text DEFAULT NULL::text, p_patient_name text DEFAULT NULL::text, p_patient_address text DEFAULT NULL::text, p_prescriber_name text DEFAULT NULL::text, p_prescriber_address text DEFAULT NULL::text, p_prescription_date date DEFAULT NULL::date, p_prescription_image_path text DEFAULT NULL::text, p_witness_name text DEFAULT NULL::text, p_witness_role text DEFAULT NULL::text, p_authorised_by text DEFAULT NULL::text, p_pharmacist_name text DEFAULT NULL::text, p_gphc_number text DEFAULT NULL::text, p_rp_signed_in_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rp_signed_out_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_return_patient_name text DEFAULT NULL::text, p_return_drug_name text DEFAULT NULL::text, p_return_drug_form text DEFAULT NULL::text, p_return_drug_strength text DEFAULT NULL::text, p_return_quantity numeric DEFAULT NULL::numeric, p_return_reason text DEFAULT NULL::text, p_return_received_by text DEFAULT NULL::text, p_disposal_date date DEFAULT NULL::date, p_disposal_witness text DEFAULT NULL::text, p_disposal_method text DEFAULT NULL::text, p_was_id_requested boolean DEFAULT NULL::boolean, p_was_id_provided boolean DEFAULT NULL::boolean, p_prescriber_registration text DEFAULT NULL::text, p_return_person_role text DEFAULT NULL::text, p_return_received_signature text DEFAULT NULL::text, p_disposal_pharmacist_signature text DEFAULT NULL::text, p_witness_signature text DEFAULT NULL::text, p_return_parent_entry_id uuid DEFAULT NULL::uuid, p_supplier_address text DEFAULT NULL::text, p_collector_type text DEFAULT NULL::text, p_collector_details text DEFAULT NULL::text)
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
REVOKE ALL ON FUNCTION public.ps_make_register_entry FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ps_make_register_entry TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
