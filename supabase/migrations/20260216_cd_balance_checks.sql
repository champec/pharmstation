-- ============================================
-- CD Balance Check System
-- Records balance checks performed on CD registers
-- Each check creates an entry in the CD register itself
-- ============================================

-- ============================================
-- BALANCE CHECK SESSIONS
-- A session groups all individual drug checks done in one sitting
-- ============================================

CREATE TABLE ps_balance_check_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  started_by UUID NOT NULL REFERENCES ps_user_profiles(id),
  completed_by UUID REFERENCES ps_user_profiles(id),
  notes TEXT,
  total_registers INTEGER DEFAULT 0,
  checked_count INTEGER DEFAULT 0,
  discrepancy_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ps_balance_sessions_org ON ps_balance_check_sessions(organisation_id);
CREATE INDEX idx_ps_balance_sessions_status ON ps_balance_check_sessions(organisation_id, status);

-- ============================================
-- INDIVIDUAL BALANCE CHECK ITEMS
-- One row per drug register checked in a session
-- ============================================

CREATE TABLE ps_balance_check_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ps_balance_check_sessions(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  drug_id UUID NOT NULL REFERENCES cdr_drugs_unique(id),
  ledger_id UUID NOT NULL REFERENCES ps_register_ledgers(id),
  drug_brand TEXT NOT NULL,
  drug_form TEXT NOT NULL,
  drug_strength TEXT NOT NULL,
  drug_class TEXT NOT NULL,
  -- Balance information
  expected_balance NUMERIC NOT NULL,
  actual_count NUMERIC,
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'discrepancy', 'adjusted', 'pending_reconciliation')),
  -- Adjustment (for liquids: overage/underfill; for solids: discrepancy)
  adjustment_amount NUMERIC,
  adjustment_reason TEXT,
  -- Notes
  notes TEXT,
  -- Who did the check
  checked_by UUID REFERENCES ps_user_profiles(id),
  checked_at TIMESTAMPTZ,
  -- The register entry created for this check (if completed)
  register_entry_id UUID REFERENCES ps_register_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ps_balance_items_session ON ps_balance_check_items(session_id);
CREATE INDEX idx_ps_balance_items_drug ON ps_balance_check_items(drug_id);
CREATE INDEX idx_ps_balance_items_ledger ON ps_balance_check_items(ledger_id);
CREATE INDEX idx_ps_balance_items_org ON ps_balance_check_items(organisation_id);

-- ============================================
-- ADD balance_check TO REGISTER ENTRIES
-- ============================================

-- Allow 'balance_check' as entry_type
ALTER TABLE ps_register_entries DROP CONSTRAINT ps_register_entries_entry_type_check;
ALTER TABLE ps_register_entries ADD CONSTRAINT ps_register_entries_entry_type_check
  CHECK (entry_type IN ('normal', 'correction', 'balance_check'));

-- Allow 'balance_check' as transaction_type
ALTER TABLE ps_register_entries DROP CONSTRAINT ps_register_entries_transaction_type_check;
ALTER TABLE ps_register_entries ADD CONSTRAINT ps_register_entries_transaction_type_check
  CHECK (transaction_type IN (
    'receipt', 'supply', 'return_to_supplier', 'patient_return',
    'disposal', 'correction', 'transfer_in', 'transfer_out', 'balance_check'
  ));

-- Balance check entries don't require quantity
ALTER TABLE ps_register_entries DROP CONSTRAINT ps_register_entries_check1;
ALTER TABLE ps_register_entries ADD CONSTRAINT ps_register_entries_check1
  CHECK (
    (register_type NOT IN ('CD', 'PRIVATE_CD'))
    OR (entry_type = 'correction')
    OR (entry_type = 'balance_check')
    OR (quantity_received IS NOT NULL OR quantity_deducted IS NOT NULL)
  );

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE ps_balance_check_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_balance_check_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ps_balance_sessions_select" ON ps_balance_check_sessions FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_balance_sessions_insert" ON ps_balance_check_sessions FOR INSERT WITH CHECK (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_balance_sessions_update" ON ps_balance_check_sessions FOR UPDATE USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);

CREATE POLICY "ps_balance_items_select" ON ps_balance_check_items FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_balance_items_insert" ON ps_balance_check_items FOR INSERT WITH CHECK (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_balance_items_update" ON ps_balance_check_items FOR UPDATE USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);

-- Audit triggers
CREATE TRIGGER ps_audit_balance_sessions AFTER INSERT OR UPDATE ON ps_balance_check_sessions FOR EACH ROW EXECUTE FUNCTION ps_audit_trigger();
CREATE TRIGGER ps_audit_balance_items AFTER INSERT OR UPDATE ON ps_balance_check_items FOR EACH ROW EXECUTE FUNCTION ps_audit_trigger();
