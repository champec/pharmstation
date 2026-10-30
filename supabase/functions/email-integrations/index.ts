import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/email-integrations/callback`
const ALLOWED_ORIGINS = (Deno.env.get('EMAIL_INTEGRATIONS_WEB_ORIGINS') || 'https://pharmstation.co.uk,http://localhost:5173').split(',').map((v) => v.trim())

type Provider = 'microsoft' | 'google'
type Admin = ReturnType<typeof adminClient>
type TokenSet = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string }

function adminClient() { return createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }) }
function randomString(bytes = 32) { const value = crypto.getRandomValues(new Uint8Array(bytes)); return base64Url(value) }
function base64Url(value: Uint8Array) { let binary = ''; value.forEach((byte) => binary += String.fromCharCode(byte)); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
async function sha256(value: string) { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))) }
function safeReason(value: unknown) { return encodeURIComponent(String(value || 'provider_error').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'provider_error') }

function providerConfig(provider: Provider) {
  if (provider === 'microsoft') return {
    clientId: Deno.env.get('MICROSOFT_OAUTH_CLIENT_ID'), clientSecret: Deno.env.get('MICROSOFT_OAUTH_CLIENT_SECRET'),
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Mail.Send', 'Mail.Read'],
  }
  return {
    clientId: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET'),
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
  }
}

async function requireManager(admin: Admin, userId: string, orgId: string) {
  const { data } = await admin.from('ps_organisation_members').select('role, permissions').eq('organisation_id', orgId).eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (!data) throw new Error('You do not have access to this organisation')
  const permission = (data.permissions as Record<string, unknown> | null)?.org_settings
  const allowed = permission === true || (permission !== false && (data.role === 'owner' || data.role === 'manager'))
  if (!allowed) throw new Error('Organisation settings permission is required')
}

async function storeSecret(admin: Admin, name: string, secret: unknown) {
  const { data, error } = await admin.rpc('ps_email_store_secret', { p_name: name, p_secret: JSON.stringify(secret), p_description: 'PharmStation email OAuth token material' })
  if (error) throw new Error(error.message)
  return data as string
}
async function readSecret(admin: Admin, id: string) {
  const { data, error } = await admin.rpc('ps_email_read_secret', { p_secret_id: id })
  if (error || !data) throw new Error('Stored email credentials could not be read')
  return JSON.parse(data as string) as TokenSet | { verifier: string }
}
async function replaceSecret(admin: Admin, id: string, secret: unknown) {
  const { error } = await admin.rpc('ps_email_replace_secret', { p_secret_id: id, p_secret: JSON.stringify(secret) })
  if (error) throw new Error(error.message)
}
async function deleteSecret(admin: Admin, id: string) { await admin.rpc('ps_email_delete_secret', { p_secret_id: id }) }

async function startOauth(admin: Admin, userId: string, body: Record<string, unknown>) {
  const orgId = String(body.org_id); const provider = String(body.provider) as Provider
  if (!['microsoft', 'google'].includes(provider)) throw new Error('Unsupported email provider')
  await requireManager(admin, userId, orgId)
  const { count } = await admin.from('ps_email_accounts').select('*', { count: 'exact', head: true }).eq('org_id', orgId).neq('status', 'disconnected')
  if ((count || 0) >= 5) throw new Error('This organisation already has five connected email accounts')
  const origin = String(body.return_origin || '')
  if (!ALLOWED_ORIGINS.includes(origin)) throw new Error('This PharmStation web origin is not allowed')
  const config = providerConfig(provider)
  if (!config.clientId || !config.clientSecret) throw new Error(`${provider === 'microsoft' ? 'Microsoft' : 'Google'} OAuth has not been configured for PharmStation yet`)

  const state = randomString(); const verifier = randomString(48); const challenge = await sha256(verifier)
  const secretId = await storeSecret(admin, `email-oauth-state-${state.slice(0, 12)}`, { verifier })
  const { error } = await admin.from('ps_email_oauth_states').insert({ state_hash: await sha256(state), org_id: orgId, user_id: userId, provider, pkce_secret_id: secretId, return_origin: origin, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() })
  if (error) { await deleteSecret(admin, secretId); throw new Error(error.message) }
  const params = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: CALLBACK_URL, scope: config.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256' })
  if (provider === 'google') { params.set('access_type', 'offline'); params.set('prompt', 'consent'); params.set('include_granted_scopes', 'true') }
  else params.set('prompt', 'select_account')
  return { authorization_url: `${config.authorize}?${params}` }
}

async function exchangeCode(provider: Provider, code: string, verifier: string) {
  const config = providerConfig(provider)
  const response = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId!, client_secret: config.clientSecret!, code, redirect_uri: CALLBACK_URL, grant_type: 'authorization_code', code_verifier: verifier }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'token_exchange_failed')
  return result as TokenSet
}

async function profile(provider: Provider, accessToken: string) {
  const url = provider === 'microsoft' ? 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName' : 'https://openidconnect.googleapis.com/v1/userinfo'
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await response.json()
  if (!response.ok) throw new Error('profile_lookup_failed')
  return provider === 'microsoft'
    ? { id: data.id as string, email: (data.mail || data.userPrincipalName) as string, name: data.displayName as string, tenant: null }
    : { id: data.sub as string, email: data.email as string, name: data.name as string, tenant: null }
}

async function callback(req: Request) {
  const url = new URL(req.url); const state = url.searchParams.get('state') || ''; const code = url.searchParams.get('code') || ''
  const admin = adminClient(); let origin = ALLOWED_ORIGINS[0]
  try {
    const { data: stateRow } = await admin.from('ps_email_oauth_states').select('*').eq('state_hash', await sha256(state)).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (!stateRow) throw new Error('invalid_or_expired_state')
    origin = stateRow.return_origin
    await admin.from('ps_email_oauth_states').update({ consumed_at: new Date().toISOString() }).eq('state_hash', stateRow.state_hash)
    if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error') || 'provider_denied')
    if (!code) throw new Error('missing_authorization_code')
    const stateSecret = await readSecret(admin, stateRow.pkce_secret_id) as { verifier: string }
    const tokens = await exchangeCode(stateRow.provider, code, stateSecret.verifier)
    await deleteSecret(admin, stateRow.pkce_secret_id)
    const user = await profile(stateRow.provider, tokens.access_token)
    const { data: existing } = await admin.from('ps_email_accounts').select('id, token_secret_id, is_default').eq('org_id', stateRow.org_id).eq('provider', stateRow.provider).eq('provider_account_id', user.id).maybeSingle()
    let tokenSecretId = existing?.token_secret_id
    if (tokenSecretId) await replaceSecret(admin, tokenSecretId, tokens)
    else tokenSecretId = await storeSecret(admin, `email-token-${stateRow.org_id}-${stateRow.provider}-${user.id}`, tokens)
    const { count } = await admin.from('ps_email_accounts').select('*', { count: 'exact', head: true }).eq('org_id', stateRow.org_id).eq('is_default', true).neq('status', 'disconnected')
    const accountRow = { org_id: stateRow.org_id, provider: stateRow.provider, provider_account_id: user.id, email_address: user.email, display_name: user.name, tenant_id: user.tenant, scopes: (tokens.scope || providerConfig(stateRow.provider).scopes.join(' ')).split(' '), token_secret_id: tokenSecretId, access_token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(), status: 'connected', is_default: existing?.is_default || (count || 0) === 0, connected_by: stateRow.user_id, disconnected_at: null, last_error_code: null, last_error_message: null, last_refreshed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const saveQuery = existing?.id
      ? admin.from('ps_email_accounts').update(accountRow).eq('id', existing.id)
      : admin.from('ps_email_accounts').insert(accountRow)
    const { error: saveError } = await saveQuery
    if (saveError) throw new Error(saveError.message)
    return Response.redirect(`${origin}/settings?tab=integrations&email_oauth=connected`, 303)
  } catch (error) {
    return Response.redirect(`${origin}/settings?tab=integrations&email_oauth=error&reason=${safeReason(error instanceof Error ? error.message : error)}`, 303)
  }
}

async function refreshToken(admin: Admin, account: any, tokens: TokenSet) {
  if (!tokens.refresh_token) throw new Error('reconnect_required')
  const config = providerConfig(account.provider)
  const response = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId!, client_secret: config.clientSecret!, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error === 'invalid_grant' ? 'reconnect_required' : 'token_refresh_failed')
  const merged = { ...tokens, ...result, refresh_token: result.refresh_token || tokens.refresh_token }
  await replaceSecret(admin, account.token_secret_id, merged)
  await admin.from('ps_email_accounts').update({ access_token_expires_at: new Date(Date.now() + (result.expires_in || 3600) * 1000).toISOString(), last_refreshed_at: new Date().toISOString(), status: 'connected', updated_at: new Date().toISOString() }).eq('id', account.id)
  return merged as TokenSet
}

async function validTokens(admin: Admin, account: any) {
  let tokens = await readSecret(admin, account.token_secret_id) as TokenSet
  if (!account.access_token_expires_at || new Date(account.access_token_expires_at).getTime() < Date.now() + 5 * 60_000) tokens = await refreshToken(admin, account, tokens)
  return tokens
}

function mimeMessage(from: string, to: string[], cc: string[], subject: string, html: string, text: string) {
  const boundary = `ps-${crypto.randomUUID()}`
  const headers = [`From: ${from}`, `To: ${to.join(', ')}`, ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []), `Subject: ${subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`]
  return `${headers.join('\r\n')}\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${text}\r\n--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${html}\r\n--${boundary}--`
}

async function sendEmail(admin: Admin, userId: string, body: Record<string, unknown>) {
  const orgId = String(body.org_id); await requireManager(admin, userId, orgId)
  const accountId = body.account_id ? String(body.account_id) : null
  let query = admin.from('ps_email_accounts').select('*').eq('org_id', orgId).eq('status', 'connected')
  query = accountId ? query.eq('id', accountId) : query.eq('is_default', true)
  const { data: account } = await query.maybeSingle()
  if (!account) throw new Error('No connected email account is available')
  const to = Array.isArray(body.to) ? body.to.map(String) : []; const cc = Array.isArray(body.cc) ? body.cc.map(String) : []
  const subject = String(body.subject || '').trim(); const html = String(body.html || ''); const text = String(body.text || '').trim()
  if (!to.length || !subject || (!html && !text)) throw new Error('Recipients, subject and message content are required')
  if (to.length + cc.length > 50) throw new Error('A maximum of 50 recipients is allowed per email')
  try {
    const tokens = await validTokens(admin, account)
    let providerMessageId: string | null = null
    if (account.provider === 'microsoft') {
      const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { subject, body: { contentType: html ? 'HTML' : 'Text', content: html || text }, toRecipients: to.map((address) => ({ emailAddress: { address } })), ccRecipients: cc.map((address) => ({ emailAddress: { address } })) }, saveToSentItems: true }) })
      if (!response.ok) throw new Error(`Microsoft Graph send failed (${response.status})`)
    } else {
      const raw = base64Url(new TextEncoder().encode(mimeMessage(account.email_address, to, cc, subject, html || text, text || html.replace(/<[^>]+>/g, ' '))))
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) })
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`Gmail send failed (${response.status})`); providerMessageId = result.id || null
    }
    await admin.from('ps_email_accounts').update({ last_used_at: new Date().toISOString(), last_error_code: null, last_error_message: null, updated_at: new Date().toISOString() }).eq('id', account.id)
    return { sent: true, provider: account.provider, account_id: account.id, provider_message_id: providerMessageId }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Email send failed'; const reconnect = reason === 'reconnect_required'
    await admin.from('ps_email_accounts').update({ status: reconnect ? 'reconnect_required' : 'error', last_error_code: reconnect ? 'invalid_grant' : 'send_error', last_error_message: reason.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', account.id)
    throw error
  }
}

async function post(req: Request) {
  const auth = req.headers.get('Authorization'); if (!auth) throw new Error('Missing authorization header')
  const client = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await client.auth.getUser(); if (!user) throw new Error('Unauthorized')
  const body = await req.json() as Record<string, unknown>; const admin = adminClient(); const orgId = String(body.org_id || '')
  if (!orgId) throw new Error('Missing org_id')
  if (body.action === 'list_accounts') { const { data: membership } = await admin.from('ps_organisation_members').select('user_id').eq('organisation_id', orgId).eq('user_id', user.id).eq('status', 'active').maybeSingle(); if (!membership) throw new Error('Access denied'); const { data, error } = await admin.from('ps_email_accounts').select('id,provider,email_address,display_name,scopes,access_token_expires_at,status,is_default,last_refreshed_at,last_used_at,last_error_message,created_at').eq('org_id', orgId).neq('status', 'disconnected').order('created_at'); if (error) throw new Error(error.message); return { accounts: data || [] } }
  if (body.action === 'start_oauth') return startOauth(admin, user.id, body)
  if (body.action === 'send_email') return sendEmail(admin, user.id, body)
  await requireManager(admin, user.id, orgId)
  const accountId = String(body.account_id || '')
  const { data: account } = await admin.from('ps_email_accounts').select('*').eq('id', accountId).eq('org_id', orgId).maybeSingle(); if (!account) throw new Error('Email account not found')
  if (body.action === 'disconnect') { await deleteSecret(admin, account.token_secret_id); await admin.from('ps_email_accounts').update({ status: 'disconnected', is_default: false, disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', account.id); return { disconnected: true } }
  if (body.action === 'set_default') { await admin.from('ps_email_accounts').update({ is_default: false }).eq('org_id', orgId); await admin.from('ps_email_accounts').update({ is_default: true }).eq('id', account.id); return { default: true } }
  throw new Error('Unknown action')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/callback')) return callback(req)
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try { return json(await post(req)) } catch (error) { return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 400) }
})
