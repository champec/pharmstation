// ============================================
// PharmStation Edge Function: nhs-gp-search
// NHS ODS API (Organisation Data Service) v6
// GP practice lookup and search
//
// Actions: search | lookup_ods
//
// Uses the public NHS ODS API (directory.spineservices.nhs.uk)
// - No auth required
// - Contains ALL GP practices in England
// - Supports search by name, ODS code, postcode
//
// Query parsing:
//   "mayfield"          → Name=mayfield
//   "mayfield surgery"  → Name=mayfield surgery
//   "mayfield WV1"      → Name=mayfield, PostCode=WV1
//   "WV1 2GZ"           → PostCode=WV1 2GZ
//   "M92040"            → Direct ODS code lookup
//
// All search terms are passed straight to the ODS API.
// We return what we get — no enrichment, no forced lookups.
// The lookup_ods action returns full detail (address, city)
// for a single ODS code.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ODS_BASE = 'https://directory.spineservices.nhs.uk/ORD/2-0-0'
const GP_ROLE_ID = 'RO177'

interface GPResult {
  odsCode: string
  name: string
  address: string
  postcode: string
  city: string
  status: string
}

// ============================================
// UK postcode regex patterns
// ============================================
const FULL_POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i
const PARTIAL_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i
const ODS_CODE_RE = /^[A-Z]\d{2,5}[A-Z]?\d*$/i

// ============================================
// Parse query into name terms + postcode + ODS code
// ============================================
interface ParsedQuery {
  nameTerms: string[]
  postcode: string | null
  odsCode: string | null
}

function parseQuery(raw: string): ParsedQuery {
  const cleaned = raw.trim().replace(/\s+/g, ' ')
  const result: ParsedQuery = { nameTerms: [], postcode: null, odsCode: null }

  // 1. Full postcode as entire query
  const fullMatch = cleaned.match(FULL_POSTCODE_RE)
  if (fullMatch) {
    result.postcode = `${fullMatch[1]} ${fullMatch[2]}`.toUpperCase()
    return result
  }

  // 2. Entire query is an ODS code
  if (ODS_CODE_RE.test(cleaned) && cleaned.length <= 7) {
    result.odsCode = cleaned.toUpperCase()
    return result
  }

  // 3. Split tokens, extract postcodes, rest is name
  const tokens = cleaned.split(' ')

  // Check for full postcode spanning two tokens
  for (let i = 0; i < tokens.length - 1; i++) {
    const pair = `${tokens[i]} ${tokens[i + 1]}`
    const pairMatch = pair.match(FULL_POSTCODE_RE)
    if (pairMatch) {
      result.postcode = `${pairMatch[1]} ${pairMatch[2]}`.toUpperCase()
      tokens.splice(i, 2)
      break
    }
  }

  // Check remaining tokens for partial postcode
  const remaining: string[] = []
  for (const token of tokens) {
    if (!result.postcode && PARTIAL_POSTCODE_RE.test(token) && token.length >= 2 && token.length <= 4 && /^[A-Z]{1,2}\d/i.test(token)) {
      result.postcode = token.toUpperCase()
      continue
    }
    remaining.push(token)
  }

  result.nameTerms = remaining
  return result
}

// ============================================
// Action: search
// ============================================
async function handleSearch(body: Record<string, unknown>) {
  const { query, limit = 15 } = body as { query?: string; limit?: number }

  if (!query) throw new Error('Provide a search query (name, postcode, or ODS code)')

  const parsed = parseQuery(query)
  let results: GPResult[] = []

  // Direct ODS code lookup
  if (parsed.odsCode) {
    try {
      const directResult = await lookupSingleOds(parsed.odsCode)
      if (directResult) return { results: [directResult], total: 1 }
    } catch (_) {
      parsed.nameTerms = [parsed.odsCode]
      parsed.odsCode = null
    }
  }

  // Build ODS API search params
  const params = new URLSearchParams()
  params.set('PrimaryRoleId', GP_ROLE_ID)
  params.set('Status', 'Active')
  params.set('Limit', String(Math.min(limit, 25)))

  // All remaining terms go into Name
  const nameSearch = parsed.nameTerms.join(' ').trim()
  if (nameSearch) params.set('Name', nameSearch)
  if (parsed.postcode) params.set('PostCode', parsed.postcode)

  if (!params.has('Name') && !params.has('PostCode')) {
    return { results: [], total: 0 }
  }

  const url = `${ODS_BASE}/organisations?${params.toString()}`

  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) {
      // If postcode format was invalid, retry without it
      if (res.status === 406 && parsed.postcode) {
        params.delete('PostCode')
        if (!params.has('Name') && nameSearch) params.set('Name', nameSearch)
        const retryRes = await fetch(`${ODS_BASE}/organisations?${params.toString()}`, {
          headers: { 'Accept': 'application/json' },
        })
        if (retryRes.ok) {
          const retryData = await retryRes.json()
          results = mapSearchResults(retryData.Organisations || [])
        }
      }
    } else {
      const data = await res.json()
      results = mapSearchResults(data.Organisations || [])
    }
  } catch (fetchErr) {
    console.error('ODS API search error:', fetchErr)
  }

  return {
    results: results.slice(0, limit),
    total: results.length,
  }
}

// ============================================
// Map ODS search results to GPResult
// ============================================
function mapSearchResults(orgs: any[]): GPResult[] {
  return orgs.map((org: any) => ({
    odsCode: org.OrgId || '',
    name: titleCase(org.Name || ''),
    address: '',
    city: '',
    postcode: org.PostCode || '',
    status: (org.Status || 'unknown').toLowerCase(),
  }))
}

// ============================================
// Action: lookup_ods
// Full detail for a single ODS code
// ============================================
async function handleLookupOds(body: Record<string, unknown>) {
  const { ods_code } = body as { ods_code: string }
  if (!ods_code) throw new Error('Missing required field: ods_code')

  const result = await lookupSingleOds(ods_code.trim().toUpperCase())
  if (!result) {
    return {
      odsCode: ods_code.trim().toUpperCase(),
      name: `GP Practice ${ods_code.trim().toUpperCase()}`,
      address: '',
      city: '',
      postcode: '',
      status: 'unknown',
      _note: 'ODS code not found in NHS directory',
    }
  }
  return result
}

// ============================================
// Helper: look up a single ODS code (full detail)
// ============================================
async function lookupSingleOds(odsCode: string): Promise<GPResult | null> {
  const url = `${ODS_BASE}/organisations/${encodeURIComponent(odsCode)}`
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const org = data.Organisation
    if (!org) return null

    const loc = org.GeoLoc?.Location || {}
    const address = [loc.AddrLn1, loc.AddrLn2, loc.AddrLn3].filter(Boolean).join(', ')

    return {
      odsCode: org.OrgId?.extension || odsCode,
      name: titleCase(org.Name || `GP Practice ${odsCode}`),
      address: titleCase(address),
      city: titleCase(loc.Town || ''),
      postcode: loc.PostCode || '',
      status: (org.Status || 'unknown').toLowerCase(),
    }
  } catch (fetchErr) {
    console.error('ODS lookup error:', fetchErr)
    return null
  }
}

// ============================================
// Title Case helper
// ============================================
function titleCase(str: string): string {
  if (!str) return str
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bNhs\b/g, 'NHS')
    .replace(/\bGp\b/g, 'GP')
    .replace(/\bPct\b/g, 'PCT')
    .replace(/\bCcg\b/g, 'CCG')
    .replace(/\bIcb\b/g, 'ICB')
    .replace(/\bOds\b/g, 'ODS')
    .replace(/\b(And|Of|The|In|At|For)\b/g, (m) => m.toLowerCase())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const body = await req.json()
    if (!body.action) throw new Error('Missing action parameter')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    let result: unknown
    switch (body.action) {
      case 'search':     result = await handleSearch(body); break
      case 'lookup_ods': result = await handleLookupOds(body); break
      default: throw new Error(`Unknown action: ${body.action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
