import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResourceHeader } from './ResourceHeader'
import { logDefinitions } from './logDefinitions'

const categories = ['All categories', ...Array.from(new Set(logDefinitions.map((log) => log.category)))]

export function PrintableLogsPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All categories')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const logs = logDefinitions.filter((log) => {
    const matchesCategory = category === 'All categories' || log.category === category
    const matchesQuery = !deferredQuery || `${log.title} ${log.category} ${log.description}`.toLowerCase().includes(deferredQuery)
    return matchesCategory && matchesQuery
  })

  return <div className="resource-shell"><ResourceHeader /><main className="resource-library"><div className="resource-page-heading"><Link to="/resources">Resources</Link><span>/</span><span>Printable logs</span><h1>Printable logs</h1><p>Clear, practical records for pharmacy governance, premises and daily operations.</p></div><div className="resource-filter-bar"><label><span>Find a log</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search logs" /></label><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((option) => <option key={option}>{option}</option>)}</select></label></div><div className="resource-result-summary"><strong>{logs.length}</strong> {logs.length === 1 ? 'log' : 'logs'}</div><section className="resource-form-list" aria-label="Available printable logs">{logs.map((log) => <article key={log.slug}><div className="resource-form-service">{log.category}</div><div><h2>{log.title}</h2><p>{log.description}</p></div><Link className="resource-primary-action" to={`/resources/logs/${log.slug}`}>View and print</Link></article>)}</section></main></div>
}