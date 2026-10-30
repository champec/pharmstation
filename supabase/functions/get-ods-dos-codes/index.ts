// ============================================
// PharmStation Edge Function: get-ods-dos-codes
//
// Returns all ODS codes for pharmacies linked
// to PharmStation organisations. ODS codes live
// in the `pharmacies` directory table, joined
// via `ps_org_pharmacy_link`.
//
// Used by the NHS 111 adaptor configuration
// and DoS integration.
//
// JWT verification OFF — called by the NHS 111
// adaptor, which can only be given a URL. It must
// carry ?token= matching the ODS_CONFIG_TOKEN
// function secret. Fails closed when unset.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Length-safe constant-time string compare, so the secret can't be timed */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const expected = Deno.env.get('ODS_CONFIG_TOKEN')
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!expected || !safeEqual(token, expected)) {
    if (!expected) console.error('ODS_CONFIG_TOKEN is not configured; rejecting request')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Fetch all linked pharmacies via the link table
    // ps_org_pharmacy_link.pharmacy_id → pharmacies.id
    const { data: links, error } = await supabase
      .from('ps_org_pharmacy_link')
      .select('org_id, pharmacy:pharmacy_id(id, ods_code)')

    if (error) {
      console.error('get-ods-dos-codes query failed', error)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Collect unique ODS codes from linked pharmacies
    const odsCodes = (links || []).map((l: any) => l.pharmacy?.ods_code).filter(Boolean)
    const uniqueOds = [...new Set(odsCodes)]

    // NHS 111 adaptor expects both odsCodes and dosIds arrays
    // dosIds (Directory of Services IDs) are optional but must be present as empty array
    return new Response(
      JSON.stringify({ odsCodes: uniqueOds, dosIds: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('get-ods-dos-codes failed', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
