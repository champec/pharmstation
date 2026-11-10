import '../_shared/monitoring.ts' // platform error tracking (see _shared/monitoring.ts)
// ============================================
// support-request — public contact form and in-app help form
// Saves a ticket in ps_support_tickets and forwards it by email (Resend)
// to the matching @pharmstation.co.uk address, which ImprovMX forwards
// to the shared inbox. Deploy with --no-verify-jwt: anonymous visitors use
// it, and a signed-in user's JWT is checked here to link the ticket.
//
// Secrets: RESEND_API (required for the email), SUPPORT_FROM_EMAIL
// (optional, default "PharmStation <no-reply@pharmstation.co.uk>").
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TOPICS = {
  support: { label: 'Help with PharmStation', to: 'support@pharmstation.co.uk' },
  sales: { label: 'Demo or pricing', to: 'hello@pharmstation.co.uk' },
  billing: { label: 'Billing', to: 'billing@pharmstation.co.uk' },
  privacy: { label: 'Data protection request', to: 'privacy@pharmstation.co.uk' },
  safety: { label: 'Clinical safety concern', to: 'safety@pharmstation.co.uk' },
  network: { label: 'Pharmacy Network dispute', to: 'support@pharmstation.co.uk' },
  other: { label: 'Something else', to: 'hello@pharmstation.co.uk' },
} as const
type Topic = keyof typeof TOPICS

// Per hour. Enough for a real person, not for a script.
const MAX_PER_IP = 5
const MAX_PER_EMAIL = 3

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function text(value: unknown, max: number) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown'
}

function reference() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().padStart(6, '0').slice(-6)
  return `PS-${date}-${random}`
}

/** Links the ticket to the signed-in user and their organisation, if any. */
async function signedInUser(req: Request, admin: ReturnType<typeof adminClient>, requestedOrgId: string | null) {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) return { userId: null, orgId: null }
  const { data } = await admin.auth.getUser(token)
  const userId = data?.user?.id ?? null
  if (!userId || !requestedOrgId) return { userId, orgId: null }
  // Only link an organisation the user really belongs to.
  const { data: member } = await admin.from('ps_organisation_members').select('organisation_id')
    .eq('organisation_id', requestedOrgId).eq('user_id', userId).eq('status', 'active').maybeSingle()
  return { userId, orgId: member ? requestedOrgId : null }
}

async function forwardByEmail(ticket: {
  reference: string; topic: Topic; name: string; email: string; phone: string | null
  organisation_name: string | null; message: string; source: string; org_id: string | null
}) {
  const apiKey = Deno.env.get('RESEND_API')
  if (!apiKey) { console.error('RESEND_API not set; ticket saved without email'); return false }
  const from = Deno.env.get('SUPPORT_FROM_EMAIL') || 'PharmStation <no-reply@pharmstation.co.uk>'
  const topic = TOPICS[ticket.topic]
  const rows: Array<[string, string]> = [
    ['Reference', ticket.reference],
    ['Topic', topic.label],
    ['From', `${ticket.name} <${ticket.email}>`],
    ['Phone', ticket.phone || '—'],
    ['Organisation', ticket.organisation_name || '—'],
    ['Sent from', ticket.source === 'app' ? `In-app help${ticket.org_id ? ` (org ${ticket.org_id})` : ''}` : 'Public contact page'],
  ]
  const html = `<table cellpadding="4">${rows.map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`
    + `<p style="white-space:pre-wrap">${escapeHtml(ticket.message)}</p>`
  const plain = `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${ticket.message}`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [topic.to],
      reply_to: ticket.email,
      subject: `[${topic.label}] ${ticket.name} (${ticket.reference})`,
      html,
      text: plain,
    }),
  })
  if (!res.ok) { console.error('Resend error', res.status, await res.text()); return false }
  return true
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid request' }, 400) }

  // Email a ticket the database already saved (e.g. a Pharmacy Network
  // dispute raised through ps_network_dispute_link). Only the ticket's own
  // signed-in author can ask, and only once.
  if (body.action === 'forward') {
    const admin = adminClient()
    const { userId } = await signedInUser(req, admin, null)
    if (!userId) return json({ error: 'Sign in first.' }, 401)
    const { data: t } = await admin.from('ps_support_tickets')
      .select('id, reference, source, topic, name, email, phone, organisation_name, message, org_id, email_forwarded')
      .eq('reference', text(body.reference, 40)).eq('user_id', userId).maybeSingle()
    if (!t) return json({ error: 'Ticket not found' }, 404)
    if (t.email_forwarded) return json({ ok: true, reference: t.reference })
    const topicKey = (t.topic in TOPICS ? t.topic : 'other') as Topic
    const sent = await forwardByEmail({ ...t, topic: topicKey })
    if (sent) await admin.from('ps_support_tickets').update({ email_forwarded: true }).eq('id', t.id)
    return json({ ok: true, reference: t.reference, emailed: sent })
  }

  // Honeypot: a hidden field people never see. Pretend success for bots.
  if (text(body.website, 200)) return json({ ok: true, reference: reference() })

  const topic = (String(body.topic || 'support') in TOPICS && body.topic !== 'network' ? String(body.topic || 'support') : 'other') as Topic
  const name = text(body.name, 120)
  const email = text(body.email, 254).toLowerCase()
  const phone = text(body.phone, 40) || null
  const organisationName = text(body.organisation_name, 200) || null
  const message = text(body.message, 5000)
  const source = body.source === 'app' ? 'app' : 'public'

  if (!name) return json({ error: 'Please tell us your name.' }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Please enter a valid email address.' }, 400)
  if (message.length < 5) return json({ error: 'Please tell us a little more about what you need.' }, 400)

  const admin = adminClient()
  const ipHash = await sha256(`${clientIp(req)}:${Deno.env.get('SUPABASE_URL')}`)
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const [{ count: ipCount }, { count: emailCount }] = await Promise.all([
    admin.from('ps_support_tickets').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since),
    admin.from('ps_support_tickets').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since),
  ])
  if ((ipCount ?? 0) >= MAX_PER_IP || (emailCount ?? 0) >= MAX_PER_EMAIL) {
    return json({ error: 'We have already received several messages from you. Please wait an hour, or email support@pharmstation.co.uk.' }, 429)
  }

  const { userId, orgId } = await signedInUser(req, admin, body.org_id ? String(body.org_id) : null)

  const row = {
    reference: reference(), source, topic, name, email, phone,
    organisation_name: organisationName, message, org_id: orgId, user_id: userId,
    ip_hash: ipHash, user_agent: text(req.headers.get('user-agent'), 300) || null,
  }
  const { data: ticket, error } = await admin.from('ps_support_tickets').insert(row).select('id, reference').single()
  if (error || !ticket) {
    console.error('ticket insert failed', error)
    return json({ error: 'Sorry, we could not send your message. Please email support@pharmstation.co.uk.' }, 500)
  }

  const forwarded = await forwardByEmail({ ...row, topic })
  if (forwarded) await admin.from('ps_support_tickets').update({ email_forwarded: true }).eq('id', ticket.id)

  return json({ ok: true, reference: ticket.reference })
})
