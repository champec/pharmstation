import { createReadStream } from 'node:fs'
import { SaxesParser } from 'saxes'

export type Row = Record<string, unknown>

export interface ParseOptions {
  /** Element name that delimits one record (e.g. "VMP", "AMP", "GTINDATA"). */
  recordTag: string
  /** Map of XML child element name -> DB column name. */
  fields: Record<string, string>
  /**
   * Optional parent context: capture an id from an ancestor element and inject
   * it into every record. Used for GTIN, where AMPP/AMPPID wraps GTINDATA rows.
   */
  context?: { tag: string; idChild: string; idField: string }
  batchSize: number
  /** Called with each full batch of parsed rows. Awaited (provides backpressure). */
  onBatch: (rows: Row[]) => Promise<void>
}

/**
 * Stream-parse a dm+d XML file, emitting rows in batches.
 * Memory stays bounded: we drive the SAX parser one file chunk at a time and
 * await `onBatch` between chunks, so the DB load paces the parse.
 */
export async function parseXml(filePath: string, options: ParseOptions): Promise<number> {
  const { recordTag, fields, context, batchSize, onBatch } = options
  const parser = new SaxesParser()

  let parseError: Error | null = null
  parser.on('error', (e) => {
    parseError = e instanceof Error ? e : new Error(String(e))
  })

  let current: Row | null = null
  let text = ''
  let contextId: string | null = null
  let total = 0
  const batch: Row[] = []

  parser.on('opentag', (node) => {
    text = ''
    if (context && node.name === context.tag) contextId = null
    if (node.name === recordTag) current = {}
  })
  parser.on('text', (t) => {
    text += t
  })
  parser.on('cdata', (t) => {
    text += t
  })
  parser.on('closetag', (node) => {
    const name = node.name
    const value = text.trim()
    text = ''

    if (context && name === context.idChild && current === null) {
      contextId = value || null
      return
    }
    if (current) {
      if (name === recordTag) {
        if (context) current[context.idField] = contextId
        batch.push(current)
        total++
        current = null
      } else {
        const col = fields[name]
        if (col) current[col] = value === '' ? null : value
      }
    }
  })

  async function flushFullBatches(): Promise<void> {
    while (batch.length >= batchSize) {
      await onBatch(batch.splice(0, batchSize))
    }
  }

  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 16 })
  for await (const chunk of stream) {
    parser.write(chunk as string)
    if (parseError) throw parseError
    await flushFullBatches()
  }
  parser.close()
  if (parseError) throw parseError

  if (batch.length > 0) await onBatch(batch.splice(0, batch.length))
  return total
}
