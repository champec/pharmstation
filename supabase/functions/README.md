# Supabase Edge Functions

This directory contains Supabase Edge Functions for PharmStation.

## What are Edge Functions?

Edge Functions are serverless functions that run on Deno, deployed globally on Supabase's edge network.

## What Goes Here

Server-side logic that needs to run securely:
- Third-party API integrations (AI services, payment processing)
- Complex business logic
- Background jobs / scheduled tasks
- Webhooks
- Data processing and transformations
- Sending emails/SMS

## Example Functions to Create

### 1. AI Integration Functions
- `ai-process-invoice`: Process invoice images with OCR/AI
- `ai-process-prescription`: Extract data from prescription images
- `genie-query`: Handle Genie natural language queries

### 2. Export Functions
- `generate-cd-register-pdf`: Generate PDF export of CD register
- `generate-rp-log-pdf`: Generate PDF export of RP log
- `generate-excel-export`: Generate Excel exports

### 3. Notification Functions
- `send-email-notification`: Send email notifications
- `send-sms-notification`: Send SMS notifications (Twilio, etc.)
- `send-push-notification`: Send push notifications

### 4. Scheduled Functions (Cron)
- `daily-reminders`: Send daily reminder notifications
- `sync-health-check`: Check sync status across pharmacies
- `cleanup-old-sessions`: Clean up expired sessions

### 5. Webhook Functions
- `stripe-webhook`: Handle Stripe payment webhooks
- `gphc-webhook`: Handle GPhC API webhooks (if available)

## Creating a New Function

```bash
supabase functions new function-name
```

This creates a new directory: `supabase/functions/function-name/`

## Function Structure

```typescript
// supabase/functions/example-function/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  try {
    // Parse request
    const { param1, param2 } = await req.json()

    // Your logic here
    const result = await processData(param1, param2)

    // Return response
    return new Response(
      JSON.stringify({ success: true, data: result }),
      { 
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { "Content-Type": "application/json" },
        status: 500
      }
    )
  }
})
```

## Deploying Functions

```bash
# Deploy single function
supabase functions deploy function-name

# Deploy all functions
supabase functions deploy
```

## Invoking Functions

### From Client (JavaScript/TypeScript)
```typescript
import { supabase } from './supabaseClient'

const { data, error } = await supabase.functions.invoke('function-name', {
  body: { param1: 'value1', param2: 'value2' }
})
```

### From cURL
```bash
curl -i --location --request POST \
  'https://your-project.supabase.co/functions/v1/function-name' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{"param1":"value1","param2":"value2"}'
```

## Environment Variables

Set secrets for functions:

```bash
# Set a secret
supabase secrets set SECRET_NAME=secret_value

# List secrets
supabase secrets list
```

Access in function:
```typescript
const apiKey = Deno.env.get('SECRET_NAME')
```

## Local Development

```bash
# Serve function locally
supabase functions serve function-name

# With watch mode
supabase functions serve function-name --watch
```

## Testing Functions

```bash
# Using curl
curl -i --location --request POST \
  'http://localhost:54321/functions/v1/function-name' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{"test":"data"}'
```

## Logging

### View Logs
```bash
supabase functions logs function-name
```

### In Function
```typescript
console.log('Debug message')
console.error('Error message')
```

## CORS

Handle CORS in your function:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Your logic
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    })
  }
})
```

## Authentication

### Verify User
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  {
    global: {
      headers: { Authorization: req.headers.get('Authorization')! },
    },
  }
)

// Get user
const { data: { user }, error } = await supabaseClient.auth.getUser()

if (error || !user) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  })
}
```

## Best Practices

1. **Error Handling**: Always wrap in try-catch
2. **Validation**: Validate all inputs
3. **Timeouts**: Set appropriate timeouts
4. **Logging**: Log important events and errors
5. **Secrets**: Never hardcode API keys
6. **Types**: Use TypeScript for type safety
7. **Testing**: Test locally before deploying
8. **Performance**: Keep functions fast (<5 seconds)
9. **Idempotency**: Make functions idempotent where possible

## Scheduled Functions (Cron)

Scheduled functions run on a cron schedule.

### Setting up Cron
```sql
-- In Supabase SQL Editor
SELECT
  cron.schedule(
    'daily-reminders',
    '0 9 * * *', -- Every day at 9 AM
    $$
    SELECT net.http_post(
        url:='https://your-project.supabase.co/functions/v1/daily-reminders',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
    ) AS request_id;
    $$
  );
```

## Limitations

- **Timeout**: 60 seconds (150 seconds for Pro plan)
- **Memory**: 150 MB
- **Size**: 20 MB compressed
- **Cold starts**: 1-2 seconds

## Resources

- [Deno Documentation](https://deno.land/manual)
- [Deno Standard Library](https://deno.land/std)
- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)

---

**Related Documentation**:
- [Supabase README](../README.md)
- [Architecture Overview](../../documentation/technical/architecture-overview.md)
