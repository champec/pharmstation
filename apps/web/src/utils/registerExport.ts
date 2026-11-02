// ============================================
// registerExport — CSV download and print-to-PDF reports
// for the CD register, RP log, patient returns and custom logs.
//
// Inspectors and backup policies expect registers to be
// "capable of being printed" and exportable. Every report states
// who generated it and when, and every value is HTML-escaped
// (register fields are free text typed by staff).
// ============================================

export type ExportCell = string | number | boolean | null | undefined

export interface ReportSection {
  /** Section heading, e.g. "Morphine sulfate 10mg/5ml oral solution" */
  heading: string
  /** Smaller line under the heading, e.g. "Class: Schedule 2 · Form: Solution" */
  subheading?: string
  headers: string[]
  rows: ExportCell[][]
  /** Optional raw HTML cells by [rowIndex][colIndex] (already safe, e.g. signature <img>) */
  htmlCells?: Record<string, string>
  emptyMessage?: string
  /** Start this section on a new printed page (default true after the first) */
  pageBreak?: boolean
}

export interface PrintReportOptions {
  title: string
  organisationName?: string | null
  organisationDetail?: string | null
  /** e.g. "1 Oct 2026 to 31 Oct 2026" */
  periodLabel?: string
  generatedBy?: string | null
  sections: ReportSection[]
  orientation?: 'portrait' | 'landscape'
  /** Extra notes printed above the first section */
  notes?: string[]
}

// ─── Formatting helpers ──────────────────────────────────────

export function escapeHtml(value: ExportCell): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB')
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

export function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value ? 'Yes' : 'No'
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function safeFilename(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

/** "POSTCODE · GPhC premises 1234567" line for report headers. */
export function organisationDetail(
  org: { gphc_premises_number?: string | null; address?: { postcode?: string } | null } | null | undefined,
): string | null {
  if (!org) return null
  return (
    [org.address?.postcode, org.gphc_premises_number ? `GPhC premises ${org.gphc_premises_number}` : null]
      .filter(Boolean)
      .join(' · ') || null
  )
}

// ─── CSV ─────────────────────────────────────────────────────

/**
 * Quote a CSV cell. Text that a spreadsheet would treat as a formula
 * (starting with = + - @ tab or CR) is prefixed with an apostrophe so a
 * malicious patient or supplier name cannot run in Excel. Real numbers
 * are written as-is so negative quantities stay numeric.
 */
export function csvCell(value: ExportCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(headers: string[], rows: ExportCell[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, headers: string[], rows: ExportCell[][]): void {
  // BOM so Excel opens UTF-8 (names with accents, £) correctly
  const blob = new Blob(['﻿', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── Print / save as PDF ─────────────────────────────────────

/** Only allow inline image data URIs (signatures) into printed HTML. */
export function signatureImg(dataUri: string | null | undefined): string | null {
  if (!dataUri) return null
  if (!/^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(dataUri)) return null
  return `<img class="sig" src="${dataUri}" alt="Signature" />`
}

function renderSection(section: ReportSection, index: number): string {
  const breakClass = index > 0 && section.pageBreak !== false ? ' page-break' : ''
  const head = section.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const body =
    section.rows.length === 0
      ? `<tr><td class="empty" colspan="${section.headers.length}">${escapeHtml(section.emptyMessage ?? 'No entries in this period.')}</td></tr>`
      : section.rows
          .map(
            (row, r) =>
              `<tr>${row
                .map((cell, c) => {
                  const raw = section.htmlCells?.[`${r}:${c}`]
                  return `<td>${raw ?? escapeHtml(cell).replace(/\n/g, '<br/>')}</td>`
                })
                .join('')}</tr>`,
          )
          .join('')
  return `
    <section class="section${breakClass}">
      <h2>${escapeHtml(section.heading)}</h2>
      ${section.subheading ? `<p class="sub">${escapeHtml(section.subheading)}</p>` : ''}
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>`
}

export function buildReportHtml(opts: PrintReportOptions): string {
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })
  const meta = [
    opts.organisationName,
    opts.organisationDetail,
    opts.periodLabel ? `Period: ${opts.periodLabel}` : null,
  ]
    .filter(Boolean)
    .map((m) => escapeHtml(m))
    .join(' · ')
  const notes = (opts.notes ?? []).map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('')
  const orientation = opts.orientation ?? 'landscape'

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.title)}${opts.organisationName ? ` — ${escapeHtml(opts.organisationName)}` : ''}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #111; padding: 12px; font-size: 10px; }
  @page { size: A4 ${orientation}; margin: 12mm; }
  @media print {
    body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .toolbar { display: none; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
    .page-break { page-break-before: always; break-before: page; }
  }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
  .toolbar button { font: inherit; font-size: 13px; padding: 6px 14px; border-radius: 6px; border: 1px solid #257BB4; background: #257BB4; color: #fff; cursor: pointer; }
  .toolbar button.secondary { background: #fff; color: #257BB4; }
  header.report { border-bottom: 2px solid #257BB4; padding-bottom: 6px; margin-bottom: 10px; }
  header.report h1 { font-size: 17px; }
  header.report .meta { font-size: 11px; color: #444; margin-top: 2px; }
  .note { font-size: 10px; color: #555; margin-bottom: 4px; }
  .section { margin-top: 12px; }
  .section h2 { font-size: 13px; margin-bottom: 2px; }
  .section .sub { font-size: 10px; color: #555; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #eef3f8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.3px; }
  tr:nth-child(even) td { background: #fafafa; }
  td.empty { text-align: center; color: #777; font-style: italic; }
  img.sig { max-height: 32px; max-width: 120px; }
  footer.report { margin-top: 14px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 9px; color: #555; }
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" data-action="print">Print or save as PDF</button>
    <button type="button" class="secondary" data-action="close">Close</button>
  </div>
  <header class="report">
    <h1>${escapeHtml(opts.title)}</h1>
    <div class="meta">${meta}</div>
  </header>
  ${notes}
  ${opts.sections.map(renderSection).join('')}
  <footer class="report">
    Generated from PharmStation on ${escapeHtml(generated)}${opts.generatedBy ? ` by ${escapeHtml(opts.generatedBy)}` : ''}.
    Entries are permanent: corrections appear as separate, dated entries and annotations; nothing has been removed or altered.
  </footer>
</body>
</html>`
}

/**
 * Open a blank report tab straight away. Call this synchronously inside a
 * click handler, before any await, so pop-up blockers allow it; then pass
 * the window to openPrintReport once the data has loaded.
 */
export function preparePrintWindow(): Window | null {
  const win = window.open('', '_blank')
  if (win) {
    win.document.open()
    win.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preparing report…</title></head>' +
        '<body style="font-family:system-ui,sans-serif;padding:24px;color:#444">Preparing report…</body></html>',
    )
    win.document.close()
  }
  return win
}

/**
 * Write the report into a tab and bring up the print dialog, where the
 * user can print or choose "Save as PDF". The report page has no inline
 * scripts (so it works under a strict Content-Security-Policy); its
 * buttons are wired from here. Returns false if a pop-up blocker stopped
 * the window opening.
 */
export function openPrintReport(opts: PrintReportOptions, existing?: Window | null): boolean {
  const win = existing ?? window.open('', '_blank')
  if (!win || win.closed) return false
  win.document.open()
  win.document.write(buildReportHtml(opts))
  win.document.close()
  win.document.querySelector('[data-action="print"]')?.addEventListener('click', () => win.print())
  win.document.querySelector('[data-action="close"]')?.addEventListener('click', () => win.close())
  win.focus()
  // Give the new document a moment to lay out (and signature images to decode)
  setTimeout(() => win.print(), 300)
  return true
}
