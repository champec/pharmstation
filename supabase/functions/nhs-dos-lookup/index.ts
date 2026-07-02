// ============================================
// PharmStation Edge Function: nhs-dos-lookup
// NHS Directory of Services (DoS) UEC REST API
//
// Actions:
//   byODSCode   — get service(s) for a pharmacy ODS code
//   byServiceId — get a specific DoS service by ID
//   search      — search services by name / postcode / type
//
// Environments:
//   Sandbox: open access, no API key needed
//   INT/PROD: requires NHS_DOS_API_KEY env var
//
// Switch DOS_BASE to DOS_INT / DOS_PROD when
// NHS Digital Onboarding API assurance is passed.
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

// DoS UEC REST API base URLs
// Note: the portal-approved endpoints for Pharmstation are byODSCode and byServiceId
const DOS_SANDBOX = 'https://sandbox.api.service.nhs.uk/dos/dosapi/dosrest/v2.0'
const DOS_INT     = 'https://int.api.service.nhs.uk/dos/dosapi/dosrest/v2.0'
const DOS_PROD    = 'https://api.service.nhs.uk/dos/dosapi/dosrest/v2.0'

// Service-search POST endpoint base URLs
const SEARCH_SANDBOX = 'https://sandbox.api.service.nhs.uk/service-search-api/search'
const SEARCH_INT     = 'https://int.api.service.nhs.uk/service-search-api/search'
const SEARCH_PROD    = 'https://api.service.nhs.uk/service-search-api/search'

// Current environment — switch to DOS_INT once INT API key is available
const DOS_BASE    = DOS_SANDBOX
const IS_SANDBOX  = DOS_BASE === DOS_SANDBOX
const SEARCH_BASE = IS_SANDBOX ? SEARCH_SANDBOX : DOS_BASE === DOS_INT ? SEARCH_INT : SEARCH_PROD

// ============================================
// Build request headers
// Sandbox: open access
// INT/PROD: requires API key in Authorization header
// ============================================
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Request-ID': crypto.randomUUID(),
  }
  const apiKey = Deno.env.get('NHS_DOS_API_KEY')
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  return headers
}

// ============================================
// Consistent error response shape
// Ensures Q2/Q3 conformance evidence is clear
// ============================================
function errorResponse(status: number, code: string, message: string, detail?: string) {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
        ...(detail ? { detail } : {}),
        timestamp: new Date().toISOString(),
      },
    }),
    {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  )
}

function successResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ============================================
// Audit logging (Risks DosRESTAPI-003 / 004 / 007)
// Every DoS query is recorded in ps_nhs_api_audit —
// a dedicated, append-only API-query audit table — with
// the caller's user_id, org, params, ODS code, HTTP
// status and outcome. Written server-side via the
// service role so the client cannot bypass or forge it.
// ============================================
function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

interface AuditEntry {
  user_id: string
  organisation_id?: string | null
  action: string
  query_params?: Record<string, unknown> | null
  ods_code?: string | null
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
      api:             'dos',
      action:          entry.action,
      query_params:    entry.query_params ?? null,
      ods_code:        entry.ods_code ?? null,
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

// Extract non-sensitive query params + ODS code for the
// audit row, based on the action. DoS params (ODS codes,
// postcodes, service names/IDs) are reference data, not
// patient-identifiable data.
function auditParamsFor(
  action: string,
  body: Record<string, unknown>,
): { query_params: Record<string, unknown>; ods_code: string | null } {
  switch (action) {
    case 'byODSCode': {
      const ods = typeof body.ods_code === 'string' ? body.ods_code.trim().toUpperCase() : null
      return { query_params: { ods_code: body.ods_code ?? null }, ods_code: ods }
    }
    case 'byServiceId':
      return { query_params: { service_id: body.service_id ?? null }, ods_code: null }
    case 'search':
      return {
        query_params: {
          postcode:        body.postcode ?? null,
          name:            body.name ?? null,
          service_types:   body.service_types ?? null,
          search_distance: body.search_distance ?? null,
        },
        ods_code: null,
      }
    default:
      return { query_params: {}, ods_code: null }
  }
}

// ============================================
// Action: byODSCode
// Retrieve DoS service profile(s) for a pharmacy
// identified by its ODS code.
// Used to: verify a pharmacy is registered in DoS,
// retrieve their service type(s) and opening hours.
// ============================================
async function handleByOdsCode(body: Record<string, unknown>) {
  const { ods_code } = body as { ods_code?: string }

  if (!ods_code || typeof ods_code !== 'string' || ods_code.trim().length === 0) {
    return errorResponse(400, 'INVALID_REQUEST', 'Missing or empty required field: ods_code')
  }

  const cleanOds = ods_code.trim().toUpperCase()

  // Basic ODS code format check (5 alphanumeric chars)
  if (!/^[A-Z0-9]{3,6}$/.test(cleanOds)) {
    return errorResponse(
      400,
      'INVALID_ODS_CODE',
      `Invalid ODS code format: '${cleanOds}'. Expected 3–6 alphanumeric characters.`,
    )
  }

  const url = `${DOS_BASE}/services/byODSCode/${encodeURIComponent(cleanOds)}`

  let dosRes: Response
  try {
    dosRes = await fetch(url, { headers: buildHeaders() })
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr)
    return errorResponse(503, 'DOS_UNAVAILABLE', 'Unable to reach DoS API', msg)
  }

  // Forward DoS error responses with descriptive messages
  if (!dosRes.ok) {
    const rawBody = await dosRes.text().catch(() => '')
    let detail = rawBody.substring(0, 500)

    if (dosRes.status === 404) {
      return errorResponse(
        404,
        'SERVICE_NOT_FOUND',
        `No DoS service found for ODS code '${cleanOds}'. The pharmacy may not be registered in the Directory of Services, or registration may be pending with their local ICS DoS Lead.`,
        detail || undefined,
      )
    }
    if (dosRes.status === 401 || dosRes.status === 403) {
      return errorResponse(
        dosRes.status,
        'DOS_AUTH_ERROR',
        'DoS API authentication failed. Check NHS_DOS_API_KEY environment variable.',
        detail || undefined,
      )
    }
    if (dosRes.status === 429) {
      return errorResponse(
        429,
        'RATE_LIMITED',
        'DoS API rate limit exceeded. Retry after 1 second. (Sandbox: 1 req/sec; INT: 1500/week)',
        detail || undefined,
      )
    }
    if (dosRes.status >= 500) {
      return errorResponse(
        502,
        'DOS_SERVER_ERROR',
        `DoS API returned server error (${dosRes.status}). This is an NHS-side issue. Retry shortly or check https://status.api.service.nhs.uk.`,
        detail || undefined,
      )
    }
    return errorResponse(
      dosRes.status,
      'DOS_ERROR',
      `DoS API returned unexpected status ${dosRes.status}`,
      detail || undefined,
    )
  }

  const data = await dosRes.json()
  return successResponse({
    source: IS_SANDBOX ? 'sandbox' : 'live',
    ods_code: cleanOds,
    services: data,
  })
}

// ============================================
// Action: byServiceId
// Retrieve a specific DoS service by its numeric ID.
// Used to: fetch full service detail for a known
// DoS service ID (e.g. retrieved from NHS 111 referral).
// ============================================
async function handleByServiceId(body: Record<string, unknown>) {
  const { service_id } = body as { service_id?: string | number }

  if (!service_id && service_id !== 0) {
    return errorResponse(400, 'INVALID_REQUEST', 'Missing required field: service_id')
  }

  const id = String(service_id).trim()
  if (!/^\d+$/.test(id)) {
    return errorResponse(
      400,
      'INVALID_SERVICE_ID',
      `Invalid service_id: '${id}'. Expected a numeric DoS service ID.`,
    )
  }

  const url = `${DOS_BASE}/services/byServiceId/${encodeURIComponent(id)}`

  let dosRes: Response
  try {
    dosRes = await fetch(url, { headers: buildHeaders() })
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr)
    return errorResponse(503, 'DOS_UNAVAILABLE', 'Unable to reach DoS API', msg)
  }

  if (!dosRes.ok) {
    const rawBody = await dosRes.text().catch(() => '')
    const detail = rawBody.substring(0, 500)

    if (dosRes.status === 404) {
      return errorResponse(
        404,
        'SERVICE_NOT_FOUND',
        `No DoS service found with ID '${id}'. The service ID may be invalid or the service may have been decommissioned.`,
        detail || undefined,
      )
    }
    if (dosRes.status === 401 || dosRes.status === 403) {
      return errorResponse(dosRes.status, 'DOS_AUTH_ERROR', 'DoS API authentication failed.', detail || undefined)
    }
    if (dosRes.status >= 500) {
      return errorResponse(
        502,
        'DOS_SERVER_ERROR',
        `DoS API returned server error (${dosRes.status}). NHS-side issue — retry shortly.`,
        detail || undefined,
      )
    }
    return errorResponse(dosRes.status, 'DOS_ERROR', `DoS API returned unexpected status ${dosRes.status}`, detail || undefined)
  }

  const data = await dosRes.json()
  return successResponse({
    source: IS_SANDBOX ? 'sandbox' : 'live',
    service_id: id,
    service: data,
  })
}

// ============================================
// Action: search
// Search DoS services by name, postcode, service type.
// Uses POST /search endpoint.
// ============================================
async function handleSearch(body: Record<string, unknown>) {
  const { search_distance, postcode, service_types, name } = body as {
    search_distance?: number
    postcode?: string
    service_types?: number[]
    name?: string
  }

  if (!postcode && !name) {
    return errorResponse(400, 'INVALID_REQUEST', 'At least one of postcode or name is required for DoS search.')
  }

  const searchPayload: Record<string, unknown> = {
    searchDistance: search_distance ?? 5,
    ...(postcode ? { postcode } : {}),
    ...(service_types ? { serviceTypeIds: service_types } : {}),
    ...(name ? { name } : {}),
  }

  const searchUrl = SEARCH_BASE

  let dosRes: Response
  try {
    dosRes = await fetch(searchUrl, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(searchPayload),
    })
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr)
    return errorResponse(503, 'DOS_UNAVAILABLE', 'Unable to reach DoS Search API', msg)
  }

  if (!dosRes.ok) {
    const rawBody = await dosRes.text().catch(() => '')
    const detail = rawBody.substring(0, 500)

    if (dosRes.status === 400) {
      return errorResponse(
        400,
        'INVALID_SEARCH_PARAMS',
        'DoS search returned 400 — check postcode format and search parameters.',
        detail || undefined,
      )
    }
    if (dosRes.status >= 500) {
      return errorResponse(502, 'DOS_SERVER_ERROR', `DoS Search API server error (${dosRes.status}).`, detail || undefined)
    }
    return errorResponse(dosRes.status, 'DOS_ERROR', `DoS Search API returned ${dosRes.status}`, detail || undefined)
  }

  const data = await dosRes.json()
  return successResponse({
    source: IS_SANDBOX ? 'sandbox' : 'live',
    results: data,
  })
}

// ============================================
// Main handler
// ============================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST requests are accepted.')
  }

  // ============================================
  // Auth guard (Risk DosRESTAPI-002)
  // Reject unauthenticated requests at entry, before any
  // DoS API call is made. Mirrors nhs-pds-lookup: validate
  // the caller's Supabase JWT via auth.getUser(). A missing
  // or invalid token returns a clean 401 UNAUTHORIZED.
  // ============================================
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return errorResponse(
      401,
      'UNAUTHORIZED',
      'Missing Authorization header. A valid Supabase access token is required.',
    )
  }

  let userId: string
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return errorResponse(401, 'UNAUTHORIZED', 'Invalid or expired access token.')
    }
    userId = user.id
  } catch (authErr: unknown) {
    const msg = authErr instanceof Error ? authErr.message : String(authErr)
    return errorResponse(401, 'UNAUTHORIZED', 'Authentication failed.', msg)
  }

  // Context for the audit trail. IP is behind the Supabase/CF edge.
  let ipAddress: string | null =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    null
  // Guard against a malformed value breaking the INET insert.
  if (ipAddress && !/^[0-9a-fA-F:.]+$/.test(ipAddress)) ipAddress = null
  const requestId =
    req.headers.get('sb-request-id') || req.headers.get('x-request-id') || null

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.')
  }

  const { action } = body as { action?: string }

  if (!action) {
    return errorResponse(
      400,
      'MISSING_ACTION',
      "Missing required field: 'action'. Expected one of: byODSCode | byServiceId | search",
    )
  }

  // Resolve org for the audit trail (best-effort): explicit
  // body.org_id, else the caller's active membership.
  let orgId: string | null = typeof body.org_id === 'string' ? body.org_id : null
  if (!orgId) {
    try {
      const admin = getAdminClient()
      const { data: membership } = await admin
        .from('ps_organisation_members')
        .select('organisation_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      orgId = (membership?.organisation_id as string) ?? null
    } catch {
      orgId = null
    }
  }

  // Dispatch the action, then audit the outcome before returning.
  let response: Response
  try {
    switch (action) {
      case 'byODSCode':
        response = await handleByOdsCode(body)
        break
      case 'byServiceId':
        response = await handleByServiceId(body)
        break
      case 'search':
        response = await handleSearch(body)
        break
      default:
        response = errorResponse(
          400,
          'UNKNOWN_ACTION',
          `Unknown action: '${action}'. Expected one of: byODSCode | byServiceId | search`,
        )
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    response = errorResponse(500, 'INTERNAL_ERROR', 'Unexpected internal error', message)
  }

  // ============================================
  // Write the audit record (Risks 003 / 004 / 007).
  // On the success path the audit write is MANDATORY:
  // if it fails we do NOT return DoS data — we return 500
  // instead, so no DoS detail is ever surfaced to a user
  // without a corresponding audit entry.
  // ============================================
  const outcome: 'success' | 'error' = response.status < 400 ? 'success' : 'error'
  const { query_params, ods_code } = auditParamsFor(action, body)

  let errorDetail: string | null = null
  if (outcome === 'error') {
    try {
      const cloned = await response.clone().json()
      errorDetail = JSON.stringify(cloned).substring(0, 500)
    } catch {
      errorDetail = null
    }
  }

  const audit = await writeAudit({
    user_id:         userId,
    organisation_id: orgId,
    action,
    query_params,
    ods_code,
    http_status:     response.status,
    outcome,
    error_detail:    errorDetail,
    ip_address:      ipAddress,
    request_id:      requestId,
  })

  if (!audit.ok && outcome === 'success') {
    return errorResponse(
      500,
      'AUDIT_WRITE_FAILED',
      'The query succeeded but its audit record could not be written, so the result has been withheld. Please retry.',
      audit.error,
    )
  }

  return response
})
