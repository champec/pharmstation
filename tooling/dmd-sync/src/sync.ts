import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig } from './config.js'
import { createServiceClient } from './supabase.js'
import { listLatestRelease, downloadRelease } from './trud.js'
import { extractRelease } from './extract.js'
import { loadFile } from './loader.js'
import { FILE_SPECS } from './mappings.js'
import { getState, saveState } from './state.js'
import { reconcileWith } from './reconcile.js'
import { log } from './log.js'

export interface SyncOptions {
  force?: boolean
  keepFiles?: boolean
  /** Skip the cdr_drugs_unique reconcile step. Default: reconcile runs. */
  noReconcile?: boolean
  /** dm+d control-drug categories to reconcile. Default Schedule 2. */
  categories?: string[]
}

/**
 * Full dm+d sync: check latest TRUD release, skip if unchanged, otherwise
 * download + verify + extract + load every dm+d table.
 */
export async function runSync(opts: SyncOptions = {}): Promise<void> {
  const config = loadConfig()
  const client = createServiceClient(config)

  log.step(`dm+d sync starting (item ${config.trudItem})`)

  const release = await listLatestRelease(config.trudApiKey, config.trudItem)
  const state = await getState(client, config.trudItem)

  if (!opts.force && state?.release_id === release.id) {
    log.info(`Already up to date with ${release.name} (released ${release.releaseDate}). Nothing to do.`)
    log.info(`Use --force to re-load anyway.`)
    return
  }
  if (state?.release_id) {
    log.info(`Updating from ${state.release_name ?? 'unknown'} -> ${release.name}.`)
  } else {
    log.info(`No previous sync recorded — performing first load.`)
  }

  const releaseDir = join(config.workDir, release.id.replace(/\.zip$/i, ''))
  const xmlDir = join(releaseDir, 'xml')

  const archivePath = await downloadRelease(release, releaseDir)
  const files = await extractRelease(archivePath, xmlDir)

  const rowCounts: Record<string, number> = {}
  for (const spec of FILE_SPECS) {
    const result = await loadFile(client, spec, files, config.batchSize)
    if (!result.skipped) rowCounts[result.table] = result.rows
  }

  await saveState(client, config.trudItem, release, rowCounts)

  if (!opts.keepFiles) {
    await rm(releaseDir, { recursive: true, force: true }).catch(() => undefined)
  }

  log.step('dm+d tables loaded')
  log.info(`Release ${release.name} loaded. Row counts:`)
  for (const [table, count] of Object.entries(rowCounts)) {
    log.info(`  ${table.padEnd(18)} ${count.toLocaleString()}`)
  }

  // Keep the CD register catalog (cdr_drugs_unique) current as part of the run.
  if (opts.noReconcile) {
    log.info('\nSkipping reconcile (--no-reconcile).')
  } else {
    const result = await reconcileWith(client, {
      categories: opts.categories ?? ['2'],
      apply: true,
    })
    log.info(
      `Reconcile: catalog ${result.catalog}, codes backfilled ${result.linked}, new drugs ${result.inserted}.`,
    )
  }

  log.step('dm+d sync complete')
}
