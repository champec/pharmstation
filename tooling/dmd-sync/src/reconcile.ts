import type { SupabaseClient } from '@supabase/supabase-js'
import { loadConfig } from './config.js'
import { createServiceClient } from './supabase.js'
import { log } from './log.js'

/**
 * Schedule number -> dm+d CONTROL_DRUG_CATEGORY codes (verified against the
 * live dm+d lookup file):
 *   0001 Sch1 | 0002/0003 Sch2 | 0004-0007 Sch3 | 0008/0009 Sch4 | 0010 Sch5.
 */
const SCHEDULE_CATS: Record<string, string[]> = {
  '1': ['0001'],
  '2': ['0002', '0003'],
  '3': ['0004', '0005', '0006', '0007'],
  '4': ['0008', '0009'],
  '5': ['0010'],
}

/** dm+d category code -> app drug_type label. */
const CAT_TO_TYPE: Record<string, string> = {
  '0001': 'CD1',
  '0002': 'CD2',
  '0003': 'CD2',
  '0004': 'CD3',
  '0005': 'CD3',
  '0006': 'CD3',
  '0007': 'CD3',
  '0008': 'CD4',
  '0009': 'CD4',
  '0010': 'CD5',
}

function catToType(catcd: string | null): string | null {
  return catcd ? CAT_TO_TYPE[catcd] ?? null : null
}

/** Expand schedule numbers (e.g. ['2']) into dm+d category codes. */
function schedulesToCats(schedules: string[]): string[] {
  return [...new Set(schedules.flatMap((s) => SCHEDULE_CATS[s.trim()] ?? []))]
}

function tokens(...parts: (string | null | undefined)[]): string[] {
  const n = parts
    .map((p) => (p ?? '').toLowerCase())
    .join(' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return n === '' ? [] : n.split(' ')
}

/** Order-independent match key: sorted unique tokens. */
function tokenKey(...parts: (string | null | undefined)[]): string {
  return [...new Set(tokens(...parts))].sort().join(' ')
}

interface CatalogItem {
  level: 'vmp' | 'amp'
  vpid: string | null
  apid: string | null
  nm: string
  vtm_nm: string | null
  cat_cd: string | null
  is_generic: boolean
  gtin: string | null
}

interface CdrRow {
  id: string
  drug_brand: string | null
  drug_class: string | null
  drug_strength: string | null
  drug_form: string | null
  vpid: string | null
  apid: string | null
  gtin: string | null
  dmd_cat_cd: string | null
}

async function fetchAllRange<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const page = 1000
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < page) break
  }
  return out
}

export interface ReconcileOptions {
  /** Schedule numbers to reconcile, e.g. ['2'] or ['2','3']. Default Schedule 2. */
  categories?: string[]
  /** Actually write changes. Default false (dry run) unless called from sync. */
  apply?: boolean
}

export interface ReconcileResult {
  catalog: number
  linked: number
  inserted: number
}

/**
 * Reconcile dm+d controlled drugs into cdr_drugs_unique.
 *
 * - Builds the Schedule-N catalog (generic VMPs + branded AMPs + barcode) via
 *   the dmd_cd_catalog() SQL function.
 * - Backfills codes (vpid/apid/dmd_cat_cd) and a representative barcode onto
 *   existing rows — NEVER overwriting curated brand/form/strength/class or images.
 * - Inserts genuinely new controlled drugs (tagged source='dmd'), live.
 * - Never deletes rows (foreign keys from ledgers/scans depend on their ids).
 */
export async function runReconcile(opts: ReconcileOptions = {}): Promise<ReconcileResult> {
  const categories = opts.categories ?? ['2'] // Schedule 2
  const apply = opts.apply ?? false
  const config = loadConfig()
  const client = createServiceClient(config)
  return reconcileWith(client, { categories, apply })
}

/** Reconcile using an existing client (so sync can reuse its connection). */
export async function reconcileWith(
  client: SupabaseClient,
  { categories, apply }: { categories: string[]; apply: boolean },
): Promise<ReconcileResult> {
  const catCodes = schedulesToCats(categories)
  log.step(`Reconcile cdr_drugs_unique (schedule=${categories.join(',')} -> cat=${catCodes.join(',')}, ${apply ? 'APPLY' : 'DRY RUN'})`)
  if (catCodes.length === 0) {
    log.warn(`No dm+d categories for schedules [${categories.join(',')}]. Use 2,3,4,5.`)
    return { catalog: 0, linked: 0, inserted: 0 }
  }

  const catalog = await fetchAllRange<CatalogItem>((from, to) =>
    client.rpc('dmd_cd_catalog', { p_cats: catCodes }).range(from, to),
  )
  log.info(`dm+d controlled-drug catalog: ${catalog.length} products`)
  if (catalog.length === 0) {
    log.warn('Empty catalog — run `pnpm sync` first to load the dm+d tables.')
    return { catalog: 0, linked: 0, inserted: 0 }
  }

  const rows = await fetchAllRange<CdrRow>((from, to) =>
    client
      .from('cdr_drugs_unique')
      .select('id,drug_brand,drug_class,drug_strength,drug_form,vpid,apid,gtin,dmd_cat_cd')
      .range(from, to),
  )
  log.info(`Existing cdr_drugs_unique rows: ${rows.length}`)

  // Indexes over existing rows.
  const byApid = new Map<string, CdrRow>()
  const byVpid = new Map<string, CdrRow>()
  const byKey = new Map<string, CdrRow>()
  for (const r of rows) {
    if (r.apid) byApid.set(r.apid, r)
    if (r.vpid) byVpid.set(r.vpid, r)
    const k = tokenKey(r.drug_brand, r.drug_strength, r.drug_form)
    if (k && !byKey.has(k)) byKey.set(k, r)
  }

  const updates = new Map<string, Record<string, unknown>>() // rowId -> patch
  const inserts: Record<string, unknown>[] = []
  const queuedInsertKeys = new Set<string>()
  const now = new Date().toISOString()

  function patchRow(row: CdrRow, item: CatalogItem): void {
    const patch: Record<string, unknown> = updates.get(row.id) ?? {}
    if (!row.vpid && item.vpid) patch.vpid = item.vpid
    if (!row.apid && item.apid) patch.apid = item.apid
    if (!row.gtin && item.gtin) patch.gtin = item.gtin
    if (!row.dmd_cat_cd && item.cat_cd) patch.dmd_cat_cd = item.cat_cd
    if (Object.keys(patch).length > 0) {
      patch.dmd_synced_at = now
      updates.set(row.id, patch)
    }
  }

  for (const item of catalog) {
    // Find an existing row this catalog item corresponds to.
    let row: CdrRow | undefined
    if (item.level === 'amp' && item.apid) row = byApid.get(item.apid)
    if (!row && item.level === 'vmp' && item.vpid) row = byVpid.get(item.vpid)
    if (!row) row = byKey.get(tokenKey(item.nm))

    if (row) {
      patchRow(row, item)
      continue
    }

    // New controlled drug — queue insert (dedupe within this run by key).
    const key = tokenKey(item.nm)
    if (key && queuedInsertKeys.has(key)) continue
    if (key) queuedInsertKeys.add(key)
    const drugClass = item.vtm_nm ?? item.nm
    inserts.push({
      drug_brand: item.nm,
      drug_type: catToType(item.cat_cd),
      drug_form: null,
      drug_strength: null,
      drug_class: drugClass,
      is_generic: item.is_generic,
      vpid: item.vpid,
      apid: item.apid,
      gtin: item.gtin,
      dmd_cat_cd: item.cat_cd,
      source: 'dmd',
      dmd_synced_at: now,
    })
  }

  log.info(`Will backfill codes/barcodes onto ${updates.size} existing rows.`)
  log.info(`Will insert ${inserts.length} new controlled drugs (source='dmd').`)
  if (inserts.length > 0) {
    log.info('Sample new inserts:')
    for (const r of inserts.slice(0, 8)) log.info(`  + [${r.drug_type}] ${r.drug_brand}`)
  }

  if (!apply) {
    log.info('DRY RUN — no changes written. Re-run with --apply to commit.')
    return { catalog: catalog.length, linked: updates.size, inserted: inserts.length }
  }

  log.step('Applying reconcile changes')
  let linked = 0
  for (const [id, patch] of updates) {
    const { error } = await client.from('cdr_drugs_unique').update(patch).eq('id', id)
    if (error) throw new Error(`backfill update failed: ${error.message}`)
    linked++
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await client.from('cdr_drugs_unique').insert(inserts.slice(i, i + 500))
    if (error) throw new Error(`insert failed: ${error.message}`)
  }
  log.info(`Backfilled ${linked} rows; inserted ${inserts.length} new controlled drugs.`)
  return { catalog: catalog.length, linked, inserted: inserts.length }
}
