-- ===========================================
-- PharmStation: Extend auth trigger for patient accounts
-- Adds a 'patient' branch alongside existing 'organisation' and 'user' branches
-- ===========================================

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

  ELSIF v_account_type = 'patient' THEN
    INSERT INTO ps_patients (
      auth_user_id,
      organisation_id,
      first_name,
      last_name,
      email,
      phone
    ) VALUES (
      NEW.id,
      (NEW.raw_user_meta_data->>'organisation_id')::uuid,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      NEW.email,
      NEW.phone
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
