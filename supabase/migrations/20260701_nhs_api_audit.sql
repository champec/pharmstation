-- ============================================
-- ps_nhs_api_audit
-- Dedicated audit trail for outbound NHS API queries
-- (DoS UEC REST API + PDS FHIR). Distinct from
-- ps_audit_log, which records row-level DB mutations
-- (INSERT/UPDATE/DELETE) and cannot represent an
-- API-query event (no HTTP status / ODS / params).
--
-- Design notes:
--  * No foreign keys — audit history must remain
--    immutable even if a user/org row is later removed.
--  * Append-only — RLS enabled with SELECT policies
--    only; no INSERT/UPDATE/DELETE policies, so only
--    the service-role Edge Function can write and no
--    one can delete (satisfies DosRESTAPI-003).
-- Evidence for: DosRESTAPI-003, 004, 007 (+ PDS equiv.)
-- ============================================
CREATE TABLE ps_nhs_api_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organisation_id UUID,
  api TEXT NOT NULL CHECK (api IN ('dos', 'pds')),
  action TEXT NOT NULL,
  query_params JSONB,
  ods_code TEXT,
  http_status INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error')),
  error_detail TEXT,
  ip_address INET,
  request_id TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ps_nhs_api_audit_user ON ps_nhs_api_audit(user_id);
CREATE INDEX idx_ps_nhs_api_audit_time ON ps_nhs_api_audit(performed_at);
CREATE INDEX idx_ps_nhs_api_audit_api ON ps_nhs_api_audit(api);
CREATE INDEX idx_ps_nhs_api_audit_org ON ps_nhs_api_audit(organisation_id);

-- Append-only audit: RLS on, read-only for app users,
-- writes restricted to the service role (Edge Function).
ALTER TABLE ps_nhs_api_audit ENABLE ROW LEVEL SECURITY;

-- A user can read their own API-query audit history.
CREATE POLICY "ps_nhs_api_audit_select_own" ON ps_nhs_api_audit
  FOR SELECT USING (user_id = auth.uid());

-- Org members can read their organisation's API-query audit history.
CREATE POLICY "ps_nhs_api_audit_select_org" ON ps_nhs_api_audit
  FOR SELECT USING (
    organisation_id IN (
      SELECT om.organisation_id FROM ps_organisation_members om
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

COMMENT ON TABLE ps_nhs_api_audit IS 'Append-only audit trail of outbound NHS API queries (DoS/PDS): who queried what, when, and the HTTP outcome. Written server-side by Edge Functions via service role; no UPDATE/DELETE permitted.';
