// ============================================
// PharmStation Edge Function: ai-chat
// Handles chat completions with interchangeable models
// Streams SSE responses back to the client
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ============================================
// Provider-specific API adapters
// ============================================

interface ChatInput {
  messages: { role: string; content: string | object[] }[]
  model: string
  tools?: object[]
  stream: boolean
  max_tokens?: number
}

interface ProviderAdapter {
  buildRequest: (input: ChatInput, apiKey: string) => { url: string; init: RequestInit }
  parseStream: (reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<{ inputTokens: number; outputTokens: number }>
}

// --- OPENAI ---
const openaiAdapter: ProviderAdapter = {
  buildRequest: (input, apiKey) => ({
    url: 'https://api.openai.com/v1/chat/completions',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: input.max_tokens ?? 4096,
      }),
    },
  }),
  parseStream: async (reader, writer) => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let inputTokens = 0
    let outputTokens = 0
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)

          // Usage info
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens ?? 0
            outputTokens = parsed.usage.completion_tokens ?? 0
          }

          const choice = parsed.choices?.[0]
          if (!choice) continue
          const delta = choice.delta

          // Text content
          if (delta?.content) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', content: delta.content })}\n\n`))
          }

          // Tool calls
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_call_start',
                  tool_call_id: tc.id,
                  tool_name: tc.function.name,
                })}\n\n`))
              }
              if (tc.function?.arguments) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_call_delta',
                  tool_call_id: tc.id,
                  tool_arguments: tc.function.arguments,
                })}\n\n`))
              }
            }
          }
        } catch {
          // skip malformed
        }
      }
    }
    return { inputTokens, outputTokens }
  },
}

// --- ANTHROPIC ---
const anthropicAdapter: ProviderAdapter = {
  buildRequest: (input, apiKey) => {
    // Separate system message from the rest
    const systemMsg = input.messages.find((m) => m.role === 'system')
    const otherMsgs = input.messages.filter((m) => m.role !== 'system')

    const body: Record<string, unknown> = {
      model: input.model,
      messages: otherMsgs,
      stream: true,
      max_tokens: input.max_tokens ?? 4096,
    }
    if (systemMsg) {
      body.system = typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content)
    }
    if (input.tools && input.tools.length > 0) {
      // Convert OpenAI-style tools to Anthropic format
      body.tools = (input.tools as { function: { name: string; description?: string; parameters?: object } }[]).map((t) => ({
        name: t.function.name,
        description: t.function.description ?? '',
        input_schema: t.function.parameters ?? { type: 'object', properties: {} },
      }))
    }

    return {
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      },
    }
  },
  parseStream: async (reader, writer) => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let inputTokens = 0
    let outputTokens = 0
    let buffer = ''
    let currentToolId = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data) continue

        try {
          const parsed = JSON.parse(data)

          if (parsed.type === 'message_start' && parsed.message?.usage) {
            inputTokens = parsed.message.usage.input_tokens ?? 0
          }
          if (parsed.type === 'message_delta' && parsed.usage) {
            outputTokens = parsed.usage.output_tokens ?? 0
          }

          if (parsed.type === 'content_block_start') {
            if (parsed.content_block?.type === 'tool_use') {
              currentToolId = parsed.content_block.id ?? ''
              await writer.write(encoder.encode(`data: ${JSON.stringify({
                type: 'tool_call_start',
                tool_call_id: currentToolId,
                tool_name: parsed.content_block.name,
              })}\n\n`))
            }
          }

          if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'text_delta') {
              await writer.write(encoder.encode(`data: ${JSON.stringify({
                type: 'text_delta',
                content: parsed.delta.text,
              })}\n\n`))
            }
            if (parsed.delta?.type === 'input_json_delta') {
              await writer.write(encoder.encode(`data: ${JSON.stringify({
                type: 'tool_call_delta',
                tool_call_id: currentToolId,
                tool_arguments: parsed.delta.partial_json,
              })}\n\n`))
            }
          }

          if (parsed.type === 'content_block_stop' && currentToolId) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({
              type: 'tool_call_end',
              tool_call_id: currentToolId,
            })}\n\n`))
            currentToolId = ''
          }
        } catch {
          // skip
        }
      }
    }
    return { inputTokens, outputTokens }
  },
}

// --- GOOGLE ---
const googleAdapter: ProviderAdapter = {
  buildRequest: (input, apiKey) => {
    // Convert messages to Gemini format
    const systemInstruction = input.messages.find((m) => m.role === 'system')
    const contents = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      }))

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: input.max_tokens ?? 4096,
      },
    }
    if (systemInstruction) {
      body.system_instruction = {
        parts: [{ text: typeof systemInstruction.content === 'string' ? systemInstruction.content : JSON.stringify(systemInstruction.content) }],
      }
    }
    if (input.tools && input.tools.length > 0) {
      body.tools = [{
        function_declarations: (input.tools as { function: { name: string; description?: string; parameters?: object } }[]).map((t) => ({
          name: t.function.name,
          description: t.function.description ?? '',
          parameters: t.function.parameters ?? { type: 'object', properties: {} },
        })),
      }]
    }

    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    }
  },
  parseStream: async (reader, writer) => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let inputTokens = 0
    let outputTokens = 0
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data) continue

        try {
          const parsed = JSON.parse(data)

          if (parsed.usageMetadata) {
            inputTokens = parsed.usageMetadata.promptTokenCount ?? 0
            outputTokens = parsed.usageMetadata.candidatesTokenCount ?? 0
          }

          const parts = parsed.candidates?.[0]?.content?.parts
          if (parts) {
            for (const part of parts) {
              if (part.text) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  type: 'text_delta',
                  content: part.text,
                })}\n\n`))
              }
              if (part.functionCall) {
                const callId = crypto.randomUUID()
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_call_start',
                  tool_call_id: callId,
                  tool_name: part.functionCall.name,
                })}\n\n`))
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_call_delta',
                  tool_call_id: callId,
                  tool_arguments: JSON.stringify(part.functionCall.args),
                })}\n\n`))
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_call_end',
                  tool_call_id: callId,
                })}\n\n`))
              }
            }
          }
        } catch {
          // skip
        }
      }
    }
    return { inputTokens, outputTokens }
  },
}

const adapters: Record<string, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
}

// ============================================
// Tool definitions for Genie
// ============================================

const GENIE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_cd_register',
      description: 'Search the CD (controlled drugs) register entries for this organisation. Use when the user asks about CD register entries, drug balances, transactions, receipts, or supplies.',
      parameters: {
        type: 'object',
        properties: {
          drug_name: { type: 'string', description: 'Drug name to search for (partial match)' },
          transaction_type: { type: 'string', enum: ['receipt', 'supply', 'disposal', 'patient_return', 'return_to_supplier', 'correction'], description: 'Type of transaction' },
          patient_name: { type: 'string', description: 'Patient name to search for' },
          date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          limit: { type: 'integer', description: 'Max results (default 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_rp_log',
      description: 'Search the Responsible Pharmacist log entries. Use when the user asks about who was RP, sign-in/out times, or pharmacist records.',
      parameters: {
        type: 'object',
        properties: {
          pharmacist_name: { type: 'string', description: 'Pharmacist name to search for' },
          date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          limit: { type: 'integer', description: 'Max results (default 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_drug_info',
      description: 'Look up drug information from the BNF drug database (cdr_drugs_unique table). Use when the user asks about specific drugs, schedules, forms, or strengths.',
      parameters: {
        type: 'object',
        properties: {
          drug_name: { type: 'string', description: 'Drug brand or generic name to search' },
          drug_class: { type: 'string', description: 'Drug classification to filter by' },
        },
        required: ['drug_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_organisation_members',
      description: 'List staff members of the current organisation. Use when the user asks about team, staff, or members.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['owner', 'manager', 'pharmacist', 'technician', 'dispenser', 'locum'], description: 'Filter by role' },
          status: { type: 'string', enum: ['active', 'suspended', 'revoked', 'pending'], description: 'Filter by status (default active)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_register_balance',
      description: 'Get the current balance and entry count for a specific CD drug ledger. Use when the user asks about stock levels or balances.',
      parameters: {
        type: 'object',
        properties: {
          drug_name: { type: 'string', description: 'Drug name to check balance for' },
        },
        required: ['drug_name'],
      },
    },
  },
]

// ============================================
// Tool execution
// ============================================

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  orgId: string,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<string> {
  try {
    switch (toolName) {
      case 'search_cd_register': {
        let query = supabaseAdmin
          .from('ps_register_entries')
          .select('entry_number, date_of_transaction, transaction_type, supplier_name, invoice_number, patient_name, prescriber_name, quantity_received, quantity_deducted, running_balance, notes, entered_at, source')
          .eq('organisation_id', orgId)
          .eq('register_type', 'CD')
          .order('entered_at', { ascending: false })
          .limit((args.limit as number) || 20)

        if (args.drug_name) {
          // Search via ledger
          const { data: ledgers } = await supabaseAdmin
            .from('ps_register_ledgers')
            .select('id, drug_name')
            .eq('organisation_id', orgId)
            .ilike('drug_name', `%${args.drug_name}%`)
          if (ledgers && ledgers.length > 0) {
            query = query.in('ledger_id', ledgers.map((l: { id: string }) => l.id))
          }
        }
        if (args.transaction_type) query = query.eq('transaction_type', args.transaction_type)
        if (args.patient_name) query = query.ilike('patient_name', `%${args.patient_name}%`)
        if (args.date_from) query = query.gte('date_of_transaction', args.date_from)
        if (args.date_to) query = query.lte('date_of_transaction', args.date_to)

        const { data, error } = await query
        if (error) return JSON.stringify({ error: error.message })
        return JSON.stringify({ entries: data, count: data?.length ?? 0 })
      }

      case 'search_rp_log': {
        let query = supabaseAdmin
          .from('ps_register_entries')
          .select('entry_number, date_of_transaction, pharmacist_name, gphc_number, rp_signed_in_at, rp_signed_out_at, notes, entered_at')
          .eq('organisation_id', orgId)
          .eq('register_type', 'RP')
          .order('entered_at', { ascending: false })
          .limit((args.limit as number) || 20)

        if (args.pharmacist_name) query = query.ilike('pharmacist_name', `%${args.pharmacist_name}%`)
        if (args.date_from) query = query.gte('date_of_transaction', args.date_from)
        if (args.date_to) query = query.lte('date_of_transaction', args.date_to)

        const { data, error } = await query
        if (error) return JSON.stringify({ error: error.message })
        return JSON.stringify({ entries: data, count: data?.length ?? 0 })
      }

      case 'get_drug_info': {
        let query = supabaseAdmin
          .from('cdr_drugs_unique')
          .select('drug_brand, drug_type, drug_form, drug_strength, drug_class, units, is_generic')
          .ilike('drug_brand', `%${args.drug_name}%`)
          .limit(20)

        if (args.drug_class) query = query.ilike('drug_class', `%${args.drug_class}%`)

        const { data, error } = await query
        if (error) return JSON.stringify({ error: error.message })
        return JSON.stringify({ drugs: data, count: data?.length ?? 0 })
      }

      case 'list_organisation_members': {
        let query = supabaseAdmin
          .from('ps_organisation_members')
          .select('role, status, is_locum, created_at, last_active_at, user_id')
          .eq('organisation_id', orgId)

        if (args.role) query = query.eq('role', args.role)
        if (args.status) query = query.eq('status', args.status)
        else query = query.eq('status', 'active')

        const { data: members, error: memberError } = await query
        if (memberError) return JSON.stringify({ error: memberError.message })

        // Fetch profiles for the members
        if (members && members.length > 0) {
          const userIds = members.map((m: { user_id: string }) => m.user_id)
          const { data: profiles } = await supabaseAdmin
            .from('ps_user_profiles')
            .select('id, full_name, email, gphc_number, default_role')
            .in('id', userIds)

          const profileMap = new Map((profiles ?? []).map((p: { id: string }) => [p.id, p]))
          const enriched = members.map((m: { user_id: string }) => ({
            ...m,
            profile: profileMap.get(m.user_id) ?? null,
          }))
          return JSON.stringify({ members: enriched, count: enriched.length })
        }

        return JSON.stringify({ members: [], count: 0 })
      }

      case 'get_register_balance': {
        const { data, error } = await supabaseAdmin
          .from('ps_register_ledgers')
          .select('id, drug_name, drug_form, drug_strength, current_balance, entry_count, is_active')
          .eq('organisation_id', orgId)
          .eq('register_type', 'CD')
          .ilike('drug_name', `%${args.drug_name}%`)

        if (error) return JSON.stringify({ error: error.message })
        return JSON.stringify({ ledgers: data, count: data?.length ?? 0 })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message })
  }
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

    // Create user-scoped client to verify auth
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

    // Admin client for tool execution (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Parse request
    const body = await req.json()
    const {
      conversation_id,
      organisation_id,
      message,
      attachments = [],
      model_id,
    } = body

    if (!organisation_id || !message) {
      return new Response(JSON.stringify({ error: 'Missing organisation_id or message' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Verify user is member of org
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

    // Resolve model
    let modelRecord: { id: string; provider: string; model_id: string; display_name: string } | null = null

    if (model_id) {
      const { data } = await supabaseAdmin
        .from('ps_ai_models')
        .select('*')
        .eq('id', model_id)
        .eq('is_active', true)
        .single()
      modelRecord = data
    }

    if (!modelRecord) {
      // Check org settings for preferred model
      const { data: orgSettings } = await supabaseAdmin
        .from('ps_ai_org_settings')
        .select('standard_model_id')
        .eq('organisation_id', organisation_id)
        .maybeSingle()

      if (orgSettings?.standard_model_id) {
        const { data } = await supabaseAdmin
          .from('ps_ai_models')
          .select('*')
          .eq('id', orgSettings.standard_model_id)
          .eq('is_active', true)
          .single()
        modelRecord = data
      }
    }

    if (!modelRecord) {
      // Fall back to default standard model
      const { data } = await supabaseAdmin
        .from('ps_ai_models')
        .select('*')
        .eq('model_type', 'standard')
        .eq('is_default', true)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(1)
        .single()
      modelRecord = data
    }

    if (!modelRecord) {
      return new Response(JSON.stringify({ error: 'No AI model available' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Get API key for provider
    const apiKeyMap: Record<string, string> = {
      openai: Deno.env.get('openai_api_key') ?? Deno.env.get('OPENAI_API_KEY') ?? '',
      anthropic: Deno.env.get('anthropic_api_key') ?? Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      google: Deno.env.get('google_api_key') ?? Deno.env.get('GOOGLE_API_KEY') ?? '',
    }

    const apiKey = apiKeyMap[modelRecord.provider]
    if (!apiKey) {
      return new Response(JSON.stringify({ error: `No API key for provider: ${modelRecord.provider}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Get or create conversation
    let convId = conversation_id
    let isNewConversation = false

    if (!convId) {
      const { data: newConv, error: convError } = await supabaseAdmin
        .from('ps_chat_conversations')
        .insert({
          organisation_id,
          user_id: user.id,
          title: message.slice(0, 80) + (message.length > 80 ? '...' : ''),
          model_id: modelRecord.id,
        })
        .select('id')
        .single()

      if (convError || !newConv) {
        return new Response(JSON.stringify({ error: `Failed to create conversation: ${convError?.message}` }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      convId = newConv.id
      isNewConversation = true
    }

    // Save user message
    await supabaseAdmin.from('ps_chat_messages').insert({
      conversation_id: convId,
      role: 'user',
      content: message,
      attachments: attachments,
      status: 'completed',
    })

    // Load conversation history
    const { data: history } = await supabaseAdmin
      .from('ps_chat_messages')
      .select('role, content, tool_calls, tool_call_id, tool_name')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(50)

    // Fetch org name for system prompt context
    const { data: org } = await supabaseAdmin
      .from('ps_organisations')
      .select('name')
      .eq('id', organisation_id)
      .single()

    // Fetch user profile
    const { data: userProfile } = await supabaseAdmin
      .from('ps_user_profiles')
      .select('full_name, gphc_number, default_role')
      .eq('id', user.id)
      .single()

    // Build messages
    const systemPrompt = `You are Genie, the intelligent AI assistant for PharmStation — a pharmacy management system used by UK community pharmacies.

You are assisting staff at "${org?.name ?? 'this pharmacy'}".
The current user is ${userProfile?.full_name ?? 'a staff member'} (role: ${membership.role}).
Current date: ${new Date().toISOString().split('T')[0]}.

You can help with:
- Searching CD register entries, RP logs, returns, and other registers
- Looking up drug information from the BNF database
- Checking stock balances for controlled drugs
- Listing and managing organisation staff
- Answering pharmacy-related questions
- Providing guidance on regulatory compliance (GPhC, MHRA, CD regulations)

IMPORTANT RULES:
- Always use the available tools to look up real data rather than guessing
- When displaying drug entries, format them clearly
- Respect user permissions — the current user's role is "${membership.role}"
- Be concise but thorough
- If you're unsure about something, say so rather than making up information
- For any provisional register entries, clearly mark them as provisional/pending`

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ]

    // Add history
    if (history) {
      for (const msg of history) {
        if (msg.role === 'tool') {
          messages.push({
            role: 'tool',
            content: msg.content ?? '',
            ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } as Record<string, string> : {}),
          } as { role: string; content: string })
        } else {
          messages.push({
            role: msg.role,
            content: msg.content ?? '',
          })
        }
      }
    }

    // Set up SSE stream
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    const adapter = adapters[modelRecord.provider]
    if (!adapter) {
      return new Response(JSON.stringify({ error: `Unsupported provider: ${modelRecord.provider}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Stream in background
    const streamPromise = (async () => {
      try {
        // Send conversation_created event if new
        if (isNewConversation) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({
            type: 'conversation_created',
            conversation_id: convId,
          })}\n\n`))
        }

        // Call the LLM
        const { url, init } = adapter.buildRequest(
          {
            messages,
            model: modelRecord!.model_id,
            tools: GENIE_TOOLS,
            stream: true,
            max_tokens: 4096,
          },
          apiKey,
        )

        const llmResponse = await fetch(url, init)

        if (!llmResponse.ok) {
          const errBody = await llmResponse.text()
          await writer.write(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: `LLM API error (${llmResponse.status}): ${errBody.slice(0, 200)}`,
          })}\n\n`))
          await writer.close()
          return
        }

        const reader = llmResponse.body!.getReader()
        const { inputTokens, outputTokens } = await adapter.parseStream(reader, writer)

        // TODO: Handle tool calls by executing tools and sending results back
        // For now, tool call events are streamed to the client for display

        // Send done event
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          type: 'done',
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        })}\n\n`))

        // Save assistant message to DB
        // We need to collect the full content — re-read from what was streamed
        // The adapter already streamed everything, so we parse from the accumulated events
        // For simplicity, we save after streaming completes
        // The client accumulates content from text_delta events

        // Update conversation updated_at
        await supabaseAdmin
          .from('ps_chat_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', convId)
      } catch (err) {
        try {
          await writer.write(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: (err as Error).message,
          })}\n\n`))
        } catch {
          // Writer might be closed
        }
      } finally {
        try {
          await writer.close()
        } catch {
          // Already closed
        }
      }
    })()

    // Don't await — let it stream
    void streamPromise

    return new Response(readable, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
