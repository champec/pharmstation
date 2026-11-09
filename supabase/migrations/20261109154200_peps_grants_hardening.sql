-- PEPS: tighten table grants to match the baseline (20261001000000_peps_baseline.sql).
-- RLS already blocks these, but TRUNCATE ignores RLS, and anon never needs PEPS tables.
-- Clients only read prescriptions, items and events; all writes go through the
-- SECURITY DEFINER functions.
begin;
revoke all on public.ps_peps_prescriptions, public.ps_peps_prescription_items, public.ps_peps_events from anon, authenticated;
grant select on public.ps_peps_prescriptions, public.ps_peps_prescription_items, public.ps_peps_events to authenticated;
revoke all on public.ps_peps_claim_attempts, public.ps_peps_signing_keys from anon, authenticated;
revoke all on public.ps_peps_prescribers, public.ps_peps_orgs from anon;
revoke truncate, references, trigger on public.ps_peps_prescribers, public.ps_peps_orgs from authenticated;
commit;
