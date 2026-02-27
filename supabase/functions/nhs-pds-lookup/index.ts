// ============================================
// PharmStation Edge Function: nhs-pds-lookup
// NHS Personal Demographics Service (PDS) FHIR R4 lookup
// Verifies patient NHS numbers and retrieves demographics
//
// Actions: lookup | verify | search
//
// NOW LIVE against NHS Sandbox (open access, no auth).
// Switch PDS_BASE to PDS_INT when NHS approval arrives.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// NHS PDS FHIR R4 endpoints
const PDS_SANDBOX = 'https://sandbox.api.service.nhs.uk/personal-demographics/FHIR/R4'
const PDS_INT     = 'https://int.api.service.nhs.uk/personal-demographics/FHIR/R4'
const PDS_PROD    = 'https://api.service.nhs.uk/personal-demographics/FHIR/R4'

// Current environment — sandbox is open access (no auth needed)
const PDS_BASE = PDS_SANDBOX
const IS_SANDBOX = PDS_BASE === PDS_SANDBOX

// ============================================
// Sandbox fake ODS code mapping
// The PDS sandbox returns "Y12345" as the GP practice
// for all test patients. This code does not exist in
// any real NHS directory, so GP name resolution fails.
//
// For testing, we map it to a real active GP practice
// so the downstream ODS lookup can resolve a real name.
// This mapping is ONLY applied in sandbox mode.
// ============================================
const SANDBOX_ODS_REPLACEMENTS: Record<string, string> = {
  'Y12345': 'M92040',  // Mayfield Medical Practice, Wolverhampton, WV1 2GZ
}

function fixSandboxOdsCode(odsCode: string | null): string | null {
  if (!IS_SANDBOX || !odsCode) return odsCode
  return SANDBOX_ODS_REPLACEMENTS[odsCode] ?? odsCode
}

// NHS number mod-11 Luhn-like validation
function validateNHSNumber(nhsNumber: string): boolean {
  if (!/^\d{10}$/.test(nhsNumber)) return false
  const digits = nhsNumber.split('').map(Number)
  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0)
  const remainder = sum % 11
  const checkDigit = remainder === 0 ? 0 : 11 - remainder
  if (checkDigit === 10) return false
  return checkDigit === digits[9]
}

function getAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// ============================================
// Parse FHIR Patient resource into our format
// ============================================
function parseFHIRPatient(fhir: Record<string, unknown>): Record<string, unknown> {
  const names = fhir.name as Array<Record<string, unknown>> | undefined
  const officialName = names?.find((n: any) => n.use === 'usual') || names?.[0]
  const familyName = (officialName?.family as string) ?? null
  const givenNames = (officialName?.given as string[]) ?? []

  const dob = (fhir.birthDate as string) ?? null
  const gender = (fhir.gender as string) ?? null

  const addresses = fhir.address as Array<Record<string, unknown>> | undefined
  const homeAddr = addresses?.find((a: any) => a.use === 'home') || addresses?.[0]
  const addressLine1 = (homeAddr?.line as string[])?.[0] ?? null
  const city = (homeAddr?.city as string) ?? null
  const postcode = (homeAddr?.postalCode as string) ?? null

  // GP ODS code from generalPractitioner[0].identifier.value
  const gps = fhir.generalPractitioner as Array<Record<string, unknown>> | undefined
  const gpEntry = gps?.[0]
  const gpIdentifier = gpEntry?.identifier as Record<string, unknown> | undefined
  let gpOds = (gpIdentifier?.value as string) ?? null

  // Fix sandbox fake ODS codes so downstream GP name resolution works
  gpOds = fixSandboxOdsCode(gpOds)

  // Restricted flag from meta.security
  const meta = fhir.meta as Record<string, unknown> | undefined
  const security = meta?.security as Array<Record<string, unknown>> | undefined
  const restricted = security?.some((s: any) => s.code === 'R') ?? false

  return {
    nhsNumber: (fhir.id as string) ?? null,
    familyName,
    givenNames,
    dateOfBirth: dob,
    gender,
    address: { line: [addressLine1].filter(Boolean), city, postalCode: postcode },
    gpPracticeOdsCode: gpOds,
    restrictedPatient: restricted,
  }
}

// ============================================
// Action: lookup
// Look up a patient by NHS number via PDS API
// ============================================
async function handleLookup(body: Record<string, unknown>, userId: string) {
  const { org_id, nhs_number, patient_id } = body as {
    org_id: string
    nhs_number: string
    patient_id?: string
  }

  if (!org_id) throw new Error('Missing required field: org_id')
  if (!nhs_number) throw new Error('Missing required field: nhs_number')

  const cleanNhsNumber = nhs_number.replace(/\s/g, '')

  // Validate NHS number format (mod-11 check)
  if (!validateNHSNumber(cleanNhsNumber)) {
    throw new Error('Invalid NHS number: failed mod-11 validation')
  }

  const admin = getAdminClient()

  // Check cache first — valid for 24 hours
  const { data: cached } = await admin
    .from('ps_nhs_patient_pds_cache')
    .select('*')
    .eq('nhs_number', cleanNhsNumber)
    .eq('org_id', org_id)
    .gte('last_verified_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle()

  if (cached) {
    return {
      source: 'cache',
      nhs_number: cleanNhsNumber,
      patient: {
        nhsNumber:         cached.nhs_number,
        familyName:        cached.pds_family_name,
        givenNames:        cached.pds_given_names,
        dateOfBirth:       cached.pds_dob,
        gender:            cached.pds_gender,
        address:           { line: [cached.pds_address_line1], postalCode: cached.pds_address_postcode },
        gpPracticeOdsCode: fixSandboxOdsCode(cached.pds_gp_ods),
        restrictedPatient: cached.pds_restricted,
      },
    }
  }

  // ============================================
  // Call NHS PDS FHIR API (Sandbox = open access)
  // For INT/PROD, add Authorization: Bearer <token>
  // ============================================
  const headers: Record<string, string> = {
    'X-Request-ID': crypto.randomUUID(),
    'Accept': 'application/fhir+json',
  }

  // If we have an API key (for INT/PROD), add auth header
  const apiKey = Deno.env.get('NHS_PDS_API_KEY')
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const pdsUrl = `${PDS_BASE}/Patient/${cleanNhsNumber}`
  const pdsRes = await fetch(pdsUrl, { headers })

  if (!pdsRes.ok) {
    const errBody = await pdsRes.text()
    if (pdsRes.status === 404) {
      throw new Error('Patient not found in PDS')
    }
    throw new Error(`PDS API error (${pdsRes.status}): ${errBody.substring(0, 200)}`)
  }

  const pdsData = await pdsRes.json()
  const patient = parseFHIRPatient(pdsData)

  const familyName   = patient.familyName as string | null
  const givenNames   = patient.givenNames as string[]
  const dob          = patient.dateOfBirth as string | null
  const gender       = patient.gender as string | null
  const addr         = patient.address as Record<string, unknown>
  const addressLine1 = (addr?.line as string[])?.[0] ?? null
  const postcode     = (addr?.postalCode as string) ?? null
  const gpOds        = patient.gpPracticeOdsCode as string | null
  const restricted   = patient.restrictedPatient as boolean

  // Upsert PDS cache
  await admin
    .from('ps_nhs_patient_pds_cache')
    .upsert({
      nhs_number:           cleanNhsNumber,
      patient_id:           patient_id ?? null,
      org_id,
      pds_family_name:      familyName,
      pds_given_names:      givenNames,
      pds_dob:              dob,
      pds_gender:           gender,
      pds_address_line1:    addressLine1,
      pds_address_postcode: postcode,
      pds_gp_ods:           gpOds,
      pds_restricted:       restricted,
      full_pds_response:    pdsData,
      last_verified_at:     new Date().toISOString(),
      verified_by:          userId,
    }, { onConflict: 'nhs_number' })

  return {
    source: 'pds',
    nhs_number: cleanNhsNumber,
    patient,
  }
}

// ============================================
// Action: search
// Search PDS by demographics (name, DOB, etc)
// Sandbox returns canned responses for specific searches
// ============================================
async function handleSearch(body: Record<string, unknown>) {
  const { family, given, birthdate, gender: g, postcode } = body as {
    family?: string; given?: string; birthdate?: string; gender?: string; postcode?: string
  }

  if (!family) throw new Error('At least family name is required for PDS search')

  const params = new URLSearchParams()
  params.set('family', family)
  if (given) params.set('given', given)
  if (birthdate) params.set('birthdate', birthdate)
  if (g) params.set('gender', g)
  if (postcode) params.set('address-postalcode', postcode)

  const headers: Record<string, string> = {
    'X-Request-ID': crypto.randomUUID(),
    'Accept': 'application/fhir+json',
  }

  const apiKey = Deno.env.get('NHS_PDS_API_KEY')
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const searchUrl = `${PDS_BASE}/Patient?${params.toString()}`
  const res = await fetch(searchUrl, { headers })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`PDS search error (${res.status}): ${errBody.substring(0, 200)}`)
  }

  const bundle = await res.json()
  // FHIR Bundle — extract entries
  const entries = (bundle.entry || []) as Array<Record<string, unknown>>
  const patients = entries.map((e: any) => parseFHIRPatient(e.resource))

  return {
    total: bundle.total ?? patients.length,
    patients,
  }
}

// ============================================
// Action: verify
// Verify a patient's NHS number matches known demographics
// ============================================
async function handleVerify(body: Record<string, unknown>, userId: string) {
  const { org_id, nhs_number, expected_dob, expected_family_name } = body as {
    org_id: string; nhs_number: string; expected_dob?: string; expected_family_name?: string
  }

  if (!org_id || !nhs_number) throw new Error('Missing org_id or nhs_number')

  const lookupResult = await handleLookup({ org_id, nhs_number, ...body }, userId) as Record<string, unknown>
  const patient = lookupResult.patient as Record<string, unknown>

  let verified = true
  const mismatches: string[] = []

  if (expected_dob && patient.dateOfBirth !== expected_dob) {
    verified = false
    mismatches.push('date_of_birth')
  }

  if (expected_family_name && (patient.familyName as string)?.toLowerCase() !== expected_family_name.toLowerCase()) {
    verified = false
    mismatches.push('family_name')
  }

  return { verified, mismatches, patient }
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
      case 'lookup':  result = await handleLookup(body, user.id); break
      case 'search':  result = await handleSearch(body); break
      case 'verify':  result = await handleVerify(body, user.id); break
      default: throw new Error(`Unknown action: ${body.action}`)
    }
    return new Response(JSON.stringify(result), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errMsg }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
