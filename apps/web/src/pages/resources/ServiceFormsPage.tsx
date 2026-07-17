import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResourceHeader } from './ResourceHeader'
import { printableForms } from './resourceCatalog'

const services = ['All services', ...Array.from(new Set(printableForms.map((form) => form.service)))]

export function ServiceFormsPage() {
  const [query, setQuery] = useState('')
  const [service, setService] = useState('All services')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const filteredForms = printableForms.filter((form) => {
    const matchesService = service === 'All services' || form.service === service
    const matchesQuery = !deferredQuery || `${form.title} ${form.service} ${form.description}`.toLowerCase().includes(deferredQuery)
    return matchesService && matchesQuery
  })

  return (
    <div className="resource-shell">
      <ResourceHeader />
      <main className="resource-library">
        <div className="resource-page-heading">
          <Link to="/resources">Resources</Link>
          <span>/</span>
          <span>Service forms</span>
          <h1>Service forms</h1>
          <p>Contingency print forms grouped by pharmacy service and clinical pathway.</p>
        </div>

        <div className="resource-filter-bar">
          <label>
            <span>Find a form</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by service or form name"
            />
          </label>
          <label>
            <span>Service</span>
            <select value={service} onChange={(event) => setService(event.target.value)}>
              {services.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>

        <div className="resource-result-summary" aria-live="polite">
          <strong>{filteredForms.length}</strong> {filteredForms.length === 1 ? 'form' : 'forms'}
          {(query || service !== 'All services') && <button type="button" onClick={() => { setQuery(''); setService('All services') }}>Clear filters</button>}
        </div>

        <section className="resource-form-list" aria-label="Available forms">
          {filteredForms.map((form) => (
            <article key={form.slug}>
              <div className="resource-form-service">{form.service}</div>
              <div>
                <h2>{form.title}</h2>
                <p>{form.description}</p>
              </div>
              <Link className="resource-primary-action" to={`/resources/forms/${form.slug}`}>View and print</Link>
            </article>
          ))}
          {filteredForms.length === 0 && (
            <div className="resource-empty-state">
              <h2>No matching forms</h2>
              <p>Try a broader search or choose another service.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}