# Database Migrations

This directory contains database migration files for PharmStation.

## What Goes Here

All SQL migration files that modify the database schema:
- Creating tables
- Adding columns
- Creating indexes
- Adding constraints
- Creating functions/triggers
- Modifying existing schema

## Migration Naming Convention

Migrations are named: `YYYYMMDDHHMMSS_description.sql`

Example:
- `20260212120000_create_pharmacies_table.sql`
- `20260212130000_create_users_table.sql`
- `20260212140000_add_rls_policies.sql`

## Creating Migrations

```bash
supabase migration new description_of_change
```

This creates a new timestamped file in this directory.

## Migration Best Practices

1. **One migration per logical change**: Don't combine unrelated schema changes
2. **Idempotent**: Use `IF NOT EXISTS` or `IF EXISTS` where appropriate
3. **Test locally**: Always test migrations with `supabase db reset` before pushing
4. **Rollback plan**: Consider how to undo changes if needed
5. **Data migrations**: Separate schema changes from data migrations when possible
6. **Comments**: Add comments explaining complex migrations

## Example Migration Structure

```sql
-- Migration: Create pharmacies table
-- Created: 2026-02-12

-- Create table
CREATE TABLE IF NOT EXISTS public.pharmacies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    gphc_number TEXT,
    owner_id UUID REFERENCES auth.users(id),
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_pharmacies_owner_id ON public.pharmacies(owner_id);
CREATE INDEX idx_pharmacies_gphc_number ON public.pharmacies(gphc_number);

-- Enable RLS
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "Users can view their own pharmacy"
    ON public.pharmacies
    FOR SELECT
    USING (owner_id = auth.uid() OR id IN (
        SELECT pharmacy_id FROM public.users WHERE id = auth.uid()
    ));

-- Add comments
COMMENT ON TABLE public.pharmacies IS 'Stores pharmacy information';
COMMENT ON COLUMN public.pharmacies.gphc_number IS 'General Pharmaceutical Council registration number';
```

## Running Migrations

### Locally
```bash
# Reset database (runs all migrations + seed)
supabase db reset
```

### Production
```bash
# Push migrations to production
supabase db push
```

## Checking Migration Status

```bash
# View applied migrations
supabase migration list
```

## Migration Order

Migrations are applied in chronological order based on the timestamp in the filename.

## Schema Design Guidelines

See [Supabase Schema Design](../../documentation/technical/supabase-schema-design.md) for detailed schema design guidelines.

## TODO: Create Initial Migrations

The following migrations need to be created:

1. **Core Tables**:
   - [ ] `create_pharmacies_table.sql`
   - [ ] `create_users_table.sql`
   - [ ] `create_rp_log_entries_table.sql`
   - [ ] `create_cd_register_entries_table.sql`
   - [ ] `create_cd_register_corrections_table.sql`
   - [ ] `create_patient_returns_table.sql`
   - [ ] `create_private_cd_register_table.sql`
   - [ ] `create_sops_table.sql`
   - [ ] `create_handover_notes_table.sql`
   - [ ] `create_compliance_logs_table.sql`

2. **Security**:
   - [ ] `add_rls_policies.sql`

3. **Functions & Triggers**:
   - [ ] `create_updated_at_trigger.sql` (auto-update updated_at)
   - [ ] `create_audit_functions.sql` (audit logging)

4. **Indexes**:
   - [ ] `create_performance_indexes.sql`

---

**Related Documentation**:
- [Supabase README](../README.md)
- [Supabase Schema Design](../../documentation/technical/supabase-schema-design.md)
