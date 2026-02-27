// ============================================
// PharmStation Edge Function: nhs-claim-scs
// Smoking Cessation Service (SCS) claim submission
// Actions: submit | update | delete | get
//
// [A6 SCAFFOLD] NHSBSA API calls are STUBBED.
// Replace stub sections in Phase B.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const NHSBSA_SCS_STAGING = 'https://stg.api.scs.pharmacy.mys.nhsbsa.nhs.uk/v1/claims'
const NHSBSA_SCS_PROD    = 'https://api.scs.pharmacy.mys.nhsbsa.nhs.uk/v1/claims'

function getAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function generateDepositId(odsCode: string, env: string): string {
  return `${env === 'production' ? 'PSN' : 'PSN-TEST'}-${odsCode}-${Date.now()}`
}

function getClaimYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function logAttempt(admin: ReturnType<typeof getAdminClient>, submissionId: string, opts: {
  attemptNumber: number; httpMethod: string; endpointUrl: string
  requestPayload: unknown; responseStatus: number; responseBody: unknown
  errorMessage?: string; succeeded: boolean
}) {
  await admin.from('ps_nhs_submission_attempts').insert({
    submission_id:   submissionId,
    attempt_number:  opts.attemptNumber,
    http_method:     opts.httpMethod,
    endpoint_url:    opts.endpointUrl,
    request_payload: opts.requestPayload,
    response_status: opts.responseStatus,
    response_body:   opts.responseBody,
    error_message:   opts.errorMessage ?? null,
    succeeded:       opts.succeeded,
  })
}

async function handleSubmit(body: Record<string, unknown>, userId: string) {
  const { org_id, patient_id, service_delivery_id, payload: claimPayload } = body as {
    org_id: string; patient_id?: string; service_delivery_id?: string
    payload: Record<string, unknown>
  }

  if (!org_id) throw new Error('Missing required field: org_id')
  if (!claimPayload) throw new Error('Missing required field: payload')
  if (!claimPayload.PATIENT_NHSNO) throw new Error('Missing PATIENT_NHSNO in payload')
  if (!claimPayload.QUIT_DATE) throw new Error('SCS claims require QUIT_DATE')
  if (!claimPayload.NUMBER_OF_CONSULTATIONS) throw new Error('SCS claims require NUMBER_OF_CONSULTATIONS')
  if (!claimPayload.NRT_PRODUCT || !Array.isArray(claimPayload.NRT_PRODUCT) || claimPayload.NRT_PRODUCT.length === 0) {
    throw new Error('SCS claims require at least one NRT_PRODUCT entry')
  }

  const admin = getAdminClient()

  const { data: org, error: orgError } = await admin
    .from('ps_organisations')
    .select('ods_code, nhs_bsa_environment')
    .eq('id', org_id)
    .single()

  if (orgError || !org) throw new Error(`Organisation not found`)
  if (!org.ods_code) throw new Error('Organisation has no ODS code configured.')

  const depositId = generateDepositId(org.ods_code, org.nhs_bsa_environment)
  const yearMonth = getClaimYearMonth()
  const endpoint  = org.nhs_bsa_environment === 'production' ? NHSBSA_SCS_PROD : NHSBSA_SCS_STAGING

  const nhsbsaPayload = {
    PLATFORM_DEPOSIT_ID: depositId,
    CLAIMANT_ODS:        org.ods_code,
    CLAIM_YEAR_MONTH:    yearMonth,
    ...claimPayload,
  }

  const { data: submission, error: insertError } = await admin
    .from('ps_nhs_claim_submissions')
    .insert({
      org_id, patient_id: patient_id ?? null,
      service_delivery_id: service_delivery_id ?? null,
      service_type:        'scs',
      platform_deposit_id: depositId,
      claim_year_month:    yearMonth,
      status:              'pending',
      payload:             nhsbsaPayload,
      created_by:          userId,
    })
    .select().single()

  if (insertError) throw new Error(`Failed to create submission record: ${insertError.message}`)

  // ================================================================
  // [STUB] NHSBSA SCS API CALL — Replace with real proxy call in Phase B
  // TODO: const nhsbsaRes = await fetch(`${proxyUrl}/scs/claims`, { method: 'POST', ... })
  // ================================================================
  const nhsbsaStatus = 200
  const nhsbsaData = { id: depositId, status: 'accepted', _stub: true }
  // ================================================================

  const succeeded = nhsbsaStatus >= 200 && nhsbsaStatus < 300
  await logAttempt(admin, submission.id, { attemptNumber: 1, httpMethod: 'POST', endpointUrl: endpoint, requestPayload: nhsbsaPayload, responseStatus: nhsbsaStatus, responseBody: nhsbsaData, succeeded })

  const { data: updated } = await admin
    .from('ps_nhs_claim_submissions')
    .update({ status: succeeded ? 'submitted' : 'rejected', bsa_response: nhsbsaData, submitted_at: succeeded ? new Date().toISOString() : null, last_updated_at: new Date().toISOString() })
    .eq('id', submission.id).select().single()

  return { success: succeeded, submission: updated, platform_deposit_id: depositId }
}

async function handleUpdate(body: Record<string, unknown>, _userId: string) {
  const { submission_id, payload: updatedPayload } = body as { submission_id: string; payload: Record<string, unknown> }
  if (!submission_id || !updatedPayload) throw new Error('Missing submission_id or payload')
  const admin = getAdminClient()
  const { data: submission, error } = await admin.from('ps_nhs_claim_submissions').select('*, ps_organisations(nhs_bsa_environment)').eq('id', submission_id).single()
  if (error || !submission) throw new Error('Submission not found')
  const endpoint = submission.ps_organisations?.nhs_bsa_environment === 'production' ? `${NHSBSA_SCS_PROD}/${submission.platform_deposit_id}` : `${NHSBSA_SCS_STAGING}/${submission.platform_deposit_id}`
  const updatedFullPayload = { ...submission.payload, ...updatedPayload }
  // [STUB]
  await logAttempt(admin, submission_id, { attemptNumber: 2, httpMethod: 'PUT', endpointUrl: endpoint, requestPayload: updatedFullPayload, responseStatus: 200, responseBody: { status: 'updated', _stub: true }, succeeded: true })
  const { data: updated } = await admin.from('ps_nhs_claim_submissions').update({ payload: updatedFullPayload, status: 'updated', last_updated_at: new Date().toISOString() }).eq('id', submission_id).select().single()
  return { success: true, submission: updated }
}

async function handleDelete(body: Record<string, unknown>) {
  const { submission_id } = body as { submission_id: string }
  if (!submission_id) throw new Error('Missing submission_id')
  const admin = getAdminClient()
  const { data: submission, error } = await admin.from('ps_nhs_claim_submissions').select('*, ps_organisations(nhs_bsa_environment)').eq('id', submission_id).single()
  if (error || !submission) throw new Error('Submission not found')
  const endpoint = submission.ps_organisations?.nhs_bsa_environment === 'production' ? `${NHSBSA_SCS_PROD}/${submission.platform_deposit_id}` : `${NHSBSA_SCS_STAGING}/${submission.platform_deposit_id}`
  // [STUB]
  await logAttempt(admin, submission_id, { attemptNumber: 1, httpMethod: 'DELETE', endpointUrl: endpoint, requestPayload: {}, responseStatus: 200, responseBody: { deleted: true, _stub: true }, succeeded: true })
  await admin.from('ps_nhs_claim_submissions').update({ status: 'deleted', last_updated_at: new Date().toISOString() }).eq('id', submission_id)
  return { success: true, submission_id }
}

async function handleGet(body: Record<string, unknown>) {
  const { submission_id } = body as { submission_id: string }
  if (!submission_id) throw new Error('Missing submission_id')
  const admin = getAdminClient()
  const { data, error } = await admin.from('ps_nhs_claim_submissions').select('*').eq('id', submission_id).single()
  if (error || !data) throw new Error('Submission not found')
  return { submission: data }
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
      case 'submit': result = await handleSubmit(body, user.id); break
      case 'update': result = await handleUpdate(body, user.id); break
      case 'delete': result = await handleDelete(body); break
      case 'get':    result = await handleGet(body); break
      default: throw new Error(`Unknown action: ${body.action}`)
    }
    return new Response(JSON.stringify(result), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errMsg }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
