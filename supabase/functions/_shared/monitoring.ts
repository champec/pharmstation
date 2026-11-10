// Platform error tracking for edge functions.
//
// Import once at the very top of a function's index.ts:
//   import '../_shared/monitoring.ts'
//
// It wraps Deno.serve so that any thrown error, and any 5xx response, is
// recorded in public.ps_monitor_errors (London, UK) and shows up on the
// platform admin Monitoring page. The database scrubs patient identifiers
// (emails, phones, NHS numbers, postcodes, ids) on insert. Reporting never
// blocks or breaks the request: failures are swallowed.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RELEASE = 'edge'

type Handler = (req: Request, info?: unknown) => Response | Promise<Response>

function functionName(req: Request): string {
  try {
    const parts = new URL(req.url).pathname.split('/').filter(Boolean)
    const i = parts.indexOf('v1')
    return (i >= 0 ? parts[i + 1] : parts[0]) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function waitUntil(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

export function reportEdgeError(fn: string, error: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return Promise.resolve()
  const err = error instanceof Error ? error : new Error(String(error))
  const body = {
    source: 'edge',
    message: `${err.name !== 'Error' ? err.name + ': ' : ''}${err.message}`.slice(0, 1500) || 'Unknown error',
    stack: (err.stack ?? '').slice(0, 6000) || null,
    route: fn,
    release: RELEASE,
    context: extra,
  }
  const p = fetch(`${SUPABASE_URL}/rest/v1/ps_monitor_errors`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  }).then(() => undefined).catch(() => undefined)
  waitUntil(p)
  return p
}

// deno-lint-ignore no-explicit-any
const g = globalThis as any
if (!g.__psMonitoringInstalled && typeof Deno?.serve === 'function') {
  g.__psMonitoringInstalled = true
  const originalServe = Deno.serve.bind(Deno)

  const wrap = (handler: Handler): Handler => async (req, info) => {
    const fn = functionName(req)
    try {
      const res = await handler(req, info)
      if (res.status >= 500) {
        let detail = ''
        try { detail = (await res.clone().text()).slice(0, 500) } catch { /* ignore */ }
        reportEdgeError(fn, new Error(`HTTP ${res.status}: ${detail || res.statusText}`), { method: req.method, status: res.status })
      }
      return res
    } catch (error) {
      reportEdgeError(fn, error, { method: req.method })
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }
  }

  // deno-lint-ignore no-explicit-any
  ;(Deno as any).serve = (...args: any[]) => {
    const i = args.findIndex((a) => typeof a === 'function')
    if (i >= 0) args[i] = wrap(args[i])
    else if (args[0] && typeof args[0].handler === 'function') args[0] = { ...args[0], handler: wrap(args[0].handler) }
    else if (args[1] && typeof args[1].handler === 'function') args[1] = { ...args[1], handler: wrap(args[1].handler) }
    // deno-lint-ignore no-explicit-any
    return (originalServe as any)(...args)
  }

  globalThis.addEventListener?.('unhandledrejection', (e: PromiseRejectionEvent) => {
    reportEdgeError('unhandled', e.reason)
  })
}
