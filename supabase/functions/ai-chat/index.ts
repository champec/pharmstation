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
// OpenRouter streaming client
// ============================================

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: OpenRouterToolCall[]
}

type OpenRouterToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type StreamRound = {
  content: string
  toolCalls: OpenRouterToolCall[]
  inputTokens: number
  outputTokens: number
}

async function sendEvent(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  event: Record<string, unknown>,
) {
  await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
}

function safeProviderError(status: number): string {
  if (status === 429) return 'Genie is temporarily busy. Please wait a moment and try again.'
  if (status >= 500) return 'The AI service is temporarily unavailable. Please try again shortly.'
  return 'The AI service could not complete this request.'
}

async function streamOpenRouterRound(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<StreamRound> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': 'PharmStation Genie',
    },
    body: JSON.stringify({
      model,
      messages,
      tools: GENIE_TOOLS,
      tool_choice: 'auto',
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 4096,
      temperature: 0.2,
    }),
  })

  if (!response.ok || !response.body) {
    console.error('OpenRouter chat request failed', response.status, (await response.text()).slice(0, 500))
    throw new Error(safeProviderError(response.status))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let inputTokens = 0
  let outputTokens = 0
  const toolCalls = new Map<number, OpenRouterToolCall>()

  const processLine = async (line: string) => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') return

    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }

    if (parsed.error) throw new Error('The AI service could not complete this request.')
    if (parsed.usage) {
      inputTokens = parsed.usage.prompt_tokens ?? inputTokens
      outputTokens = parsed.usage.completion_tokens ?? outputTokens
    }

    const delta = parsed.choices?.[0]?.delta
    if (typeof delta?.content === 'string' && delta.content) {
      content += delta.content
      await sendEvent(writer, { type: 'text_delta', content: delta.content })
    }

    for (const part of delta?.tool_calls ?? []) {
      const index = Number(part.index ?? 0)
      let call = toolCalls.get(index)
      if (!call) {
        call = {
          id: part.id || crypto.randomUUID(),
          type: 'function',
          function: { name: part.function?.name ?? '', arguments: '' },
        }
        toolCalls.set(index, call)
        await sendEvent(writer, {
          type: 'tool_call_start',
          tool_call_id: call.id,
          tool_name: call.function.name,
        })
      }
      if (part.id) call.id = part.id
      if (part.function?.name) call.function.name = part.function.name
      if (part.function?.arguments) {
        call.function.arguments += part.function.arguments
        await sendEvent(writer, {
          type: 'tool_call_delta',
          tool_call_id: call.id,
          tool_arguments: part.function.arguments,
        })
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) await processLine(line.replace(/\r$/, ''))
  }
  buffer += decoder.decode()
  if (buffer.trim()) await processLine(buffer.trim())

  for (const call of toolCalls.values()) {
    await sendEvent(writer, { type: 'tool_call_end', tool_call_id: call.id })
  }

  return {
    content,
    toolCalls: [...toolCalls.values()],
    inputTokens,
    outputTokens,
  }
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

    if (!organisation_id || typeof message !== 'string' || !message.trim()) {
      return new Response(JSON.stringify({ error: 'Missing organisation_id or message' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (message.length > 20000) {
      return new Response(JSON.stringify({ error: 'Message is too long' }), {
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
        .eq('provider', 'openrouter')
        .contains('capabilities', ['text', 'function_calling'])
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
          .eq('provider', 'openrouter')
          .contains('capabilities', ['text', 'function_calling'])
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
        .eq('provider', 'openrouter')
        .eq('model_id', 'z-ai/glm-5.2')
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

    const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'AI service is not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Get or create conversation
    let convId = conversation_id
    let isNewConversation = false

    if (convId) {
      const { data: existingConversation } = await supabaseAdmin
        .from('ps_chat_conversations')
        .select('id')
        .eq('id', convId)
        .eq('organisation_id', organisation_id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existingConversation) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    } else {
      const { data: newConv, error: convError } = await supabaseAdmin
        .from('ps_chat_conversations')
        .insert({
          organisation_id,
          user_id: user.id,
          title: message.trim().slice(0, 80) + (message.trim().length > 80 ? '...' : ''),
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
    const { error: userMessageError } = await supabaseAdmin.from('ps_chat_messages').insert({
      conversation_id: convId,
      role: 'user',
      content: message.trim(),
      attachments: attachments,
      status: 'completed',
    })

    if (userMessageError) {
      return new Response(JSON.stringify({ error: 'Failed to save message' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

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

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    // Add history
    if (history) {
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content ?? '',
          })
        }
      }
    }

    // Set up SSE stream
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()

    // Stream in background
    const streamPromise = (async () => {
      try {
        // Send conversation_created event if new
        if (isNewConversation) {
          await sendEvent(writer, {
            type: 'conversation_created',
            conversation_id: convId,
          })
        }

        let fullContent = ''
        let inputTokens = 0
        let outputTokens = 0
        const savedToolCalls: { id: string; name: string; arguments: string }[] = []

        for (let roundNumber = 0; roundNumber < 5; roundNumber += 1) {
          const round = await streamOpenRouterRound(
            apiKey,
            modelRecord!.model_id,
            messages,
            writer,
          )
          fullContent += round.content
          inputTokens += round.inputTokens
          outputTokens += round.outputTokens

          if (round.toolCalls.length === 0) break

          messages.push({
            role: 'assistant',
            content: round.content || null,
            tool_calls: round.toolCalls,
          })

          for (const call of round.toolCalls) {
            savedToolCalls.push({
              id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
            })

            let parsedArgs: Record<string, unknown> = {}
            try {
              parsedArgs = JSON.parse(call.function.arguments || '{}')
            } catch {
              parsedArgs = {}
            }

            const result = await executeTool(call.function.name, parsedArgs, organisation_id, supabaseAdmin)
            messages.push({ role: 'tool', tool_call_id: call.id, content: result })
            await sendEvent(writer, {
              type: 'tool_result',
              tool_call_id: call.id,
              tool_name: call.function.name,
              tool_result: result,
            })
          }

          if (roundNumber === 4) {
            throw new Error('Genie could not finish the tool workflow. Please try a more specific question.')
          }
        }

        const { data: assistantMessage, error: assistantMessageError } = await supabaseAdmin
          .from('ps_chat_messages')
          .insert({
            conversation_id: convId,
            role: 'assistant',
            content: fullContent || null,
            tool_calls: savedToolCalls.length > 0 ? savedToolCalls : null,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            model_provider: 'openrouter',
            model_id_str: modelRecord!.model_id,
            status: 'completed',
          })
          .select('id')
          .single()

        if (assistantMessageError || !assistantMessage) throw new Error('Failed to save Genie response')

        await sendEvent(writer, {
          type: 'message_saved',
          message_id: assistantMessage.id,
        })
        await sendEvent(writer, {
          type: 'done',
          message_id: assistantMessage.id,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        })

        // Update conversation updated_at
        await supabaseAdmin
          .from('ps_chat_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', convId)
      } catch (err) {
        try {
          await sendEvent(writer, {
            type: 'error',
            error: (err as Error).message,
          })
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
