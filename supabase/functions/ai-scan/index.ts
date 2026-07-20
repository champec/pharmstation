// ============================================
// PharmStation Edge Function: ai-scan
// Processes prescription/invoice images using AI
// Extracts drug data, reconciles against DB
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ============================================
// Response schema for structured AI output
// ============================================

const SCAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    document_type: {
      type: 'string',
      enum: ['prescription', 'invoice', 'unknown'],
      description: 'Whether this is a prescription (drug being supplied OUT to patient) or an invoice (drug being received IN from supplier)',
    },
    overall_confidence: {
      type: 'string',
      enum: ['0', '1', '2', '3'],
      description: '3=confident all correct, 2=partially confident some fields need review, 1=very unclear needs manual supervision, 0=rejected (unusable/inappropriate/unreadable)',
    },
    notes: {
      type: 'string',
      description: 'Notes about the document, any observations, issues, or things that need attention',
    },
    supplier: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Supplier/wholesaler name' },
        invoice_number: { type: 'string', description: 'Invoice number or reference' },
        date: { type: 'string', description: 'Invoice date in YYYY-MM-DD format' },
      },
      description: 'Only populated if document_type is invoice',
    },
    patient: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Patient full name' },
        address: { type: 'string', description: 'Patient address' },
      },
      description: 'Only populated if document_type is prescription',
    },
    prescriber: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Prescriber/doctor name' },
        address: { type: 'string', description: 'Prescriber/surgery address' },
        registration: { type: 'string', description: 'GMC/GPhC registration number' },
      },
      description: 'Only populated if document_type is prescription',
    },
    is_partial_supply: {
      type: 'boolean',
      description: 'Whether handwritten notes indicate this is a partial/split supply of the prescribed quantity',
    },
    handwritten_notes: {
      type: 'string',
      description: 'Any handwritten notes detected on the prescription (brand endorsements, quantities supplied, dates, initials)',
    },
    drugs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          drug_name: { type: 'string', description: 'Drug brand name (if handwritten brand endorsement present, use that; otherwise use the printed name)' },
          drug_class: { type: 'string', description: 'Drug classification/generic name (e.g. "Morphine Sulfate", "Oxycodone Hydrochloride")' },
          drug_form: { type: 'string', description: 'Dosage form (e.g. "Modified-release tablets", "Oral solution", "Patches")' },
          drug_strength: { type: 'string', description: 'Strength (e.g. "10mg", "30mg/5ml", "25mcg/hr")' },
          quantity: { type: 'number', description: 'Number of units (tablets, mls, patches). For partial supplies, use the quantity actually supplied as written in the handwritten notes, not the original prescribed quantity.' },
          confidence: {
            type: 'string',
            enum: ['0', '1', '2', '3'],
            description: '3=certain about this drug entry, 2=mostly certain but some fields unclear, 1=very uncertain, 0=cannot determine',
          },
          confidence_notes: { type: 'string', description: 'Explain why confidence is not 3 (what is uncertain)' },
        },
        required: ['drug_name', 'drug_class', 'drug_form', 'drug_strength', 'quantity', 'confidence', 'confidence_notes'],
      },
      description: 'List of Schedule 2 controlled drugs found on this document. ONLY include Schedule 2 CDs, not other medications.',
    },
  },
  required: ['document_type', 'overall_confidence', 'notes', 'drugs'],
}

// ============================================
// Build system prompt with augmentation context
// ============================================

function buildSystemPrompt(augmentationNotes: { scope: string; category: string; title: string; content: string }[]): string {
  let prompt = `You are a specialist AI system for UK pharmacy Controlled Drug (CD) register processing. Your task is to analyze photographs of pharmaceutical documents — either prescriptions or invoices — and extract structured data about Schedule 2 Controlled Drugs.

## Your Mission
1. DETERMINE if the document is a prescription (supply OUT to patient) or an invoice (receipt IN from supplier)
2. EXTRACT all relevant details (patient/prescriber for prescriptions, supplier/invoice for invoices)
3. IDENTIFY every Schedule 2 Controlled Drug on the document
4. EXTRACT drug name, class, form, strength, and quantity for each CD
5. READ any handwritten notes (brand endorsements, partial supply notes, dates, initials)
6. ASSIGN a confidence score (0-3) for your overall reading and for each drug

## UK CD Prescription Legal Requirements (Misuse of Drugs Regulations 2001)
A valid Schedule 2/3 CD prescription MUST contain:
- **Patient name and address** (legally required)
- **Prescriber name, address (must be UK), signature, and date**
- **Drug formulation** must be stated ("tabs" and "caps" abbreviations are acceptable)
- **Strength** is only legally required if the drug is available in more than one strength
- **Total quantity** must be written in BOTH words AND figures (e.g. "56 (fifty-six) tablets")
- **Dose** must be clearly defined but does NOT need to be in words and figures
- **Patient age** only required if under 12 years
- CD prescriptions are valid for 28 days from the date stated
- Brand name is NOT a legal requirement — prescriptions may be written generically
- Dental prescriptions should contain "for dental treatment only"

## Confidence Scoring
- 3: High confidence — all fields are clearly readable and you are certain of the values
- 2: Partial confidence — most fields are clear but some need human verification (e.g. handwriting is slightly ambiguous)
- 1: Low confidence — significant uncertainty, multiple fields are unclear, human must verify carefully
- 0: Rejected — the image is unusable: not a pharmacy document, extremely poor quality, inappropriate content, or completely illegible

## Important Rules
- ONLY extract Schedule 2 CDs. Do NOT include Schedule 3, 4, or 5 drugs, or non-controlled drugs.
- For prescriptions: read handwritten brand endorsements carefully. If a CD is prescribed generically but a brand name is written on by the pharmacist, use the BRAND name as the drug_name.
- If NO brand is stated (prescription is generic), set drug_name to the generic/class name (e.g. "Oxycodone"). The brand is NOT a legal requirement.
- The drug_class field should ALWAYS be the generic name (e.g. "Oxycodone", "Morphine Sulfate") regardless of whether a brand is used.
- The drug_form should be the formulation as stated (e.g. "tablets", "modified-release tablets", "oral solution"). Do NOT assume "modified-release" unless explicitly stated. Plain "tablets" means immediate-release.
- **Brand-specific formulations are safety-critical.** When a proprietary brand only exists in a particular release formulation, preserve that formulation even if the document also uses a shortened dosage-form word such as "tablets". Do not convert a modified-release/prolonged-release brand into immediate-release tablets.
- **OxyContin specifically is a modified-release tablet product in the PharmStation drug catalogue; there is no plain immediate-release "OxyContin tablets" catalogue product.** If the brand is clearly OxyContin, return drug_form as exactly "modified-release tablets". If the brand itself is uncertain or the image appears inconsistent, lower confidence and explain the concern in confidence_notes instead of returning plain "tablets" with high confidence.
- Before assigning confidence 3, check that the extracted brand, formulation, and strength form a clinically plausible product combination. A clear quantity does not make an incompatible brand/formulation combination high confidence.
- For partial supplies: look for handwritten notes like "supplied 28/56", a date, and initials. Use the ACTUALLY SUPPLIED quantity, not the full prescribed quantity.
- For invoices: extract every Schedule 2 CD line item with its quantity (pack size × number of packs = total quantity).
- Dates should be in YYYY-MM-DD format when possible.
- If you cannot read a field at all, provide your best guess and set confidence accordingly.
- NEVER fabricate information. If something is truly illegible, say so in confidence_notes.
`

  // Add augmentation context
  const globalNotes = augmentationNotes.filter(n => n.scope === 'global')
  const orgNotes = augmentationNotes.filter(n => n.scope === 'organisation')

  if (globalNotes.length > 0) {
    prompt += `\n## Pharmacy Domain Knowledge\n`
    for (const note of globalNotes) {
      prompt += `\n### ${note.title}\n${note.content}\n`
    }
  }

  if (orgNotes.length > 0) {
    prompt += `\n## Organisation-Specific Notes\nThese are specific to this pharmacy — give them high priority:\n`
    for (const note of orgNotes) {
      prompt += `\n### ${note.title}\n${note.content}\n`
    }
  }

  return prompt
}

// ============================================
// Drug reconciliation — match AI output to cdr_drugs_unique
// ============================================

interface DrugMatch {
  drug_id: string
  drug_brand: string
  drug_form: string
  drug_strength: string
  drug_class: string
}

// Normalize common UK pharmacy form abbreviations
function normalizeForm(form: string): string {
  let s = form.toLowerCase().trim().replace(/\s+/g, ' ')
  // Expand leading/word abbreviations
  s = s
    .replace(/\btabs?\b/g, 'tablets')
    .replace(/\bcaps?\b/g, 'capsules')
    .replace(/\bsoln\b/g, 'solution')
    .replace(/\binj\b/g, 'injection')
    .replace(/\bliq\b/g, 'liquid')
    .replace(/\bsupps?\b/g, 'suppositories')
  // Unify release qualifiers: MR / SR / PR / XL / XR / prolonged-release / sustained-release /
  // extended-release are all the same clinical family — "modified-release".
  s = s
    .replace(/\b(m\/?r|mr|sr|pr|xl|xr)\b/g, 'modified-release')
    .replace(/\b(prolonged|sustained|extended|slow)[\s-]?release\b/g, 'modified-release')
    .replace(/\bmodified[\s-]?release\b/g, 'modified-release')
  return s.replace(/\s+/g, ' ').trim()
}

// Form family — the clinically meaningful grouping used for the safety gate.
// "tablets" (IR) ≠ "modified-release tablets", but "prolonged-release tablets"
// = "modified-release tablets". Base dosage form is kept distinct (tablets vs capsules).
function formFamily(form: string): string {
  const s = normalizeForm(form)
  const mr = /\bmodified-release\b/.test(s)
  let base = ''
  if (/\btablets?\b/.test(s)) base = 'tablets'
  else if (/\bcapsules?\b/.test(s)) base = 'capsules'
  else if (/\bpatch(es)?\b/.test(s)) base = 'patches'
  else if (/\b(oral solution|oral suspension|liquid|elixir|syrup)\b/.test(s)) base = 'oral-liquid'
  else if (/\binjection|infusion|ampoules?|syringes?|vials?\b/.test(s)) base = 'injection'
  else if (/\bsuppositor/.test(s)) base = 'suppositories'
  else if (/\bnasal spray\b/.test(s)) base = 'nasal-spray'
  else if (/\blozenge|buccal|sublingual|orodispersible\b/.test(s)) base = 'oromucosal'
  else base = s
  return mr && base !== 'injection' ? `mr-${base}` : base
}

// Normalize strengths: "18 mg" → "18mg", "25 mcg/hr" → "25micrograms/hour", unify mcg/µg.
function normalizeStrength(strength: string): string {
  return strength
    .toLowerCase()
    .replace(/\b(mcg|µg|ug)\b/g, 'micrograms')
    .replace(/\bmicrogram\b/g, 'micrograms')
    .replace(/\/hr\b/g, '/hour')
    .replace(/\s+/g, '')
    .trim()
}

// Normalize class names: strip salt suffixes so "Methylphenidate Hydrochloride"
// matches catalogue class "Methylphenidate".
const SALT_WORDS = /\b(hydrochloride|hydrobromide|sulfate|sulphate|tartrate|phosphate|citrate|maleate|mesilate|napsylate|sodium|besilate)\b/g
function normalizeClass(cls: string): string {
  return cls.toLowerCase().replace(SALT_WORDS, ' ').replace(/\s+/g, ' ').trim()
}

// Brand equivalence: exact, or one is the other plus a trailing release qualifier
// (e.g. prescription says "Concerta", catalogue brand is "Concerta XL").
const BRAND_QUALIFIER = /\s+(xl|xr|sr|pr|mr|continus|retard|dtrans|matrix|reservoir)$/i
function normalizeBrand(brand: string): string {
  return brand.toLowerCase().replace(/\s+/g, ' ').trim()
}
function brandsEquivalent(a: string, b: string): boolean {
  const na = normalizeBrand(a)
  const nb = normalizeBrand(b)
  if (na === nb) return true
  return na.replace(BRAND_QUALIFIER, '') === nb.replace(BRAND_QUALIFIER, '')
}

// Score how well a DB drug matches the AI extraction
function scoreDrugMatch(d: DrugMatch, drugName: string, drugClass: string, drugForm: string, drugStrength: string): number {
  let score = 0
  const dStrength = normalizeStrength(d.drug_strength ?? '')
  const dClass = normalizeClass(d.drug_class)
  const dBrand = normalizeBrand(d.drug_brand)
  const qStrength = normalizeStrength(drugStrength)
  const qClass = normalizeClass(drugClass)
  const qBrand = normalizeBrand(drugName)

  // Strength match — most important
  if (dStrength && dStrength === qStrength) score += 10
  else if (dStrength && qStrength && (dStrength.includes(qStrength) || qStrength.includes(dStrength))) score += 5

  // Form match — same clinical family only.
  // "tablets" (IR) ≠ "modified-release tablets" — clinically different drugs.
  // But "prolonged-release tablets" = "modified-release tablets" = "SR tablets".
  if (formFamily(d.drug_form) === formFamily(drugForm)) score += 8

  // Brand match (qualifier-tolerant: "Concerta" ≈ "Concerta XL")
  if (dBrand === qBrand) score += 6
  else if (brandsEquivalent(dBrand, qBrand)) score += 5
  else if (dBrand.includes(qBrand) || qBrand.includes(dBrand)) score += 2

  // Class match (salt-tolerant: "Methylphenidate Hydrochloride" ≈ "Methylphenidate")
  if (dClass === qClass) score += 4
  else if (dClass.includes(qClass) || qClass.includes(dClass)) score += 2

  return score
}

async function reconcileDrug(
  supabaseAdmin: ReturnType<typeof createClient>,
  drugName: string,
  drugClass: string,
  drugForm: string,
  drugStrength: string,
): Promise<DrugMatch | null> {
  // NOTE: We alias "id" as "drug_id" so the returned objects match the DrugMatch interface directly.
  const selectCols = 'drug_id:id, drug_brand, drug_form, drug_strength, drug_class'
  const qFamily = drugForm ? formFamily(drugForm) : ''
  const qStrengthNorm = normalizeStrength(drugStrength ?? '')

  // Validate a scored candidate list — clinical safety gates:
  // 1. Form family must match ("tablets" IR ≠ "modified-release tablets";
  //    but "prolonged-release" = "modified-release" = "SR").
  // 2. If a strength was extracted, the match's strength must agree.
  // 3. The winner must be unambiguous — if two different catalogue rows tie
  //    on top score, don't auto-match; let the human choose.
  function pickSafeMatch(scored: (DrugMatch & { score: number })[]): DrugMatch | null {
    if (scored.length === 0) return null
    const best = scored[0]
    if (qFamily && formFamily(best.drug_form) !== qFamily) return null
    if (qStrengthNorm && normalizeStrength(best.drug_strength ?? '') !== qStrengthNorm) return null
    if (scored.length > 1 && scored[1].score === best.score && scored[1].drug_id !== best.drug_id) {
      // Ambiguous tie between different rows — check they aren't clinically identical
      const same = formFamily(scored[1].drug_form) === formFamily(best.drug_form)
        && normalizeStrength(scored[1].drug_strength ?? '') === normalizeStrength(best.drug_strength ?? '')
        && brandsEquivalent(scored[1].drug_brand, best.drug_brand)
      if (!same) return null
    }
    return best
  }

  function scoreAndPick(rows: DrugMatch[] | null): DrugMatch | null {
    if (!rows || rows.length === 0) return null
    const scored = rows.map((d: DrugMatch) => ({ ...d, score: scoreDrugMatch(d, drugName, drugClass, drugForm, drugStrength) }))
    scored.sort((a, b) => b.score - a.score)
    return pickSafeMatch(scored)
  }

  // Strip salt words for class searching ("Methylphenidate Hydrochloride" → "Methylphenidate")
  const classSearch = drugClass ? drugClass.replace(SALT_WORDS, ' ').replace(/\s+/g, ' ').trim() : ''
  // Strip trailing release qualifier for brand searching ("Concerta XL" ↔ "Concerta")
  const brandBase = drugName ? drugName.replace(BRAND_QUALIFIER, '').trim() : ''

  // Strategy 1: brand match (exact, then base-brand prefix to catch "Concerta" → "Concerta XL")
  if (drugName) {
    const { data: exactBrand } = await supabaseAdmin
      .from('cdr_drugs_unique')
      .select(selectCols)
      .ilike('drug_brand', drugName)
      .limit(20)

    let candidates: DrugMatch[] = (exactBrand as DrugMatch[] | null) ?? []
    if (brandBase && brandBase.toLowerCase() !== drugName.toLowerCase().trim()) {
      const { data: baseBrand } = await supabaseAdmin
        .from('cdr_drugs_unique')
        .select(selectCols)
        .ilike('drug_brand', `${brandBase}%`)
        .limit(20)
      if (baseBrand) candidates = candidates.concat(baseBrand as DrugMatch[])
    } else if (candidates.length === 0 && brandBase) {
      // Prescription may say "Concerta" while catalogue says "Concerta XL"
      const { data: prefixBrand } = await supabaseAdmin
        .from('cdr_drugs_unique')
        .select(selectCols)
        .ilike('drug_brand', `${brandBase} %`)
        .limit(20)
      if (prefixBrand) candidates = prefixBrand as DrugMatch[]
    }

    const result = scoreAndPick(candidates)
    if (result) return result
    // No safe brand match — fall through to class strategies
  }

  // Strategy 2: class + strength — covers generic/brandless prescriptions
  if (classSearch) {
    const classQuery = supabaseAdmin
      .from('cdr_drugs_unique')
      .select(selectCols)
      .ilike('drug_class', `%${classSearch}%`)

    if (drugStrength) {
      classQuery.ilike('drug_strength', drugStrength)
    }

    const { data: classMatches } = await classQuery.limit(50)
    const result = scoreAndPick(classMatches as DrugMatch[] | null)
    if (result) return result
  }

  // Strategy 3: fuzzy brand match
  if (drugName) {
    const { data: fuzzyBrand } = await supabaseAdmin
      .from('cdr_drugs_unique')
      .select(selectCols)
      .ilike('drug_brand', `%${brandBase || drugName}%`)
      .limit(20)

    const result = scoreAndPick(fuzzyBrand as DrugMatch[] | null)
    if (result) return result
  }

  // Strategy 4: class only (last resort) — safety gates still apply
  if (classSearch) {
    const { data: classOnly } = await supabaseAdmin
      .from('cdr_drugs_unique')
      .select(selectCols)
      .ilike('drug_class', `%${classSearch}%`)
      .limit(50)

    const result = scoreAndPick(classOnly as DrugMatch[] | null)
    if (result) return result
  }

  return null
}

// ============================================
// OpenRouter multimodal processing
// ============================================

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

type ScanModel = { modelId: string; displayName: string }

function validateImage(imageBase64: string, mimeType: string) {
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, or WebP.')
  }
  const estimatedBytes = Math.floor((imageBase64.length * 3) / 4)
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large. The maximum processed image size is 10 MB.')
  }
}

function parseScanResult(content: string): Record<string, unknown> {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('The selected model returned an invalid structured response.')
  }

  if (!['prescription', 'invoice', 'unknown'].includes(String(parsed.document_type))) {
    parsed.document_type = 'unknown'
  }
  const confidence = Number(parsed.overall_confidence)
  parsed.overall_confidence = Number.isInteger(confidence) && confidence >= 0 && confidence <= 3
    ? String(confidence)
    : '0'
  if (!Array.isArray(parsed.drugs)) parsed.drugs = []
  if (typeof parsed.notes !== 'string') parsed.notes = ''
  return parsed
}

async function resolveScanModel(
  supabaseAdmin: ReturnType<typeof createClient>,
  organisationId: string,
): Promise<ScanModel> {
  const { data: settings } = await supabaseAdmin
    .from('ps_ai_org_settings')
    .select('scan_model_id')
    .eq('organisation_id', organisationId)
    .maybeSingle()

  if (settings?.scan_model_id) {
    const { data: selectedModel } = await supabaseAdmin
      .from('ps_ai_models')
      .select('model_id, display_name, capabilities')
      .eq('id', settings.scan_model_id)
      .eq('provider', 'openrouter')
      .eq('is_active', true)
      .maybeSingle()

    if (selectedModel && Array.isArray(selectedModel.capabilities) && selectedModel.capabilities.includes('image_input')) {
      return { modelId: selectedModel.model_id, displayName: selectedModel.display_name }
    }
  }

  // Organisations created before AI settings were introduced may not have a
  // ps_ai_org_settings row. Always fall back to the verified scan default.
  const { data: defaultModel, error: defaultModelError } = await supabaseAdmin
    .from('ps_ai_models')
    .select('model_id, display_name, capabilities')
    .eq('provider', 'openrouter')
    .eq('model_id', 'google/gemini-3.5-flash')
    .eq('is_active', true)
    .maybeSingle()

  if (
    defaultModelError ||
    !defaultModel ||
    !Array.isArray(defaultModel.capabilities) ||
    !defaultModel.capabilities.includes('image_input')
  ) {
    console.error('Default image model resolution failed', defaultModelError?.message ?? 'model unavailable')
    throw new Error('No valid image-understanding model is configured for this organisation.')
  }

  return { modelId: defaultModel.model_id, displayName: defaultModel.display_name }
}

async function processWithOpenRouter(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<Record<string, unknown>> {
  validateImage(imageBase64, mimeType)

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': 'PharmStation AI Scan',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this pharmacy document. Extract only Schedule 2 Controlled Drug information and return the required JSON object. Do not include markdown.',
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'pharmacy_cd_scan', strict: false, schema: SCAN_RESPONSE_SCHEMA },
      },
      max_tokens: 4096,
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    console.error('OpenRouter scan request failed', response.status, (await response.text()).slice(0, 500))
    if (response.status === 429) throw new Error('The selected AI model is temporarily busy. Please try again shortly.')
    if (response.status >= 500) throw new Error('The AI image service is temporarily unavailable. Please try again shortly.')
    throw new Error('The selected AI model could not process this image.')
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The selected model did not return scan data.')
  }
  return parseScanResult(content)
}

// ============================================
// Main handler
// Two-phase architecture:
//   action=upload  → fast: auth, store image, create DB record → return scan_id
//   action=process → slow: AI processing, drug reconciliation → update DB record
// This ensures the DB record exists IMMEDIATELY for all terminals.
// ============================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    // Auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Verify user
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const action = body.action ?? 'full' // 'upload', 'process', or 'full' (legacy)

    // ============================================
    // Phase 1: UPLOAD — ultra-fast, DB record only, no image upload
    // Image is sent directly to Phase 2 to skip the storage roundtrip
    // ============================================
    if (action === 'upload') {
      const { organisation_id } = body

      if (!organisation_id) {
        return new Response(JSON.stringify({ error: 'Missing organisation_id' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // Verify membership
      const { data: membership } = await supabaseAdmin
        .from('ps_organisation_members')
        .select('role, permissions, status')
        .eq('organisation_id', organisation_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (!membership) {
        return new Response(JSON.stringify({ error: 'Not a member of this organisation' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      if (membership.permissions?.ai_scan_use === false) {
        return new Response(JSON.stringify({ error: 'AI scan permission not granted' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // Create DB record — instantly visible to ALL terminals
      // No image yet — Phase 2 handles storage upload + AI in parallel
      const { data: scanRecord, error: scanInsertError } = await supabaseAdmin
        .from('ps_ai_scan_queue')
        .insert({
          organisation_id,
          uploaded_by: user.id,
          image_path: '',
          image_url: null,
          status: 'processing',
        })
        .select('*')
        .single()

      if (scanInsertError || !scanRecord) {
        return new Response(JSON.stringify({ error: `Failed to create scan record: ${scanInsertError?.message}` }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // Return immediately — DB record exists, all terminals can see it
      return new Response(JSON.stringify({
        scan_id: scanRecord.id,
        scan: scanRecord,
        status: 'processing',
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ============================================
    // Phase 2: PROCESS — receives image directly from client,
    // runs storage upload + LLM processing IN PARALLEL.
    //
    // RETRY MODE: if image_base64 is omitted, the image is downloaded from
    // storage (scan must already have an image_path from a previous run) and
    // the existing extraction is replaced. Blocked once any item is approved.
    // ============================================
    if (action === 'process') {
      const { scan_id, organisation_id } = body
      let { image_base64, mime_type } = body

      if (!scan_id || !organisation_id) {
        return new Response(JSON.stringify({ error: 'Missing scan_id or organisation_id' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      const isRetry = !image_base64

      const { data: processMembership } = await supabaseAdmin
        .from('ps_organisation_members')
        .select('permissions')
        .eq('organisation_id', organisation_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()

      if (!processMembership || processMembership.permissions?.ai_scan_use === false) {
        return new Response(JSON.stringify({ error: 'AI scan permission not granted' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // Fetch scan record (must exist from upload phase)
      const { data: scanRecord, error: scanFetchError } = await supabaseAdmin
        .from('ps_ai_scan_queue')
        .select('*')
        .eq('id', scan_id)
        .eq('organisation_id', organisation_id)
        .single()

      if (scanFetchError || !scanRecord) {
        return new Response(JSON.stringify({ error: 'Scan record not found' }), {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      if (isRetry) {
        // Retry safety: never re-extract once a register entry has been created
        const { count: approvedCount } = await supabaseAdmin
          .from('ps_ai_scan_items')
          .select('id', { count: 'exact', head: true })
          .eq('scan_id', scan_id)
          .eq('status', 'approved')

        if ((approvedCount ?? 0) > 0) {
          return new Response(JSON.stringify({ error: 'This scan has approved items with register entries. Retry is not allowed — delete the scan and re-photograph instead.' }), {
            status: 409,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }

        if (!scanRecord.image_path) {
          return new Response(JSON.stringify({ error: 'No stored image is available for this scan, so it cannot be re-processed.' }), {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }

        // Download the original image from storage
        const { data: imageBlob, error: downloadError } = await supabaseAdmin.storage
          .from('scan-images')
          .download(scanRecord.image_path)

        if (downloadError || !imageBlob) {
          return new Response(JSON.stringify({ error: `Could not load the stored image: ${downloadError?.message ?? 'not found'}` }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }

        const bytes = new Uint8Array(await imageBlob.arrayBuffer())
        let binary = ''
        const CHUNK = 0x8000
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
        }
        image_base64 = btoa(binary)
        const pathExt = scanRecord.image_path.split('.').pop()?.toLowerCase() ?? 'jpg'
        mime_type = pathExt === 'png' ? 'image/png' : pathExt === 'webp' ? 'image/webp' : 'image/jpeg'

        // Mark as processing again and clear previous results
        await supabaseAdmin.from('ps_ai_scan_queue').update({
          status: 'processing',
          error_message: null,
        }).eq('id', scan_id)
      }

      if (!image_base64 || !mime_type) {
        return new Response(JSON.stringify({ error: 'Missing image_base64 or mime_type' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      try {
        validateImage(image_base64, mime_type)
      } catch (err) {
        await supabaseAdmin.from('ps_ai_scan_queue').update({
          status: 'error',
          error_message: (err as Error).message,
          processed_at: new Date().toISOString(),
        }).eq('id', scan_id).eq('organisation_id', organisation_id)
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // Start storage upload in background (runs in parallel with AI).
      // On retry the image is already in storage — keep the existing path.
      const ext = mime_type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
      const storagePath = `${organisation_id}/${crypto.randomUUID()}.${ext}`

      const storagePromise = isRetry
        ? Promise.resolve({ path: scanRecord.image_path as string })
        : (async () => {
            try {
              const imageBuffer = Uint8Array.from(atob(image_base64), (c) => c.charCodeAt(0))
              const { error: storageError } = await supabaseAdmin.storage
                .from('scan-images')
                .upload(storagePath, imageBuffer, { contentType: mime_type, upsert: false })
              if (storageError) {
                console.error('Storage upload failed (non-blocking):', storageError.message)
                return null
              }
              return { path: storagePath }
            } catch (err) {
              console.error('Storage upload error (non-blocking):', err)
              return null
            }
          })()

      // Get augmentation notes
      const { data: augmentationNotes } = await supabaseAdmin
        .from('ps_ai_augmentation')
        .select('scope, category, title, content')
        .or(`scope.eq.global,and(scope.eq.organisation,organisation_id.eq.${organisation_id})`)
        .eq('is_active', true)
        .order('scope')
        .order('category')

      let scanModel: ScanModel
      try {
        scanModel = await resolveScanModel(supabaseAdmin, organisation_id)
      } catch (err) {
        await supabaseAdmin.from('ps_ai_scan_queue').update({
          status: 'error',
          error_message: (err as Error).message,
          processed_at: new Date().toISOString(),
        }).eq('id', scan_id)
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''

      if (!apiKey) {
        await supabaseAdmin.from('ps_ai_scan_queue').update({
          status: 'error',
          error_message: 'AI image service is not configured',
        }).eq('id', scan_id)

        return new Response(JSON.stringify({ error: 'AI image service is not configured' }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // Process with AI
      const systemPrompt = buildSystemPrompt(augmentationNotes ?? [])

      let aiResult: Record<string, unknown>
      try {
        aiResult = await processWithOpenRouter(
          apiKey,
          scanModel.modelId,
          systemPrompt,
          image_base64,
          mime_type,
        )
      } catch (err) {
        await supabaseAdmin.from('ps_ai_scan_queue').update({
          status: 'error',
          error_message: (err as Error).message,
          model_used: scanModel.displayName,
          processed_at: new Date().toISOString(),
        }).eq('id', scan_id)

        return new Response(JSON.stringify({
          error: `AI processing failed: ${(err as Error).message}`,
          scan_id,
        }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // Parse response
      const documentType = aiResult.document_type as string ?? 'unknown'
      const overallConfidence = parseInt(String(aiResult.overall_confidence), 10) || 0
      const aiNotes = aiResult.notes as string ?? ''
      const drugs = (aiResult.drugs as Record<string, unknown>[]) ?? []
      const supplierInfo = aiResult.supplier as Record<string, string> | undefined
      const patientInfo = aiResult.patient as Record<string, string> | undefined
      const prescriberInfo = aiResult.prescriber as Record<string, string> | undefined

      let scanStatus = 'ready'
      if (overallConfidence === 0) scanStatus = 'rejected'

      // Wait for storage upload to finish (should already be done by now since AI took longer)
      const storageResult = await storagePromise

      // Update scan record with AI results + storage path
      await supabaseAdmin.from('ps_ai_scan_queue').update({
        document_type: documentType,
        overall_confidence: overallConfidence,
        status: scanStatus,
        raw_ai_response: aiResult,
        ai_notes: aiNotes,
        model_used: scanModel.displayName,
        // Storage fields (from parallel upload)
        image_path: storageResult?.path ?? '',
        image_url: null,
        // Document fields
        supplier_name: supplierInfo?.name ?? null,
        invoice_number: supplierInfo?.invoice_number ?? null,
        invoice_date: supplierInfo?.date ?? null,
        patient_name: patientInfo?.name ?? null,
        patient_address: patientInfo?.address ?? null,
        prescriber_name: prescriberInfo?.name ?? null,
        prescriber_address: prescriberInfo?.address ?? null,
        prescriber_registration: prescriberInfo?.registration ?? null,
        is_partial_supply: aiResult.is_partial_supply ?? false,
        handwritten_notes: aiResult.handwritten_notes as string ?? null,
        processed_at: new Date().toISOString(),
      }).eq('id', scan_id)

      // On retry, replace the previous extraction (no approved items exist —
      // that was verified before processing started)
      if (isRetry) {
        await supabaseAdmin
          .from('ps_ai_scan_items')
          .delete()
          .eq('scan_id', scan_id)
      }

      // Reconcile drugs and create scan items
      const scanItems = []

      for (const drug of drugs) {
        const drugName = drug.drug_name as string ?? ''
        const drugClass = drug.drug_class as string ?? ''
        const drugForm = drug.drug_form as string ?? ''
        const drugStrength = drug.drug_strength as string ?? ''
        const quantity = drug.quantity as number ?? 0
        const confidence = parseInt(String(drug.confidence), 10) || 0
        const confidenceNotes = drug.confidence_notes as string ?? ''

        const match = await reconcileDrug(supabaseAdmin, drugName, drugClass, drugForm, drugStrength)

        const { data: item, error: itemError } = await supabaseAdmin
          .from('ps_ai_scan_items')
          .insert({
            scan_id,
            organisation_id,
            drug_name_raw: drugName,
            drug_class_raw: drugClass,
            drug_form_raw: drugForm,
            drug_strength_raw: drugStrength,
            quantity,
            matched_drug_id: match?.drug_id ?? null,
            matched_drug_brand: match?.drug_brand ?? null,
            matched_drug_form: match?.drug_form ?? null,
            matched_drug_strength: match?.drug_strength ?? null,
            matched_drug_class: match?.drug_class ?? null,
            confidence,
            confidence_notes: confidenceNotes,
            status: 'pending',
          })
          .select('*')
          .single()

        if (item && !itemError) scanItems.push(item)
      }

      const { data: fullScan } = await supabaseAdmin
        .from('ps_ai_scan_queue')
        .select('*')
        .eq('id', scan_id)
        .single()

      return new Response(JSON.stringify({
        scan: fullScan,
        items: scanItems,
        drug_count: scanItems.length,
        document_type: documentType,
        overall_confidence: overallConfidence,
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ============================================
    // Legacy: FULL — single call (backward compat)
    // ============================================
    const { organisation_id, image_base64, mime_type, filename } = body

    if (!organisation_id || !image_base64 || !mime_type) {
      return new Response(JSON.stringify({ error: 'Missing organisation_id, image_base64, or mime_type' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Verify membership
    const { data: membership } = await supabaseAdmin
      .from('ps_organisation_members')
      .select('role, permissions, status')
      .eq('organisation_id', organisation_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Not a member of this organisation' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (membership.permissions?.ai_scan_use === false) {
      return new Response(JSON.stringify({ error: 'AI scan permission not granted' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    try {
      validateImage(image_base64, mime_type)
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 1. Store image
    const ext = mime_type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
    const storagePath = `${organisation_id}/${crypto.randomUUID()}.${ext}`
    const imageBuffer = Uint8Array.from(atob(image_base64), (c) => c.charCodeAt(0))

    const { error: storageError } = await supabaseAdmin.storage
      .from('scan-images')
      .upload(storagePath, imageBuffer, { contentType: mime_type, upsert: false })

    if (storageError) {
      return new Response(JSON.stringify({ error: `Storage upload failed: ${storageError.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 2. Create record
    const { data: scanRecord, error: scanInsertError } = await supabaseAdmin
      .from('ps_ai_scan_queue')
      .insert({
        organisation_id,
        uploaded_by: user.id,
        image_path: storagePath,
        image_url: null,
        status: 'processing',
      })
      .select('id')
      .single()

    if (scanInsertError || !scanRecord) {
      return new Response(JSON.stringify({ error: `Failed to create scan record: ${scanInsertError?.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const scanId = scanRecord.id

    // 3. Augmentation
    const { data: augmentationNotes } = await supabaseAdmin
      .from('ps_ai_augmentation')
      .select('scope, category, title, content')
      .or(`scope.eq.global,and(scope.eq.organisation,organisation_id.eq.${organisation_id})`)
      .eq('is_active', true)
      .order('scope')
      .order('category')

    let scanModel: ScanModel
    try {
      scanModel = await resolveScanModel(supabaseAdmin, organisation_id)
    } catch (err) {
      await supabaseAdmin.from('ps_ai_scan_queue').update({
        status: 'error',
        error_message: (err as Error).message,
        processed_at: new Date().toISOString(),
      }).eq('id', scanId)
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''

    if (!apiKey) {
      await supabaseAdmin.from('ps_ai_scan_queue').update({
        status: 'error',
        error_message: 'AI image service is not configured',
      }).eq('id', scanId)

      return new Response(JSON.stringify({ error: 'AI image service is not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 5. AI processing
    const systemPrompt = buildSystemPrompt(augmentationNotes ?? [])

    let aiResult: Record<string, unknown>
    try {
      aiResult = await processWithOpenRouter(
        apiKey,
        scanModel.modelId,
        systemPrompt,
        image_base64,
        mime_type,
      )
    } catch (err) {
      await supabaseAdmin.from('ps_ai_scan_queue').update({
        status: 'error',
        error_message: (err as Error).message,
        model_used: scanModel.displayName,
        processed_at: new Date().toISOString(),
      }).eq('id', scanId)

      return new Response(JSON.stringify({
        error: `AI processing failed: ${(err as Error).message}`,
        scan_id: scanId,
      }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 6. Parse response
    const documentType = aiResult.document_type as string ?? 'unknown'
    const overallConfidence = parseInt(String(aiResult.overall_confidence), 10) || 0
    const aiNotes = aiResult.notes as string ?? ''
    const drugs = (aiResult.drugs as Record<string, unknown>[]) ?? []
    const supplierInfo = aiResult.supplier as Record<string, string> | undefined
    const patientInfo = aiResult.patient as Record<string, string> | undefined
    const prescriberInfo = aiResult.prescriber as Record<string, string> | undefined

    let scanStatus = 'ready'
    if (overallConfidence === 0) scanStatus = 'rejected'

    // 7. Update record
    await supabaseAdmin.from('ps_ai_scan_queue').update({
      document_type: documentType,
      overall_confidence: overallConfidence,
      status: scanStatus,
      raw_ai_response: aiResult,
      ai_notes: aiNotes,
      model_used: scanModel.displayName,
      supplier_name: supplierInfo?.name ?? null,
      invoice_number: supplierInfo?.invoice_number ?? null,
      invoice_date: supplierInfo?.date ?? null,
      patient_name: patientInfo?.name ?? null,
      patient_address: patientInfo?.address ?? null,
      prescriber_name: prescriberInfo?.name ?? null,
      prescriber_address: prescriberInfo?.address ?? null,
      prescriber_registration: prescriberInfo?.registration ?? null,
      is_partial_supply: aiResult.is_partial_supply ?? false,
      handwritten_notes: aiResult.handwritten_notes as string ?? null,
      processed_at: new Date().toISOString(),
    }).eq('id', scanId)

    // 8. Reconcile drugs
    const scanItems = []
    for (const drug of drugs) {
      const drugName = drug.drug_name as string ?? ''
      const drugClass = drug.drug_class as string ?? ''
      const drugForm = drug.drug_form as string ?? ''
      const drugStrength = drug.drug_strength as string ?? ''
      const quantity = drug.quantity as number ?? 0
      const confidence = parseInt(String(drug.confidence), 10) || 0
      const confidenceNotes = drug.confidence_notes as string ?? ''

      const match = await reconcileDrug(supabaseAdmin, drugName, drugClass, drugForm, drugStrength)

      const { data: item, error: itemError } = await supabaseAdmin
        .from('ps_ai_scan_items')
        .insert({
          scan_id: scanId,
          organisation_id,
          drug_name_raw: drugName,
          drug_class_raw: drugClass,
          drug_form_raw: drugForm,
          drug_strength_raw: drugStrength,
          quantity,
          matched_drug_id: match?.drug_id ?? null,
          matched_drug_brand: match?.drug_brand ?? null,
          matched_drug_form: match?.drug_form ?? null,
          matched_drug_strength: match?.drug_strength ?? null,
          matched_drug_class: match?.drug_class ?? null,
          confidence,
          confidence_notes: confidenceNotes,
          status: 'pending',
        })
        .select('*')
        .single()

      if (item && !itemError) scanItems.push(item)
    }

    // 9. Return
    const { data: fullScan } = await supabaseAdmin
      .from('ps_ai_scan_queue')
      .select('*')
      .eq('id', scanId)
      .single()

    return new Response(JSON.stringify({
      scan: fullScan,
      items: scanItems,
      drug_count: scanItems.length,
      document_type: documentType,
      overall_confidence: overallConfidence,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
