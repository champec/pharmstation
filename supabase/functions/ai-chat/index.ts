import '../_shared/monitoring.ts' // platform error tracking (see _shared/monitoring.ts)
// ============================================
// PharmStation Edge Function: ai-chat (Genie)
// Streams Genie answers (SSE) from an approved model on OpenRouter.
//
// Safety rules enforced here:
// - Only models flagged ps_ai_models.genie_enabled are used.
// - Plan + monthly message cap (ps_genie_claim_message), per-user rate limit.
// - Every data lookup runs as the signed-in user (row security applies) and
//   checks the same permission the app would (cd_register_read, rp_log_view).
// - Patient data (patient/prescriber names, register notes) is only sent to
//   the model when a platform admin has switched it on for the pharmacy
//   (ps_ai_org_settings.genie_patient_data). Staff emails are never sent.
// - OpenRouter is asked to use only providers that keep no data and do not
//   train on it (provider.zdr / data_collection: deny).
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'
import { GENIE_MONTHLY_MESSAGES, plansEnforced, type PlanId } from '../_shared/billing-plans.ts'
import { actionToolDefinitions, executeActionTool, performAction, type ActionContext } from './actions.ts'

// deno-lint-ignore no-explicit-any
type Db = any

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_TOOL_ROUNDS = 5
const HISTORY_MESSAGES = 40
const MAX_TOOL_ROWS = 50
const MAX_SAVED_TOOL_RESULT = 6000
const MESSAGES_PER_MINUTE = 10

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ============================================
// OpenRouter streaming client
// ============================================

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | ContentPart[]
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

type SavedToolCall = { id: string; name: string; arguments: string; result?: string }

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
  tools: unknown[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  signal: AbortSignal,
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
      tools,
      tool_choice: 'auto',
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 4096,
      temperature: 0.2,
      // Only route to providers with zero data retention that do not train on
      // prompts, preferring EU-hosted endpoints.
      provider: {
        zdr: true,
        data_collection: 'deny',
        order: ['google-vertex/europe', 'amazon-bedrock/eu-west-1'],
      },
    }),
    signal,
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

    // deno-lint-ignore no-explicit-any
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

function genieTools(patientData: boolean) {
  const cdSearchProperties: Record<string, unknown> = {
    drug_name: { type: 'string', description: 'Drug name to search for (partial match)' },
    transaction_type: {
      type: 'string',
      enum: [...CD_TRANSACTION_TYPES],
      description: 'Type of transaction',
    },
    date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
    date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
    limit: { type: 'integer', description: `Max results (default 20, max ${MAX_TOOL_ROWS})` },
  }
  if (patientData) {
    cdSearchProperties.patient_name = { type: 'string', description: 'Patient name to search for' }
  }

  return [
    {
      type: 'function',
      function: {
        name: 'search_cd_register',
        description: patientData
          ? 'Search the CD (controlled drugs) register entries for this pharmacy. Use for questions about CD transactions, receipts, supplies, returns or balances over time.'
          : 'Search the CD (controlled drugs) register entries for this pharmacy. Use for questions about CD transactions, receipts, supplies, returns or balances over time. Patient and prescriber details are not available.',
        parameters: { type: 'object', properties: cdSearchProperties },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_rp_log',
        description: 'Search the Responsible Pharmacist log. Use when the user asks who was RP, or RP sign-in and sign-out times.',
        parameters: {
          type: 'object',
          properties: {
            pharmacist_name: { type: 'string', description: 'Pharmacist name to search for' },
            date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
            date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
            limit: { type: 'integer', description: `Max results (default 20, max ${MAX_TOOL_ROWS})` },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_drug_info',
        description: 'Look up controlled drugs in the PharmStation drug catalogue (brand, form, strength, class/schedule). Not a clinical reference.',
        parameters: {
          type: 'object',
          properties: {
            drug_name: { type: 'string', description: 'Drug brand or generic name to search' },
            drug_class: { type: 'string', description: 'Drug class or schedule to filter by' },
          },
          required: ['drug_name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_organisation_members',
        description: 'List staff members of this pharmacy with their roles. Use when the user asks about the team.',
        parameters: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: [...MEMBER_ROLES], description: 'Filter by role' },
            status: { type: 'string', enum: [...MEMBER_STATUSES], description: 'Filter by status (default active)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_register_balance',
        description: 'Get the current balance and entry count for CD register drugs matching a name. Use for stock level or balance questions.',
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
}

// ============================================
// Tool execution
// ============================================

type ToolContext = {
  orgId: string
  userClient: Db
  supabaseAdmin: Db
  patientData: boolean
}

function clampLimit(value: unknown, fallback = 20): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, MAX_TOOL_ROWS)
}

function textArg(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Strip PostgREST pattern characters the model has no reason to send.
  const cleaned = value.replace(/[%_,()\\]/g, ' ').trim().slice(0, 100)
  return cleaned || null
}

function enumArg(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null
}

const CD_TRANSACTION_TYPES = ['receipt', 'supply', 'disposal', 'patient_return', 'return_to_supplier', 'correction', 'opening_balance', 'transfer_in', 'transfer_out'] as const
const MEMBER_ROLES = ['owner', 'manager', 'pharmacist', 'technician', 'dispenser', 'locum'] as const
const MEMBER_STATUSES = ['active', 'suspended', 'revoked', 'pending'] as const

function dateArg(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

async function hasPermission(ctx: ToolContext, permission: string): Promise<boolean> {
  const { data, error } = await ctx.userClient.rpc('ps_member_has_permission', {
    p_organisation_id: ctx.orgId,
    p_permission: permission,
  })
  return !error && data === true
}

const NO_PERMISSION = (what: string) =>
  JSON.stringify({ error: `This user does not have permission to view ${what}. Tell them to ask their pharmacy owner or manager.` })

// Tool rows carry ISO dates and UTC timestamps. Turn them into UK formats ("9 Nov 2026",
// "9 Nov 2026, 14:06" in UK local time) so Genie never quotes UTC or ISO dates to staff.
const UK_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' })
const UK_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

function localiseValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return UK_DATE.format(new Date(Date.UTC(y, m - 1, d, 12)))
  }
  if ((key.endsWith('_at') || key.startsWith('date')) && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : UK_DATE_TIME.format(date)
  }
  return value
}

function localiseDates(node: unknown, key = ''): unknown {
  if (Array.isArray(node)) return node.map((item) => localiseDates(item, key))
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, localiseDates(v, k)]))
  }
  return localiseValue(key, node)
}

/** The unit CD quantities are counted in, from the ledger's form (e.g. oral solution -> ml). */
function unitForForm(form: string | null | undefined): string {
  const f = (form ?? '').toLowerCase()
  if (/ampoule|vial|injection|infusion/.test(f)) return 'ampoules or vials'
  if (/solution|liquid|syrup|suspension|linctus|elixir|mixture|drops|concentrate/.test(f)) return 'ml'
  if (/patch/.test(f)) return 'patches'
  if (/capsule/.test(f)) return 'capsules'
  if (/tablet|lozenge|film/.test(f)) return 'tablets'
  if (/suppositor/.test(f)) return 'suppositories'
  if (/spray/.test(f)) return 'sprays or bottles'
  return 'units as recorded in the register'
}

async function executeTool(toolName: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const raw = await executeToolRaw(toolName, args, ctx)
  try {
    return JSON.stringify(localiseDates(JSON.parse(raw)))
  } catch {
    return raw
  }
}

async function executeToolRaw(toolName: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  try {
    switch (toolName) {
      case 'search_cd_register': {
        if (!(await hasPermission(ctx, 'cd_register_read'))) return NO_PERMISSION('the CD register')

        const columns = [
          'entry_number', 'date_of_transaction', 'transaction_type', 'supplier_name', 'invoice_number',
          'quantity_received', 'quantity_deducted', 'running_balance', 'entered_at', 'source', 'ledger_id', 'entered_by',
        ]
        if (ctx.patientData) columns.push('patient_name', 'prescriber_name', 'notes')

        let query = ctx.userClient
          .from('ps_register_entries')
          .select(columns.join(', '))
          .eq('organisation_id', ctx.orgId)
          .eq('register_type', 'CD')
          .order('entered_at', { ascending: false })
          .limit(clampLimit(args.limit))

        const drugName = textArg(args.drug_name)
        let ledgerNames = new Map<string, string>()
        const ledgerUnits = new Map<string, string>()
        if (drugName) {
          const { data: ledgers, error } = await ctx.userClient
            .from('ps_register_ledgers')
            .select('id, drug_name, drug_strength, drug_form')
            .eq('organisation_id', ctx.orgId)
            .eq('register_type', 'CD')
            .ilike('drug_name', `%${drugName}%`)
          if (error) return JSON.stringify({ error: 'Could not search the CD register.' })
          if (!ledgers || ledgers.length === 0) {
            return JSON.stringify({ entries: [], count: 0, note: `No CD register in this pharmacy matches "${drugName}".` })
          }
          ledgerNames = new Map(ledgers.map((l: { id: string; drug_name: string; drug_strength: string | null; drug_form: string | null }) =>
            [l.id, [l.drug_name, l.drug_strength, l.drug_form].filter(Boolean).join(' ')]))
          for (const l of ledgers as { id: string; drug_form: string | null }[]) ledgerUnits.set(l.id, unitForForm(l.drug_form))
          query = query.in('ledger_id', ledgers.map((l: { id: string }) => l.id))
        }

        const transactionType = enumArg(args.transaction_type, CD_TRANSACTION_TYPES)
        if (transactionType) query = query.eq('transaction_type', transactionType)
        if (ctx.patientData) {
          const patientName = textArg(args.patient_name)
          if (patientName) query = query.ilike('patient_name', `%${patientName}%`)
        }
        const from = dateArg(args.date_from)
        const to = dateArg(args.date_to)
        if (from) query = query.gte('date_of_transaction', from)
        if (to) query = query.lte('date_of_transaction', to)

        const { data, error } = await query
        if (error) return JSON.stringify({ error: 'Could not search the CD register.' })
        // Without a drug filter, look up the drug for each entry so answers can name it.
        const missing = [...new Set<string>((data ?? []).map((e: Record<string, unknown>) => e.ledger_id as string))]
          .filter((id) => id && !ledgerNames.has(id))
        if (missing.length) {
          const { data: ledgers } = await ctx.userClient
            .from('ps_register_ledgers')
            .select('id, drug_name, drug_strength, drug_form')
            .in('id', missing)
          for (const l of (ledgers ?? []) as { id: string; drug_name: string; drug_strength: string | null; drug_form: string | null }[]) {
            ledgerNames.set(l.id, [l.drug_name, l.drug_strength, l.drug_form].filter(Boolean).join(' '))
            ledgerUnits.set(l.id, unitForForm(l.drug_form))
          }
        }
        // Who made each entry (staff names, not patient data).
        const staffIds = [...new Set<string>((data ?? []).map((e: Record<string, unknown>) => e.entered_by as string))].filter(Boolean)
        const staffNames = new Map<string, string>()
        if (staffIds.length) {
          const { data: profiles } = await ctx.supabaseAdmin
            .from('ps_user_profiles')
            .select('id, full_name')
            .in('id', staffIds)
          for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
            if (p.full_name) staffNames.set(p.id, p.full_name)
          }
        }
        const entries = (data ?? []).map((e: Record<string, unknown>) => {
          const { ledger_id, entered_by, ...rest } = e
          return {
            drug: ledgerNames.get(ledger_id as string) ?? undefined,
            quantity_unit: ledgerUnits.get(ledger_id as string) ?? undefined,
            ...rest,
            entered_by: staffNames.get(entered_by as string) ?? (entered_by ? 'Not recorded' : undefined),
          }
        })
        return JSON.stringify({
          entries,
          count: entries.length,
          ...(ctx.patientData ? {} : { note: 'Patient and prescriber details are switched off for Genie in this pharmacy.' }),
        })
      }

      case 'search_rp_log': {
        if (!(await hasPermission(ctx, 'rp_log_view'))) return NO_PERMISSION('the RP log')

        let query = ctx.userClient
          .from('ps_register_entries')
          .select('entry_number, date_of_transaction, pharmacist_name, gphc_number, rp_signed_in_at, rp_signed_out_at, entered_at')
          .eq('organisation_id', ctx.orgId)
          .eq('register_type', 'RP')
          .order('entered_at', { ascending: false })
          .limit(clampLimit(args.limit))

        const pharmacist = textArg(args.pharmacist_name)
        if (pharmacist) query = query.ilike('pharmacist_name', `%${pharmacist}%`)
        const from = dateArg(args.date_from)
        const to = dateArg(args.date_to)
        if (from) query = query.gte('date_of_transaction', from)
        if (to) query = query.lte('date_of_transaction', to)

        const { data, error } = await query
        if (error) return JSON.stringify({ error: 'Could not search the RP log.' })
        return JSON.stringify({ entries: data ?? [], count: data?.length ?? 0 })
      }

      case 'get_drug_info': {
        const drugName = textArg(args.drug_name)
        if (!drugName) return JSON.stringify({ error: 'A drug name is needed.' })
        let query = ctx.userClient
          .from('cdr_drugs_unique')
          .select('drug_brand, drug_type, drug_form, drug_strength, drug_class, units, is_generic')
          .ilike('drug_brand', `%${drugName}%`)
          .limit(20)

        const drugClass = textArg(args.drug_class)
        if (drugClass) query = query.ilike('drug_class', `%${drugClass}%`)

        const { data, error } = await query
        if (error) return JSON.stringify({ error: 'Could not search the drug catalogue.' })
        return JSON.stringify({ drugs: data ?? [], count: data?.length ?? 0 })
      }

      case 'list_organisation_members': {
        let query = ctx.supabaseAdmin
          .from('ps_organisation_members')
          .select('role, status, is_locum, created_at, last_active_at, user_id')
          .eq('organisation_id', ctx.orgId)
          .limit(200)

        const role = enumArg(args.role, MEMBER_ROLES)
        const status = enumArg(args.status, MEMBER_STATUSES)
        if (role) query = query.eq('role', role)
        query = query.eq('status', status ?? 'active')

        const { data: members, error } = await query
        if (error) return JSON.stringify({ error: 'Could not list staff.' })
        if (!members || members.length === 0) return JSON.stringify({ members: [], count: 0 })

        const userIds = members.map((m: { user_id: string }) => m.user_id)
        const { data: profiles } = await ctx.supabaseAdmin
          .from('ps_user_profiles')
          .select('id, full_name, gphc_number')
          .in('id', userIds)

        const profileMap = new Map((profiles ?? []).map((p: { id: string; full_name: string | null; gphc_number: string | null }) => [p.id, p]))
        const enriched = members.map(({ user_id, ...m }: { user_id: string } & Record<string, unknown>) => {
          const p = profileMap.get(user_id) as { full_name: string | null; gphc_number: string | null } | undefined
          return { ...m, name: p?.full_name ?? null, gphc_number: p?.gphc_number ?? null }
        })
        return JSON.stringify({ members: enriched, count: enriched.length })
      }

      case 'get_register_balance': {
        if (!(await hasPermission(ctx, 'cd_register_read'))) return NO_PERMISSION('the CD register')
        const drugName = textArg(args.drug_name)
        if (!drugName) return JSON.stringify({ error: 'A drug name is needed.' })

        const { data, error } = await ctx.userClient
          .from('ps_register_ledgers')
          .select('drug_name, drug_form, drug_strength, current_balance, entry_count, is_active')
          .eq('organisation_id', ctx.orgId)
          .eq('register_type', 'CD')
          .ilike('drug_name', `%${drugName}%`)
          .limit(MAX_TOOL_ROWS)

        if (error) return JSON.stringify({ error: 'Could not read CD balances.' })
        if (!data || data.length === 0) {
          return JSON.stringify({ ledgers: [], count: 0, note: `No CD register in this pharmacy matches "${drugName}".` })
        }
        const ledgers = (data as { drug_form: string | null }[]).map((l) => ({ ...l, balance_unit: unitForForm(l.drug_form) }))
        return JSON.stringify({ ledgers, count: ledgers.length })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (err) {
    console.error('Genie tool failed', toolName, err)
    return JSON.stringify({ error: 'This lookup failed. Try again or check the page directly.' })
  }
}

// ============================================
// History
// ============================================

type HistoryRow = {
  role: string
  content: string | null
  tool_calls: SavedToolCall[] | null
  attachments?: StoredAttachment[] | null
}

// ============================================
// Attachments (images and PDFs in the genie-attachments bucket)
// ============================================

type StoredAttachment = { type: 'image' | 'pdf'; url: string; name: string; size?: number; mime_type?: string }

const ATTACHMENT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024

/** Keeps only attachments the caller uploaded to their own folder. */
function readAttachments(value: unknown, userId: string): StoredAttachment[] {
  if (!Array.isArray(value)) return []
  const out: StoredAttachment[] = []
  for (const raw of value.slice(0, MAX_ATTACHMENTS)) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as Record<string, unknown>
    const path = typeof a.url === 'string' ? a.url : typeof a.path === 'string' ? a.path : ''
    const mime = typeof a.mime_type === 'string' ? a.mime_type : ''
    if (!path.startsWith(`${userId}/`) || path.includes('..') || path.length > 300) continue
    if (!ATTACHMENT_MIME.includes(mime)) continue
    out.push({
      type: mime === 'application/pdf' ? 'pdf' : 'image',
      url: path,
      name: (typeof a.name === 'string' ? a.name : 'attachment').replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'attachment',
      size: typeof a.size === 'number' ? a.size : undefined,
      mime_type: mime,
    })
  }
  return out
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/** Downloads the attachments and turns them into model content parts. */
async function attachmentParts(supabaseAdmin: Db, attachments: StoredAttachment[]): Promise<ContentPart[]> {
  const parts: ContentPart[] = []
  let total = 0
  for (const a of attachments) {
    const { data, error } = await supabaseAdmin.storage.from('genie-attachments').download(a.url)
    if (error || !data) throw new Error(`Genie could not open the attachment "${a.name}". Please attach it again.`)
    const bytes = new Uint8Array(await data.arrayBuffer())
    total += bytes.length
    if (bytes.length > MAX_ATTACHMENT_BYTES || total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error('Genie attachments are too large. Attach up to 4 files, 10 MB each.')
    }
    const dataUrl = `data:${a.mime_type};base64,${toBase64(bytes)}`
    parts.push(a.type === 'pdf'
      ? { type: 'file', file: { filename: a.name, file_data: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl } })
  }
  return parts
}

function historyToMessages(rows: HistoryRow[], replayToolResults: boolean): OpenRouterMessage[] {
  const out: OpenRouterMessage[] = []
  for (const row of rows) {
    if (row.role === 'user') {
      // Earlier files are named, not re-sent, to keep each question small.
      const files = Array.isArray(row.attachments) && row.attachments.length
        ? `\n[Attached earlier: ${row.attachments.map((a) => a.name).join(', ')}]`
        : ''
      out.push({ role: 'user', content: (row.content ?? '') + files })
      continue
    }
    if (row.role !== 'assistant') continue

    const calls = Array.isArray(row.tool_calls) ? row.tool_calls.filter((c) => typeof c?.result === 'string') : []
    if (replayToolResults && calls.length > 0) {
      out.push({
        role: 'assistant',
        content: null,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })),
      })
      for (const c of calls) out.push({ role: 'tool', tool_call_id: c.id, content: c.result as string })
    }
    if (row.content) out.push({ role: 'assistant', content: row.content })
  }
  // The model needs the conversation to start with a user turn.
  while (out.length > 0 && out[0].role !== 'user') out.shift()
  return out
}

// ============================================
// System prompt
// ============================================

type PageContext = { path: string; title: string; details: string }
type RecentAction = { summary: string; status: string; result: { message?: string } | null }

function systemPrompt(opts: {
  orgName: string; userName: string; role: string; patientData: boolean
  page: PageContext | null; recentActions: RecentAction[]
}) {
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  return `You are Genie, the AI assistant inside PharmStation, a pharmacy management system for UK community pharmacies.

You are helping staff at "${opts.orgName}".
The current user is ${opts.userName} (role: ${opts.role}).
Today's date (UK) is ${today}.

What you can look up with your tools:
- CD register entries and current CD balances
- The Responsible Pharmacist (RP) log
- The PharmStation controlled drug catalogue
- The pharmacy's staff list and roles
- Locum shifts, applications and bookings
- Services, appointment times (slots) and appointments

What you can do (always with the user's confirmation):
- Create, change and cancel locum shifts; approve or reject locum applications
- Add appointment times; confirm, complete, mark no-show, cancel or move appointments${opts.patientData ? '; book patients in' : ''}

You can also answer general questions about UK pharmacy practice and regulation (GPhC, MHRA, Misuse of Drugs Regulations), clearly as general guidance.

Rules:
- Always use the tools for this pharmacy's data. Never guess or invent register entries, balances or names.
- If a tool says the user lacks permission, tell them plainly. Do not try to work around it.
- You cannot change CD register or RP log entries, staff, settings or anything not listed above. If asked, explain where in PharmStation the user can do it.
- To change something, call the matching tool. It does NOT make the change: it shows the user a card with Confirm and Cancel. Then say in one short sentence what will happen and ask them to tap Confirm. Never claim a change is done until a later message shows it was confirmed.
- Before changing a shift or appointment, look it up first so you use the right id. If the request is ambiguous (which shift? what rate?), ask a short question instead of guessing.
- Propose one change per tool call. For several changes, make several calls.
- Be concise. Use short Markdown tables or lists for register data.
- Write dates the UK way ("9 Nov 2026") and times in 24-hour UK local time ("14:06"). Tool results are already in UK local time; never convert them or call them UTC.
- CD entries include entered_by, the staff member who made the entry. You may name staff.
- Always state CD quantities and balances with their unit (quantity_unit or balance_unit), e.g. "30 ml" or "28 capsules", never just "units".
- The user can attach photos, screenshots and PDFs (for example an invoice, a delivery note, a label or a document). Read them carefully, say what you can and cannot make out, and never guess text you cannot read.
- If you are unsure, say so. For clinical decisions, tell the user to check an authoritative source (BNF, SPC) and use professional judgement.
${opts.patientData
    ? '- Patient details are available. Only show patient information that the question needs.'
    : '- Patient details are switched off for Genie in this pharmacy. You cannot see patient or prescriber names. Do not ask the user to type patient details; if they need them, tell them to open the register in PharmStation. If an attached file shows patient names, addresses, dates of birth or NHS numbers, do not repeat them; refer to "the patient" instead.'}${opts.page ? `

The user is looking at this PharmStation page right now: "${opts.page.title}" (${opts.page.path}).${opts.page.details ? ` On screen: ${opts.page.details}` : ''}
Use it as context: "this shift", "this page" or "here" means what they are looking at. Ids in the path (after /shifts/ or /appointments/) can be used with your tools.` : ''}${opts.recentActions.length ? `

Changes you proposed earlier in this chat, and what happened:
${opts.recentActions.map((a) => `- ${a.summary}: ${a.status === 'done' ? `done (${a.result?.message ?? 'confirmed'})` : a.status === 'pending' ? 'waiting for the user to confirm' : a.status}`).join('\n')}` : ''}`
}

/** Page the user is on, sent by the app. Short, plain text only. */
function readPageContext(value: unknown): PageContext | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const clean = (x: unknown, max: number) =>
    typeof x === 'string' ? x.replace(/[\u0000-\u001f`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
  const path = clean(v.path, 200)
  if (!path.startsWith('/')) return null
  return { path, title: clean(v.title, 120) || path, details: clean(v.details, 400) }
}

// ============================================
// Main handler
// ============================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'Missing authorization' })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // User-scoped client: verifies the caller and runs every data lookup with row security.
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json(401, { error: 'Unauthorized' })

    // Admin client: conversations, usage and settings only.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json(400, { error: 'Invalid request' })
    }
    // Confirm or cancel a change Genie proposed. No AI call, so it does not use the allowance.
    if (typeof body.action_id === 'string') {
      const decision = body.decision === 'confirm' ? 'confirm' : body.decision === 'cancel' ? 'cancel' : null
      if (!decision) return json(400, { error: 'Invalid request' })
      const { data: action } = await supabaseAdmin
        .from('ps_genie_actions')
        .select('id, organisation_id, tool, args, summary, status, expires_at')
        .eq('id', body.action_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!action) return json(404, { error: 'That change was not found.' })
      if (action.status !== 'pending') {
        return json(409, { error: `This change was already ${action.status === 'done' ? 'made' : action.status}.`, status: action.status })
      }
      const { data: stillMember } = await supabaseAdmin
        .from('ps_organisation_members')
        .select('user_id')
        .eq('organisation_id', action.organisation_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()
      if (!stillMember) return json(403, { error: 'Not a member of this organisation' })

      const finish = async (status: string, result: Record<string, unknown> | null) => {
        // Only a still-pending row is updated, so a double tap cannot run the change twice.
        const { data: updated } = await supabaseAdmin
          .from('ps_genie_actions')
          .update({ status, result, decided_at: new Date().toISOString() })
          .eq('id', action.id)
          .eq('status', status === 'done' || status === 'failed' ? 'running' : 'pending')
          .select('id')
        return (updated ?? []).length > 0
      }
      if (decision === 'cancel') {
        await finish('cancelled', null)
        return json(200, { status: 'cancelled', message: 'Cancelled. Nothing was changed.' })
      }
      if (new Date(action.expires_at).getTime() < Date.now()) {
        await finish('expired', null)
        return json(409, { error: 'This change has expired. Ask Genie again.', status: 'expired' })
      }
      // Claim it (pending -> running) before doing anything.
      const { data: claimed } = await supabaseAdmin
        .from('ps_genie_actions')
        .update({ status: 'running' })
        .eq('id', action.id)
        .eq('status', 'pending')
        .select('id')
      if (!claimed?.length) return json(409, { error: 'This change is already being made.' })
      const outcome = await performAction(
        { tool: action.tool, args: action.args ?? {} },
        { orgId: action.organisation_id, userId: user.id, userClient },
      )
      await finish(outcome.ok ? 'done' : 'failed', outcome)
      return json(outcome.ok ? 200 : 422, { status: outcome.ok ? 'done' : 'failed', message: outcome.message, link: outcome.link ?? null })
    }

    const conversationIdInput = typeof body.conversation_id === 'string' ? body.conversation_id : null
    const organisationId = typeof body.organisation_id === 'string' ? body.organisation_id : ''
    const message = typeof body.message === 'string' ? body.message : ''
    const attachments = readAttachments(body.attachments, user.id)
    const requestedModelId = typeof body.model_id === 'string' ? body.model_id : null
    const pageContext = readPageContext(body.page_context)

    if (!organisationId || (!message.trim() && attachments.length === 0)) return json(400, { error: 'Missing organisation_id or message' })
    if (message.length > 20000) return json(400, { error: 'Message is too long' })

    // Membership (staff accounts only)
    const { data: membership } = await supabaseAdmin
      .from('ps_organisation_members')
      .select('role, status')
      .eq('organisation_id', organisationId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!membership) return json(403, { error: 'Not a member of this organisation' })

    // Org AI settings
    const { data: orgSettings } = await supabaseAdmin
      .from('ps_ai_org_settings')
      .select('standard_model_id, enable_ai_features, genie_patient_data')
      .eq('organisation_id', organisationId)
      .maybeSingle()
    if (orgSettings && orgSettings.enable_ai_features === false) {
      return json(403, { error: 'AI features are turned off for this pharmacy.', code: 'ai_disabled' })
    }
    const patientData = orgSettings?.genie_patient_data === true

    // Plan
    // The allowance follows the effective plan (including complimentary upgrades). Until plans
    // are enforced, every pharmacy gets at least the Essential allowance.
    let plan: PlanId = 'essential'
    const { data: effective, error: planError } = await supabaseAdmin.rpc('ps_org_effective_plan', { p_org_id: organisationId })
    if (planError) {
      console.error('Genie plan lookup failed', planError.message)
      if (plansEnforced()) return json(503, { error: 'Genie could not check your plan. Please try again shortly.' })
    } else {
      plan = (['network', 'essential', 'complete'].includes(effective) ? effective : 'network') as PlanId
    }
    if (!plansEnforced() && plan === 'network') plan = 'essential'
    const monthlyLimit = GENIE_MONTHLY_MESSAGES[plan]
    if (monthlyLimit <= 0) {
      return json(403, { error: 'Genie is included in the Essential and Complete plans. Upgrade in Settings to use it.', code: 'plan_required' })
    }

    // Model: only Genie-approved models
    const { data: genieModels } = await supabaseAdmin
      .from('ps_ai_models')
      .select('id, model_id, display_name, is_default, sort_order')
      .eq('provider', 'openrouter')
      .eq('is_active', true)
      .eq('genie_enabled', true)
      .order('sort_order', { ascending: true })
    const models = (genieModels ?? []) as { id: string; model_id: string; display_name: string; is_default: boolean }[]
    const modelRecord =
      models.find((m) => m.id === requestedModelId) ??
      models.find((m) => m.id === orgSettings?.standard_model_id) ??
      models.find((m) => m.is_default) ??
      models[0]
    if (!modelRecord) return json(500, { error: 'No AI model available' })

    const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''
    if (!apiKey) return json(500, { error: 'AI service is not configured' })

    // Conversation (must belong to this user and pharmacy)
    let convId = conversationIdInput
    let isNewConversation = false
    if (convId) {
      const { data: existingConversation } = await supabaseAdmin
        .from('ps_chat_conversations')
        .select('id')
        .eq('id', convId)
        .eq('organisation_id', organisationId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!existingConversation) return json(404, { error: 'Conversation not found' })
    }

    // Monthly allowance + per-user rate limit (atomic)
    const { data: claim, error: claimError } = await supabaseAdmin.rpc('ps_genie_claim_message', {
      p_organisation_id: organisationId,
      p_user_id: user.id,
      p_monthly_limit: monthlyLimit,
      p_per_minute: MESSAGES_PER_MINUTE,
    })
    if (claimError || !claim) {
      console.error('Genie usage claim failed', claimError?.message)
      return json(503, { error: 'Genie could not check your usage. Please try again shortly.' })
    }
    if (!claim.allowed) {
      if (claim.reason === 'rate_limited') {
        return json(429, { error: 'You are sending messages too quickly. Please wait a minute and try again.', code: 'rate_limited' })
      }
      return json(429, {
        error: `Your pharmacy has used all ${monthlyLimit} Genie messages for this month. The allowance resets on the 1st.`,
        code: 'monthly_limit',
        usage: { used: claim.used, limit: monthlyLimit },
      })
    }
    const usage = { used: claim.used as number, limit: monthlyLimit }

    const refund = async (inputTokens = 0, outputTokens = 0, refundMessage = true) => {
      await supabaseAdmin.rpc('ps_genie_record_usage', {
        p_organisation_id: organisationId,
        p_input_tokens: inputTokens,
        p_output_tokens: outputTokens,
        p_refund_message: refundMessage,
      })
    }

    if (!convId) {
      const { data: newConv, error: convError } = await supabaseAdmin
        .from('ps_chat_conversations')
        .insert({
          organisation_id: organisationId,
          user_id: user.id,
          title: (message.trim() || `Attachment: ${attachments[0]?.name ?? 'file'}`).slice(0, 80) + (message.trim().length > 80 ? '...' : ''),
          model_id: modelRecord.id,
        })
        .select('id')
        .single()
      if (convError || !newConv) {
        console.error('Genie conversation insert failed', convError?.message)
        await refund()
        return json(500, { error: 'Failed to start a conversation' })
      }
      convId = newConv.id
      isNewConversation = true
    }

    const { error: userMessageError } = await supabaseAdmin.from('ps_chat_messages').insert({
      conversation_id: convId,
      role: 'user',
      content: message.trim() || null,
      attachments,
      status: 'completed',
    })
    if (userMessageError) {
      await refund()
      return json(500, { error: 'Failed to save message' })
    }

    // Newest messages first, then back into time order.
    const { data: historyDesc } = await supabaseAdmin
      .from('ps_chat_messages')
      .select('role, content, tool_calls, attachments, created_at')
      .eq('conversation_id', convId)
      .in('role', ['user', 'assistant'])
      .neq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(HISTORY_MESSAGES)
    const history = ((historyDesc ?? []) as HistoryRow[]).reverse()

    const [{ data: org }, { data: userProfile }, { data: recentActions }] = await Promise.all([
      supabaseAdmin.from('ps_organisations').select('name').eq('id', organisationId).maybeSingle(),
      supabaseAdmin.from('ps_user_profiles').select('full_name').eq('id', user.id).maybeSingle(),
      supabaseAdmin
        .from('ps_genie_actions')
        .select('summary, status, result')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: systemPrompt({
          orgName: org?.name ?? 'this pharmacy',
          userName: userProfile?.full_name ?? 'a staff member',
          role: membership.role,
          patientData,
          page: pageContext,
          recentActions: ((recentActions ?? []) as RecentAction[]).reverse(),
        }),
      },
      // Tool results from earlier turns are only replayed while patient data is on,
      // so turning the switch off also stops older patient data being re-sent.
      ...historyToMessages(history, patientData),
    ]

    const tools = [...genieTools(patientData), ...actionToolDefinitions(patientData)]
    const toolCtx: ToolContext = { orgId: organisationId, userClient, supabaseAdmin, patientData }
    const proposedActionIds: string[] = []

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()

    // Stops the model (and its cost) when the user presses Stop or leaves.
    const upstream = new AbortController()
    req.signal.addEventListener('abort', () => upstream.abort())

    const streamPromise = (async () => {
      let inputTokens = 0
      let outputTokens = 0
      let answered = false
      try {
        if (isNewConversation) {
          await sendEvent(writer, { type: 'conversation_created', conversation_id: convId })
        }

        // This question's files go to the model as images / PDF documents.
        if (attachments.length) {
          const parts = await attachmentParts(supabaseAdmin, attachments)
          const current = [...messages].reverse().find((m) => m.role === 'user')
          if (current) {
            current.content = [
              { type: 'text', text: message.trim() || 'Please look at the attached file and tell me what it shows.' },
              ...parts,
            ]
          }
        }

        let fullContent = ''
        const savedToolCalls: SavedToolCall[] = []
        const actionCtx: ActionContext = {
          orgId: organisationId,
          userId: user.id,
          userClient,
          supabaseAdmin,
          patientData,
          propose: async (proposal) => {
            const { data: row, error } = await supabaseAdmin
              .from('ps_genie_actions')
              .insert({
                organisation_id: organisationId,
                user_id: user.id,
                conversation_id: convId,
                tool: proposal.tool,
                args: proposal.args,
                summary: proposal.summary,
                details: proposal.details,
              })
              .select('id')
              .single()
            if (error || !row) throw new Error('Genie could not prepare that change. Please try again.')
            proposedActionIds.push(row.id)
            await sendEvent(writer, {
              type: 'action_proposed',
              action: { id: row.id, tool: proposal.tool, summary: proposal.summary, details: proposal.details, status: 'pending' },
            })
            return { id: row.id }
          },
        }

        for (let roundNumber = 0; roundNumber < MAX_TOOL_ROUNDS; roundNumber += 1) {
          const round = await streamOpenRouterRound(apiKey, modelRecord.model_id, messages, tools, writer, upstream.signal)
          fullContent += round.content
          inputTokens += round.inputTokens
          outputTokens += round.outputTokens

          if (round.toolCalls.length === 0) break
          if (roundNumber === MAX_TOOL_ROUNDS - 1) {
            throw new Error('Genie could not finish the tool workflow. Please try a more specific question.')
          }

          messages.push({ role: 'assistant', content: round.content || null, tool_calls: round.toolCalls })

          for (const call of round.toolCalls) {
            let parsedArgs: Record<string, unknown> = {}
            try {
              const parsed = JSON.parse(call.function.arguments || '{}')
              if (parsed && typeof parsed === 'object') parsedArgs = parsed
            } catch {
              parsedArgs = {}
            }

            const actionResult = await executeActionTool(call.function.name, parsedArgs, actionCtx)
            const result = actionResult !== null
              ? JSON.stringify(localiseDates(JSON.parse(actionResult)))
              : await executeTool(call.function.name, parsedArgs, toolCtx)
            savedToolCalls.push({
              id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
              result: result.slice(0, MAX_SAVED_TOOL_RESULT),
            })
            messages.push({ role: 'tool', tool_call_id: call.id, content: result })
            await sendEvent(writer, { type: 'tool_result', tool_call_id: call.id, tool_name: call.function.name })
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
            model_id_str: modelRecord.model_id,
            status: 'completed',
          })
          .select('id')
          .single()

        if (assistantMessageError || !assistantMessage) throw new Error('Failed to save Genie response')
        answered = true
        if (proposedActionIds.length) {
          await supabaseAdmin.from('ps_genie_actions').update({ message_id: assistantMessage.id }).in('id', proposedActionIds)
        }
        await refund(inputTokens, outputTokens, false)

        await sendEvent(writer, { type: 'message_saved', message_id: assistantMessage.id })
        await sendEvent(writer, {
          type: 'done',
          message_id: assistantMessage.id,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          usage,
        })

        await supabaseAdmin
          .from('ps_chat_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', convId)
      } catch (err) {
        if (!answered) {
          // Stopped by the user: the message counts. Failed: give it back.
          const stopped = upstream.signal.aborted
          await refund(inputTokens, outputTokens, !stopped).catch(() => {})
        }
        if (!upstream.signal.aborted) {
          const msg = (err as Error).message
          const known = msg.startsWith('Genie') || msg.startsWith('The AI service')
          if (!known) console.error('Genie stream failed', err)
          try {
            await sendEvent(writer, { type: 'error', error: known ? msg : 'Genie could not complete this request.' })
          } catch {
            // Writer might be closed
          }
        }
      } finally {
        try {
          await writer.close()
        } catch {
          // Already closed
        }
      }
    })()

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
    console.error('ai-chat failed', err)
    return json(500, { error: 'Genie could not start this request. Please try again.' })
  }
})
