#!/usr/bin/env -S npx tsx
import { runSync } from './sync.js'
import { runReconcile } from './reconcile.js'
import { loadConfig } from './config.js'
import { createServiceClient } from './supabase.js'
import { getState } from './state.js'
import { listLatestRelease } from './trud.js'
import { log } from './log.js'

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

async function runStatus(): Promise<void> {
  const config = loadConfig()
  const client = createServiceClient(config)
  const [state, latest] = await Promise.all([
    getState(client, config.trudItem),
    listLatestRelease(config.trudApiKey, config.trudItem).catch(() => null),
  ])

  log.step(`dm+d status (item ${config.trudItem})`)
  if (state) {
    log.info(`Loaded release : ${state.release_name} (${state.release_date})`)
    log.info(`Synced at      : ${state.synced_at}`)
    if (state.row_counts) {
      for (const [t, c] of Object.entries(state.row_counts)) log.info(`  ${t.padEnd(18)} ${c.toLocaleString()}`)
    }
  } else {
    log.info('No sync has run yet for this item.')
  }
  if (latest) {
    const upToDate = state?.release_id === latest.id
    log.info(`Latest on TRUD : ${latest.name} (${latest.releaseDate}) ${upToDate ? '— up to date' : '— UPDATE AVAILABLE'}`)
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  const catArg = args.find((a) => a.startsWith('--categories='))
  const categories = catArg ? catArg.split('=')[1].split(',') : undefined
  switch (command) {
    case 'sync':
      await runSync({
        force: hasFlag(args, '--force'),
        keepFiles: hasFlag(args, '--keep-files'),
        noReconcile: hasFlag(args, '--no-reconcile'),
        categories,
      })
      break
    case 'reconcile':
      await runReconcile({ apply: hasFlag(args, '--apply'), categories })
      break
    case 'status':
      await runStatus()
      break
    default:
      console.log(
        [
          'dm+d sync — usage:',
          '  pnpm sync [--force] [--keep-files] [--no-reconcile] [--categories=2]',
          '      Download latest TRUD release, load dmd_* tables, then reconcile the',
          '      CD register (cdr_drugs_unique) — all in one run. Skips if unchanged.',
          '  pnpm reconcile [--apply] [--categories=2,3]',
          '      Reconcile CD register only. Dry run unless --apply.',
          '  pnpm status',
          '      Show loaded vs latest release.',
          '',
          '  Categories are schedule numbers: 2=Sch2 (default), 3=Sch3, 4=Sch4, 5=Sch5.',
        ].join('\n'),
      )
      process.exitCode = command ? 1 : 0
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err))
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exitCode = 1
})
