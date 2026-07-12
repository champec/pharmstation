const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    })
  }

  const token = Deno.env.get('MAPBOX_ACCESS_TOKEN')
  if (!token) {
    console.error('[map-config] MAPBOX_ACCESS_TOKEN is not configured')
    return new Response(JSON.stringify({ error: 'Map configuration is unavailable' }), {
      status: 503,
      headers: JSON_HEADERS,
    })
  }

  return new Response(JSON.stringify({ token }), { headers: JSON_HEADERS })
})
