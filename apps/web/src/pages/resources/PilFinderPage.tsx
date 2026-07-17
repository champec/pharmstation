import { useDeferredValue, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { ResourceHeader } from './ResourceHeader'
import { commonPilLeaflets, getPrintablePilUrl } from './resourceCatalog'

interface EmcDrug {
  id: string
  drug_name: string
  emc_url: string
  active_ingredient: string | null
  company_name: string | null
  drug_class: string | null
}

export function PilFinderPage() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [results, setResults] = useState<EmcDrug[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (deferredQuery.length < 2) {
      setResults([])
      setError('')
      return
    }

    let active = true
    setLoading(true)
    setError('')
    const safeQuery = deferredQuery.replace(/[,%()]/g, ' ').trim()

    getUserClient()
      .from('emc_drugs')
      .select('id, drug_name, emc_url, active_ingredient, company_name, drug_class')
      .or(`drug_name.ilike.%${safeQuery}%,active_ingredient.ilike.%${safeQuery}%`)
      .order('drug_name')
      .limit(40)
      .then(({ data, error: requestError }) => {
        if (!active) return
        setResults((data as EmcDrug[] | null) ?? [])
        setError(requestError ? 'Medicine leaflets could not be loaded. Please try again.' : '')
        setLoading(false)
      })

    return () => { active = false }
  }, [deferredQuery])

  return (
    <div className="resource-shell">
      <ResourceHeader />
      <main className="resource-library resource-pil-library">
        <div className="resource-page-heading">
          <Link to="/resources">Resources</Link>
          <span>/</span>
          <span>Medicine leaflets</span>
          <h1>Patient information leaflets</h1>
          <p>Search by medicine or active ingredient, then open the manufacturer&apos;s print-friendly leaflet.</p>
        </div>

        <section className="resource-pil-search">
          <label htmlFor="pil-search">Medicine or active ingredient</label>
          <input
            id="pil-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="For example, nitrofurantoin 100 mg"
            autoFocus
          />
          <div className="resource-common-leaflets" aria-label="Common leaflets">
            <span>Common leaflets:</span>
            {commonPilLeaflets.map((leaflet) => (
              <a key={leaflet.url} href={leaflet.url} target="_blank" rel="noreferrer" title={leaflet.detail}>{leaflet.name}</a>
            ))}
          </div>
        </section>

        <div className="resource-result-summary" aria-live="polite">
          {loading ? 'Searching medicines...' : deferredQuery.length < 2 ? 'Enter at least 2 characters to search.' : `${results.length}${results.length === 40 ? '+' : ''} results`}
        </div>

        {error && <div className="resource-error-state">{error}</div>}
        <section className="resource-pil-results" aria-label="Medicine leaflet results">
          {!loading && !error && results.map((drug) => (
            <article key={drug.id}>
              <div>
                <h2>{drug.drug_name}</h2>
                {drug.active_ingredient && <p><strong>Active ingredient:</strong> {drug.active_ingredient}</p>}
                <p>{[drug.company_name, drug.drug_class].filter(Boolean).join(' · ')}</p>
              </div>
              <a className="resource-primary-action" href={getPrintablePilUrl(drug.emc_url)} target="_blank" rel="noreferrer">Open print leaflet</a>
            </article>
          ))}
        </section>

        <aside className="resource-source-note">
          <strong>Trusted source</strong>
          <p>Leaflets open on the electronic medicines compendium. Always select the leaflet matching the exact product and manufacturer supplied.</p>
        </aside>
      </main>
    </div>
  )
}