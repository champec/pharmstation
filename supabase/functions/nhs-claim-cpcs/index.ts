// ============================================
// PharmStation Edge Function: nhs-claim-cpcs
// Handles NHSBSA MYS claim submission for:
//   CPCS (EMG_MED, MIN_ILL, EMG_MED_UEC, MIN_ILL_UEC)
//   Pharmacy First / CCS
//   Flu Vaccination (FLU_VAC)
//   COVID Vaccination (COVID_VAC, GP_COVID_VAC)
//
// All use the same NHSBSA CPCS API endpoint.
//
// Actions: submit | update | delete | get
//
// [A6 SCAFFOLD] NHSBSA API calls are STUBBED.
// Replace stub sections in Phase B once staging credentials received.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// NHSBSA staging endpoint — all CPCS-family services
const NHSBSA_CPCS_STAGING = 'https://stg.services.nhsbsa.nhs.uk/pharmacy-cpcs-api/resources/Claim'
const NHSBSA_CPCS_PROD = 'https://services.nhsbsa.nhs.uk/pharmacy-cpcs-api/resources/Claim'

const CPCS_CLAIM_TYPES = ['EMG_MED', 'MIN_ILL', 'EMG_MED_UEC', 'MIN_ILL_UEC', 'CCS', 'FLU_VAC', 'COVID_VAC', 'GP_COVID_VAC']

// Maps NHSBSA CLAIM_TYPE_CODE → our nhs_service_type enum
const CLAIM_TYPE_TO_SERVICE_TYPE: Record<string, string> = {
  EMG_MED:     'cpcs_emg_med',
  MIN_ILL:     'cpcs_min_ill',
  EMG_MED_UEC: 'cpcs_emg_uec',
  MIN_ILL_UEC: 'cpcs_min_ill_uec',
  CCS:         'cpcs_ccs',
  FLU_VAC:     'flu_vac',
  COVID_VAC:   'covid_vac',
  GP_COVID_VAC:'gp_covid_vac',
}

// ============================================
// Helpers
// ============================================

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function generateDepositId(odsCode: string, env: string): string {
  const prefix = env === 'production' ? 'PSN' : 'PSN-TEST'
  return `${prefix}-${odsCode}-${Date.now()}`
}

function getClaimYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function logAttempt(
  admin: ReturnType<typeof getAdminClient>,
  submissionId: string,
  opts: {
    attemptNumber: number
    httpMethod: string
    endpointUrl: string
    requestPayload: unknown
    responseStatus: number
    responseBody: unknown
    errorMessage?: string
    succeeded: boolean
  },
) {
  await admin.from('nhs_submission_attempts').insert({
    submission_id:    submissionId,
    attempt_number:   opts.attemptNumber,
    http_method:      opts.httpMethod,
    endpoint_url:     opts.endpointUrl,
    request_payload:  opts.requestPayload,
    response_status:  opts.responseStatus,
    response_body:    opts.responseBody,
    error_message:    opts.errorMessage ?? null,
    succeeded:        opts.succeeded,
  })
}

// ============================================
// Action: submit
// Creates a new NHSBSA claim from a service delivery
// ============================================

async function handleSubmit(body: Record<string, unknown>, userId: string) {
  const {
    org_id,
    patient_id,
    service_delivery_id,
    claim_type_code,
    payload: claimPayload,
  } = body as {
    org_id: string
    patient_id?: string
    service_delivery_id?: string
    claim_type_code: string
    payload: Record<string, unknown>
  }

  if (!org_id) throw new Error('Missing required field: org_id')
  if (!claim_type_code) throw new Error('Missing required field: claim_type_code')
  if (!claimPayload) throw new Error('Missing required field: payload')
  if (!CPCS_CLAIM_TYPES.includes(claim_type_code)) {
    throw new Error(`Invalid claim_type_code: ${claim_type_code}. Must be one of: ${CPCS_CLAIM_TYPES.join(', ')}`)
  }

  // Pharmacy First (CCS) specific validation
  if (claim_type_code === 'CCS') {
    if (!claimPayload.CCS_PRESENTING_COMPLAINT_OR_ISSUE) {
      throw new Error('CCS claims require CCS_PRESENTING_COMPLAINT_OR_ISSUE')
    }
    if (!claimPayload.PROFESSIONAL_IDENTIFIER) {
      throw new Error('CCS claims require PROFESSIONAL_IDENTIFIER (GPhC/NMC number)')
    }
    // Otitis Media must be face-to-face
    if (
      claimPayload.CCS_PRESENTING_COMPLAINT_OR_ISSUE === 'A_O_M' &&
      claimPayload.CONSULTATION_METHOD !== 'FACE_TO_FACE'
    ) {
      throw new Error('Acute Otitis Media (A_O_M) requires CONSULTATION_METHOD = FACE_TO_FACE')
    }
  }

  // Common required fields
  if (!claimPayload.PATIENT_NHSNO) throw new Error('Missing PATIENT_NHSNO in payload')
  if (!claimPayload.ASSESSMENT_DATE) throw new Error('Missing ASSESSMENT_DATE in payload')
  if (!claimPayload.CONSULTATION_METHOD && !['FLU_VAC', 'COVID_VAC', 'GP_COVID_VAC'].includes(claim_type_code)) {
    throw new Error('Missing CONSULTATION_METHOD in payload')
  }

  const admin = getAdminClient()

  // Load org to get ODS code and BSA environment
  const { data: org, error: orgError } = await admin
    .from('ps_organisations')
    .select('ods_code, nhs_bsa_environment')
    .eq('id', org_id)
    .single()

  if (orgError || !org) throw new Error(`Organisation not found: ${orgError?.message}`)
  if (!org.ods_code) throw new Error('Organisation has no ODS code configured. Set it in NHS Settings.')

  const depositId = generateDepositId(org.ods_code, org.nhs_bsa_environment)
  const yearMonth = getClaimYearMonth()
  const serviceType = CLAIM_TYPE_TO_SERVICE_TYPE[claim_type_code]
  const endpoint = org.nhs_bsa_environment === 'production' ? NHSBSA_CPCS_PROD : NHSBSA_CPCS_STAGING

  // Build full NHSBSA payload
  const nhsbsaPayload = {
    PLATFORM_DEPOSIT_ID: depositId,
    CLAIMANT_ODS: org.ods_code,
    CLAIM_YEAR_MONTH: yearMonth,
    CLAIM_TYPE_CODE: claim_type_code,
    ...claimPayload,
  }

  // Create nhs_claim_submissions record at 'pending' status
  const { data: submission, error: insertError } = await admin
    .from('nhs_claim_submissions')
    .insert({
      org_id,
      patient_id:          patient_id ?? null,
      service_delivery_id: service_delivery_id ?? null,
      service_type:        serviceType,
      platform_deposit_id: depositId,
      claim_year_month:    yearMonth,
      status:              'pending',
      payload:             nhsbsaPayload,
      created_by:          userId,
    })
    .select()
    .single()

  if (insertError) throw new Error(`Failed to create submission record: ${insertError.message}`)

  // ================================================================
  // [STUB] NHSBSA API CALL — Replace with real proxy call in Phase B
  // ================================================================
  // TODO Phase B: Replace this stub block with:
  //   const proxyUrl = Deno.env.get('NHSBSA_PROXY_URL')!
  //   const nhsbsaRes = await fetch(`${proxyUrl}/cpcs/Claim`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify(nhsbsaPayload),
  //   })
  //   const nhsbsaData = await nhsbsaRes.json()
  //   const nhsbsaStatus = nhsbsaRes.status
  // ================================================================
  const nhsbsaStatus = 200
  const nhsbsaData = {
    resourceType: 'ClaimResponse',
    id: depositId,
    status: 'active',
    outcome: 'complete',
    _stub: true,
    _note: 'NHSBSA staging credentials pending — this is a stub response',
  }
  // ================================================================

  const succeeded = nhsbsaStatus >= 200 && nhsbsaStatus < 300

  // Log the attempt
  await logAttempt(admin, submission.id, {
    attemptNumber: 1,
    httpMethod:    'POST',
    endpointUrl:   endpoint,
    requestPayload: nhsbsaPayload,
    responseStatus: nhsbsaStatus,
    responseBody:   nhsbsaData,
    succeeded,
  })

  // Update submission status
  const newStatus = succeeded ? 'submitted' : 'rejected'
  const { data: updated, error: updateError } = await admin
    .from('nhs_claim_submissions')
    .update({
      status:         newStatus,
      bsa_response:   nhsbsaData,
      submitted_at:   succeeded ? new Date().toISOString() : null,
      last_updated_at: new Date().toISOString(),
    })
    .eq('id', submission.id)
    .select()
    .single()

  if (updateError) throw new Error(`Failed to update submission status: ${updateError.message}`)

  return {
    success: succeeded,
    submission: updated,
    platform_deposit_id: depositId,
    bsa_response: nhsbsaData,
  }
}

// ============================================
// Action: update
// Updates an existing submitted claim (PUT)
// ============================================

async function handleUpdate(body: Record<string, unknown>, userId: string) {
  const { submission_id, payload: updatedPayload } = body as {
    submission_id: string
    payload: Record<string, unknown>
  }

  if (!submission_id) throw new Error('Missing required field: submission_id')
  if (!updatedPayload) throw new Error('Missing required field: payload')

  const admin = getAdminClient()

  const { data: submission, error: fetchError } = await admin
    .from('nhs_claim_submissions')
    .select('*, ps_organisations(ods_code, nhs_bsa_environment)')
    .eq('id', submission_id)
    .single()

  if (fetchError || !submission) throw new Error('Submission not found')
  if (!['submitted', 'accepted', 'rejected'].includes(submission.status)) {
    throw new Error(`Cannot update a claim with status: ${submission.status}`)
  }

  const endpoint = submission.ps_organisations?.nhs_bsa_environment === 'production'
    ? `${NHSBSA_CPCS_PROD}/${submission.platform_deposit_id}`
    : `${NHSBSA_CPCS_STAGING}/${submission.platform_deposit_id}`

  const updatedFullPayload = { ...submission.payload, ...updatedPayload }

  // ================================================================
  // [STUB] NHSBSA PUT — Replace with real proxy call in Phase B
  // ================================================================
  const nhsbsaStatus = 200
  const nhsbsaData = { resourceType: 'ClaimResponse', id: submission.platform_deposit_id, status: 'active', outcome: 'complete', _stub: true }
  // ================================================================

  const succeeded = nhsbsaStatus >= 200 && nhsbsaStatus < 300

  await logAttempt(admin, submission_id, {
    attemptNumber: (submission.bsa_response ? 2 : 1),
    httpMethod:    'PUT',
    endpointUrl:   endpoint,
    requestPayload: updatedFullPayload,
    responseStatus: nhsbsaStatus,
    responseBody:   nhsbsaData,
    succeeded,
  })

  const { data: updated } = await admin
    .from('nhs_claim_submissions')
    .update({
      payload:        updatedFullPayload,
      status:         succeeded ? 'updated' : 'rejected',
      bsa_response:   nhsbsaData,
      last_updated_at: new Date().toISOString(),
    })
    .eq('id', submission_id)
    .select()
    .single()

  return { success: succeeded, submission: updated }
}

// ============================================
// Action: delete
// Deletes a submitted claim (DELETE)
// ============================================

async function handleDelete(body: Record<string, unknown>) {
  const { submission_id } = body as { submission_id: string }
  if (!submission_id) throw new Error('Missing required field: submission_id')

  const admin = getAdminClient()

  const { data: submission, error } = await admin
    .from('nhs_claim_submissions')
    .select('*, ps_organisations(ods_code, nhs_bsa_environment)')
    .eq('id', submission_id)
    .single()

  if (error || !submission) throw new Error('Submission not found')

  const endpoint = submission.ps_organisations?.nhs_bsa_environment === 'production'
    ? `${NHSBSA_CPCS_PROD}/${submission.platform_deposit_id}`
    : `${NHSBSA_CPCS_STAGING}/${submission.platform_deposit_id}`

  // ================================================================
  // [STUB] NHSBSA DELETE — Replace with real proxy call in Phase B
  // ================================================================
  const nhsbsaStatus = 200
  const nhsbsaData = { deleted: true, id: submission.platform_deposit_id, _stub: true }
  // ================================================================

  await logAttempt(admin, submission_id, {
    attemptNumber: 1,
    httpMethod:    'DELETE',
    endpointUrl:   endpoint,
    requestPayload: { platform_deposit_id: submission.platform_deposit_id },
    responseStatus: nhsbsaStatus,
    responseBody:   nhsbsaData,
    succeeded:      true,
  })

  await admin
    .from('nhs_claim_submissions')
    .update({ status: 'deleted', last_updated_at: new Date().toISOString() })
    .eq('id', submission_id)

  return { success: true, submission_id }
}

// ============================================
// Action: get
// Fetches current claim status from NHSBSA (GET)
// ============================================

async function handleGet(body: Record<string, unknown>) {
  const { submission_id } = body as { submission_id: string }
  if (!submission_id) throw new Error('Missing required field: submission_id')

  const admin = getAdminClient()

  const { data: submission, error } = await admin
    .from('nhs_claim_submissions')
    .select('*')
    .eq('id', submission_id)
    .single()

  if (error || !submission) throw new Error('Submission not found')

  return { submission }
}

// ============================================
// Main handler
// ============================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const body = await req.json()
    const { action } = body

    if (!action) throw new Error('Missing action parameter')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    let result: unknown

    switch (action) {
      case 'submit': result = await handleSubmit(body, user.id); break
      case 'update': result = await handleUpdate(body, user.id); break
      case 'delete': result = await handleDelete(body); break
      case 'get':    result = await handleGet(body); break
      default: throw new Error(`Unknown action: ${action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }
})
