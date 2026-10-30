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

// @ts-ignore — esm.sh URL import resolves in the Supabase Deno runtime, not tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

// @ts-ignore Deno globals — this runs in Supabase Deno runtime, not Node/tsc
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

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

// The admin client bypasses RLS, so this is the tenant check: the caller
// must be the org's own auth user or an active member of the org.
async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const admin = getAdminClient()
  const { data: org } = await admin
    .from('ps_organisations').select('auth_user_id').eq('id', orgId).maybeSingle()
  if (!org) return false
  if (org.auth_user_id === userId) return true
  const { data: member } = await admin
    .from('ps_organisation_members').select('user_id')
    .eq('organisation_id', orgId).eq('user_id', userId).eq('status', 'active')
    .maybeSingle()
  return !!member
}

// ============================================
// Audit logging (Risk APPRESTPDSCONN-019)
// Every PDS query is recorded in ps_nhs_api_audit —
// a dedicated, append-only API-query audit table — with
// the caller's user_id, org, action, the NHS number /
// search params queried, HTTP status and outcome.
// Written server-side via the service role so the client
// cannot bypass or forge it. Mirrors nhs-dos-lookup.
// ============================================
interface AuditEntry {
  user_id: string
  organisation_id?: string | null
  action: string
  query_params?: Record<string, unknown> | null
  http_status: number
  outcome: 'success' | 'error'
  error_detail?: string | null
  ip_address?: string | null
  request_id?: string | null
}

async function writeAudit(entry: AuditEntry): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = getAdminClient()
    const { error } = await admin.from('ps_nhs_api_audit').insert({
      user_id:         entry.user_id,
      organisation_id: entry.organisation_id ?? null,
      api:             'pds',
      action:          entry.action,
      query_params:    entry.query_params ?? null,
      ods_code:        null,
      http_status:     entry.http_status,
      outcome:         entry.outcome,
      error_detail:    entry.error_detail ?? null,
      ip_address:      entry.ip_address ?? null,
      request_id:      entry.request_id ?? null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Capture the NHS number / search terms queried for the
// audit row. Recording which patient was accessed is an
// IG requirement (APPRESTPDSCONN-019); the audit table is
// append-only and access-controlled by RLS.
function pdsAuditParams(action: string, body: Record<string, unknown>): Record<string, unknown> {
  const nhs = typeof body.nhs_number === 'string' ? body.nhs_number.replace(/\s/g, '') : null
  switch (action) {
    case 'lookup':
    case 'verify':
      return { nhs_number: nhs }
    case 'search':
      return {
        family:    body.family ?? null,
        given:     body.given ?? null,
        birthdate: body.birthdate ?? null,
        gender:    body.gender ?? null,
        postcode:  body.postcode ?? null,
      }
    default:
      return {}
  }
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
  let gpOds: string | null = (gpIdentifier?.value as string) ?? null

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

  // Context captured for the audit trail once known.
  let userId: string | null = null
  let action: string | null = null
  let orgId: string | null = null
  let auditParams: Record<string, unknown> | null = null
  let ipAddress: string | null =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    null
  if (ipAddress && !/^[0-9a-fA-F:.]+$/.test(ipAddress)) ipAddress = null
  const requestId =
    req.headers.get('sb-request-id') || req.headers.get('x-request-id') || null

  try {
    const body = await req.json()
    if (!body.action) throw new Error('Missing action parameter')
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    // Capture context now that the caller is authenticated.
    userId = user.id
    action = body.action as string
    orgId = typeof body.org_id === 'string' ? body.org_id : null
    auditParams = pdsAuditParams(action, body)

    // Checked after capturing context so denied attempts are audited too.
    if (typeof body.org_id !== 'string' || !(await isOrgMember(user.id, body.org_id))) {
      throw new Error('Forbidden')
    }

    let result: unknown
    switch (body.action) {
      case 'lookup':  result = await handleLookup(body, user.id); break
      case 'search':  result = await handleSearch(body); break
      case 'verify':  result = await handleVerify(body, user.id); break
      default: throw new Error(`Unknown action: ${body.action}`)
    }

    // ============================================
    // Audit the successful PDS query (APPRESTPDSCONN-019).
    // Mandatory on success: if the audit write fails we do
    // NOT return patient data — we return 500 instead, so
    // no PDS detail is surfaced without an audit entry.
    // ============================================
    const audit = await writeAudit({
      user_id:         user.id,
      organisation_id: orgId,
      action,
      query_params:    auditParams,
      http_status:     200,
      outcome:         'success',
      ip_address:      ipAddress,
      request_id:      requestId,
    })
    if (!audit.ok) {
      return new Response(
        JSON.stringify({ error: 'Query succeeded but its audit record could not be written, so the result has been withheld. Please retry.' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify(result), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    // Audit the failed PDS query when we know who made it.
    if (userId && action) {
      await writeAudit({
        user_id:         userId,
        organisation_id: orgId,
        action,
        query_params:    auditParams,
        http_status:     400,
        outcome:         'error',
        error_detail:    errMsg.substring(0, 500),
        ip_address:      ipAddress,
        request_id:      requestId,
      })
    }
    return new Response(JSON.stringify({ error: errMsg }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
