import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type SubscriptionBody = {
  endpoint?: string
  expirationTime?: number | null
  keys?: { p256dh?: string; auth?: string }
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)

  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) return response({ error: 'Unauthorized' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authorization } } },
    )
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return response({ error: 'Unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { action, subscription, org_id, device_name, user_agent } = await req.json() as {
      action?: 'register' | 'unregister'
      subscription?: SubscriptionBody
      org_id?: string
      device_name?: string
      user_agent?: string
    }
    if (!org_id) return response({ error: 'Organisation is required' }, 400)
    const { data: membership, error: membershipError } = await admin.from('ps_organisation_members')
      .select('id').eq('organisation_id', org_id).eq('user_id', user.id).eq('status', 'active').maybeSingle()
    if (membershipError || !membership) return response({ error: 'No active membership for this organisation' }, 403)
    const endpoint = subscription?.endpoint?.trim()
    if (!endpoint || endpoint.length > 4096) return response({ error: 'Invalid push endpoint' }, 400)

    if (action === 'unregister') {
      const { error } = await admin.from('ps_web_push_subscriptions')
        .delete().eq('endpoint', endpoint).eq('org_id', org_id)
      if (error) throw error
      return response({ ok: true })
    }

    if (action !== 'register' || !subscription?.keys?.p256dh || !subscription.keys.auth) {
      return response({ error: 'Invalid push subscription' }, 400)
    }

    let expirationTime: string | null = null
    if (typeof subscription.expirationTime === 'number') {
      const date = new Date(subscription.expirationTime)
      if (!Number.isNaN(date.getTime())) expirationTime = date.toISOString()
    }

    // Endpoint uniqueness deliberately reassigns a shared workstation to the
    // currently authenticated staff account instead of retaining the old user.
    const { error } = await admin.from('ps_web_push_subscriptions').upsert({
      org_id,
      registered_by: user.id,
      endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expiration_time: expirationTime,
      user_agent: typeof user_agent === 'string' ? user_agent.slice(0, 1000) : null,
      device_name: typeof device_name === 'string' ? device_name.slice(0, 200) : null,
      enabled: true,
      failure_count: 0,
      last_error: null,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })
    if (error) throw error

    return response({ ok: true })
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
