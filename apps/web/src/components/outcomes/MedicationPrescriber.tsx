import { useState, useEffect, useCallback, useRef } from 'react'
import { usePatientMedicationStore } from '@pharmstation/core'
import type { BnfDrugSearchResult } from '@pharmstation/types'

/**
 * A single medication item in the prescriber list.
 * This is a local working type (not persisted until saved).
 */
export interface PrescribedMedication {
  localId: string
  drug: BnfDrugSearchResult | null
  drug_name: string
  drug_form: string | null
  drug_strength: string | null
  dose: string
  quantity: number | null
  unit: string
  directions: string
  supply_type: 'dispensed' | 'owed' | 'not_supplied'
  is_controlled_drug: boolean
}

export interface MedicationPrescriberProps {
  /** Controlled value — list of prescribed medications */
  value: PrescribedMedication[]
  /** Called whenever the list changes */
  onChange: (medications: PrescribedMedication[]) => void
  /** Max number of medications allowed (e.g. 4 for emergency supply). 0 = unlimited */
  maxItems?: number
  /** Label shown above the component */
  label?: string
  /** Whether the component is read-only */
  readOnly?: boolean
}

let _localIdCounter = 0
function nextLocalId() {
  return `med_${Date.now()}_${++_localIdCounter}`
}

export function createEmptyMedication(): PrescribedMedication {
  return {
    localId: nextLocalId(),
    drug: null,
    drug_name: '',
    drug_form: null,
    drug_strength: null,
    dose: '',
    quantity: null,
    unit: 'tablets',
    directions: '',
    supply_type: 'dispensed',
    is_controlled_drug: false,
  }
}

export function MedicationPrescriber({
  value,
  onChange,
  maxItems = 0,
  label = 'Medications',
  readOnly = false,
}: MedicationPrescriberProps) {
  const { searchDrugs, drugSearchResults, searching, clearSearch } = usePatientMedicationStore()

  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Debounced drug search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      clearSearch()
      return
    }
    const timer = setTimeout(() => {
      searchDrugs(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, searchDrugs, clearSearch])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveIndex(null)
        setSearchQuery('')
        clearSearch()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [clearSearch])

  const updateItem = useCallback(
    (index: number, updates: Partial<PrescribedMedication>) => {
      const next = value.map((item, i) => (i === index ? { ...item, ...updates } : item))
      onChange(next)
    },
    [value, onChange]
  )

  const addItem = useCallback(() => {
    if (maxItems > 0 && value.length >= maxItems) return
    onChange([...value, createEmptyMedication()])
  }, [value, onChange, maxItems])

  const removeItem = useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index))
    },
    [value, onChange]
  )

  const selectDrug = useCallback(
    (index: number, drug: BnfDrugSearchResult) => {
      updateItem(index, {
        drug,
        drug_name: drug.name,
        drug_form: drug.form,
        drug_strength: null, // Strength is part of the name in BNF data
        is_controlled_drug: !!drug.controlledDrugSchedule,
      })
      setActiveIndex(null)
      setSearchQuery('')
      clearSearch()
    },
    [updateItem, clearSearch]
  )

  const canAddMore = maxItems === 0 || value.length < maxItems

  return (
    <div className="medication-prescriber">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
        <label style={{ fontWeight: 600, color: 'var(--ps-midnight)', fontSize: '14px' }}>
          {label}
          {maxItems > 0 && (
            <span style={{ fontWeight: 400, color: 'var(--ps-slate)', marginLeft: '8px' }}>
              ({value.length}/{maxItems})
            </span>
          )}
        </label>
        {!readOnly && canAddMore && (
          <button
            type="button"
            className="ps-btn ps-btn-secondary"
            style={{ fontSize: '13px', padding: '4px 12px' }}
            onClick={addItem}
          >
            + Add Medication
          </button>
        )}
      </div>

      {value.length === 0 && (
        <div
          style={{
            padding: 'var(--ps-space-lg)',
            textAlign: 'center',
            color: 'var(--ps-slate)',
            border: '2px dashed var(--ps-border)',
            borderRadius: 'var(--ps-radius-md)',
            fontSize: '14px',
          }}
        >
          No medications added yet.
          {!readOnly && canAddMore && (
            <>
              {' '}
              <button
                type="button"
                onClick={addItem}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ps-primary)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontSize: '14px',
                }}
              >
                Add one
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
        {value.map((item, index) => (
          <div
            key={item.localId}
            style={{
              border: '1px solid var(--ps-border)',
              borderRadius: 'var(--ps-radius-md)',
              padding: 'var(--ps-space-md)',
              background: 'var(--ps-bg-subtle, #f9fafb)',
              position: 'relative',
            }}
          >
            {/* Header row with number and remove */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
              <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--ps-midnight)' }}>
                #{index + 1}
                {item.is_controlled_drug && (
                  <span
                    style={{
                      marginLeft: '8px',
                      background: '#fef3c7',
                      color: '#92400e',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    CD
                  </span>
                )}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--ps-danger, #dc2626)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    padding: '2px 6px',
                  }}
                >
                  ✕ Remove
                </button>
              )}
            </div>

            {/* Drug search / selected drug */}
            <div style={{ marginBottom: 'var(--ps-space-sm)', position: 'relative' }} ref={activeIndex === index ? dropdownRef : undefined}>
              <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
                Drug
              </label>
              {item.drug ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    border: '1px solid var(--ps-primary)',
                    borderRadius: 'var(--ps-radius-sm)',
                    background: '#f0f9ff',
                    fontSize: '13px',
                  }}
                >
                  <div>
                    <strong>{item.drug.name}</strong>
                    {item.drug.form && (
                      <span style={{ color: 'var(--ps-slate)', marginLeft: '8px' }}>{item.drug.form}</span>
                    )}
                    {item.drug.brand_name && (
                      <span style={{ color: 'var(--ps-slate)', marginLeft: '8px', fontStyle: 'italic' }}>
                        ({item.drug.brand_name})
                      </span>
                    )}
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        updateItem(index, {
                          drug: null,
                          drug_name: '',
                          drug_form: null,
                          drug_strength: null,
                          is_controlled_drug: false,
                        })
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--ps-primary)',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    className="ps-input"
                    placeholder="Search drugs (e.g. Amoxicillin, Paracetamol)..."
                    value={activeIndex === index ? searchQuery : item.drug_name}
                    readOnly={readOnly}
                    onChange={(e) => {
                      setActiveIndex(index)
                      setSearchQuery(e.target.value)
                      updateItem(index, { drug_name: e.target.value })
                    }}
                    onFocus={() => setActiveIndex(index)}
                    style={{ width: '100%' }}
                  />
                  {/* Search results dropdown */}
                  {activeIndex === index && (searchQuery.length >= 2) && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid var(--ps-border)',
                        borderRadius: 'var(--ps-radius-sm)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        maxHeight: '240px',
                        overflowY: 'auto',
                        zIndex: 50,
                      }}
                    >
                      {searching && (
                        <div style={{ padding: '12px', color: 'var(--ps-slate)', fontSize: '13px' }}>
                          Searching...
                        </div>
                      )}
                      {!searching && drugSearchResults.length === 0 && (
                        <div style={{ padding: '12px', color: 'var(--ps-slate)', fontSize: '13px' }}>
                          No results found
                        </div>
                      )}
                      {drugSearchResults.map((drug) => (
                        <div
                          key={drug.id}
                          onClick={() => selectDrug(index, drug)}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--ps-border)',
                            fontSize: '13px',
                          }}
                          onMouseEnter={(e) => {
                            ;(e.currentTarget as HTMLDivElement).style.background = '#f0f9ff'
                          }}
                          onMouseLeave={(e) => {
                            ;(e.currentTarget as HTMLDivElement).style.background = ''
                          }}
                        >
                          <div style={{ fontWeight: 500 }}>{drug.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--ps-slate)' }}>
                            {[drug.form, drug.brand_name, drug.manufacturer].filter(Boolean).join(' · ')}
                            {drug.controlledDrugSchedule && (
                              <span style={{ marginLeft: '6px', color: '#92400e', fontWeight: 600 }}>
                                {drug.controlledDrugSchedule}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Dose, Quantity, Unit — inline row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-sm)' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
                  Dose
                </label>
                <input
                  type="text"
                  className="ps-input"
                  placeholder="e.g. 500mg"
                  value={item.dose}
                  readOnly={readOnly}
                  onChange={(e) => updateItem(index, { dose: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
                  Quantity
                </label>
                <input
                  type="number"
                  className="ps-input"
                  min={1}
                  value={item.quantity ?? ''}
                  readOnly={readOnly}
                  onChange={(e) => updateItem(index, { quantity: e.target.value ? Number(e.target.value) : null })}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
                  Unit
                </label>
                <select
                  className="ps-input"
                  value={item.unit}
                  disabled={readOnly}
                  onChange={(e) => updateItem(index, { unit: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="tablets">Tablets</option>
                  <option value="capsules">Capsules</option>
                  <option value="ml">ml</option>
                  <option value="sachets">Sachets</option>
                  <option value="doses">Doses</option>
                  <option value="patches">Patches</option>
                  <option value="inhalers">Inhalers</option>
                  <option value="tubes">Tubes</option>
                  <option value="bottles">Bottles</option>
                  <option value="packs">Packs</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            {/* Directions */}
            <div style={{ marginBottom: 'var(--ps-space-sm)' }}>
              <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
                Directions
              </label>
              <input
                type="text"
                className="ps-input"
                placeholder="e.g. Take one three times a day after meals"
                value={item.directions}
                readOnly={readOnly}
                onChange={(e) => updateItem(index, { directions: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>

            {/* Supply type */}
            <div>
              <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
                Supply Status
              </label>
              <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
                {(['dispensed', 'owed', 'not_supplied'] as const).map((st) => (
                  <label
                    key={st}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '13px',
                      cursor: readOnly ? 'default' : 'pointer',
                      color: item.supply_type === st ? 'var(--ps-primary)' : 'var(--ps-slate)',
                    }}
                  >
                    <input
                      type="radio"
                      name={`supply_${item.localId}`}
                      checked={item.supply_type === st}
                      disabled={readOnly}
                      onChange={() => updateItem(index, { supply_type: st })}
                    />
                    {st === 'dispensed' ? 'Dispensed' : st === 'owed' ? 'Owed' : 'Not Supplied'}
                  </label>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
