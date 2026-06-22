import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrudRelease } from './trud.js'

export interface SyncState {
  item: string
  release_id: string | null
  release_name: string | null
  release_date: string | null
  archive_sha256: string | null
  row_counts: Record<string, number> | null
  synced_at: string | null
}

export async function getState(client: SupabaseClient, item: string): Promise<SyncState | null> {
  const { data, error } = await client.from('dmd_sync_state').select('*').eq('item', item).maybeSingle()
  if (error) throw new Error(`read dmd_sync_state failed: ${error.message}`)
  return (data as SyncState) ?? null
}

export async function saveState(
  client: SupabaseClient,
  item: string,
  release: TrudRelease,
  rowCounts: Record<string, number>,
): Promise<void> {
  const { error } = await client.from('dmd_sync_state').upsert(
    {
      item,
      release_id: release.id,
      release_name: release.name,
      release_date: release.releaseDate,
      archive_sha256: release.archiveFileSha256,
      row_counts: rowCounts,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'item' },
  )
  if (error) throw new Error(`save dmd_sync_state failed: ${error.message}`)
}
