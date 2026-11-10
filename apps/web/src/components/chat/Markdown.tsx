import type { ReactNode } from 'react'

// A small, safe Markdown renderer for assistant replies: paragraphs, headings, bullet and numbered
// lists, tables, code blocks, **bold**, *italic*, `code` and links. Everything is rendered as React
// elements, never as raw HTML.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\))/g
  let last = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyBase}-${i++}`
    if (token.startsWith('`')) out.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**') || token.startsWith('__')) out.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>)
    else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'))
      const href = match[2]
      const external = href.startsWith('http')
      out.push(<a key={key} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{label}</a>)
    } else out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>)
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const isTableDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
const tableCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim().startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++])
      i++
      blocks.push(<pre key={k++}><code>{code.join('\n')}</code></pre>)
      continue
    }

    // Table: a header row of pipes followed by a |---|---| divider row.
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = tableCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) rows.push(tableCells(lines[i++]))
      blocks.push(
        <div key={k++} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{header.map((c, n) => <th key={n}>{inline(c, `th${k}-${n}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, rn) => (
                <tr key={rn}>{header.map((_, n) => <td key={n}>{inline(r[n] ?? '', `td${k}-${rn}-${n}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      blocks.push(<p key={k++} className="md-heading"><strong>{inline(heading[2], `h${k}`)}</strong></p>)
      i++
      continue
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''))
      blocks.push(<ul key={k++}>{items.map((item, n) => <li key={n}>{inline(item, `u${k}-${n}`)}</li>)}</ul>)
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))
      blocks.push(<ol key={k++}>{items.map((item, n) => <li key={n}>{inline(item, `o${k}-${n}`)}</li>)}</ol>)
      continue
    }

    if (!line.trim()) { i++; continue }

    const para: string[] = []
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !lines[i].trim().startsWith('```') && !/^#{1,4}\s/.test(lines[i]) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) para.push(lines[i++])
    blocks.push(
      <p key={k++}>
        {para.map((p, n) => <span key={n}>{n > 0 && <br />}{inline(p, `p${k}-${n}`)}</span>)}
      </p>,
    )
  }

  return <div className="md">{blocks}</div>
}
