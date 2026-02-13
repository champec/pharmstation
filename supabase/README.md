# PharmStation Supabase Configuration

This directory contains all Supabase-related configuration, migrations, functions, and seed data for the PharmStation backend.

## Directory Structure

```
supabase/
├── migrations/         # Database migration files
├── functions/          # Edge functions
├── seed.sql           # Seed data for development
├── config.toml        # Supabase project configuration
└── README.md          # This file
```

## What is Supabase?

Supabase is an open-source Firebase alternative that provides:
- **PostgreSQL Database**: Relational database with full SQL support
- **Authentication**: Built-in user authentication with various providers
- **Realtime**: WebSocket connections for live updates
- **Storage**: File storage for documents, images, etc.
- **Edge Functions**: Serverless functions (Deno)
- **Row Level Security (RLS)**: Fine-grained access control

## Database Schema Overview

### Core Tables (to be created)

**Pharmacies**
- id, name, address, gphc_number, owner_id, settings, created_at, updated_at

**Users**
- id (from auth.users), pharmacy_id, role, gphc_number, name, email, created_at

**RP Log Entries**
- id, pharmacy_id, user_id, action (sign_in/sign_out/absence), timestamp, notes

**CD Register Entries**
- id, pharmacy_id, drug_name, strength, form, entry_type (receipt/supply), quantity, balance, date, supplier/patient, prescriber, invoice_number, user_id, created_at

**CD Register Corrections**
- id, original_entry_id, corrected_entry_id, reason, user_id, created_at

**Patient Returns**
- id, pharmacy_id, patient_name, medication, quantity, return_date, storage_location, disposal_date, disposal_method, witness_id, user_id, created_at

**Private CD Register**
- id, pharmacy_id, date, patient_name, prescriber_name, medication, quantity, prescription_retained, user_id, created_at

**SOPs**
- id, pharmacy_id, title, content, category, file_url, assigned_to, created_by, created_at, updated_at

**Handover Notes**
- id, pharmacy_id, content, color, position_x, position_y, width, height, assigned_to, due_date, status (open/done/archived), created_by, created_at, updated_at

**Compliance Logs**
- id, pharmacy_id, log_type (fridge/cleaning/date_checking/guest/near_miss), date, data (JSONB), user_id, created_at

### Row Level Security (RLS)

All tables will have RLS policies to ensure:
- Users can only access data for their pharmacy
- Appropriate role-based permissions (owner, pharmacist, technician, staff)
- No unauthorized data access

### Indexes

Key indexes for performance:
- pharmacy_id on all tables (most common query)
- date ranges for entries (CD register, RP log)
- user_id for audit trails
- Full-text search indexes where applicable

## Migrations

### Creating Migrations

```bash
# Using Supabase CLI
supabase migration new migration_name

# Example
supabase migration new create_pharmacies_table
```

### Running Migrations

```bash
# Local development
supabase db reset

# Production (via Supabase Dashboard or CLI)
supabase db push
```

### Migration Naming Convention

`YYYYMMDDHHMMSS_description.sql`

Example: `20260212120000_create_pharmacies_table.sql`

## Edge Functions

Supabase Edge Functions run on Deno and are deployed globally.

### Use Cases for Edge Functions
- Complex business logic
- Third-party API integrations (AI services, payment processing)
- Scheduled tasks (cron jobs)
- Webhooks
- Data transformations

### Example Functions (to be created)
- `sync-check`: Verify data consistency
- `generate-exports`: Create PDF/Excel exports
- `ai-process-invoice`: Call AI service for invoice processing
- `send-notifications`: Email/SMS notifications

### Creating Functions

```bash
supabase functions new function_name
```

### Deploying Functions

```bash
supabase functions deploy function_name
```

## Local Development

### Setup

```bash
# Install Supabase CLI
brew install supabase/tap/supabase  # macOS
# or
npm install -g supabase

# Start local Supabase
cd /path/to/pharmstation
supabase start

# This starts:
# - PostgreSQL database (localhost:54322)
# - Studio (localhost:54323)
# - API Gateway (localhost:54321)
# - Realtime (localhost:54321)
```

### Stopping

```bash
supabase stop
```

### Resetting Database

```bash
supabase db reset  # Drops and recreates database with migrations + seed
```

## Seed Data

The `seed.sql` file contains sample data for development and testing.

### What to Include in Seed Data
- Test pharmacies
- Test users (with known credentials)
- Sample CD register entries
- Sample RP log entries
- Sample handover notes
- Sample SOPs

### Running Seed

```bash
supabase db reset  # Automatically runs seed.sql
```

## Configuration (config.toml)

The `config.toml` file contains project configuration:
- Project ID
- Database settings
- API settings
- Auth settings
- Storage settings

### Example Config Sections
```toml
[db]
port = 54322

[api]
port = 54321

[auth]
enabled = true
site_url = "http://localhost:3000"

[storage]
enabled = true
```

## Environment Variables

### Required Environment Variables

**Development** (`.env.local`):
```env
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Production**:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_production_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_production_service_role_key
```

## Schema Design Principles

1. **Immutability**: Never delete or overwrite historical records (CD register, RP log)
2. **Audit Trail**: Track who created/updated every record (user_id, created_at, updated_at)
3. **Soft Deletes**: Use `deleted_at` instead of actual deletion
4. **Timestamps**: Always use `timestamptz` for timezone awareness
5. **Foreign Keys**: Enforce referential integrity
6. **Indexes**: Add indexes for common queries
7. **Constraints**: Use CHECK constraints for validation
8. **Enums**: Use PostgreSQL enums for fixed sets of values

## Realtime Features

### Subscribing to Changes

```typescript
// Subscribe to CD register changes
const subscription = supabase
  .channel('cd-register')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'cd_register_entries',
    filter: `pharmacy_id=eq.${pharmacyId}`
  }, (payload) => {
    console.log('Change received!', payload)
  })
  .subscribe()
```

### Use Cases
- Live updates when team members make entries
- Instant notification of handover notes
- Real-time sync across multiple devices

## Security Best Practices

1. **RLS Policies**: Enable on all tables
2. **API Keys**: Never commit real API keys to git
3. **Service Role**: Only use service role key server-side
4. **HTTPS**: Always use HTTPS in production
5. **Rate Limiting**: Use Supabase rate limiting features
6. **Input Validation**: Validate all inputs (client and server)
7. **SQL Injection**: Use parameterized queries
8. **Secrets**: Store secrets in Supabase Vault

## Backup Strategy

### Automated Backups
- Supabase Pro plan: Daily automated backups
- Point-in-time recovery (PITR) for Pro+ plans

### Manual Backups
```bash
# Export database
pg_dump -h db.your-project.supabase.co -U postgres -d postgres > backup.sql

# Restore database
psql -h db.your-project.supabase.co -U postgres -d postgres < backup.sql
```

## Monitoring

### Supabase Dashboard
- Query performance
- Database size
- API usage
- Error logs

### Logging
- Enable logging for all Edge Functions
- Monitor API error rates
- Track slow queries

## Testing

### Local Testing
```bash
# Start Supabase locally
supabase start

# Run tests against local database
pnpm test
```

### Migration Testing
```bash
# Reset to test migrations
supabase db reset

# Verify schema
supabase db diff
```

## Production Deployment

### Initial Setup
1. Create Supabase project via dashboard
2. Note project URL and API keys
3. Update environment variables
4. Run migrations: `supabase db push`
5. Deploy edge functions: `supabase functions deploy --project-ref your-ref`

### Updates
1. Create migration locally
2. Test locally: `supabase db reset`
3. Push to production: `supabase db push`
4. Verify in Supabase dashboard

## Useful Commands

```bash
# Start local Supabase
supabase start

# Stop local Supabase
supabase stop

# View database URL and keys
supabase status

# Create new migration
supabase migration new migration_name

# Reset database (run all migrations + seed)
supabase db reset

# View migration differences
supabase db diff

# Push migrations to remote
supabase db push

# Create new edge function
supabase functions new function_name

# Deploy edge function
supabase functions deploy function_name

# View logs
supabase functions logs function_name
```

## Links

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Supabase Schema Design](../documentation/technical/supabase-schema-design.md)
- [Architecture Overview](../documentation/technical/architecture-overview.md)
