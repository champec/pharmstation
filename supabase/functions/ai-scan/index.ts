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
      type: 'integer',
      enum: [0, 1, 2, 3],
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
            type: 'integer',
            enum: [0, 1, 2, 3],
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

## Confidence Scoring
- 3: High confidence — all fields are clearly readable and you are certain of the values
- 2: Partial confidence — most fields are clear but some need human verification (e.g. handwriting is slightly ambiguous)
- 1: Low confidence — significant uncertainty, multiple fields are unclear, human must verify carefully
- 0: Rejected — the image is unusable: not a pharmacy document, extremely poor quality, inappropriate content, or completely illegible

## Important Rules
- ONLY extract Schedule 2 CDs. Do NOT include Schedule 3, 4, or 5 drugs, or non-controlled drugs.
- For prescriptions: read handwritten brand endorsements carefully. If a CD is prescribed generically but a brand name is written on by the pharmacist, use the BRAND name as the drug_name.
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

async function reconcileDrug(
  supabaseAdmin: ReturnType<typeof createClient>,
  drugName: string,
  drugClass: string,
  drugForm: string,
  drugStrength: string,
): Promise<DrugMatch | null> {
  // Try exact brand match first
  const { data: exactMatch } = await supabaseAdmin
    .from('cdr_drugs_unique')
    .select('id, drug_brand, drug_form, drug_strength, drug_class')
    .ilike('drug_brand', drugName)
    .limit(5)

  if (exactMatch && exactMatch.length > 0) {
    // Try to find one that also matches strength
    const strengthMatch = exactMatch.find(
      (d: DrugMatch) => d.drug_strength.toLowerCase().includes(drugStrength.toLowerCase())
        || drugStrength.toLowerCase().includes(d.drug_strength.toLowerCase())
    )
    if (strengthMatch) return strengthMatch as DrugMatch

    // Try form match
    const formMatch = exactMatch.find(
      (d: DrugMatch) => d.drug_form.toLowerCase().includes(drugForm.toLowerCase())
        || drugForm.toLowerCase().includes(d.drug_form.toLowerCase())
    )
    if (formMatch) return formMatch as DrugMatch

    return exactMatch[0] as DrugMatch
  }

  // Try fuzzy brand match
  const { data: fuzzyBrand } = await supabaseAdmin
    .from('cdr_drugs_unique')
    .select('id, drug_brand, drug_form, drug_strength, drug_class')
    .ilike('drug_brand', `%${drugName}%`)
    .limit(10)

  if (fuzzyBrand && fuzzyBrand.length > 0) {
    // Score by how many fields match
    const scored = fuzzyBrand.map((d: DrugMatch) => {
      let score = 0
      if (d.drug_strength.toLowerCase().includes(drugStrength.toLowerCase())
        || drugStrength.toLowerCase().includes(d.drug_strength.toLowerCase())) score += 2
      if (d.drug_form.toLowerCase().includes(drugForm.toLowerCase())
        || drugForm.toLowerCase().includes(d.drug_form.toLowerCase())) score += 1
      if (d.drug_class.toLowerCase().includes(drugClass.toLowerCase())
        || drugClass.toLowerCase().includes(d.drug_class.toLowerCase())) score += 1
      return { ...d, score }
    })
    scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    return scored[0] as DrugMatch
  }

  // Try class + strength match (generic name match)
  const { data: classMatch } = await supabaseAdmin
    .from('cdr_drugs_unique')
    .select('id, drug_brand, drug_form, drug_strength, drug_class')
    .ilike('drug_class', `%${drugClass}%`)
    .ilike('drug_strength', `%${drugStrength}%`)
    .limit(5)

  if (classMatch && classMatch.length > 0) {
    const formMatchInClass = classMatch.find(
      (d: DrugMatch) => d.drug_form.toLowerCase().includes(drugForm.toLowerCase())
        || drugForm.toLowerCase().includes(d.drug_form.toLowerCase())
    )
    return (formMatchInClass || classMatch[0]) as DrugMatch
  }

  // Last resort — class only
  const { data: classOnly } = await supabaseAdmin
    .from('cdr_drugs_unique')
    .select('id, drug_brand, drug_form, drug_strength, drug_class')
    .ilike('drug_class', `%${drugClass}%`)
    .limit(1)

  if (classOnly && classOnly.length > 0) return classOnly[0] as DrugMatch

  return null
}

// ============================================
// Gemini API — process image
// ============================================

async function processWithGemini(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<Record<string, unknown>> {
  const body = {
    contents: [
      {
        parts: [
          { text: 'Analyze this pharmacy document and extract all Schedule 2 Controlled Drug information according to your instructions. Respond ONLY with the JSON object matching the required schema.' },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SCAN_RESPONSE_SCHEMA,
      maxOutputTokens: 4096,
      temperature: 0.1, // Low temperature for accuracy
    },
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`Gemini API error (${response.status}): ${errBody.slice(0, 500)}`)
  }

  const result = await response.json()
  const content = result.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new Error('No content in Gemini response')

  return JSON.parse(content)
}

// ============================================
// OpenAI API — process image
// ============================================

async function processWithOpenAI(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<Record<string, unknown>> {
  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this pharmacy document and extract all Schedule 2 Controlled Drug information. Respond with JSON matching the required schema.' },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    temperature: 0.1,
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`OpenAI API error (${response.status}): ${errBody.slice(0, 500)}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  if (!content) throw new Error('No content in OpenAI response')

  return JSON.parse(content)
}

// ============================================
// Anthropic API — process image
// ============================================

async function processWithAnthropic(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<Record<string, unknown>> {
  // Anthropic uses media_type not mime_type, and supports specific types
  const anthropicMime = mimeType === 'image/heic' || mimeType === 'image/heif' ? 'image/jpeg' : mimeType

  const body = {
    model: modelId,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: anthropicMime,
              data: imageBase64,
            },
          },
          { type: 'text', text: 'Analyze this pharmacy document and extract all Schedule 2 Controlled Drug information. Respond ONLY with raw JSON matching the required schema, no markdown wrapping.' },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0.1,
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`Anthropic API error (${response.status}): ${errBody.slice(0, 500)}`)
  }

  const result = await response.json()
  const content = result.content?.[0]?.text
  if (!content) throw new Error('No content in Anthropic response')

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
  return JSON.parse(cleaned)
}

// ============================================
// Main handler
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

    // Parse request
    const body = await req.json()
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

    // Check AI scan permission
    if (membership.permissions?.ai_scan_use === false) {
      return new Response(JSON.stringify({ error: 'AI scan permission not granted' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ============================================
    // 1. Store image in Supabase Storage
    // ============================================
    const ext = mime_type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
    const storagePath = `${organisation_id}/${crypto.randomUUID()}.${ext}`

    const imageBuffer = Uint8Array.from(atob(image_base64), (c) => c.charCodeAt(0))

    const { error: storageError } = await supabaseAdmin.storage
      .from('scan-images')
      .upload(storagePath, imageBuffer, {
        contentType: mime_type,
        upsert: false,
      })

    if (storageError) {
      return new Response(JSON.stringify({ error: `Storage upload failed: ${storageError.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Get signed URL (valid for 10 years — these are permanent records)
    const { data: urlData } = await supabaseAdmin.storage
      .from('scan-images')
      .createSignedUrl(storagePath, 315360000) // ~10 years

    const imageUrl = urlData?.signedUrl ?? null

    // ============================================
    // 2. Create scan queue record (status: processing)
    // ============================================
    const { data: scanRecord, error: scanInsertError } = await supabaseAdmin
      .from('ps_ai_scan_queue')
      .insert({
        organisation_id,
        uploaded_by: user.id,
        image_path: storagePath,
        image_url: imageUrl,
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

    // ============================================
    // 3. Get augmentation notes (global + org)
    // ============================================
    const { data: augmentationNotes } = await supabaseAdmin
      .from('ps_ai_augmentation')
      .select('scope, category, title, content')
      .or(`scope.eq.global,and(scope.eq.organisation,organisation_id.eq.${organisation_id})`)
      .eq('is_active', true)
      .order('scope') // global first, then org
      .order('category')

    // ============================================
    // 4. Resolve AI model to use
    // ============================================
    // Check org settings for image-capable model preference
    const { data: orgSettings } = await supabaseAdmin
      .from('ps_ai_org_settings')
      .select('standard_model_id')
      .eq('organisation_id', organisation_id)
      .maybeSingle()

    // Default to Gemini 3 Pro (best cost/quality for image processing)
    let provider = 'google'
    let modelId = 'gemini-3-pro-preview'
    let modelDisplayName = 'Gemini 3 Pro'

    // If org has a preference, try to use it (must support image_input)
    if (orgSettings?.standard_model_id) {
      const { data: modelRecord } = await supabaseAdmin
        .from('ps_ai_models')
        .select('provider, model_id, display_name, capabilities')
        .eq('id', orgSettings.standard_model_id)
        .eq('is_active', true)
        .single()

      if (modelRecord) {
        const caps = modelRecord.capabilities as string[]
        if (caps.includes('image_input')) {
          provider = modelRecord.provider
          modelId = modelRecord.model_id
          modelDisplayName = modelRecord.display_name
        }
      }
    }

    // Get API key
    const apiKeyMap: Record<string, string> = {
      openai: Deno.env.get('openai_api_key') ?? Deno.env.get('OPENAI_API_KEY') ?? '',
      anthropic: Deno.env.get('anthropic_api_key') ?? Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      google: Deno.env.get('google_api_key') ?? Deno.env.get('GOOGLE_API_KEY') ?? '',
    }
    const apiKey = apiKeyMap[provider]

    if (!apiKey) {
      await supabaseAdmin.from('ps_ai_scan_queue').update({
        status: 'error',
        error_message: `No API key configured for provider: ${provider}`,
      }).eq('id', scanId)

      return new Response(JSON.stringify({ error: `No API key for provider: ${provider}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ============================================
    // 5. Process image with AI
    // ============================================
    const systemPrompt = buildSystemPrompt(augmentationNotes ?? [])

    let aiResult: Record<string, unknown>
    try {
      switch (provider) {
        case 'google':
          aiResult = await processWithGemini(apiKey, modelId, systemPrompt, image_base64, mime_type)
          break
        case 'openai':
          aiResult = await processWithOpenAI(apiKey, modelId, systemPrompt, image_base64, mime_type)
          break
        case 'anthropic':
          aiResult = await processWithAnthropic(apiKey, modelId, systemPrompt, image_base64, mime_type)
          break
        default:
          throw new Error(`Unsupported provider: ${provider}`)
      }
    } catch (err) {
      await supabaseAdmin.from('ps_ai_scan_queue').update({
        status: 'error',
        error_message: (err as Error).message,
        model_used: modelDisplayName,
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

    // ============================================
    // 6. Parse and validate AI response
    // ============================================
    const documentType = aiResult.document_type as string ?? 'unknown'
    const overallConfidence = aiResult.overall_confidence as number ?? 0
    const aiNotes = aiResult.notes as string ?? ''
    const drugs = (aiResult.drugs as Record<string, unknown>[]) ?? []
    const supplierInfo = aiResult.supplier as Record<string, string> | undefined
    const patientInfo = aiResult.patient as Record<string, string> | undefined
    const prescriberInfo = aiResult.prescriber as Record<string, string> | undefined

    // Determine status based on confidence
    let scanStatus = 'ready'
    if (overallConfidence === 0) {
      scanStatus = 'rejected'
    }
    if (drugs.length === 0 && overallConfidence > 0) {
      // AI found no Schedule 2 CDs — mark as ready but with a note
    }

    // ============================================
    // 7. Update scan queue with parsed data
    // ============================================
    await supabaseAdmin.from('ps_ai_scan_queue').update({
      document_type: documentType,
      overall_confidence: overallConfidence,
      status: scanStatus,
      raw_ai_response: aiResult,
      ai_notes: aiNotes,
      model_used: modelDisplayName,
      // Invoice fields
      supplier_name: supplierInfo?.name ?? null,
      invoice_number: supplierInfo?.invoice_number ?? null,
      invoice_date: supplierInfo?.date ?? null,
      // Prescription fields
      patient_name: patientInfo?.name ?? null,
      patient_address: patientInfo?.address ?? null,
      prescriber_name: prescriberInfo?.name ?? null,
      prescriber_address: prescriberInfo?.address ?? null,
      prescriber_registration: prescriberInfo?.registration ?? null,
      is_partial_supply: aiResult.is_partial_supply ?? false,
      handwritten_notes: aiResult.handwritten_notes as string ?? null,
      processed_at: new Date().toISOString(),
    }).eq('id', scanId)

    // ============================================
    // 8. Reconcile drugs and create scan items
    // ============================================
    const scanItems = []

    for (const drug of drugs) {
      const drugName = drug.drug_name as string ?? ''
      const drugClass = drug.drug_class as string ?? ''
      const drugForm = drug.drug_form as string ?? ''
      const drugStrength = drug.drug_strength as string ?? ''
      const quantity = drug.quantity as number ?? 0
      const confidence = drug.confidence as number ?? 0
      const confidenceNotes = drug.confidence_notes as string ?? ''

      // Try to reconcile against our drug database
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

      if (item && !itemError) {
        scanItems.push(item)
      }
    }

    // ============================================
    // 9. Return result
    // ============================================
    // Re-fetch the full scan record with items
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
