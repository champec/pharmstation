import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { log } from './log.js'

const TRUD_BASE = 'https://isd.digital.nhs.uk/trud/api/v1'

export interface TrudRelease {
  id: string
  name: string
  releaseDate: string
  archiveFileUrl: string
  archiveFileName: string
  archiveFileSizeBytes: number
  archiveFileSha256: string
}

interface ReleaseListResponse {
  apiVersion?: string
  releases?: TrudRelease[]
  httpStatus: number
  message: string
}

/**
 * Fetch the latest release metadata for a TRUD item.
 * The API key is part of the URL path — never log the full URL.
 */
export async function listLatestRelease(apiKey: string, item: string): Promise<TrudRelease> {
  const url = `${TRUD_BASE}/keys/${apiKey}/items/${item}/releases?latest`
  log.info(`Querying TRUD for latest release of item ${item}...`)

  const res = await fetch(url)
  const body = (await res.json()) as ReleaseListResponse

  if (body.httpStatus !== 200) {
    throw new Error(`TRUD release-list failed (HTTP ${body.httpStatus}): ${body.message}`)
  }
  const release = body.releases?.[0]
  if (!release) {
    throw new Error(`TRUD returned no releases for item ${item}. Check your subscription.`)
  }
  log.info(`Latest release: ${release.name} (${release.releaseDate}) — ${release.archiveFileName}`)
  return release
}

/**
 * Download a release archive to workDir and verify its SHA-256 hash.
 * Returns the absolute path to the downloaded file.
 */
export async function downloadRelease(release: TrudRelease, workDir: string): Promise<string> {
  await mkdir(workDir, { recursive: true })
  const destPath = join(workDir, release.archiveFileName)

  log.info(
    `Downloading ${release.archiveFileName} (${(release.archiveFileSizeBytes / 1_048_576).toFixed(1)} MB)...`,
  )

  const res = await fetch(release.archiveFileUrl)
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`)
  }

  await mkdir(dirname(destPath), { recursive: true })
  const hash = createHash('sha256')
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  nodeStream.on('data', (chunk) => hash.update(chunk))
  await pipeline(nodeStream, createWriteStream(destPath))

  const actual = hash.digest('hex').toUpperCase()
  const expected = release.archiveFileSha256.toUpperCase()
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for ${release.archiveFileName}.\n  expected ${expected}\n  actual   ${actual}`,
    )
  }
  log.info(`Download verified (SHA-256 OK).`)
  return destPath
}
