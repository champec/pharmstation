// ============================================
// mfa-email-recovery — "Can't get your code? Email me one"
//
// For someone who knows their password but has lost their authenticator
// (new phone, reinstalled app). Called with the person's own signed-in,
// not-yet-two-step (aal1) session:
//   { action: 'send' }            emails a 6-digit code to the account email
//   { action: 'verify', code }    checks it, then removes the account's
//                                 authenticator apps so the person can sign in
//                                 and set two-step sign-in up again
//
// The code is kept as an HMAC (keyed with a server secret) in the user's
// app_metadata, which only the service role can change, so no table is
// needed. Codes last 10 minutes, allow 5 tries, and 3 emails an hour.
// Every reset is logged in ps_auth_events and emailed to the pharmacy's
// owners, so a stolen password plus inbox can't do it quietly.
//
// Secrets: RESEND_API (required), SUPPORT_FROM_EMAIL (optional).
// Deploy with JWT verification on (the default).
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CODE_MINUTES = 10
const MAX_TRIES = 5
const MAX_SENDS_PER_HOUR = 3

interface RecoveryState {
  h?: string
  exp?: number
  tries?: number
  sends?: number[]
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function hmac(userId: string, code: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`mfa-email-recovery:${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}:${code}`))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sixDigits() {
  // Rejection sampling keeps every code equally likely.
  const buf = new Uint32Array(1)
  let n: number
  do {
    crypto.getRandomValues(buf)
    n = buf[0]
  } while (n >= 4_294_000_000)
  return String(n % 1_000_000).padStart(6, '0')
}

function maskEmail(email: string) {
  const [name, domain] = email.split('@')
  if (!domain) return email
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

async function sendEmail(to: string[], subject: string, text: string, html: string) {
  const apiKey = Deno.env.get('RESEND_API')
  if (!apiKey) throw new Error('Email isn’t set up yet. Ask your pharmacy owner to reset your two-step sign-in.')
  const from = Deno.env.get('SUPPORT_FROM_EMAIL') || 'PharmStation <no-reply@pharmstation.co.uk>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, html }),
  })
  if (!res.ok) {
    console.error('Resend error', res.status, await res.text())
    throw new Error('We couldn’t send the email just now. Try again in a minute.')
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid request' }, 400) }

  const admin = adminClient()
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: userData } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  const user = userData?.user
  if (!user?.email) return json({ error: 'Sign in with your email and password first.' }, 401)

  const { data: factorData, error: factorErr } = await admin.auth.admin.mfa.listFactors({ userId: user.id })
  if (factorErr) return json({ error: 'Something went wrong. Try again.' }, 500)
  const factors = factorData?.factors ?? []
  if (!factors.some((f) => f.status === 'verified')) {
    return json({ error: 'Two-step sign-in is already off for this account. Sign in again.' }, 400)
  }

  const meta = (user.app_metadata ?? {}) as Record<string, unknown>
  const state = (meta.mfa_email_recovery ?? {}) as RecoveryState
  const now = Date.now()
  const saveState = (next: RecoveryState | null) =>
    admin.auth.admin.updateUserById(user.id, { app_metadata: { ...meta, mfa_email_recovery: next } })

  if (body.action === 'send') {
    const sends = (state.sends ?? []).filter((t) => now - t < 60 * 60 * 1000)
    if (sends.length >= MAX_SENDS_PER_HOUR) {
      return json({ error: 'We’ve already sent you several codes. Check your inbox and spam folder, or wait an hour.' }, 429)
    }
    const code = sixDigits()
    await saveState({ h: await hmac(user.id, code), exp: now + CODE_MINUTES * 60 * 1000, tries: 0, sends: [...sends, now] })
    try {
      await sendEmail(
        [user.email],
        `Your PharmStation sign-in code: ${code}`,
        `Your PharmStation code is ${code}.\n\nIt lasts ${CODE_MINUTES} minutes. Entering it turns off two-step sign-in on your account so you can set it up again on your phone.\n\nIf you didn't ask for this, someone may know your password. Change it now and tell your pharmacy owner.`,
        `<p>Your PharmStation code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>`
          + `<p>It lasts ${CODE_MINUTES} minutes. Entering it turns off two-step sign-in on your account so you can set it up again on your phone.</p>`
          + `<p><strong>If you didn't ask for this</strong>, someone may know your password. Change it now and tell your pharmacy owner.</p>`,
      )
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'Couldn’t send the email.' }, 502)
    }
    return json({ ok: true, sentTo: maskEmail(user.email) })
  }

  if (body.action === 'verify') {
    const code = String(body.code ?? '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(code)) return json({ error: 'Enter the 6-digit code from the email.' }, 400)
    if (!state.h || !state.exp || now > state.exp) {
      return json({ error: 'That code has expired. Send a new one.' }, 400)
    }
    if ((state.tries ?? 0) >= MAX_TRIES) {
      return json({ error: 'Too many tries. Send a new code.' }, 429)
    }
    if ((await hmac(user.id, code)) !== state.h) {
      await saveState({ ...state, tries: (state.tries ?? 0) + 1 })
      return json({ error: 'That code didn’t match. Check the newest email and try again.' }, 400)
    }

    await saveState(null)
    for (const f of factors) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: f.id })
      if (error) {
        console.error('deleteFactor failed', error)
        return json({ error: 'Something went wrong. Try again.' }, 500)
      }
    }

    // Log it and tell the owners of every pharmacy this person works at.
    const { data: memberships } = await admin
      .from('ps_organisation_members')
      .select('organisation_id, ps_organisations(name)')
      .eq('user_id', user.id)
      .eq('status', 'active')
    const orgIds = (memberships ?? []).map((m) => m.organisation_id as string)
    if (orgIds.length) {
      await admin.from('ps_auth_events').insert(orgIds.map((orgId) => ({
        organisation_id: orgId,
        user_id: user.id,
        email: user.email,
        event: 'two_step_reset_by_email',
        created_by: user.id,
      })))
      const { data: owners } = await admin
        .from('ps_organisation_members')
        .select('user_id')
        .in('organisation_id', orgIds)
        .eq('role', 'owner')
        .eq('status', 'active')
        .neq('user_id', user.id)
      const ownerIds = [...new Set((owners ?? []).map((o) => o.user_id as string).filter(Boolean))]
      const emails: string[] = []
      for (const id of ownerIds) {
        const { data } = await admin.auth.admin.getUserById(id)
        if (data?.user?.email) emails.push(data.user.email)
      }
      if (emails.length) {
        const who = user.email
        try {
          await sendEmail(
            emails,
            `${who} reset their two-step sign-in by email`,
            `${who} couldn't get their two-step sign-in code, so they confirmed their email address and turned two-step sign-in off. They'll be asked to set it up again.\n\nIf this wasn't expected, speak to them now. You can see sign-in activity in Settings > Team.`,
            `<p><strong>${escapeHtml(who)}</strong> couldn't get their two-step sign-in code, so they confirmed their email address and turned two-step sign-in off. They'll be asked to set it up again.</p>`
              + `<p>If this wasn't expected, speak to them now. You can see sign-in activity in Settings &gt; Team.</p>`,
          )
        } catch (err) {
          console.error('owner notice failed', err)
        }
      }
    }
    return json({ ok: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
