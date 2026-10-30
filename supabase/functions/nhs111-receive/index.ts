// ============================================
// PharmStation Edge Function: nhs111-receive
//
// Receives FHIR STU3 JSON Bundles from the
// NHS 111 Report Adaptor (via bridge script).
//
// Extracts patient demographics, disposition,
// presenting complaint, care plan, triage Q&A,
// and encounter narrative from the FHIR resources.
//
// Looks up the destination pharmacy by ODS code,
// inserts into ps_nhs111_referrals.
//
// JWT verification OFF — called by bridge script.
// Authenticated by the x-bridge-secret header, which
// must match the NHS111_BRIDGE_SECRET function secret.
// Fails closed when the secret is not configured.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bridge-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// NHS number identifier system
const NHS_NUMBER_SYSTEM = 'https://fhir.nhs.uk/Id/nhs-number'
// ODS code identifier system
const ODS_CODE_SYSTEM = 'https://fhir.nhs.uk/Id/ods-organization-code'

// ============================================
// Helpers
// ============================================

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

/** Length-safe constant-time string compare, so the secret can't be timed */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ============================================
// FHIR Bundle Parser
// ============================================

/** Find the first resource of a given type in the bundle */
function findResource<T extends { resourceType: string }>(
  entries: Array<{ resource: Record<string, unknown> }>,
  resourceType: string,
): T | null {
  const entry = entries.find((e) => e.resource?.resourceType === resourceType)
  return (entry?.resource as T) ?? null
}

/** Find all resources of a given type */
function findAllResources<T extends { resourceType: string }>(
  entries: Array<{ resource: Record<string, unknown> }>,
  resourceType: string,
): T[] {
  return entries
    .filter((e) => e.resource?.resourceType === resourceType)
    .map((e) => e.resource as T)
}

/** Extract NHS number from Patient.identifier */
function extractNhsNumber(patient: Record<string, unknown>): string | null {
  const identifiers = patient.identifier as Array<Record<string, unknown>> | undefined
  if (!identifiers) return null
  const nhsId = identifiers.find((id) => id.system === NHS_NUMBER_SYSTEM)
  return (nhsId?.value as string) ?? null
}

/** Extract human name from Patient.name */
function extractPatientName(patient: Record<string, unknown>): string | null {
  const names = patient.name as Array<Record<string, unknown>> | undefined
  if (!names || names.length === 0) return null
  const name = names[0]
  if (name.text) return name.text as string
  const given = (name.given as string[]) ?? []
  const family = (name.family as string) ?? ''
  return [...given, family].filter(Boolean).join(' ') || null
}

/** Extract address from Patient.address */
function extractAddress(patient: Record<string, unknown>): Record<string, unknown> | null {
  const addresses = patient.address as Array<Record<string, unknown>> | undefined
  if (!addresses || addresses.length === 0) return null
  const addr = addresses[0]
  return {
    line: addr.line ?? [],
    city: addr.city ?? null,
    postalCode: addr.postalCode ?? null,
  }
}

/** Extract phone from Patient.telecom */
function extractPhone(patient: Record<string, unknown>): string | null {
  const telecoms = patient.telecom as Array<Record<string, unknown>> | undefined
  if (!telecoms) return null
  const phone = telecoms.find((t) => t.system === 'phone')
  return (phone?.value as string) ?? null
}

/** Extract GP ODS code and name from Patient.generalPractitioner */
function extractGP(patient: Record<string, unknown>): { odsCode: string | null; name: string | null } {
  const gps = patient.generalPractitioner as Array<Record<string, unknown>> | undefined
  if (!gps || gps.length === 0) return { odsCode: null, name: null }

  const gp = gps[0]
  const gpOrg = gp.resource as Record<string, unknown> | undefined

  let odsCode: string | null = null
  let name: string | null = (gp.display as string) ?? null

  if (gpOrg) {
    name = (gpOrg.name as string) ?? name
    const identifiers = gpOrg.identifier as Array<Record<string, unknown>> | undefined
    if (identifiers) {
      const odsId = identifiers.find((id) => id.system === ODS_CODE_SYSTEM)
      odsCode = (odsId?.value as string) ?? null
    }
  }

  return { odsCode, name }
}

/** Extract ODS code from Organization.identifier */
function extractOdsCode(org: Record<string, unknown>): string | null {
  const identifiers = org.identifier as Array<Record<string, unknown>> | undefined
  if (!identifiers) return null
  const odsId = identifiers.find(
    (id) => id.system === ODS_CODE_SYSTEM || (id.system as string)?.includes('ods'),
  )
  return (odsId?.value as string) ?? null
}

/** Extract event type from MessageHeader.event.code */
function extractEventType(messageHeader: Record<string, unknown>): string {
  const event = messageHeader.event as Record<string, unknown> | undefined
  const code = event?.code as string | undefined
  // 'referral-1' → 'referral', 'discharge-details-1' → 'discharge_details'
  if (code?.startsWith('referral')) return 'referral'
  if (code?.startsWith('discharge')) return 'discharge_details'
  return 'referral'
}

/** Extract destination ODS code from MessageHeader.destination[0].endpoint */
function extractDestinationOds(messageHeader: Record<string, unknown>): string | null {
  const destinations = messageHeader.destination as Array<Record<string, unknown>> | undefined
  if (!destinations || destinations.length === 0) return null
  // endpoint format: "urn:nhs-uk:addressing:ods:RSHSO14A:DOSServiceID:2000006423"
  const endpoint = destinations[0].endpoint as string | undefined
  if (!endpoint) return null
  const parts = endpoint.split(':')
  const odsIndex = parts.indexOf('ods')
  if (odsIndex >= 0 && odsIndex + 1 < parts.length) {
    return parts[odsIndex + 1]
  }
  return null
}

/** Extract case ID from bundle identifier or Composition.identifier */
function extractCaseId(
  bundle: Record<string, unknown>,
  composition: Record<string, unknown> | null,
): string | null {
  // Try bundle identifier first
  const bundleId = bundle.identifier as Record<string, unknown> | undefined
  if (bundleId?.value) return bundleId.value as string

  // Try Composition identifier
  if (composition) {
    const compId = composition.identifier as Record<string, unknown> | undefined
    if (compId?.value) return compId.value as string
  }
  return null
}

/** Extract disposition code and text from ReferralRequest or ProcedureRequest */
function extractDisposition(
  entries: Array<{ resource: Record<string, unknown> }>,
): { code: string | null; text: string | null } {
  // Try ReferralRequest first
  const referral = findResource(entries, 'ReferralRequest') as Record<string, unknown> | null
  if (referral) {
    const reasonCodes = referral.reasonCode as Array<Record<string, unknown>> | undefined
    if (reasonCodes && reasonCodes.length > 0) {
      const coding = (reasonCodes[0].coding as Array<Record<string, unknown>>) ?? []
      return {
        code: (coding[0]?.code as string) ?? null,
        text: (coding[0]?.display as string) ?? (reasonCodes[0].text as string) ?? null,
      }
    }
  }

  // Try ProcedureRequest
  const procedure = findResource(entries, 'ProcedureRequest') as Record<string, unknown> | null
  if (procedure) {
    const code = procedure.code as Record<string, unknown> | undefined
    const coding = (code?.coding as Array<Record<string, unknown>>) ?? []
    return {
      code: (coding[0]?.code as string) ?? null,
      text: (coding[0]?.display as string) ?? (code?.text as string) ?? null,
    }
  }

  return { code: null, text: null }
}

/** Extract presenting complaint from Condition or Observation */
function extractPresentingComplaint(
  entries: Array<{ resource: Record<string, unknown> }>,
): string | null {
  // Try Condition.category or Condition.code
  const condition = findResource(entries, 'Condition') as Record<string, unknown> | null
  if (condition) {
    const category = condition.category as Array<Record<string, unknown>> | undefined
    if (category?.[0]?.text) return category[0].text as string
    const code = condition.code as Record<string, unknown> | undefined
    if (code?.text) return code.text as string
  }

  // Try Observation with code 33962009 (Presenting complaint)
  const observations = findAllResources(entries, 'Observation') as Array<Record<string, unknown>>
  for (const obs of observations) {
    const code = obs.code as Record<string, unknown> | undefined
    const coding = (code?.coding as Array<Record<string, unknown>>) ?? []
    if (coding.some((c) => c.code === '33962009')) {
      return (obs.valueString as string) ?? null
    }
  }

  return null
}

/** Extract care plan advice text */
function extractCarePlan(entries: Array<{ resource: Record<string, unknown> }>): string | null {
  const carePlans = findAllResources(entries, 'CarePlan') as Array<Record<string, unknown>>
  if (carePlans.length === 0) return null
  const descriptions = carePlans
    .map((cp) => cp.description as string)
    .filter(Boolean)
  return descriptions.join('\n\n') || null
}

/** Extract encounter narrative from Composition sections */
function extractEncounterSummary(composition: Record<string, unknown> | null): string | null {
  if (!composition) return null
  const sections = composition.section as Array<Record<string, unknown>> | undefined
  if (!sections) return null

  const parts: string[] = []
  for (const section of sections) {
    const title = section.title as string | undefined
    const textObj = section.text as Record<string, unknown> | undefined
    const div = textObj?.div as string | undefined
    if (title || div) {
      // Strip HTML tags from div
      const cleanText = div?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      if (title) parts.push(`**${title}**`)
      if (cleanText) parts.push(cleanText)
    }
  }
  return parts.join('\n\n') || null
}

/** Extract triage Q&A from QuestionnaireResponse items */
function extractTriageQuestions(
  entries: Array<{ resource: Record<string, unknown> }>,
): Array<{ question: string; answer: string }> | null {
  const responses = findAllResources(entries, 'QuestionnaireResponse') as Array<
    Record<string, unknown>
  >
  if (responses.length === 0) return null

  const qas: Array<{ question: string; answer: string }> = []

  function walkItems(items: Array<Record<string, unknown>>) {
    for (const item of items) {
      const question = item.text as string | undefined
      const answers = item.answer as Array<Record<string, unknown>> | undefined
      if (question && answers && answers.length > 0) {
        const answerText =
          (answers[0].valueString as string) ??
          String(answers[0].valueBoolean ?? '')
        if (answerText) qas.push({ question, answer: answerText })
        // Nested items inside answers
        for (const ans of answers) {
          const nested = ans.item as Array<Record<string, unknown>> | undefined
          if (nested) walkItems(nested)
        }
      }
      // Nested items at item level
      const nestedItems = item.item as Array<Record<string, unknown>> | undefined
      if (nestedItems) walkItems(nestedItems)
    }
  }

  for (const response of responses) {
    const items = response.item as Array<Record<string, unknown>> | undefined
    if (items) walkItems(items)
  }

  return qas.length > 0 ? qas : null
}

/** Extract source organisation (who sent the referral) */
function extractSourceOrg(
  entries: Array<{ resource: Record<string, unknown> }>,
): { odsCode: string | null; name: string | null } {
  const orgs = findAllResources(entries, 'Organization') as Array<Record<string, unknown>>

  // The service provider org typically has a type with "Referrer" or is the first org
  for (const org of orgs) {
    const odsCode = extractOdsCode(org)
    const name = org.name as string | undefined
    if (odsCode && name) {
      return { odsCode, name }
    }
  }

  // Fallback: first org with a name
  if (orgs.length > 0) {
    return {
      odsCode: extractOdsCode(orgs[0]),
      name: (orgs[0].name as string) ?? null,
    }
  }

  return { odsCode: null, name: null }
}

/** Derive urgency from disposition code */
function deriveUrgency(dispositionCode: string | null): string {
  if (!dispositionCode) return 'routine'
  const code = dispositionCode.toUpperCase()
  // Dx01-Dx03: emergency (ambulance / ED)
  // Dx04-Dx08: urgent (primary care within hours)
  // Dx09+: routine
  const num = parseInt(code.replace(/[^0-9]/g, ''), 10)
  if (isNaN(num)) return 'routine'
  if (num <= 3) return 'emergency'
  if (num <= 8) return 'urgent'
  return 'routine'
}

// ============================================
// Main Handler
// ============================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const expected = Deno.env.get('NHS111_BRIDGE_SECRET')
  if (!expected) {
    console.error('NHS111_BRIDGE_SECRET is not configured; rejecting request')
    return jsonResponse({ error: 'Service unavailable' }, 503)
  }
  if (!safeEqual(req.headers.get('x-bridge-secret') ?? '', expected)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabase = getAdminClient()

  try {
    const bundle = await req.json()

    // Validate it's a FHIR Bundle
    if (bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
      return jsonResponse({ error: 'Invalid FHIR Bundle: missing resourceType or entry' }, 400)
    }

    const entries = bundle.entry as Array<{ resource: Record<string, unknown> }>

    // ---- Extract MessageHeader ----
    const messageHeader = findResource(entries, 'MessageHeader') as Record<string, unknown> | null
    if (!messageHeader) {
      return jsonResponse({ error: 'Invalid FHIR Bundle: no MessageHeader resource' }, 400)
    }

    const eventType = extractEventType(messageHeader)
    const destinationOds = extractDestinationOds(messageHeader)

    // ---- Look up destination pharmacy by ODS code ----
    // ODS codes live in the `pharmacies` directory table, linked to
    // PharmStation orgs via `ps_org_pharmacy_link`.
    if (!destinationOds) {
      return jsonResponse({ error: 'Cannot determine destination pharmacy: no ODS code in MessageHeader' }, 400)
    }

    // Find the pharmacies directory entry by ODS code
    const { data: pharmacy, error: phError } = await supabase
      .from('pharmacies')
      .select('id')
      .eq('ods_code', destinationOds)
      .maybeSingle()

    if (phError || !pharmacy) {
      console.error(`No pharmacy directory entry for ODS code: ${destinationOds}`, phError)
      return jsonResponse({ error: `Unknown pharmacy ODS code: ${destinationOds}` }, 404)
    }

    // Find the PharmStation org linked to this pharmacy
    const { data: link, error: linkError } = await supabase
      .from('ps_org_pharmacy_link')
      .select('org_id')
      .eq('pharmacy_id', pharmacy.id)
      .maybeSingle()

    if (linkError || !link) {
      console.error(`No PharmStation org linked to pharmacy ${destinationOds} (id=${pharmacy.id})`, linkError)
      return jsonResponse({ error: `Pharmacy ${destinationOds} is not registered on PharmStation` }, 404)
    }

    const org = { id: link.org_id }

    // ---- Extract Patient ----
    const patient = findResource(entries, 'Patient') as Record<string, unknown> | null
    const nhsNumber = patient ? extractNhsNumber(patient) : null
    const patientName = patient ? extractPatientName(patient) : null
    const patientDob = patient ? (patient.birthDate as string ?? null) : null
    const patientAddress = patient ? extractAddress(patient) : null
    const patientPhone = patient ? extractPhone(patient) : null
    const gp = patient ? extractGP(patient) : { odsCode: null, name: null }

    // ---- Extract Clinical Content ----
    const composition = findResource(entries, 'Composition') as Record<string, unknown> | null
    const caseId = extractCaseId(bundle, composition)
    const disposition = extractDisposition(entries)
    const presentingComplaint = extractPresentingComplaint(entries)
    const encounterSummary = extractEncounterSummary(composition)
    const carePlan = extractCarePlan(entries)
    const triageQuestions = extractTriageQuestions(entries)
    const sourceOrg = extractSourceOrg(entries)

    // ---- Extract case ref from Encounter identifier ----
    const encounter = findResource(entries, 'Encounter') as Record<string, unknown> | null
    let caseRef: string | null = null
    if (encounter) {
      const identifiers = encounter.identifier as Array<Record<string, unknown>> | undefined
      if (identifiers && identifiers.length > 0) {
        caseRef = (identifiers[0].value as string) ?? null
      }
    }

    // ---- Check for duplicate (same case_id) ----
    if (caseId) {
      const { data: existing } = await supabase
        .from('ps_nhs111_referrals')
        .select('id')
        .eq('case_id', caseId)
        .maybeSingle()

      if (existing) {
        return jsonResponse({
          message: 'Duplicate referral — already received',
          referral_id: existing.id,
          duplicate: true,
        }, 200)
      }
    }

    // ---- Insert referral ----
    const referralRow = {
      org_id: org.id,
      patient_nhs_number: nhsNumber,
      patient_name: patientName,
      patient_dob: patientDob,
      patient_address: patientAddress,
      patient_phone: patientPhone,
      patient_gp_ods_code: gp.odsCode,
      patient_gp_name: gp.name,
      case_id: caseId,
      case_ref: caseRef,
      event_type: eventType,
      disposition_code: disposition.code,
      disposition_text: disposition.text,
      presenting_complaint: presentingComplaint,
      encounter_summary: encounterSummary,
      care_plan: carePlan,
      triage_questions: triageQuestions,
      source_ods_code: sourceOrg.odsCode,
      source_org_name: sourceOrg.name,
      urgency: deriveUrgency(disposition.code),
      raw_fhir_bundle: bundle,
      status: 'received',
    }

    const { data: inserted, error: insertError } = await supabase
      .from('ps_nhs111_referrals')
      .insert(referralRow)
      .select('id')
      .single()

    if (insertError) {
      console.error('Failed to insert referral:', insertError)
      return jsonResponse({ error: 'Failed to store referral' }, 500)
    }

    console.log(`✅ NHS 111 referral received: ${inserted.id} for ODS ${destinationOds} (${eventType})`)

    return jsonResponse({
      message: 'Referral received successfully',
      referral_id: inserted.id,
      event_type: eventType,
    }, 201)

  } catch (err) {
    console.error('Error processing NHS 111 referral:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
