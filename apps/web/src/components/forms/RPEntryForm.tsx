import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { RegisterEntry } from '@pharmstation/types'

const rpEntrySchema = z.object({
  date_of_transaction: z.string().min(1, 'Date is required'),
  pharmacist_name: z.string().min(1, 'Pharmacist name is required'),
  gphc_number: z.string().min(1, 'GPhC number is required').regex(/^\d{1,7}$/, 'Must be up to 7 digits'),
  rp_signed_in_at: z.string().min(1, 'Sign-in time is required'),
  rp_signed_out_at: z.string().optional().nullable(),
  notes: z.string().max(200, 'Notes must be 200 characters or less').optional().nullable(),
})

type RPEntryFormData = z.infer<typeof rpEntrySchema>

interface RPEntryFormProps {
  onSuccess: (entry: RegisterEntry) => void | Promise<void>
  onCancel: () => void
  mode?: 'create' | 'edit'
  targetEntry?: RegisterEntry | null
  initialValues?: Partial<RPEntryFormData>
}

function toDateInputValue(date: Date) {
  return date.toISOString().split('T')[0]
}

export function RPEntryForm({
  onSuccess,
  onCancel,
  mode = 'create',
  targetEntry = null,
  initialValues,
}: RPEntryFormProps) {
  const { activeUser } = useAuthStore()
  const { activeLedger } = useRegisterStore()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const defaultValues = useMemo<RPEntryFormData>(() => {
    const now = new Date()
    return {
      date_of_transaction: initialValues?.date_of_transaction ?? toDateInputValue(now),
      pharmacist_name: initialValues?.pharmacist_name ?? activeUser?.full_name ?? '',
      gphc_number: initialValues?.gphc_number ?? activeUser?.gphc_number ?? '',
      rp_signed_in_at: initialValues?.rp_signed_in_at ?? (now.getHours() >= 10
        ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        : '09:00'),
      rp_signed_out_at: initialValues?.rp_signed_out_at ?? '18:00',
      notes: initialValues?.notes ?? '',
    }
  }, [activeUser, initialValues])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RPEntryFormData>({
    resolver: zodResolver(rpEntrySchema),
    defaultValues,
  })

  const onSubmit = async (data: RPEntryFormData) => {
    if (!activeLedger || !activeUser) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const { data: entry, error } = await getUserClient().rpc('ps_make_register_entry', {
        p_ledger_id: activeLedger.id,
        p_register_type: activeLedger.register_type,
        p_entry_type: mode === 'edit' ? 'correction' : 'normal',
        p_date_of_transaction: data.date_of_transaction,
        p_notes: data.notes || null,
        p_source: 'manual',
        p_corrects_entry_id: mode === 'edit' ? targetEntry?.id ?? null : null,
        p_correction_reason:
          mode === 'edit'
            ? `RP entry corrected by ${activeUser.full_name} on ${new Date().toLocaleString('en-GB')}`
            : null,
        p_expected_lock_version: activeLedger.lock_version,
        p_entered_by: activeUser.id,
        p_authorised_by: activeUser.full_name,
        p_pharmacist_name: data.pharmacist_name,
        p_gphc_number: data.gphc_number,
        p_rp_signed_in_at: new Date(`${data.date_of_transaction}T${data.rp_signed_in_at}`).toISOString(),
        p_rp_signed_out_at: data.rp_signed_out_at
          ? new Date(`${data.date_of_transaction}T${data.rp_signed_out_at}`).toISOString()
          : null,
      })

      if (error) {
        if (error.message.includes('CONFLICT')) {
          setSubmitError('Another entry was made while you were editing. Refresh and try again.')
        } else {
          setSubmitError(error.message)
        }
        return
      }

      await onSuccess(entry as RegisterEntry)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create RP entry')
    } finally {
      setSubmitting(false)
    }
  }

  if (!activeLedger) return null

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="cd-entry-form">
      <div className="entry-form-drug-info">
        <strong>Responsible Pharmacist Log</strong>
      </div>

      {mode === 'edit' && (
        <div className="ps-badge ps-badge-amber" style={{ width: 'fit-content' }}>
          Editing via correction entry (audit-safe)
        </div>
      )}

      {submitError && <div className="auth-error">{submitError}</div>}

      <div className="form-group">
        <label>Date *</label>
        <input type="date" className="ps-input" {...register('date_of_transaction')} />
        {errors.date_of_transaction && <div className="form-error">{errors.date_of_transaction.message}</div>}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Pharmacist Name *</label>
          <input className="ps-input" placeholder="e.g. Sarah Ahmed" {...register('pharmacist_name')} />
          {errors.pharmacist_name && <div className="form-error">{errors.pharmacist_name.message}</div>}
        </div>

        <div className="form-group">
          <label>GPhC Number *</label>
          <input
            className="ps-input"
            placeholder="e.g. 2087654"
            inputMode="numeric"
            maxLength={7}
            {...register('gphc_number')}
          />
          {errors.gphc_number && <div className="form-error">{errors.gphc_number.message}</div>}
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Time Started *</label>
          <input type="time" className="ps-input" {...register('rp_signed_in_at')} />
          {errors.rp_signed_in_at && <div className="form-error">{errors.rp_signed_in_at.message}</div>}
        </div>

        <div className="form-group">
          <label>Time Ended</label>
          <input type="time" className="ps-input" {...register('rp_signed_out_at')} />
        </div>
      </div>

      <div className="form-group">
        <label>Notes <span style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-xs)' }}>(max 200 chars)</span></label>
        <textarea className="ps-input" rows={3} maxLength={200} placeholder="e.g. Break coverage, reason for leaving" {...register('notes')} />
      </div>

      <div className="form-actions">
        <button type="button" className="ps-btn ps-btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="ps-btn ps-btn-primary" disabled={submitting}>
          {submitting ? 'Saving...' : mode === 'edit' ? 'Save Correction' : 'Save Entry'}
        </button>
      </div>
    </form>
  )
}
