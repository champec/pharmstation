import type { SupabaseClient } from '@supabase/supabase-js'
import { findXml } from './extract.js'
import { parseXml, type Row } from './parser.js'
import { VMP_CONTROL_SPEC, type FileSpec } from './mappings.js'
import { log } from './log.js'

/** Columns that must be sent as JSON numbers, not strings. */
const NUMERIC_COLUMNS = new Set(['udfs', 'qtyval'])

function coerce(rows: Row[]): Row[] {
  for (const row of rows) {
    for (const col of NUMERIC_COLUMNS) {
      const v = row[col]
      if (typeof v === 'string') {
        const n = Number(v)
        row[col] = Number.isFinite(n) ? n : null
      }
    }
  }
  return rows
}

async function upsert(client: SupabaseClient, table: string, rows: Row[], conflict: string): Promise<void> {
  const { error } = await client.from(table).upsert(coerce(rows), { onConflict: conflict })
  if (error) throw new Error(`upsert ${table} failed: ${error.message}`)
}

async function insert(client: SupabaseClient, table: string, rows: Row[]): Promise<void> {
  const { error } = await client.from(table).insert(coerce(rows))
  if (error) throw new Error(`insert ${table} failed: ${error.message}`)
}

/**
 * Pre-read the VMP CONTROL_INFO section into a map of vpid -> controlled-drug
 * category code, so we can fold cat_cd into each VMP row during load.
 */
async function buildVmpControlMap(vmpPath: string, batchSize: number): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await parseXml(vmpPath, {
    recordTag: VMP_CONTROL_SPEC.recordTag,
    fields: VMP_CONTROL_SPEC.fields,
    batchSize,
    onBatch: async (rows) => {
      for (const r of rows) {
        if (r.vpid && r.cat_cd) map.set(String(r.vpid), String(r.cat_cd))
      }
    },
  })
  return map
}

export interface LoadResult {
  table: string
  rows: number
  skipped?: boolean
}

/**
 * Load one dm+d file into its table. VMP is special-cased to fold in the
 * controlled-drug category.
 */
export async function loadFile(
  client: SupabaseClient,
  spec: FileSpec,
  files: Map<string, string>,
  batchSize: number,
): Promise<LoadResult> {
  const xmlPath = findXml(files, spec.prefix)
  if (!xmlPath) {
    if (spec.required) throw new Error(`Required dm+d file missing from release: ${spec.prefix}*`)
    log.warn(`Optional file ${spec.prefix}* not found — skipping ${spec.table}.`)
    return { table: spec.table, rows: 0, skipped: true }
  }

  log.step(`Loading ${spec.key} -> ${spec.table}`)

  if (spec.fullReplace) {
    log.info(`Clearing ${spec.table} (full snapshot replace)...`)
    const { error } = await client.from(spec.table).delete().gt('id', -1)
    if (error) throw new Error(`clear ${spec.table} failed: ${error.message}`)
  }

  let controlMap: Map<string, string> | null = null
  if (spec.key === 'VMP') {
    log.info('Reading controlled-drug categories from VMP CONTROL_INFO...')
    controlMap = await buildVmpControlMap(xmlPath, batchSize)
    log.info(`Found ${controlMap.size} controlled-drug VMP entries.`)
  }

  let count = 0
  await parseXml(xmlPath, {
    recordTag: spec.recordTag,
    fields: spec.fields,
    context: spec.context,
    batchSize,
    onBatch: async (rows) => {
      if (controlMap) {
        for (const r of rows) r.cat_cd = controlMap.get(String(r.vpid)) ?? null
      }
      if (spec.conflict) await upsert(client, spec.table, rows, spec.conflict)
      else await insert(client, spec.table, rows)
      count += rows.length
      if (count % 20000 < batchSize) log.info(`  ${spec.table}: ${count} rows...`)
    },
  })

  log.info(`Loaded ${count} rows into ${spec.table}.`)
  return { table: spec.table, rows: count }
}
