import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import type { CDDrug } from '@pharmstation/types'

export function CDRegisterPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const [drugClasses, setDrugClasses] = useState<string[]>([])
  const [expandedClass, setExpandedClass] = useState<string | null>(null)
  const [drugsInClass, setDrugsInClass] = useState<CDDrug[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  // Fetch distinct drug classes from cdr_drugs_unique
  useEffect(() => {
    async function fetchClasses() {
      setLoading(true)
      const { data, error } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('drug_class')
        .order('drug_class')

      if (data && !error) {
        const unique = [...new Set(data.map((d) => d.drug_class))]
        setDrugClasses(unique)
      }
      setLoading(false)
    }
    fetchClasses()
  }, [])

  // Fetch drugs when a class is expanded
  useEffect(() => {
    if (!expandedClass) {
      setDrugsInClass([])
      return
    }
    async function fetchDrugs() {
      const { data } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('*')
        .eq('drug_class', expandedClass)
        .order('drug_brand')

      setDrugsInClass((data as CDDrug[]) ?? [])
    }
    fetchDrugs()
  }, [expandedClass])

  const filteredClasses = searchQuery
    ? drugClasses.filter((c) => c.toLowerCase().includes(searchQuery.toLowerCase()))
    : drugClasses

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/">Dashboard</a>
          <span className="separator">/</span>
          <span>Registers</span>
          <span className="separator">/</span>
          <span>CD Register</span>
        </div>
        <h1>💊 CD Register</h1>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 'var(--ps-space-md)', maxWidth: '400px' }}>
        <input
          className="ps-input"
          placeholder="Search drug class..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p style={{ color: 'var(--ps-slate)' }}>Loading drug classes...</p>
      ) : (
        <div>
          {filteredClasses.map((drugClass) => (
            <div key={drugClass} className="ps-card" style={{ marginBottom: 'var(--ps-space-sm)' }}>
              {/* Accordion header */}
              <button
                onClick={() =>
                  setExpandedClass(expandedClass === drugClass ? null : drugClass)
                }
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--ps-space-md)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--ps-font-family)',
                  fontSize: 'var(--ps-font-base)',
                  fontWeight: 600,
                  color: 'var(--ps-midnight)',
                  textAlign: 'left',
                }}
              >
                <span>{drugClass}</span>
                <span style={{ color: 'var(--ps-mist)' }}>
                  {expandedClass === drugClass ? '▼' : '▶'}
                </span>
              </button>

              {/* Expanded: show drugs in this class */}
              {expandedClass === drugClass && (
                <div style={{ padding: '0 var(--ps-space-md) var(--ps-space-md)' }}>
                  {drugsInClass.length === 0 ? (
                    <p style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-sm)' }}>
                      Loading...
                    </p>
                  ) : (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: 'var(--ps-space-sm)',
                      }}
                    >
                      {drugsInClass.map((drug) => (
                        <button
                          key={drug.id}
                          className="ps-card"
                          onClick={() => navigate(`/registers/cd/${drug.id}`)}
                          style={{
                            padding: 'var(--ps-space-sm) var(--ps-space-md)',
                            cursor: 'pointer',
                            border: '1px solid var(--ps-off-white)',
                            background: 'var(--ps-white)',
                            textAlign: 'left',
                            fontFamily: 'var(--ps-font-family)',
                            transition: 'all var(--ps-transition-fast)',
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.borderColor = 'var(--ps-cloud-blue)'
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.borderColor = 'var(--ps-off-white)'
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 'var(--ps-font-sm)' }}>
                            {drug.drug_brand}
                            {drug.is_generic && (
                              <span className="ps-badge ps-badge-blue" style={{ marginLeft: '6px' }}>
                                Generic
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 'var(--ps-font-xs)',
                              color: 'var(--ps-slate)',
                              marginTop: '2px',
                            }}
                          >
                            {drug.drug_form} — {drug.drug_strength}
                          </div>
                          <div
                            style={{
                              fontSize: 'var(--ps-font-xs)',
                              color: 'var(--ps-mist)',
                              marginTop: '2px',
                            }}
                          >
                            {drug.drug_type}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
