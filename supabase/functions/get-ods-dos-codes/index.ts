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
// JWT verification OFF — called by bridge config.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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
      return new Response(JSON.stringify({ error: error.message }), {
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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
