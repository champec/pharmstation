// ============================================
// CDEntryForm — Simplified IN/OUT entry form
// IN = receipt from supplier (supplier + invoice + qty)
// OUT = supply to patient (patient, prescriber, collector, ID check, qty)
// ============================================

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState, useEffect, useCallback } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { KnownContact, RegisterEntry } from '@pharmstation/types'

// Schema changes based on direction (IN vs OUT)
const cdInSchema = z.object({
  direction: z.literal('in'),
  date_of_transaction: z.string().min(1, 'Date is required'),
  supplier_name: z.string().min(1, 'Supplier is required'),
  invoice_number: z.string().optional().nullable(),
  quantity: z.coerce.number().min(0.01, 'Quantity must be greater than 0'),
  notes: z.string().optional().nullable(),
})

const cdOutSchema = z.object({
  direction: z.literal('out'),
  date_of_transaction: z.string().min(1, 'Date is required'),
  patient_name: z.string().min(1, 'Patient name is required'),
  patient_address: z.string().optional().nullable(),
  prescriber_name: z.string().min(1, 'Prescriber is required'),
  prescriber_address: z.string().optional().nullable(),
  collector_name: z.string().optional().nullable(),
  was_id_requested: z.boolean(),
  was_id_provided: z.boolean(),
  quantity: z.coerce.number().min(0.01, 'Quantity must be greater than 0'),
  notes: z.string().optional().nullable(),
})

const cdEntrySchema = z.discriminatedUnion('direction', [cdInSchema, cdOutSchema])

type CDEntryFormData = z.infer<typeof cdEntrySchema>

interface CDEntryFormProps {
  direction: 'in' | 'out'
  onSuccess: (entry: RegisterEntry) => void
  onCancel: () => void
}

export function CDEntryForm({ direction, onSuccess, onCancel }: CDEntryFormProps) {
  const { organisation, activeUser } = useAuthStore()
  const { activeLedger, lastUsedValues, setLastUsedValue } = useRegisterStore()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [patientSuggestions, setPatientSuggestions] = useState<KnownContact[]>([])
  const [prescriberSuggestions, setPrescriberSuggestions] = useState<KnownContact[]>([])
  const [supplierSuggestions, setSupplierSuggestions] = useState<KnownContact[]>([])
  const [showPatientSuggest, setShowPatientSuggest] = useState(false)
  const [showPrescriberSuggest, setShowPrescriberSuggest] = useState(false)
  const [showSupplierSuggest, setShowSupplierSuggest] = useState(false)

  const defaultValues: CDEntryFormData = direction === 'in'
    ? {
        direction: 'in',
        date_of_transaction: new Date().toISOString().split('T')[0],
        supplier_name: lastUsedValues.supplier_name ?? '',
        invoice_number: '',
        quantity: 0,
        notes: '',
      }
    : {
        direction: 'out',
        date_of_transaction: new Date().toISOString().split('T')[0],
        patient_name: '',
        patient_address: '',
        prescriber_name: lastUsedValues.prescriber_name ?? '',
        prescriber_address: lastUsedValues.prescriber_address ?? '',
        collector_name: '',
        was_id_requested: false,
        was_id_provided: false,
        quantity: 0,
        notes: '',
      }

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CDEntryFormData>({
    resolver: zodResolver(direction === 'in' ? cdInSchema : cdOutSchema),
    defaultValues,
  })

  // Auto-complete search for contacts
  const searchContacts = useCallback(
    async (query: string, type: 'patient' | 'prescriber' | 'supplier') => {
      if (!organisation || query.length < 2) {
        if (type === 'patient') setPatientSuggestions([])
        else if (type === 'prescriber') setPrescriberSuggestions([])
        else setSupplierSuggestions([])
        return
      }
      const { data } = await getUserClient()
        .from('ps_known_contacts')
        .select('*')
        .eq('organisation_id', organisation.id)
        .eq('contact_type', type)
        .ilike('search_key', `%${query.toLowerCase()}%`)
        .order('usage_count', { ascending: false })
        .limit(5)

      if (data) {
        if (type === 'patient') setPatientSuggestions(data)
        else if (type === 'prescriber') setPrescriberSuggestions(data)
        else setSupplierSuggestions(data)
      }
    },
    [organisation],
  )

  // Debounced search for each contact field
  const watchedValues = watch()

  useEffect(() => {
    if (direction !== 'out') return
    const val = (watchedValues as z.infer<typeof cdOutSchema>).patient_name
    const timer = setTimeout(() => {
      if (val && val.length >= 2) searchContacts(val, 'patient')
      else setPatientSuggestions([])
    }, 300)
    return () => clearTimeout(timer)
  }, [direction, (watchedValues as z.infer<typeof cdOutSchema>).patient_name, searchContacts])

  useEffect(() => {
    if (direction !== 'out') return
    const val = (watchedValues as z.infer<typeof cdOutSchema>).prescriber_name
    const timer = setTimeout(() => {
      if (val && val.length >= 2) searchContacts(val, 'prescriber')
      else setPrescriberSuggestions([])
    }, 300)
    return () => clearTimeout(timer)
  }, [direction, (watchedValues as z.infer<typeof cdOutSchema>).prescriber_name, searchContacts])

  useEffect(() => {
    if (direction !== 'in') return
    const val = (watchedValues as z.infer<typeof cdInSchema>).supplier_name
    const timer = setTimeout(() => {
      if (val && val.length >= 2) searchContacts(val, 'supplier')
      else setSupplierSuggestions([])
    }, 300)
    return () => clearTimeout(timer)
  }, [direction, (watchedValues as z.infer<typeof cdInSchema>).supplier_name, searchContacts])

  const selectContact = (contact: KnownContact, type: 'patient' | 'prescriber' | 'supplier') => {
    if (type === 'patient') {
      setValue('patient_name' as keyof CDEntryFormData, contact.full_name)
      setValue(
        'patient_address' as keyof CDEntryFormData,
        [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '),
      )
      // Auto-suggest prescriber for this patient
      if (contact.full_name) {
        searchContacts(contact.full_name, 'prescriber')
      }
      setShowPatientSuggest(false)
      setPatientSuggestions([])
    } else if (type === 'prescriber') {
      setValue('prescriber_name' as keyof CDEntryFormData, contact.full_name)
      setValue(
        'prescriber_address' as keyof CDEntryFormData,
        [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '),
      )
      setShowPrescriberSuggest(false)
      setPrescriberSuggestions([])
    } else {
      setValue('supplier_name' as keyof CDEntryFormData, contact.full_name)
      setShowSupplierSuggest(false)
      setSupplierSuggestions([])
    }
  }

  const onSubmit = async (data: CDEntryFormData) => {
    if (!activeLedger || !activeUser) return
    setSubmitting(true)
    setSubmitError(null)

    try {
      const isIn = data.direction === 'in'
      const rpcParams: Record<string, unknown> = {
        p_ledger_id: activeLedger.id,
        p_register_type: activeLedger.register_type,
        p_entry_type: 'normal',
        p_date_of_transaction: data.date_of_transaction,
        p_notes: data.notes || null,
        p_source: 'manual',
        p_expected_lock_version: activeLedger.lock_version,
        p_transaction_type: isIn ? 'receipt' : 'supply',
        p_quantity_received: isIn ? data.quantity : null,
        p_quantity_deducted: isIn ? null : data.quantity,
        p_entered_by: activeUser.id,
        // IN fields
        p_supplier_name: isIn ? (data as z.infer<typeof cdInSchema>).supplier_name : null,
        p_invoice_number: isIn ? (data as z.infer<typeof cdInSchema>).invoice_number || null : null,
        // OUT fields
        p_patient_name: !isIn ? (data as z.infer<typeof cdOutSchema>).patient_name : null,
        p_patient_address: !isIn ? (data as z.infer<typeof cdOutSchema>).patient_address || null : null,
        p_prescriber_name: !isIn ? (data as z.infer<typeof cdOutSchema>).prescriber_name : null,
        p_prescriber_address: !isIn ? (data as z.infer<typeof cdOutSchema>).prescriber_address || null : null,
        p_prescription_date: null,
        p_witness_name: null,
        p_witness_role: null,
        p_authorised_by: activeUser.full_name,
      }

      const { data: entry, error } = await getUserClient().rpc('ps_make_register_entry', rpcParams)

      if (error) {
        if (error.message.includes('CONFLICT')) {
          setSubmitError('Another entry was made while you were editing. Refresh the ledger and try again.')
        } else {
          setSubmitError(error.message)
        }
        return
      }

      // Save frequently used values
      if (isIn) {
        setLastUsedValue('supplier_name', (data as z.infer<typeof cdInSchema>).supplier_name)
      } else {
        const outData = data as z.infer<typeof cdOutSchema>
        if (outData.prescriber_name) setLastUsedValue('prescriber_name', outData.prescriber_name)
        if (outData.prescriber_address) setLastUsedValue('prescriber_address', outData.prescriber_address)
      }

      onSuccess(entry as RegisterEntry)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create entry')
    } finally {
      setSubmitting(false)
    }
  }

  if (!activeLedger) return null

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="cd-entry-form">
      {/* Drug info header */}
      <div className="entry-form-drug-info">
        <strong>{activeLedger.drug_name}</strong>
        <span>{activeLedger.drug_form} — {activeLedger.drug_strength}</span>
        <span className="ps-badge ps-badge-blue">Balance: {activeLedger.current_balance}</span>
      </div>

      <div className={`entry-direction-badge ${direction === 'in' ? 'entry-in' : 'entry-out'}`}>
        {direction === 'in' ? '📥 Received IN' : '📤 Supplied OUT'}
      </div>

      {submitError && <div className="auth-error">{submitError}</div>}

      {/* Date */}
      <div className="form-group">
        <label>Date of Transaction *</label>
        <input type="date" className="ps-input" {...register('date_of_transaction')} />
        {errors.date_of_transaction && <div className="form-error">{errors.date_of_transaction.message}</div>}
      </div>

      {/* === IN FIELDS === */}
      {direction === 'in' && (
        <>
          <div className="form-row">
            <div className="form-group autocomplete-group">
              <label>Supplier *</label>
              <input
                className="ps-input"
                placeholder="e.g. Alliance Healthcare"
                {...register('supplier_name')}
                onFocus={() => setShowSupplierSuggest(true)}
                onBlur={() => setTimeout(() => setShowSupplierSuggest(false), 200)}
              />
              {showSupplierSuggest && supplierSuggestions.length > 0 && (
                <div className="autocomplete-dropdown">
                  {supplierSuggestions.map((c) => (
                    <button key={c.id} type="button" className="autocomplete-item" onClick={() => selectContact(c, 'supplier')}>
                      <span className="autocomplete-name">{c.full_name}</span>
                    </button>
                  ))}
                </div>
              )}
              {(errors as Record<string, { message?: string }>).supplier_name && (
                <div className="form-error">{(errors as Record<string, { message?: string }>).supplier_name?.message}</div>
              )}
            </div>
            <div className="form-group">
              <label>Invoice Number</label>
              <input className="ps-input" placeholder="e.g. INV-12345" {...register('invoice_number')} />
            </div>
          </div>

          <div className="form-group">
            <label>Quantity Received *</label>
            <input type="number" className="ps-input" step="any" min="0" {...register('quantity')} />
            {errors.quantity && <div className="form-error">{errors.quantity.message}</div>}
          </div>
        </>
      )}

      {/* === OUT FIELDS === */}
      {direction === 'out' && (
        <>
          {/* Patient */}
          <div className="form-row">
            <div className="form-group autocomplete-group">
              <label>Patient Name *</label>
              <input
                className="ps-input"
                placeholder="Start typing..."
                {...register('patient_name')}
                onFocus={() => setShowPatientSuggest(true)}
                onBlur={() => setTimeout(() => setShowPatientSuggest(false), 200)}
              />
              {showPatientSuggest && patientSuggestions.length > 0 && (
                <div className="autocomplete-dropdown">
                  {patientSuggestions.map((c) => (
                    <button key={c.id} type="button" className="autocomplete-item" onClick={() => selectContact(c, 'patient')}>
                      <span className="autocomplete-name">{c.full_name}</span>
                      {c.postcode && <span className="autocomplete-detail">{c.postcode}</span>}
                    </button>
                  ))}
                </div>
              )}
              {(errors as Record<string, { message?: string }>).patient_name && (
                <div className="form-error">{(errors as Record<string, { message?: string }>).patient_name?.message}</div>
              )}
            </div>
            <div className="form-group">
              <label>Patient Address</label>
              <input className="ps-input" {...register('patient_address')} />
            </div>
          </div>

          {/* Prescriber */}
          <div className="form-row">
            <div className="form-group autocomplete-group">
              <label>Prescriber *</label>
              <input
                className="ps-input"
                placeholder="Start typing..."
                {...register('prescriber_name')}
                onFocus={() => setShowPrescriberSuggest(true)}
                onBlur={() => setTimeout(() => setShowPrescriberSuggest(false), 200)}
              />
              {showPrescriberSuggest && prescriberSuggestions.length > 0 && (
                <div className="autocomplete-dropdown">
                  {prescriberSuggestions.map((c) => (
                    <button key={c.id} type="button" className="autocomplete-item" onClick={() => selectContact(c, 'prescriber')}>
                      <span className="autocomplete-name">{c.full_name}</span>
                      {c.postcode && <span className="autocomplete-detail">{c.postcode}</span>}
                    </button>
                  ))}
                </div>
              )}
              {(errors as Record<string, { message?: string }>).prescriber_name && (
                <div className="form-error">{(errors as Record<string, { message?: string }>).prescriber_name?.message}</div>
              )}
            </div>
            <div className="form-group">
              <label>Prescriber Address</label>
              <input className="ps-input" {...register('prescriber_address')} />
            </div>
          </div>

          {/* Collector */}
          <div className="form-group">
            <label>Person Collecting</label>
            <input className="ps-input" placeholder="Name of collector (if different from patient)" {...register('collector_name')} />
          </div>

          {/* ID Check */}
          <div className="form-row">
            <div className="form-group">
              <label className="checkbox-label">
                <input type="checkbox" {...register('was_id_requested')} />
                <span>ID Requested?</span>
              </label>
            </div>
            <div className="form-group">
              <label className="checkbox-label">
                <input type="checkbox" {...register('was_id_provided')} />
                <span>ID Provided?</span>
              </label>
            </div>
          </div>

          {/* Quantity */}
          <div className="form-group">
            <label>Quantity Supplied *</label>
            <input type="number" className="ps-input" step="any" min="0" {...register('quantity')} />
            {errors.quantity && <div className="form-error">{errors.quantity.message}</div>}
          </div>
        </>
      )}

      {/* Entered by — auto-filled, read-only */}
      <div className="form-group">
        <label>Entered By</label>
        <input className="ps-input" value={activeUser?.full_name ?? ''} readOnly disabled />
      </div>

      {/* Notes */}
      <div className="form-group">
        <label>Notes</label>
        <textarea
          className="ps-input"
          rows={2}
          placeholder="Optional notes..."
          {...register('notes')}
          style={{ resize: 'vertical' }}
        />
      </div>

      {/* Actions */}
      <div className="form-actions">
        <button type="button" className="ps-btn ps-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={`ps-btn ${direction === 'in' ? 'ps-btn-success' : 'ps-btn-primary'}`}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : direction === 'in' ? '📥 Record Receipt' : '📤 Record Supply'}
        </button>
      </div>
    </form>
  )
}
