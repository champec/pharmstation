-- ============================================
-- PharmStation: Auth trigger for auto-profile creation
-- When a new auth.users row is inserted:
--   account_type = 'organisation' → ps_organisations row
--   account_type = 'user' (default) → ps_user_profiles row
-- ============================================

CREATE OR REPLACE FUNCTION ps_handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_type TEXT;
BEGIN
  v_account_type := COALESCE(NEW.raw_user_meta_data->>'account_type', 'user');

  IF v_account_type = 'organisation' THEN
    INSERT INTO ps_organisations (
      auth_user_id,
      name,
      gphc_premises_number,
      address
    ) VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'org_name', 'Unnamed Pharmacy'),
      NEW.raw_user_meta_data->>'gphc_premises_number',
      COALESCE(
        (NEW.raw_user_meta_data->'address')::JSONB,
        '{}'::JSONB
      )
    );

  ELSE
    -- Default: create user profile
    INSERT INTO ps_user_profiles (
      id,
      full_name,
      email,
      gphc_number,
      default_role
    ) VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      NEW.email,
      NEW.raw_user_meta_data->>'gphc_number',
      COALESCE(NEW.raw_user_meta_data->>'default_role', 'dispenser')
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ps_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION ps_handle_new_auth_user();

-- ============================================
-- Fix: Direct member select policy (prevents circular RLS)
-- ============================================

CREATE POLICY "ps_members_select_own" ON ps_organisation_members
FOR SELECT USING (user_id = auth.uid());
