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

  try {
    switch (action) {
      case 'byODSCode':
        return await handleByOdsCode(body)
      case 'byServiceId':
        return await handleByServiceId(body)
      case 'search':
        return await handleSearch(body)
      default:
        return errorResponse(
          400,
          'UNKNOWN_ACTION',
          `Unknown action: '${action}'. Expected one of: byODSCode | byServiceId | search`,
        )
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(500, 'INTERNAL_ERROR', 'Unexpected internal error', message)
  }
})
