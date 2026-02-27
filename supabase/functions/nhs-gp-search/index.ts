// ============================================
// PharmStation Edge Function: nhs-gp-search
// NHS Directory of Healthcare Services (DoHS) v3
// GP practice ODS code lookup and autocomplete
//
// Actions: search | lookup_ods
//
// [A6 SCAFFOLD] DoHS API calls are STUBBED.
// Replace stub in Phase D once NHS Developer Portal
// subscription key is obtained (action A2).
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// NHS Directory of Healthcare Services v3
// https://api.nhs.uk/service-search/
// Auth: Ocp-Apim-Subscription-Key header (subscription key from NHS Developer Portal)
const DOHS_BASE = 'https://api.nhs.uk/service-search'

function getAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

interface GPResult {
  odsCode: string
  name: string
  address: string
  postcode: string
  status: string
}

// ============================================
// Action: search
// Search for GP practices by name or postcode
// Returns list of matching practices with ODS codes
// ============================================

async function handleSearch(body: Record<string, unknown>) {
  const { query, postcode, limit = 10 } = body as {
    query?: string
    postcode?: string
    limit?: number
  }

  if (!query && !postcode) throw new Error('Provide at least one of: query (name search) or postcode')

  // ================================================================
  // [STUB] DoHS API CALL — Replace with real API call in Phase D
  // Requires: NHS Developer Portal subscription key (task A2)
  //
  // TODO Phase D: Replace this stub with:
  //   const subscriptionKey = Deno.env.get('NHS_DOHS_API_KEY')!
  //   const searchBody = {
  //     filter: postcode
  //       ? { "Distance": { "from": { "lat": ..., "lon": ... }, "distance": 5km } }
  //       : { "Name": { "startsWith": query } },
  //     top: limit,
  //     select: ['ODSCode', 'OrganisationName', 'Address1', 'Postcode', 'OrganisationStatus'],
  //   }
  //   const doRes = await fetch(`${DOHS_BASE}/search/type/78`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': subscriptionKey },
  //     body: JSON.stringify(searchBody)
  //   })
  //   const doData = await doRes.json()
  //   const results = doData.value.map(p => ({ odsCode: p.ODSCode, name: p.OrganisationName, ... }))
  // ================================================================

  // Stub: return a few fake GP practices matching any query
  const stubResults: GPResult[] = [
    { odsCode: 'A12345', name: 'The Surgery — Stub GP Practice', address: '1 High Street', postcode: 'SW1A 1AA', status: 'active' },
    { odsCode: 'B67890', name: 'Central Medical Centre (STUB)', address: '22 Park Road', postcode: 'E1 6RF', status: 'active' },
    { odsCode: 'C11111', name: 'Riverside Health Centre (STUB)', address: '5 River Lane', postcode: 'CF10 1AB', status: 'active' },
  ].filter(r =>
    !query || r.name.toLowerCase().includes(query.toLowerCase()) ||
    r.odsCode.toLowerCase().includes(query.toLowerCase())
  ).slice(0, limit)

  return {
    results: stubResults,
    total: stubResults.length,
    _stub: true,
    _note: 'DoHS API subscription key pending — this is a stub response',
  }
  // ================================================================
}

// ============================================
// Action: lookup_ods
// Look up a specific ODS code to get GP practice details
// Used to validate an ODS code the pharmacist has entered manually
// ============================================

async function handleLookupOds(body: Record<string, unknown>) {
  const { ods_code } = body as { ods_code: string }
  if (!ods_code) throw new Error('Missing required field: ods_code')
  if (!/^[A-Z]\d{5}$/i.test(ods_code.trim())) throw new Error('Invalid ODS code format. Expected format: letter + 5 digits (e.g. A12345)')

  // ================================================================
  // [STUB]  DoHS lookup by ODS code — Replace in Phase D
  // TODO: const doRes = await fetch(`${DOHS_BASE}/search/type/78?api-version=2&$filter=ODSCode eq '${ods_code}'`, { headers: { 'Ocp-Apim-Subscription-Key': key } })
  // ================================================================
  return {
    odsCode: ods_code.toUpperCase(),
    name: `GP Practice ${ods_code.toUpperCase()} (STUB)`,
    address: '1 Stub Street',
    postcode: 'SW1A 1AA',
    status: 'active',
    _stub: true,
  }
  // ================================================================
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const body = await req.json()
    if (!body.action) throw new Error('Missing action parameter')
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')
    let result: unknown
    switch (body.action) {
      case 'search':     result = await handleSearch(body); break
      case 'lookup_ods': result = await handleLookupOds(body); break
      default: throw new Error(`Unknown action: ${body.action}`)
    }
    return new Response(JSON.stringify(result), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errMsg }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
