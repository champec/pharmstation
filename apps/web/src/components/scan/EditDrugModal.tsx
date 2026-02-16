// ============================================
// EditDrugModal — Separate modal for manually
// selecting / overriding the matched drug
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import type { ScanDrugItem, CDDrug } from '@pharmstation/types'

interface EditDrugModalProps {
  isOpen: boolean
  item: ScanDrugItem
  initialDrugId: string
  initialQuantity: number
  onSave: (drugId: string, quantity: number) => void
  onCancel: () => void
}

export function EditDrugModal({
  isOpen,
  item,
  initialDrugId,
  initialQuantity,
  onSave,
  onCancel,
}: EditDrugModalProps) {
  // Cascading drug selector state
  const [allDrugClasses, setAllDrugClasses] = useState<string[]>([])
  const [selectedClass, setSelectedClass] = useState(item.drug_class_raw ?? '')
  const [brandsForClass, setBrandsForClass] = useState<CDDrug[]>([])
  const [selectedDrugId, setSelectedDrugId] = useState(initialDrugId)
  const [editQuantity, setEditQuantity] = useState(initialQuantity)
  const [loadingBrands, setLoadingBrands] = useState(false)

  // Override AI-read filters (strength/form)
  const [overrideFilters, setOverrideFilters] = useState(false)

  // Fallback text search
  const [drugSearch, setDrugSearch] = useState('')
  const [drugResults, setDrugResults] = useState<CDDrug[]>([])
  const [searching, setSearching] = useState(false)
  const [showFallbackSearch, setShowFallbackSearch] = useState(false)

  // Track the selected drug details for the confirmation banner
  const [confirmedDrug, setConfirmedDrug] = useState<CDDrug | null>(null)

  // Load distinct drug classes on open
  useEffect(() => {
    if (!isOpen || allDrugClasses.length > 0) return
    ;(async () => {
      try {
        const { data } = await getUserClient()
          .from('cdr_drugs_unique')
          .select('drug_class')
          .order('drug_class')
        if (data) {
          const unique = [...new Set(data.map((d: { drug_class: string }) => d.drug_class))]
          setAllDrugClasses(unique)
        }
      } catch {
        /* ignore */
      }
    })()
  }, [isOpen, allDrugClasses.length])

  // Load brands when class changes
  useEffect(() => {
    if (!isOpen || !selectedClass) {
      setBrandsForClass([])
      return
    }
    let cancelled = false
    setLoadingBrands(true)
    ;(async () => {
      try {
        let query = getUserClient()
          .from('cdr_drugs_unique')
          .select('*')
          .ilike('drug_class', selectedClass)
          .order('drug_brand')

        // Only filter by AI-read strength when filters are NOT overridden
        if (!overrideFilters && item.drug_strength_raw) {
          query = query.ilike('drug_strength', item.drug_strength_raw)
        }

        const { data } = await query.limit(100)
        if (!cancelled) {
          setBrandsForClass((data as CDDrug[]) ?? [])
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingBrands(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, selectedClass, item.drug_strength_raw, overrideFilters])

  // Load initial drug details if we have an initialDrugId
  useEffect(() => {
    if (!isOpen || !initialDrugId) return
    ;(async () => {
      try {
        const { data } = await getUserClient()
          .from('cdr_drugs_unique')
          .select('*')
          .eq('id', initialDrugId)
          .single()
        if (data) setConfirmedDrug(data as CDDrug)
      } catch {
        /* ignore */
      }
    })()
  }, [isOpen, initialDrugId])

  // When selectedDrugId changes, update confirmedDrug from available data
  useEffect(() => {
    if (!selectedDrugId) {
      setConfirmedDrug(null)
      return
    }
    const found =
      brandsForClass.find((d) => d.id === selectedDrugId) ??
      drugResults.find((d) => d.id === selectedDrugId)
    if (found) setConfirmedDrug(found)
  }, [selectedDrugId, brandsForClass, drugResults])

  // Drug search
  const searchDrugs = useCallback(async (query: string) => {
    if (query.length < 2) {
      setDrugResults([])
      return
    }
    setSearching(true)
    try {
      const { data } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('*')
        .or(`drug_brand.ilike.%${query}%,drug_class.ilike.%${query}%`)
        .limit(20)
      setDrugResults((data as CDDrug[]) ?? [])
    } catch {
      setDrugResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (drugSearch) searchDrugs(drugSearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [drugSearch, searchDrugs])

  // Handle selecting from text search — clear feedback
  const handleSearchSelect = (drug: CDDrug) => {
    setSelectedDrugId(drug.id)
    setSelectedClass(drug.drug_class)
    setOverrideFilters(true)
    setConfirmedDrug(drug)
    // Close search to show clear feedback
    setShowFallbackSearch(false)
    setDrugSearch('')
    setDrugResults([])
  }

  // Handle selecting from cascade list
  const handleCascadeSelect = (drug: CDDrug) => {
    setSelectedDrugId(drug.id)
    setConfirmedDrug(drug)
  }

  if (!isOpen) return null

  return (
    <div className="edit-drug-overlay" onClick={onCancel}>
      <div className="edit-drug-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="edit-drug-header">
          <h3>🔍 Select Drug</h3>
          <button className="scan-review-close" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="edit-drug-body">
          {/* AI Read reference — always visible at top */}
          <div className="edit-drug-ai-ref">
            <h4>📷 AI Read (for reference)</h4>
            <div className="scan-item-raw">
              <span>
                <strong>Brand:</strong> {item.drug_name_raw ?? '—'}
              </span>
              <span>
                <strong>Class:</strong> {item.drug_class_raw ?? '—'}
              </span>
              <span>
                <strong>Form:</strong> {item.drug_form_raw ?? '—'}
              </span>
              <span>
                <strong>Strength:</strong> {item.drug_strength_raw ?? '—'}
              </span>
              <span>
                <strong>Qty:</strong> {item.quantity ?? '—'}
              </span>
            </div>
          </div>

          {/* Current selection banner */}
          {confirmedDrug && (
            <div className="edit-drug-selected-banner">
              <div className="edit-drug-selected-info">
                <span className="edit-drug-selected-label">✅ Selected:</span>
                <span className="edit-drug-selected-name">{confirmedDrug.drug_brand}</span>
                <span className="edit-drug-selected-detail">
                  {confirmedDrug.drug_form} – {confirmedDrug.drug_strength}
                </span>
                <span className="edit-drug-selected-class">{confirmedDrug.drug_class}</span>
              </div>
              <button
                className="ps-btn ps-btn-ghost ps-btn-xs"
                onClick={() => {
                  setSelectedDrugId('')
                  setConfirmedDrug(null)
                }}
              >
                ✕ Clear
              </button>
            </div>
          )}

          {/* Cascade selector */}
          <div className="edit-drug-selector">
            {/* Step 1: Drug Class */}
            <div className="scan-cascade-field">
              <label>Drug Class (generic name):</label>
              <select
                className="ps-input"
                value={selectedClass}
                onChange={(e) => {
                  setSelectedClass(e.target.value)
                  setSelectedDrugId('')
                  setConfirmedDrug(null)
                  setBrandsForClass([])
                  setShowFallbackSearch(false)
                  setDrugSearch('')
                  setDrugResults([])
                  // Auto-override filters when class changes from AI read
                  if (e.target.value !== item.drug_class_raw) {
                    setOverrideFilters(true)
                  }
                }}
              >
                <option value="">— Select class —</option>
                {allDrugClasses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {item.drug_class_raw && selectedClass !== item.drug_class_raw && (
                <p className="scan-cascade-hint">
                  AI read: <strong>{item.drug_class_raw}</strong>
                </p>
              )}
            </div>

            {/* Step 2: Brand / form / strength */}
            {selectedClass && (
              <div className="scan-cascade-field">
                <label>
                  Select Brand &amp; Form
                  {!overrideFilters && item.drug_strength_raw && (
                    <span className="scan-cascade-filter-tag">{item.drug_strength_raw}</span>
                  )}
                  {!overrideFilters && item.drug_form_raw && (
                    <span className="scan-cascade-filter-tag">{item.drug_form_raw}</span>
                  )}
                  {overrideFilters && (
                    <span className="scan-cascade-filter-tag override">
                      All strengths &amp; forms
                    </span>
                  )}
                </label>
                <div className="scan-filter-toggle">
                  <button
                    className="ps-btn ps-btn-ghost ps-btn-xs"
                    onClick={() => {
                      setOverrideFilters((v) => !v)
                      setSelectedDrugId('')
                      setConfirmedDrug(null)
                    }}
                  >
                    {overrideFilters
                      ? '🔒 Filter to AI read'
                      : '🔓 Show all strengths & forms'}
                  </button>
                </div>
                {loadingBrands ? (
                  <p className="scan-cascade-loading">Loading options...</p>
                ) : brandsForClass.length === 0 ? (
                  <p className="scan-cascade-empty">
                    No drugs found for {selectedClass}
                    {!overrideFilters && item.drug_strength_raw
                      ? ` ${item.drug_strength_raw}`
                      : ''}
                    .
                    {!overrideFilters ? (
                      <button
                        className="ps-btn ps-btn-ghost ps-btn-xs"
                        onClick={() => setOverrideFilters(true)}
                        style={{ marginLeft: 8 }}
                      >
                        Show all strengths
                      </button>
                    ) : (
                      ' Try the text search below.'
                    )}
                  </p>
                ) : (
                  <div className="scan-drug-results">
                    {brandsForClass.map((drug) => {
                      const isExactFormMatch =
                        drug.drug_form.toLowerCase() ===
                        (item.drug_form_raw ?? '').toLowerCase()
                      return (
                        <button
                          key={drug.id}
                          className={`scan-drug-result ${drug.id === selectedDrugId ? 'selected' : ''} ${isExactFormMatch ? 'form-match' : ''}`}
                          onClick={() => handleCascadeSelect(drug)}
                        >
                          <span className="scan-drug-name">{drug.drug_brand}</span>
                          <span className="scan-drug-detail">
                            {drug.drug_form} – {drug.drug_strength}
                          </span>
                          {isExactFormMatch && (
                            <span className="scan-form-match-tag">exact form match</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fallback: free text search */}
          <div className="scan-cascade-fallback">
            <button
              className="ps-btn ps-btn-ghost ps-btn-sm"
              onClick={() => {
                setShowFallbackSearch(!showFallbackSearch)
                if (showFallbackSearch) {
                  setDrugSearch('')
                  setDrugResults([])
                }
              }}
            >
              {showFallbackSearch
                ? '▾ Hide text search'
                : "▸ Can't find it? Search by name"}
            </button>
            {showFallbackSearch && (
              <div className="scan-fallback-search">
                <input
                  type="text"
                  className="ps-input"
                  placeholder="Search by drug name or class..."
                  value={drugSearch}
                  onChange={(e) => setDrugSearch(e.target.value)}
                  autoFocus
                />
                {searching && <p className="scan-searching">Searching...</p>}
                {drugResults.length > 0 && (
                  <div className="scan-drug-results">
                    {drugResults.map((drug) => (
                      <button
                        key={drug.id}
                        className={`scan-drug-result ${drug.id === selectedDrugId ? 'selected' : ''}`}
                        onClick={() => handleSearchSelect(drug)}
                      >
                        <span className="scan-drug-name">{drug.drug_brand}</span>
                        <span className="scan-drug-detail">
                          {drug.drug_form} – {drug.drug_strength}
                        </span>
                        <span className="scan-drug-class">{drug.drug_class}</span>
                      </button>
                    ))}
                  </div>
                )}
                {drugSearch.length >= 2 && !searching && drugResults.length === 0 && (
                  <p className="scan-cascade-empty">No results for "{drugSearch}"</p>
                )}
              </div>
            )}
          </div>

          {/* Quantity */}
          <div className="edit-drug-quantity">
            <label>Quantity:</label>
            <input
              type="number"
              className="ps-input"
              value={editQuantity}
              onChange={(e) => setEditQuantity(Number(e.target.value))}
              min={0.01}
              step="any"
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="edit-drug-footer">
          <button
            className="ps-btn ps-btn-primary"
            onClick={() => onSave(selectedDrugId, editQuantity)}
            disabled={!selectedDrugId}
          >
            💾 Save Selection
          </button>
          <button className="ps-btn ps-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
