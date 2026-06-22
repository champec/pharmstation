import { config as loadEnv } from 'dotenv'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

loadEnv()

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy tooling/dmd-sync/.env.example to .env and fill it in.`,
    )
  }
  return value.trim()
}

export interface DmdConfig {
  trudApiKey: string
  trudItem: string
  supabaseUrl: string
  supabaseServiceRoleKey: string
  batchSize: number
  workDir: string
}

export function loadConfig(): DmdConfig {
  return {
    trudApiKey: required('TRUD_API_KEY'),
    trudItem: (process.env.TRUD_DMD_ITEM ?? '24').trim(),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    batchSize: Number(process.env.DMD_BATCH_SIZE ?? '1000') || 1000,
    workDir: process.env.DMD_WORK_DIR
      ? resolve(process.env.DMD_WORK_DIR)
      : resolve(tmpdir(), 'dmd-sync'),
  }
}
