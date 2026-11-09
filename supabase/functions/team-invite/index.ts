// ============================================
// team-invite — create a staff invite and email the link
//
// Called by an owner or manager (website or phone) with their own session.
// The invite is created through ps_org_create_invite using THEIR token, so
// the database's own rules (who may invite which role, two-step sign-in,
// pharmacy verification) still decide. This function only adds the email.
//
//   { org_id, email, role, permissions? }  -> { invite_id, token, expires_at, link, emailed }
//
// Secrets: RESEND_API, SUPPORT_FROM_EMAIL (optional), PUBLIC_SITE_URL
// (optional, default https://pharmstation.co.uk). JWT verification on.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'an owner',
  manager: 'a manager',
  pharmacist: 'a pharmacist',
  technician: 'a pharmacy technician',
  dispenser: 'a dispenser',
  locum: 'a locum pharmacist',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid request' }, 400) }

  const authHeader = req.headers.get('Authorization') || ''
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: me } = await asCaller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (!me?.user) return json({ error: 'Sign in again, then try once more.' }, 401)

  const orgId = String(body.org_id ?? '')
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = String(body.role ?? '')
  if (!orgId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400)
  if (!(role in ROLE_LABELS)) return json({ error: 'Choose a role.' }, 400)
  const permissions = body.permissions && typeof body.permissions === 'object' && Object.keys(body.permissions).length
    ? body.permissions : null

  const { data, error } = await asCaller.rpc('ps_org_create_invite', {
    p_org_id: orgId, p_email: email, p_role: role, p_permissions: permissions,
  })
  if (error) {
    // The database refuses staff management without two-step sign-in, but
    // only says "no permission". Say what to do instead.
    let aal = 'aal1'
    try {
      aal = JSON.parse(atob(authHeader.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal ?? 'aal1'
    } catch {
      // keep aal1
    }
    if (aal !== 'aal2' && /permission|two-step/i.test(error.message)) {
      return json({ error: 'Inviting staff needs two-step sign-in. Turn it on in My Account > Security, then sign out and back in with your code.' }, 403)
    }
    return json({ error: error.message }, 400)
  }
  const row = (data as { invite_id: string; token: string; expires_at: string }[] | null)?.[0]
  if (!row) return json({ error: 'Could not create the invite.' }, 500)

  const site = (Deno.env.get('PUBLIC_SITE_URL') || 'https://pharmstation.co.uk').replace(/\/$/, '')
  const link = `${site}/join/${row.token}`

  // Names for the email, read with the caller's own access.
  const [{ data: org }, { data: inviter }] = await Promise.all([
    asCaller.from('ps_organisations').select('name').eq('id', orgId).maybeSingle(),
    asCaller.from('ps_user_profiles').select('full_name').eq('id', me.user.id).maybeSingle(),
  ])
  const orgName = (org?.name as string | undefined) || 'your pharmacy'
  const inviterName = (inviter?.full_name as string | undefined) || 'Your manager'
  const expires = new Date(row.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

  let emailed = false
  const apiKey = Deno.env.get('RESEND_API')
  if (apiKey) {
    const from = Deno.env.get('SUPPORT_FROM_EMAIL') || 'PharmStation <no-reply@pharmstation.co.uk>'
    const subject = `${inviterName} invited you to join ${orgName} on PharmStation`
    const text = `${inviterName} has invited you to join ${orgName} on PharmStation as ${ROLE_LABELS[role]}.\n\nAccept the invite: ${link}\n\nThe link works until ${expires}. If you already have a PharmStation account, sign in with it; otherwise you can create one.\n\nIf you weren't expecting this, you can ignore this email.`
    const html = `<p><strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(orgName)}</strong> on PharmStation as ${ROLE_LABELS[role]}.</p>`
      + `<p><a href="${link}" style="display:inline-block;background:#257BB4;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Accept the invite</a></p>`
      + `<p>The link works until ${expires}. If you already have a PharmStation account, sign in with it; otherwise you can create one.</p>`
      + `<p style="color:#666;font-size:13px">If you weren't expecting this, you can ignore this email.</p>`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
    })
    emailed = res.ok
    if (!res.ok) console.error('Resend error', res.status, await res.text())
  }

  return json({ invite_id: row.invite_id, token: row.token, expires_at: row.expires_at, link, emailed })
})
