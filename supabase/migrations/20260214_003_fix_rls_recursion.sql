-- ============================================
-- Fix RLS infinite recursion (42P17)
-- The original policies had circular references:
--   ps_organisations SELECT → ps_organisation_members SELECT → self-reference
-- Fix: Use a SECURITY DEFINER function to break the cycle
-- ============================================

-- Step 1: SECURITY DEFINER function that queries membership without RLS
CREATE OR REPLACE FUNCTION ps_get_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT organisation_id 
  FROM ps_organisation_members 
  WHERE user_id = auth.uid() AND status = 'active';
$$;

-- Step 2: Fix ps_organisations SELECT policy
DROP POLICY IF EXISTS ps_orgs_select_member ON ps_organisations;
CREATE POLICY ps_orgs_select ON ps_organisations
  FOR SELECT USING (
    auth_user_id = auth.uid()
    OR id IN (SELECT ps_get_user_org_ids())
  );

-- Step 3: Fix ps_organisation_members SELECT (remove self-reference)
DROP POLICY IF EXISTS ps_members_select ON ps_organisation_members;
CREATE POLICY ps_members_select_org ON ps_organisation_members
  FOR SELECT USING (
    organisation_id IN (
      SELECT id FROM ps_organisations WHERE auth_user_id = auth.uid()
    )
  );
-- ps_members_select_own (user_id = auth.uid()) remains unchanged

-- Step 4: Fix ps_user_profiles SELECT (nested self-reference via members)
DROP POLICY IF EXISTS ps_profiles_select_org_members ON ps_user_profiles;
CREATE POLICY ps_profiles_select_org_members ON ps_user_profiles
  FOR SELECT USING (
    id IN (
      SELECT om.user_id 
      FROM ps_organisation_members om
      WHERE om.organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

-- Step 5: Fix ps_organisation_members INSERT (had self-reference in WITH CHECK)
DROP POLICY IF EXISTS ps_members_insert ON ps_organisation_members;
CREATE POLICY ps_members_insert ON ps_organisation_members
  FOR INSERT WITH CHECK (
    organisation_id IN (
      SELECT id FROM ps_organisations WHERE auth_user_id = auth.uid()
    )
    OR organisation_id IN (
      SELECT ps_get_user_org_ids()
    )
  );
