// ============================================
// PharmStation Edge Function: nhs-pds-lookup
// NHS Personal Demographics Service (PDS) FHIR R4 lookup
// Verifies patient NHS numbers and retrieves demographics
//
// Actions: lookup | verify
//
// [A6 SCAFFOLD] PDS API calls are STUBBED.
// Replace stub in Phase D once NHS Developer Portal
// API access is approved (action A2).
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// NHS PDS FHIR R4 endpoint
// Sandbox (no real data, for development): https://sandbox.api.service.nhs.uk/personal-demographics/FHIR/R4
// Integration (requires NHS Developer Portal approval): https://int.api.service.nhs.uk/personal-demographics/FHIR/R4
// Production: https://api.service.nhs.uk/personal-demographics/FHIR/R4
const PDS_SANDBOX   = 'https://sandbox.api.service.nhs.uk/personal-demographics/FHIR/R4'
const PDS_INT       = 'https://int.api.service.nhs.uk/personal-demographics/FHIR/R4'
const PDS_PROD      = 'https://api.service.nhs.uk/personal-demographics/FHIR/R4'

// NHS number mod-11 Luhn-like validation
function validateNHSNumber(nhsNumber: string): boolean {
  if (!/^\d{10}$/.test(nhsNumber)) return false
  const digits = nhsNumber.split('').map(Number)
  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0)
  const remainder = sum % 11
  const checkDigit = remainder === 0 ? 0 : 11 - remainder
  if (checkDigit === 10) return false // invalid NHS number
  return checkDigit === digits[9]
}

function getAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// ============================================
// Action: lookup
// Look up a patient by NHS number.
// Caches result in nhs_patient_pds_cache.
// ============================================

async function handleLookup(body: Record<string, unknown>, userId: string) {
  const { org_id, nhs_number, patient_id } = body as {
    org_id: string
    nhs_number: string
    patient_id?: string
  }

  if (!org_id) throw new Error('Missing required field: org_id')
  if (!nhs_number) throw new Error('Missing required field: nhs_number')

  // Validate NHS number format (mod-11 check)
  if (!validateNHSNumber(nhs_number.replace(/\s/g, ''))) {
    throw new Error('Invalid NHS number: failed mod-11 validation')
  }

  const cleanNhsNumber = nhs_number.replace(/\s/g, '')
  const admin = getAdminClient()

  // Check cache first — valid for 24 hours
  const { data: cached } = await admin
    .from('nhs_patient_pds_cache')
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
        nhsNumber:          cached.nhs_number,
        familyName:         cached.pds_family_name,
        givenNames:         cached.pds_given_names,
        dateOfBirth:        cached.pds_dob,
        gender:             cached.pds_gender,
        address:            { line: [cached.pds_address_line1], postalCode: cached.pds_address_postcode },
        gpPracticeOdsCode:  cached.pds_gp_ods,
        restrictedPatient:  cached.pds_restricted,
      },
    }
  }

  // ================================================================
  // [STUB] PDS FHIR API CALL — Replace with real API call in Phase D
  // Requires: NHS Developer Portal API access (task A2)
  //
  // TODO Phase D: Replace this stub with:
  //   const apiKey = Deno.env.get('NHS_PDS_API_KEY')!
  //   const pdsRes = await fetch(`${PDS_INT}/Patient/${cleanNhsNumber}`, {
  //     headers: {
  //       'Authorization': `Bearer ${apiKey}`,
  //       'X-Request-ID': crypto.randomUUID(),
  //       'X-Correlation-ID': crypto.randomUUID(),
  //     }
  //   })
  //   const pdsData = await pdsRes.json()
  //   // Extract fields from FHIR R4 Patient resource
  // ================================================================
  const pdsData = {
    resourceType: 'Patient',
    id: cleanNhsNumber,
    identifier: [{ value: cleanNhsNumber }],
    name: [{ family: 'STUB-FAMILY', given: ['STUB-GIVEN'] }],
    birthDate: '1990-01-01',
    gender: 'unknown',
    address: [{ line: ['1 Stub Street'], postalCode: 'SW1A 1AA' }],
    generalPractitioner: [{ identifier: { value: 'A12345' } }],
    _stub: true,
    _note: 'PDS API access pending approval — this is a stub response',
  }
  // ================================================================

  const familyName   = (pdsData.name?.[0]?.family as string) ?? null
  const givenNames   = (pdsData.name?.[0]?.given as string[]) ?? []
  const dob          = (pdsData.birthDate as string) ?? null
  const gender       = (pdsData.gender as string) ?? null
  const addressLine1 = (pdsData.address?.[0]?.line?.[0] as string) ?? null
  const postcode     = (pdsData.address?.[0]?.postalCode as string) ?? null
  const gpOds        = (pdsData.generalPractitioner?.[0]?.identifier?.value as string) ?? null
  const restricted   = !!(pdsData as Record<string, unknown>).meta

  // Upsert PDS cache
  await admin
    .from('nhs_patient_pds_cache')
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
    patient: {
      nhsNumber: cleanNhsNumber,
      familyName, givenNames, dateOfBirth: dob, gender,
      address: { line: [addressLine1], postalCode: postcode },
      gpPracticeOdsCode: gpOds,
      restrictedPatient: restricted,
    },
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

  // Do the lookup first
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
      case 'lookup': result = await handleLookup(body, user.id); break
      case 'verify': result = await handleVerify(body, user.id); break
      default: throw new Error(`Unknown action: ${body.action}`)
    }
    return new Response(JSON.stringify(result), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errMsg }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
