import AdmZip from 'adm-zip'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { log } from './log.js'

/**
 * Recursively extract a dm+d release archive.
 *
 * The TRUD release zip contains the main dm+d XML files plus nested zips
 * (e.g. *GTIN.zip, *BNF.zip). We walk every zip (at any depth) and write
 * out every .xml file we find into `outDir`, flattened by basename.
 *
 * Returns a map of lower-cased xml basename -> absolute path on disk.
 */
export async function extractRelease(archivePath: string, outDir: string): Promise<Map<string, string>> {
  await mkdir(outDir, { recursive: true })
  const xmlFiles = new Map<string, string>()

  async function walk(zip: AdmZip, depth: number): Promise<void> {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      const name = entry.entryName
      const lower = name.toLowerCase()

      if (lower.endsWith('.zip')) {
        // Nested archive — recurse into its buffer.
        await walk(new AdmZip(entry.getData()), depth + 1)
      } else if (lower.endsWith('.xml')) {
        const fileName = basename(name)
        const dest = join(outDir, fileName)
        await writeFile(dest, entry.getData())
        xmlFiles.set(fileName.toLowerCase(), dest)
      }
    }
  }

  log.info(`Extracting ${basename(archivePath)}...`)
  await walk(new AdmZip(archivePath), 0)
  log.info(`Extracted ${xmlFiles.size} XML files.`)
  return xmlFiles
}

/**
 * Find an extracted XML file whose name matches a dm+d prefix.
 * dm+d filenames embed a date, e.g. f_amp2_3141124.xml, so we match by prefix.
 */
export function findXml(files: Map<string, string>, prefix: string): string | undefined {
  const p = prefix.toLowerCase()
  for (const [name, path] of files) {
    if (name.startsWith(p)) return path
  }
  return undefined
}
