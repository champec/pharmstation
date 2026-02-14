import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import type { CDDrug } from '@pharmstation/types'

export function CDRegisterPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const [allDrugs, setAllDrugs] = useState<CDDrug[]>([])
  const [expandedClass, setExpandedClass] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [classSearch, setClassSearch] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  // Fetch ALL drugs at once on mount
  useEffect(() => {
    async function fetchAll() {
      setLoading(true)
      const { data, error } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('*')
        .order('drug_class')
        .order('drug_brand')

      if (data && !error) {
        setAllDrugs(data as CDDrug[])
      }
      setLoading(false)
    }
    fetchAll()
  }, [])

  // Group drugs by class
  const drugsByClass = useMemo(() => {
    const map = new Map<string, CDDrug[]>()
    for (const drug of allDrugs) {
      const cls = drug.drug_class
      if (!map.has(cls)) map.set(cls, [])
      map.get(cls)!.push(drug)
    }
    return map
  }, [allDrugs])

  // Filter classes by global search
  const filteredClasses = useMemo(() => {
    const classes = Array.from(drugsByClass.keys())
    if (!globalSearch) return classes
    const q = globalSearch.toLowerCase()
    return classes.filter((cls) => {
      // Match class name or any drug in the class
      if (cls.toLowerCase().includes(q)) return true
      return drugsByClass.get(cls)!.some(
        (d) =>
          d.drug_brand.toLowerCase().includes(q) ||
          d.drug_form.toLowerCase().includes(q) ||
          d.drug_strength.toLowerCase().includes(q),
      )
    })
  }, [drugsByClass, globalSearch])

  // Filter drugs within expanded class
  const getFilteredDrugs = (cls: string): CDDrug[] => {
    const drugs = drugsByClass.get(cls) ?? []
    const q = classSearch[cls]?.toLowerCase()
    if (!q) return drugs
    return drugs.filter(
      (d) =>
        d.drug_brand.toLowerCase().includes(q) ||
        d.drug_form.toLowerCase().includes(q) ||
        d.drug_strength.toLowerCase().includes(q),
    )
  }

  const setClassSearchValue = (cls: string, value: string) => {
    setClassSearch((prev) => ({ ...prev, [cls]: value }))
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/registers" onClick={(e) => { e.preventDefault(); navigate('/registers') }}>Registers</a>
          <span className="separator">/</span>
          <span>CD Register</span>
        </div>
        <h1>💊 CD Register</h1>
      </div>

      {/* Global search */}
      <div style={{ marginBottom: 'var(--ps-space-md)', maxWidth: '400px' }}>
        <input
          className="ps-input"
          placeholder="Search all drugs..."
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p style={{ color: 'var(--ps-slate)' }}>Loading drugs...</p>
      ) : (
        <div>
          {filteredClasses.map((drugClass) => {
            const isOpen = expandedClass === drugClass
            const drugCount = drugsByClass.get(drugClass)?.length ?? 0
            const filtered = isOpen ? getFilteredDrugs(drugClass) : []

            return (
              <div key={drugClass} className="ps-card" style={{ marginBottom: 'var(--ps-space-sm)' }}>
                {/* Accordion header */}
                <button
                  onClick={() => setExpandedClass(isOpen ? null : drugClass)}
                  className="accordion-header"
                >
                  <div className="accordion-header-left">
                    <span className="accordion-chevron">{isOpen ? '▼' : '▶'}</span>
                    <span className="accordion-title">{drugClass}</span>
                    <span className="accordion-count">{drugCount}</span>
                  </div>

                  {/* Inline search — shown when expanded */}
                  {isOpen && (
                    <div
                      className="accordion-search"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        className="ps-input accordion-search-input"
                        placeholder="Filter brands..."
                        value={classSearch[drugClass] ?? ''}
                        onChange={(e) => setClassSearchValue(drugClass, e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}
                </button>

                {/* Expanded: drug cards */}
                {isOpen && (
                  <div className="accordion-body">
                    {filtered.length === 0 ? (
                      <p style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-sm)', padding: 'var(--ps-space-sm)' }}>
                        No matching drugs
                      </p>
                    ) : (
                      <div className="drug-card-grid">
                        {filtered.map((drug) => (
                          <button
                            key={drug.id}
                            className="drug-card"
                            onClick={() => navigate(`/registers/cd/${drug.id}`)}
                          >
                            <div className="drug-card-name">
                              {drug.drug_brand}
                              {drug.is_generic && (
                                <span className="ps-badge ps-badge-blue" style={{ marginLeft: '6px' }}>
                                  Generic
                                </span>
                              )}
                            </div>
                            <div className="drug-card-detail">
                              {drug.drug_form} — {drug.drug_strength}
                            </div>
                            <div className="drug-card-type">{drug.drug_type}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
