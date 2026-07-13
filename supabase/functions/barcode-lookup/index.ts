// ============================================
// PharmStation Edge Function: barcode-lookup
// Resolves medicine GTINs through dm+d package data.
// Lookup only: this function never creates register entries.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
})

function normalizeGtin(input: unknown): string {
  const digits = String(input ?? '').replace(/\D/g, '')
  if (digits.length !== 13 && digits.length !== 14) {
    throw new Error('A GTIN must contain 13 or 14 digits.')
  }
  return digits
}

function hasValidCheckDigit(gtin: string): boolean {
  const digits = gtin.split('').map(Number)
  const checkDigit = digits.pop()
  if (checkDigit === undefined) return false

  let sum = 0
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += digits[index] * (position % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === checkDigit
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)

    const { organisation_id, gtin: requestedGtin } = await req.json()
    if (!organisation_id) return json({ error: 'Missing organisation_id' }, 400)

    const gtin = normalizeGtin(requestedGtin)
    if (!hasValidCheckDigit(gtin)) return json({ error: 'The barcode has an invalid GTIN check digit.' }, 400)

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: membership } = await admin
      .from('ps_organisation_members')
      .select('permissions')
      .eq('organisation_id', organisation_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (!membership) return json({ error: 'Not a member of this organisation' }, 403)
    if (membership.permissions?.cd_register_read === false) {
      return json({ error: 'Controlled-drug register permission not granted' }, 403)
    }

    // GTIN-13 and the equivalent zero-padded GTIN-14 may both appear in dm+d.
    const candidates = new Set([gtin])
    if (gtin.length === 13) candidates.add(`0${gtin}`)
    if (gtin.length === 14 && gtin.startsWith('0')) candidates.add(gtin.slice(1))

    const { data: gtinRows, error: gtinError } = await admin
      .from('dmd_gtin')
      .select('gtin, appid, startdt, enddt')
      .in('gtin', [...candidates])

    if (gtinError) throw gtinError

    let supplementalMapping: {
      gtin: string
      appid: string
      source_name: string
      source_url: string | null
      verified_at: string
    } | null = null

    if (!gtinRows?.length) {
      const { data: alias, error: aliasError } = await admin
        .from('ps_barcode_aliases')
        .select('gtin, appid, source_name, source_url, verified_at')
        .in('gtin', [...candidates])
        .maybeSingle()
      if (aliasError) throw aliasError
      supplementalMapping = alias
    }

    if (!gtinRows?.length && !supplementalMapping) {
      return json({
        found: false,
        gtin,
        message: 'No dm+d or verified supplemental medicine-pack mapping matches this GTIN.',
      })
    }

    const today = new Date().toISOString().slice(0, 10)
    const sortedRows = [...(gtinRows ?? [])].sort((left, right) => {
      const leftActive = !left.enddt || left.enddt >= today
      const rightActive = !right.enddt || right.enddt >= today
      if (leftActive !== rightActive) return leftActive ? -1 : 1
      if (left.gtin === gtin && right.gtin !== gtin) return -1
      if (right.gtin === gtin && left.gtin !== gtin) return 1
      return String(right.startdt ?? '').localeCompare(String(left.startdt ?? ''))
    })
    const gtinRow = sortedRows[0] ?? {
      gtin: supplementalMapping!.gtin,
      appid: supplementalMapping!.appid,
      startdt: null,
      enddt: null,
    }

    const { data: pack, error: packError } = await admin
      .from('dmd_ampp')
      .select('appid, nm, abbrevnm, apid, vppid, invalid, legal_catcd, disccd, discdt')
      .eq('appid', gtinRow.appid)
      .maybeSingle()
    if (packError) throw packError
    if (!pack) return json({ found: false, gtin, message: 'The GTIN exists but its dm+d pack record is unavailable.' })

    const [{ data: product, error: productError }, { data: virtualPack, error: virtualPackError }] = await Promise.all([
      admin.from('dmd_amp').select('apid, nm, abbrevnm, vpid, invalid, suppcd').eq('apid', pack.apid).maybeSingle(),
      admin.from('dmd_vmpp').select('vppid, nm, abbrevnm, vpid, qtyval, qty_uomcd, invalid').eq('vppid', pack.vppid).maybeSingle(),
    ])
    if (productError) throw productError
    if (virtualPackError) throw virtualPackError

    const vpid = product?.vpid ?? virtualPack?.vpid ?? null
    const { data: virtualProduct, error: virtualProductError } = vpid
      ? await admin.from('dmd_vmp').select('vpid, nm, abbrevnm, cat_cd, invalid').eq('vpid', vpid).maybeSingle()
      : { data: null, error: null }
    if (virtualProductError) throw virtualProductError

    let catalogueMatches: Record<string, unknown>[] = []
    if (pack.apid || vpid) {
      const filters = []
      if (pack.apid) filters.push(`apid.eq.${pack.apid}`)
      if (vpid) filters.push(`vpid.eq.${vpid}`)
      const { data, error } = await admin
        .from('cdr_drugs_unique')
        .select('id, drug_brand, drug_class, drug_form, drug_strength, drug_type, units, is_generic, box_image, vpid, apid, gtin')
        .or(filters.join(','))
      if (error) throw error
      catalogueMatches = data ?? []
    }

    const catalogueMatch = catalogueMatches.find((row) => row.apid === pack.apid)
      ?? catalogueMatches.find((row) => row.vpid === vpid)
      ?? null

    let subscription = null
    let ledger = null
    if (catalogueMatch) {
      const [{ data: subscriptionData }, { data: ledgerData }] = await Promise.all([
        admin
          .from('ps_subscribed_registers')
          .select('id, drug_id, drug_brand, drug_class, drug_form, drug_strength, drug_type')
          .eq('organisation_id', organisation_id)
          .eq('drug_id', catalogueMatch.id)
          .maybeSingle(),
        admin
          .from('ps_register_ledgers')
          .select('id, register_type, current_balance, is_active, entry_count')
          .eq('organisation_id', organisation_id)
          .eq('drug_id', catalogueMatch.id)
          .eq('register_type', 'CD')
          .eq('is_active', true)
          .maybeSingle(),
      ])
      subscription = subscriptionData
      ledger = ledgerData
    }

    const historical = Boolean(gtinRow.enddt && gtinRow.enddt < today)
    return json({
      found: true,
      gtin,
      matched_gtin: gtinRow.gtin,
      historical,
      gtin_valid_from: gtinRow.startdt,
      gtin_valid_to: gtinRow.enddt,
      supplemental_mapping: supplementalMapping,
      pack,
      product,
      virtual_pack: virtualPack,
      virtual_product: virtualProduct,
      catalogue_match: catalogueMatch,
      organisation_register: subscription,
      ledger,
    })
  } catch (error) {
    console.error('barcode-lookup error', error)
    const message = error instanceof Error ? error.message : 'Barcode lookup failed.'
    const status = message.includes('GTIN must') ? 400 : 500
    return json({ error: status === 500 ? 'Barcode lookup failed. Please try again.' : message }, status)
  }
})
