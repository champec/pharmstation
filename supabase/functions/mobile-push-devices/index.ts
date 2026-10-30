import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) return response({ error: 'Unauthorized' }, 401)
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return response({ error: 'Unauthorized' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { action, expo_push_token, platform, app_variant, device_name } = await req.json() as { action?: 'register' | 'unregister'; expo_push_token?: string; platform?: string; app_variant?: string; device_name?: string }
    const token = expo_push_token?.trim()
    if (!token || !/^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(token)) return response({ error: 'Invalid Expo push token' }, 400)
    if (action === 'unregister') {
      const { error } = await admin.from('ps_mobile_push_tokens').update({ enabled: false, updated_at: new Date().toISOString() }).eq('expo_push_token', token).eq('user_id', user.id)
      if (error) throw error
      return response({ ok: true })
    }
    if (action !== 'register' || !['ios', 'android'].includes(platform ?? '') || !['development', 'preview', 'production'].includes(app_variant ?? '')) return response({ error: 'Invalid device registration' }, 400)
    const { error } = await admin.from('ps_mobile_push_tokens').upsert({ user_id: user.id, expo_push_token: token, platform, app_variant, device_name: typeof device_name === 'string' ? device_name.slice(0, 200) : null, enabled: true, failure_count: 0, last_error: null, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'expo_push_token' })
    if (error) throw error
    await admin.from('ps_user_notification_preferences').upsert({ user_id: user.id, mobile_enabled: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    return response({ ok: true })
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
