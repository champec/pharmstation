// ============================================
// CDEntryForm — React Hook Form + Zod
// Form for adding a new CD register entry
// ============================================

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState, useEffect, useCallback } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { KnownContact, RegisterEntry, TransactionType } from '@pharmstation/types'

const cdEntrySchema = z.object({
  transaction_type: z.enum([
    'receipt', 'supply', 'return_to_supplier', 'patient_return',
    'disposal', 'transfer_in', 'transfer_out',
  ] as const),
  date_of_transaction: z.string().min(1, 'Date is required'),
  quantity_received: z.coerce.number().min(0).optional().nullable(),
  quantity_deducted: z.coerce.number().min(0).optional().nullable(),
  supplier_name: z.string().optional().nullable(),
  invoice_number: z.string().optional().nullable(),
  patient_name: z.string().optional().nullable(),
  patient_address: z.string().optional().nullable(),
  prescriber_name: z.string().optional().nullable(),
  prescriber_address: z.string().optional().nullable(),
  prescription_date: z.string().optional().nullable(),
  witness_name: z.string().optional().nullable(),
  witness_role: z.string().optional().nullable(),
  authorised_by: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
}).superRefine((data, ctx) => {
  const receiptTypes: TransactionType[] = ['receipt', 'transfer_in', 'patient_return']
  const deductTypes: TransactionType[] = ['supply', 'return_to_supplier', 'disposal', 'transfer_out']

  if (receiptTypes.includes(data.transaction_type)) {
    if (!data.quantity_received || data.quantity_received <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quantity received is required for receipts',
        path: ['quantity_received'],
      })
    }
  }
  if (deductTypes.includes(data.transaction_type)) {
    if (!data.quantity_deducted || data.quantity_deducted <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quantity deducted is required for supplies/disposals',
        path: ['quantity_deducted'],
      })
    }
  }
  if (data.transaction_type === 'supply') {
    if (!data.patient_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Patient name is required for supplies',
        path: ['patient_name'],
      })
    }
    if (!data.prescriber_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Prescriber name is required for supplies',
        path: ['prescriber_name'],
      })
    }
  }
})

type CDEntryFormData = z.infer<typeof cdEntrySchema>

interface CDEntryFormProps {
  onSuccess: (entry: RegisterEntry) => void
  onCancel: () => void
}

const RECEIPT_TYPES: TransactionType[] = ['receipt', 'transfer_in', 'patient_return']

export function CDEntryForm({ onSuccess, onCancel }: CDEntryFormProps) {
  const { organisation, activeUser } = useAuthStore()
  const { activeLedger, lastUsedValues, setLastUsedValue } = useRegisterStore()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [patientSuggestions, setPatientSuggestions] = useState<KnownContact[]>([])
  const [prescriberSuggestions, setPrescriberSuggestions] = useState<KnownContact[]>([])
  const [showPatientSuggest, setShowPatientSuggest] = useState(false)
  const [showPrescriberSuggest, setShowPrescriberSuggest] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CDEntryFormData>({
    resolver: zodResolver(cdEntrySchema),
    defaultValues: {
      transaction_type: 'receipt',
      date_of_transaction: new Date().toISOString().split('T')[0],
      quantity_received: null,
      quantity_deducted: null,
      supplier_name: lastUsedValues.supplier_name ?? '',
      invoice_number: '',
      patient_name: '',
      patient_address: '',
      prescriber_name: lastUsedValues.prescriber_name ?? '',
      prescriber_address: lastUsedValues.prescriber_address ?? '',
      prescription_date: '',
      witness_name: '',
      witness_role: '',
      authorised_by: activeUser?.full_name ?? '',
      notes: '',
    },
  })

  const transactionType = watch('transaction_type')
  const isReceipt = RECEIPT_TYPES.includes(transactionType)
  const isSupply = transactionType === 'supply'
  const isDisposal = transactionType === 'disposal'

  // Auto-complete search for contacts
  const searchContacts = useCallback(async (query: string, type: 'patient' | 'prescriber') => {
    if (!organisation || query.length < 2) {
      type === 'patient' ? setPatientSuggestions([]) : setPrescriberSuggestions([])
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
      type === 'patient' ? setPatientSuggestions(data) : setPrescriberSuggestions(data)
    }
  }, [organisation])

  const patientName = watch('patient_name')
  const prescriberName = watch('prescriber_name')

  useEffect(() => {
    const timer = setTimeout(() => {
      if (patientName && patientName.length >= 2) {
        searchContacts(patientName, 'patient')
      } else {
        setPatientSuggestions([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [patientName, searchContacts])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (prescriberName && prescriberName.length >= 2) {
        searchContacts(prescriberName, 'prescriber')
      } else {
        setPrescriberSuggestions([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [prescriberName, searchContacts])

  const selectContact = (contact: KnownContact, type: 'patient' | 'prescriber') => {
    if (type === 'patient') {
      setValue('patient_name', contact.full_name)
      setValue('patient_address', [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '))
      setShowPatientSuggest(false)
      setPatientSuggestions([])
    } else {
      setValue('prescriber_name', contact.full_name)
      setValue('prescriber_address', [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '))
      setShowPrescriberSuggest(false)
      setPrescriberSuggestions([])
    }
  }

  const onSubmit = async (data: CDEntryFormData) => {
    if (!activeLedger || !activeUser) return
    setSubmitting(true)
    setSubmitError(null)

    try {
      const { data: entry, error } = await getUserClient().rpc('ps_make_register_entry', {
        p_ledger_id: activeLedger.id,
        p_register_type: activeLedger.register_type,
        p_entry_type: 'normal',
        p_date_of_transaction: data.date_of_transaction,
        p_notes: data.notes || null,
        p_source: 'manual',
        p_expected_lock_version: activeLedger.lock_version,
        p_transaction_type: data.transaction_type,
        p_quantity_received: isReceipt ? data.quantity_received : null,
        p_quantity_deducted: !isReceipt ? data.quantity_deducted : null,
        p_supplier_name: data.supplier_name || null,
        p_invoice_number: data.invoice_number || null,
        p_patient_name: data.patient_name || null,
        p_patient_address: data.patient_address || null,
        p_prescriber_name: data.prescriber_name || null,
        p_prescriber_address: data.prescriber_address || null,
        p_prescription_date: data.prescription_date || null,
        p_witness_name: data.witness_name || null,
        p_witness_role: data.witness_role || null,
        p_authorised_by: data.authorised_by || null,
        p_entered_by: activeUser.id,
      })

      if (error) {
        // Handle conflict errors
        if (error.message.includes('CONFLICT')) {
          setSubmitError('Another entry was made while you were editing. Please refresh the ledger and try again.')
        } else {
          setSubmitError(error.message)
        }
        return
      }

      // Save frequently used values
      if (data.supplier_name) setLastUsedValue('supplier_name', data.supplier_name)
      if (data.prescriber_name) setLastUsedValue('prescriber_name', data.prescriber_name)
      if (data.prescriber_address) setLastUsedValue('prescriber_address', data.prescriber_address)

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

      {submitError && (
        <div className="auth-error">{submitError}</div>
      )}

      {/* Transaction Type */}
      <div className="form-row">
        <div className="form-group">
          <label>Transaction Type *</label>
          <select className="ps-input" {...register('transaction_type')}>
            <optgroup label="Receipts (Quantity In)">
              <option value="receipt">Receipt from Supplier</option>
              <option value="transfer_in">Transfer In</option>
              <option value="patient_return">Patient Return</option>
            </optgroup>
            <optgroup label="Deductions (Quantity Out)">
              <option value="supply">Supply to Patient</option>
              <option value="return_to_supplier">Return to Supplier</option>
              <option value="disposal">Disposal / Destruction</option>
              <option value="transfer_out">Transfer Out</option>
            </optgroup>
          </select>
          {errors.transaction_type && <div className="form-error">{errors.transaction_type.message}</div>}
        </div>

        <div className="form-group">
          <label>Date of Transaction *</label>
          <input type="date" className="ps-input" {...register('date_of_transaction')} />
          {errors.date_of_transaction && <div className="form-error">{errors.date_of_transaction.message}</div>}
        </div>
      </div>

      {/* Quantity */}
      <div className="form-row">
        {isReceipt ? (
          <div className="form-group">
            <label>Quantity Received *</label>
            <input type="number" className="ps-input" step="any" min="0" {...register('quantity_received')} />
            {errors.quantity_received && <div className="form-error">{errors.quantity_received.message}</div>}
          </div>
        ) : (
          <div className="form-group">
            <label>Quantity Deducted *</label>
            <input type="number" className="ps-input" step="any" min="0" {...register('quantity_deducted')} />
            {errors.quantity_deducted && <div className="form-error">{errors.quantity_deducted.message}</div>}
          </div>
        )}
      </div>

      {/* Receipt: Supplier info */}
      {isReceipt && (
        <div className="form-row">
          <div className="form-group">
            <label>Supplier Name</label>
            <input className="ps-input" placeholder="e.g. Alliance Healthcare" {...register('supplier_name')} />
          </div>
          <div className="form-group">
            <label>Invoice Number</label>
            <input className="ps-input" placeholder="e.g. INV-12345" {...register('invoice_number')} />
          </div>
        </div>
      )}

      {/* Supply: Patient info */}
      {isSupply && (
        <>
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
                    <button
                      key={c.id}
                      type="button"
                      className="autocomplete-item"
                      onClick={() => selectContact(c, 'patient')}
                    >
                      <span className="autocomplete-name">{c.full_name}</span>
                      {c.postcode && <span className="autocomplete-detail">{c.postcode}</span>}
                    </button>
                  ))}
                </div>
              )}
              {errors.patient_name && <div className="form-error">{errors.patient_name.message}</div>}
            </div>
            <div className="form-group">
              <label>Patient Address</label>
              <input className="ps-input" {...register('patient_address')} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group autocomplete-group">
              <label>Prescriber Name *</label>
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
                    <button
                      key={c.id}
                      type="button"
                      className="autocomplete-item"
                      onClick={() => selectContact(c, 'prescriber')}
                    >
                      <span className="autocomplete-name">{c.full_name}</span>
                      {c.postcode && <span className="autocomplete-detail">{c.postcode}</span>}
                    </button>
                  ))}
                </div>
              )}
              {errors.prescriber_name && <div className="form-error">{errors.prescriber_name.message}</div>}
            </div>
            <div className="form-group">
              <label>Prescriber Address</label>
              <input className="ps-input" {...register('prescriber_address')} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Prescription Date</label>
              <input type="date" className="ps-input" {...register('prescription_date')} />
            </div>
          </div>
        </>
      )}

      {/* Disposal: Witness */}
      {isDisposal && (
        <div className="form-row">
          <div className="form-group">
            <label>Witness Name</label>
            <input className="ps-input" placeholder="Name of witness" {...register('witness_name')} />
          </div>
          <div className="form-group">
            <label>Witness Role</label>
            <input className="ps-input" placeholder="e.g. Pharmacist" {...register('witness_role')} />
          </div>
        </div>
      )}

      {/* Authorised by */}
      <div className="form-row">
        <div className="form-group">
          <label>Authorised By</label>
          <input className="ps-input" {...register('authorised_by')} />
        </div>
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
        <button type="submit" className="ps-btn ps-btn-primary" disabled={submitting}>
          {submitting ? 'Saving...' : 'Add Entry'}
        </button>
      </div>
    </form>
  )
}
