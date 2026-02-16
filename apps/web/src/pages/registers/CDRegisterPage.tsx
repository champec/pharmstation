import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { CDDrug, SubscribedRegister } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

export function CDRegisterPage() {
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const { subscribedRegisters, setSubscribedRegisters, subscribedLoading, setSubscribedLoading } =
    useRegisterStore()

  const [expandedClass, setExpandedClass] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [classSearch, setClassSearch] = useState<Record<string, string>>({})

  // Add New Register modal state
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalInitialSearch, setAddModalInitialSearch] = useState('')

  // ============================================
  // Fetch subscribed registers for this org
  // ============================================
  const loadSubscribed = useCallback(async () => {
    if (!organisation) return
    setSubscribedLoading(true)
    const { data, error } = await getUserClient()
      .from('ps_subscribed_registers')
      .select('*')
      .eq('organisation_id', organisation.id)
      .order('drug_class')
      .order('drug_brand')

    if (data && !error) {
      setSubscribedRegisters(data as SubscribedRegister[])
    }
    setSubscribedLoading(false)
  }, [organisation, setSubscribedRegisters, setSubscribedLoading])

  useEffect(() => {
    loadSubscribed()
  }, [loadSubscribed])

  // ============================================
  // Group subscribed registers by class
  // ============================================
  const registersByClass = useMemo(() => {
    const map = new Map<string, SubscribedRegister[]>()
    for (const reg of subscribedRegisters) {
      const cls = reg.drug_class
      if (!map.has(cls)) map.set(cls, [])
      map.get(cls)!.push(reg)
    }
    return map
  }, [subscribedRegisters])

  // ============================================
  // Multi-word search: split query into tokens, match ALL tokens
  // against class name, brand, form, or strength
  // ============================================
  const matchesTokens = useCallback((tokens: string[], reg: SubscribedRegister) => {
    const searchable = `${reg.drug_class} ${reg.drug_brand} ${reg.drug_form} ${reg.drug_strength}`.toLowerCase()
    return tokens.every((t) => searchable.includes(t))
  }, [])

  const filteredClasses = useMemo(() => {
    const classes = Array.from(registersByClass.keys())
    if (!globalSearch.trim()) return classes

    const tokens = globalSearch.toLowerCase().trim().split(/\s+/).filter(Boolean)
    return classes.filter((cls) => {
      // Match class name itself
      const classLower = cls.toLowerCase()
      if (tokens.every((t) => classLower.includes(t))) return true
      // Match any register in the class
      return registersByClass.get(cls)!.some((reg) => matchesTokens(tokens, reg))
    })
  }, [registersByClass, globalSearch, matchesTokens])

  // Auto-expand when only one class matches
  useEffect(() => {
    if (filteredClasses.length === 1 && globalSearch.trim()) {
      setExpandedClass(filteredClasses[0])
    }
  }, [filteredClasses, globalSearch])

  // ============================================
  // Filter registers within an expanded class (multi-word)
  // ============================================
  const getFilteredRegisters = (cls: string): SubscribedRegister[] => {
    const registers = registersByClass.get(cls) ?? []

    // Combine global + class-level search tokens
    const globalTokens = globalSearch.trim() ? globalSearch.toLowerCase().trim().split(/\s+/).filter(Boolean) : []
    const classTokens = (classSearch[cls] ?? '').trim()
      ? (classSearch[cls] ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean)
      : []
    const allTokens = [...globalTokens, ...classTokens]

    if (allTokens.length === 0) return registers
    return registers.filter((reg) => matchesTokens(allTokens, reg))
  }

  const setClassSearchValue = (cls: string, value: string) => {
    setClassSearch((prev) => ({ ...prev, [cls]: value }))
  }

  // ============================================
  // "Search doesn't find register" — show add prompt
  // ============================================
  const hasSearchResults = filteredClasses.length > 0
  const showNoResultsPrompt = globalSearch.trim().length >= 2 && !hasSearchResults

  const handleAddFromSearch = () => {
    setAddModalInitialSearch(globalSearch.trim())
    setAddModalOpen(true)
  }

  const handleRegisterAdded = () => {
    setAddModalOpen(false)
    setAddModalInitialSearch('')
    loadSubscribed()
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>💊 CD Register</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button
              className="ps-btn ps-btn-ghost"
              onClick={() => navigate('/registers/scan')}
              title="Scan a prescription or invoice with AI"
            >
              📸 AI Scan
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => { setAddModalInitialSearch(''); setAddModalOpen(true) }}
            >
              ＋ Add New Register
            </button>
          </div>
        </div>
      </div>

      {/* Global search */}
      <div style={{ marginBottom: 'var(--ps-space-md)', maxWidth: '400px' }}>
        <input
          className="ps-input"
          placeholder="Search registers... (e.g. zomo 10 m)"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />
      </div>

      {subscribedLoading ? (
        <p style={{ color: 'var(--ps-slate)' }}>Loading registers...</p>
      ) : subscribedRegisters.length === 0 && !globalSearch.trim() ? (
        /* Empty state — no registers subscribed yet */
        <div className="cd-empty-state">
          <div className="cd-empty-icon">📋</div>
          <h3>No registers yet</h3>
          <p>
            Your pharmacy hasn't added any CD registers yet. Just like picking a blank register insert in real life,
            click the button below to add your first register.
          </p>
          <button
            className="ps-btn ps-btn-primary"
            onClick={() => { setAddModalInitialSearch(''); setAddModalOpen(true) }}
          >
            ＋ Add Your First Register
          </button>
        </div>
      ) : (
        <>
          {/* No results prompt */}
          {showNoResultsPrompt && (
            <div className="cd-no-results-prompt">
              <p>
                Looks like the register for <strong>"{globalSearch}"</strong> doesn't exist in your pharmacy yet.
              </p>
              <button className="ps-btn ps-btn-primary" onClick={handleAddFromSearch}>
                ＋ Add this register
              </button>
            </div>
          )}

          {/* Accordion list of subscribed registers */}
          <div>
            {filteredClasses.map((drugClass) => {
              const isOpen = expandedClass === drugClass
              const regCount = registersByClass.get(drugClass)?.length ?? 0
              const filtered = isOpen ? getFilteredRegisters(drugClass) : []

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
                      <span className="accordion-count">{regCount}</span>
                    </div>

                    {/* Inline search — shown when expanded */}
                    {isOpen && (
                      <div className="accordion-search" onClick={(e) => e.stopPropagation()}>
                        <input
                          className="ps-input accordion-search-input"
                          placeholder="Filter brands & strengths..."
                          value={classSearch[drugClass] ?? ''}
                          onChange={(e) => setClassSearchValue(drugClass, e.target.value)}
                        />
                      </div>
                    )}
                  </button>

                  {/* Expanded: register cards */}
                  {isOpen && (
                    <div className="accordion-body">
                      {filtered.length === 0 ? (
                        <p style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-sm)', padding: 'var(--ps-space-sm)' }}>
                          No matching registers
                        </p>
                      ) : (
                        <div className="drug-card-grid">
                          {filtered.map((reg) => (
                            <button
                              key={reg.drug_id}
                              className="drug-card"
                              onClick={() => navigate(`/registers/cd/${reg.drug_id}`)}
                            >
                              <div className="drug-card-name">{reg.drug_brand}</div>
                              <div className="drug-card-detail">
                                {reg.drug_form} — {reg.drug_strength}
                              </div>
                              <div className="drug-card-type">{reg.drug_type}</div>
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
        </>
      )}

      {/* Add New Register Modal */}
      <AddRegisterModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        initialSearch={addModalInitialSearch}
        onAdded={handleRegisterAdded}
      />
    </div>
  )
}

// ============================================
// AddRegisterModal — Step-through: Class → Brand → Strength
// ============================================

interface AddRegisterModalProps {
  isOpen: boolean
  onClose: () => void
  initialSearch: string
  onAdded: () => void
}

function AddRegisterModal({ isOpen, onClose, initialSearch, onAdded }: AddRegisterModalProps) {
  const { organisation, activeUser } = useAuthStore()

  // All drug data fetched on modal open
  const [allDrugs, setAllDrugs] = useState<CDDrug[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step-through selections
  const [selectedClass, setSelectedClass] = useState<string | null>(null)
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null)

  // Free text filter for each step
  const [classFilter, setClassFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [strengthFilter, setStrengthFilter] = useState('')

  // Fetch all drugs when modal opens
  useEffect(() => {
    if (!isOpen) return
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
    // Reset state
    setSelectedClass(null)
    setSelectedBrand(null)
    setClassFilter(initialSearch)
    setBrandFilter('')
    setStrengthFilter('')
    setError(null)
  }, [isOpen, initialSearch])

  // Distinct classes — search by class name AND brand names within each class
  const classes = useMemo(() => {
    const classSet = new Set(allDrugs.map((d) => d.drug_class))
    const arr = Array.from(classSet).sort()
    if (!classFilter.trim()) return arr
    const tokens = classFilter.toLowerCase().trim().split(/\s+/)
    return arr.filter((cls) => {
      // Match class name itself
      if (tokens.every((t) => cls.toLowerCase().includes(t))) return true
      // Also match any brand/form/strength within this class
      const drugsInClass = allDrugs.filter((d) => d.drug_class === cls)
      return drugsInClass.some((d) => {
        const searchable = `${d.drug_class} ${d.drug_brand} ${d.drug_form} ${d.drug_strength}`.toLowerCase()
        return tokens.every((t) => searchable.includes(t))
      })
    })
  }, [allDrugs, classFilter])

  // Brands in selected class — also pre-filter from initial search if brand was typed
  const brands = useMemo(() => {
    if (!selectedClass) return []
    const drugsInClass = allDrugs.filter((d) => d.drug_class === selectedClass)
    const set = new Set(drugsInClass.map((d) => d.drug_brand))
    const arr = Array.from(set).sort()
    if (!brandFilter.trim()) return arr
    const tokens = brandFilter.toLowerCase().trim().split(/\s+/)
    return arr.filter((b) => {
      // Match brand name or form/strength within that brand
      if (tokens.every((t) => b.toLowerCase().includes(t))) return true
      const brandsInClass = drugsInClass.filter((d) => d.drug_brand === b)
      return brandsInClass.some((d) => {
        const searchable = `${d.drug_brand} ${d.drug_form} ${d.drug_strength}`.toLowerCase()
        return tokens.every((t) => searchable.includes(t))
      })
    })
  }, [allDrugs, selectedClass, brandFilter])

  // Strengths for selected brand
  const strengths = useMemo(() => {
    if (!selectedClass || !selectedBrand) return []
    const matching = allDrugs.filter(
      (d) => d.drug_class === selectedClass && d.drug_brand === selectedBrand,
    )
    if (!strengthFilter.trim()) return matching
    const tokens = strengthFilter.toLowerCase().trim().split(/\s+/)
    return matching.filter((d) => {
      const searchable = `${d.drug_form} ${d.drug_strength}`.toLowerCase()
      return tokens.every((t) => searchable.includes(t))
    })
  }, [allDrugs, selectedClass, selectedBrand, strengthFilter])

  // When initial search is set (e.g. brand name like "oxycontin"), carry it into brand filter
  // once class is auto-selected so user sees matching brands immediately
  useEffect(() => {
    if (selectedClass && !selectedBrand && classFilter.trim() && !brandFilter.trim()) {
      // Only carry over if classFilter doesn't match class name exactly (i.e. it's a brand search)
      const tokens = classFilter.toLowerCase().trim().split(/\s+/)
      const isClassMatch = tokens.every((t) => selectedClass.toLowerCase().includes(t))
      if (!isClassMatch) {
        setBrandFilter(classFilter)
      }
    }
  }, [selectedClass, selectedBrand, classFilter, brandFilter])

  // Auto-select class if only one matches
  useEffect(() => {
    if (classes.length === 1 && !selectedClass) {
      setSelectedClass(classes[0])
    }
  }, [classes, selectedClass])

  // Auto-select brand if only one matches
  useEffect(() => {
    if (brands.length === 1 && !selectedBrand && selectedClass) {
      setSelectedBrand(brands[0])
    }
  }, [brands, selectedBrand, selectedClass])

  // Opening balance step
  const [selectedDrug, setSelectedDrug] = useState<CDDrug | null>(null)
  const [openingBalance, setOpeningBalance] = useState('0')
  const [showConfirmation, setShowConfirmation] = useState(false)

  const handleSelectDrugForBalance = (drug: CDDrug) => {
    setSelectedDrug(drug)
    setOpeningBalance('0')
    setShowConfirmation(false)
  }

  const handleConfirmCreate = () => {
    setShowConfirmation(true)
  }

  const handleFinalCreate = async () => {
    if (!organisation || !activeUser || !selectedDrug) return
    setSaving(true)
    setError(null)

    const balance = parseFloat(openingBalance) || 0

    // 1. Create the subscribed register
    const { error: insertError } = await getUserClient()
      .from('ps_subscribed_registers')
      .insert({
        organisation_id: organisation.id,
        drug_id: selectedDrug.id,
        drug_brand: selectedDrug.drug_brand,
        drug_form: selectedDrug.drug_form,
        drug_strength: selectedDrug.drug_strength,
        drug_class: selectedDrug.drug_class,
        drug_type: selectedDrug.drug_type,
        created_by: activeUser.id,
      })

    if (insertError) {
      if (insertError.message.includes('duplicate') || insertError.message.includes('unique')) {
        setError('This register is already added to your pharmacy.')
      } else {
        setError(insertError.message)
      }
      setSaving(false)
      return
    }

    // 2. Create the ledger with the opening balance
    const { error: ledgerError } = await getUserClient()
      .from('ps_register_ledgers')
      .insert({
        organisation_id: organisation.id,
        register_type: 'CD',
        drug_id: selectedDrug.id,
        drug_name: selectedDrug.drug_brand,
        drug_form: selectedDrug.drug_form,
        drug_strength: selectedDrug.drug_strength,
        drug_class: selectedDrug.drug_class,
        current_balance: balance,
        created_by: activeUser.id,
      })

    if (ledgerError) {
      setError(ledgerError.message)
      setSaving(false)
      return
    }

    setSaving(false)
    setSelectedDrug(null)
    setShowConfirmation(false)
    onAdded()
  }

  const goBack = () => {
    if (showConfirmation) {
      setShowConfirmation(false)
    } else if (selectedDrug) {
      setSelectedDrug(null)
      setOpeningBalance('0')
    } else if (selectedBrand) {
      setSelectedBrand(null)
      setStrengthFilter('')
    } else if (selectedClass) {
      setSelectedClass(null)
      setBrandFilter('')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New Register" width="600px">
      <div className="add-register-modal">
        {loading ? (
          <p style={{ color: 'var(--ps-slate)' }}>Loading drugs database...</p>
        ) : (
          <>
            {/* Breadcrumb trail */}
            <div className="add-register-breadcrumb">
              <button
                className={`add-register-step ${!selectedClass ? 'active' : 'done'}`}
                onClick={() => { setSelectedClass(null); setSelectedBrand(null); setSelectedDrug(null); setShowConfirmation(false) }}
              >
                1. Class
              </button>
              <span className="add-register-step-arrow">→</span>
              <button
                className={`add-register-step ${selectedClass && !selectedBrand ? 'active' : selectedBrand ? 'done' : ''}`}
                onClick={() => { if (selectedClass) { setSelectedBrand(null); setSelectedDrug(null); setShowConfirmation(false) } }}
                disabled={!selectedClass}
              >
                2. Brand
              </button>
              <span className="add-register-step-arrow">→</span>
              <button
                className={`add-register-step ${selectedBrand && !selectedDrug ? 'active' : selectedDrug ? 'done' : ''}`}
                onClick={() => { if (selectedBrand) { setSelectedDrug(null); setShowConfirmation(false) } }}
                disabled={!selectedBrand}
              >
                3. Strength
              </button>
              <span className="add-register-step-arrow">→</span>
              <span className={`add-register-step ${selectedDrug ? 'active' : ''}`}>
                4. Opening Balance
              </span>
            </div>

            {error && <div className="auth-error">{error}</div>}

            {/* Step 1: Select Class */}
            {!selectedClass && (
              <div className="add-register-step-content">
                <label className="form-label">Select drug class</label>
                <input
                  className="ps-input"
                  placeholder="Filter classes..."
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                  autoFocus
                />
                <div className="add-register-list">
                  {classes.map((cls) => (
                    <button
                      key={cls}
                      className="add-register-list-item"
                      onClick={() => { setSelectedClass(cls); setBrandFilter('') }}
                    >
                      {cls}
                    </button>
                  ))}
                  {classes.length === 0 && (
                    <p className="add-register-empty">No matching drug classes found.</p>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Select Brand */}
            {selectedClass && !selectedBrand && (
              <div className="add-register-step-content">
                <div className="add-register-selected">
                  <strong>Class:</strong> {selectedClass}
                  <button className="ps-btn ps-btn-ghost" onClick={goBack} style={{ marginLeft: 'auto', fontSize: '12px' }}>
                    ← Back
                  </button>
                </div>
                <label className="form-label">Select brand</label>
                <input
                  className="ps-input"
                  placeholder="Filter brands..."
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  autoFocus
                />
                <div className="add-register-list">
                  {brands.map((brand) => (
                    <button
                      key={brand}
                      className="add-register-list-item"
                      onClick={() => { setSelectedBrand(brand); setStrengthFilter('') }}
                    >
                      {brand}
                    </button>
                  ))}
                  {brands.length === 0 && (
                    <p className="add-register-empty">No matching brands found.</p>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Select specific drug (form + strength) */}
            {selectedClass && selectedBrand && !selectedDrug && (
              <div className="add-register-step-content">
                <div className="add-register-selected">
                  <strong>Class:</strong> {selectedClass} &nbsp;→&nbsp; <strong>Brand:</strong> {selectedBrand}
                  <button className="ps-btn ps-btn-ghost" onClick={goBack} style={{ marginLeft: 'auto', fontSize: '12px' }}>
                    ← Back
                  </button>
                </div>
                <label className="form-label">Select form & strength</label>
                <input
                  className="ps-input"
                  placeholder="Filter strengths..."
                  value={strengthFilter}
                  onChange={(e) => setStrengthFilter(e.target.value)}
                  autoFocus
                />
                <div className="add-register-list">
                  {strengths.map((drug) => (
                    <button
                      key={drug.id}
                      className="add-register-list-item"
                      onClick={() => handleSelectDrugForBalance(drug)}
                    >
                      <span className="add-register-drug-name">
                        {drug.drug_brand} — {drug.drug_form}
                      </span>
                      <span className="add-register-drug-strength">{drug.drug_strength}</span>
                      <span className="add-register-drug-type">{drug.drug_type}</span>
                    </button>
                  ))}
                  {strengths.length === 0 && (
                    <p className="add-register-empty">No matching strengths found.</p>
                  )}
                </div>
              </div>
            )}

            {/* Step 4: Opening balance + confirmation */}
            {selectedDrug && !showConfirmation && (
              <div className="add-register-step-content">
                <div className="add-register-selected">
                  <strong>{selectedDrug.drug_brand}</strong> — {selectedDrug.drug_form} — {selectedDrug.drug_strength}
                  <button className="ps-btn ps-btn-ghost" onClick={goBack} style={{ marginLeft: 'auto', fontSize: '12px' }}>
                    ← Back
                  </button>
                </div>
                <div className="form-group">
                  <label className="form-label">Opening Balance</label>
                  <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-mist)', marginBottom: '8px' }}>
                    What is the current stock balance for this drug? Enter 0 if starting fresh.
                  </p>
                  <input
                    type="number"
                    className="ps-input"
                    placeholder="0"
                    step="any"
                    min="0"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    autoFocus
                    style={{ maxWidth: '200px' }}
                  />
                </div>
                <div className="form-actions">
                  <button className="ps-btn ps-btn-ghost" onClick={goBack}>← Back</button>
                  <button
                    className="ps-btn ps-btn-primary"
                    onClick={handleConfirmCreate}
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {/* Confirmation step */}
            {selectedDrug && showConfirmation && (
              <div className="add-register-step-content">
                <div className="add-register-confirm">
                  <div className="add-register-confirm-icon">⚠️</div>
                  <h3>Confirm New Register</h3>
                  <div className="add-register-confirm-details">
                    <p><strong>Drug:</strong> {selectedDrug.drug_brand}</p>
                    <p><strong>Form:</strong> {selectedDrug.drug_form}</p>
                    <p><strong>Strength:</strong> {selectedDrug.drug_strength}</p>
                    <p><strong>Class:</strong> {selectedDrug.drug_class}</p>
                    <p><strong>Opening Balance:</strong> {parseFloat(openingBalance) || 0}</p>
                  </div>
                  <div className="add-register-confirm-warning">
                    ⚠️ This action cannot be reversed. A new CD register will be created with an opening balance of <strong>{parseFloat(openingBalance) || 0}</strong>.
                  </div>
                  <div className="form-actions" style={{ justifyContent: 'center' }}>
                    <button className="ps-btn ps-btn-ghost" onClick={goBack}>← Back</button>
                    <button
                      className="ps-btn ps-btn-primary"
                      onClick={handleFinalCreate}
                      disabled={saving}
                    >
                      {saving ? 'Creating...' : '✓ Create Register'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
