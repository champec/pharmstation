import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DmdConfig } from './config.js'

/**
 * Service-role client — server-side only. Bypasses RLS so we can bulk-load
 * the reference tables. NEVER ship this key to the browser.
 */
export function createServiceClient(config: DmdConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
