// ============================================
// Autocomplete — reusable debounced typeahead with optional "add new".
// Used across PEPS (patient / prescriber / prescribing org / pharmacy / drug).
// ============================================

import { useEffect, useRef, useState, useCallback } from 'react'

interface AutocompleteProps<T> {
  value: string
  onChange: (text: string) => void
  onSearch: (query: string) => Promise<T[]>
  onSelect: (item: T) => void
  getLabel: (item: T) => string
  getDetail?: (item: T) => string | null
  getKey: (item: T) => string
  placeholder?: string
  minChars?: number
  disabled?: boolean
  // Optional "add new" affordance shown at the bottom of the dropdown
  addNewLabel?: string
  onAddNew?: (currentText: string) => void
  className?: string
  inputClassName?: string
  autoFocus?: boolean
}

export function Autocomplete<T>({
  value,
  onChange,
  onSearch,
  onSelect,
  getLabel,
  getDetail,
  getKey,
  placeholder,
  minChars = 2,
  disabled,
  addNewLabel,
  onAddNew,
  className,
  inputClassName,
  autoFocus,
}: AutocompleteProps<T>) {
  const [suggestions, setSuggestions] = useState<T[]>([])
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (query.trim().length < minChars) {
        setSuggestions([])
        return
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true)
        try {
          const results = await onSearch(query)
          setSuggestions(results)
        } catch {
          setSuggestions([])
        } finally {
          setLoading(false)
        }
      }, 280)
    },
    [onSearch, minChars],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (blurTimeout.current) clearTimeout(blurTimeout.current)
    }
  }, [])

  const handleInput = (text: string) => {
    onChange(text)
    setShow(true)
    runSearch(text)
  }

  const handleSelect = (item: T) => {
    onSelect(item)
    setShow(false)
    setSuggestions([])
  }

  return (
    <div className={`autocomplete-group ${className ?? ''}`}>
      <input
        className={inputClassName ?? 'ps-input'}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setShow(true)
        }}
        onBlur={() => {
          // Delay so a click on a suggestion registers first
          blurTimeout.current = setTimeout(() => setShow(false), 180)
        }}
      />
      {show && (suggestions.length > 0 || loading || (addNewLabel && value.trim().length >= minChars)) && (
        <div className="autocomplete-dropdown">
          {loading && suggestions.length === 0 && (
            <div className="autocomplete-item" style={{ cursor: 'default', color: 'var(--ps-mist)' }}>
              Searching…
            </div>
          )}
          {suggestions.map((item) => {
            const detail = getDetail?.(item)
            return (
              <button
                key={getKey(item)}
                type="button"
                className="autocomplete-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(item)}
              >
                <span className="autocomplete-name">{getLabel(item)}</span>
                {detail && <span className="autocomplete-detail">{detail}</span>}
              </button>
            )
          })}
          {addNewLabel && onAddNew && value.trim().length >= minChars && (
            <button
              type="button"
              className="autocomplete-item autocomplete-add-new"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShow(false)
                onAddNew(value)
              }}
              style={{ color: 'var(--ps-deep-blue)', fontWeight: 600 }}
            >
              <span className="autocomplete-name">＋ {addNewLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
