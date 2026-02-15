// ============================================
// ContactModal — Add or edit a patient, prescriber, or supplier
// Linked to the organisation, not a specific register
// ============================================

import { useState, useEffect } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import type { KnownContact, ContactType } from '@pharmstation/types'
import { Modal } from './Modal'

interface ContactModalProps {
  isOpen: boolean
  onClose: () => void
  contactType: ContactType
  /** If provided, we are editing an existing contact */
  existingContact?: KnownContact | null
  /** Pre-fill the name field (for "Add New" from search) */
  initialName?: string
  onSaved: (contact: KnownContact) => void
  /** Called when a contact is deleted (editing mode only) */
  onDeleted?: (contactId: string) => void
}

const CONTACT_LABELS: Record<ContactType, string> = {
  patient: 'Patient',
  prescriber: 'Prescriber',
  supplier: 'Supplier',
}

export function ContactModal({
  isOpen,
  onClose,
  contactType,
  existingContact,
  initialName = '',
  onSaved,
  onDeleted,
}: ContactModalProps) {
  const { organisation } = useAuthStore()
  const isEditing = !!existingContact
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Patient-specific split name fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  // Generic full name for prescriber/supplier
  const [fullName, setFullName] = useState('')

  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [prescriberType, setPrescriberType] = useState('')
  const [nhsNumber, setNhsNumber] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Populate from existing contact or reset
  useEffect(() => {
    if (!isOpen) return
    if (existingContact) {
      if (contactType === 'patient') {
        // Use split fields if available, otherwise guess from full_name
        if (existingContact.first_name || existingContact.last_name) {
          setFirstName(existingContact.first_name ?? '')
          setLastName(existingContact.last_name ?? '')
        } else {
          // Best-effort split of full_name for legacy records
          const parts = existingContact.full_name.trim().split(/\s+/)
          setFirstName(parts[0] ?? '')
          setLastName(parts.slice(1).join(' '))
        }
      }
      setFullName(existingContact.full_name)
      setAddressLine1(existingContact.address_line_1 ?? '')
      setAddressLine2(existingContact.address_line_2 ?? '')
      setCity(existingContact.city ?? '')
      setPostcode(existingContact.postcode ?? '')
      // Use gmc_number as generic registration field
      setRegistrationNumber(existingContact.gmc_number ?? existingContact.gphc_number ?? '')
      setPrescriberType(existingContact.prescriber_type ?? '')
      setNhsNumber(existingContact.nhs_number ?? '')
      setDateOfBirth(existingContact.date_of_birth ?? '')
    } else {
      // New contact — seed name from initialName
      if (contactType === 'patient') {
        const parts = initialName.trim().split(/\s+/)
        setFirstName(parts[0] ?? '')
        setLastName(parts.slice(1).join(' '))
      }
      setFullName(initialName)
      setAddressLine1('')
      setAddressLine2('')
      setCity('')
      setPostcode('')
      setRegistrationNumber('')
      setPrescriberType('')
      setNhsNumber('')
      setDateOfBirth('')
    }
    setError(null)
    setConfirmDelete(false)
    setDeleting(false)
  }, [isOpen, existingContact, initialName, contactType])

  const handleSave = async () => {
    if (!organisation) return

    // Build effective full_name
    let effectiveName: string
    if (contactType === 'patient') {
      if (!firstName.trim()) {
        setError('First name is required')
        return
      }
      if (!lastName.trim()) {
        setError('Last name is required')
        return
      }
      effectiveName = `${firstName.trim()} ${lastName.trim()}`
    } else {
      if (!fullName.trim()) {
        setError('Name is required')
        return
      }
      effectiveName = fullName.trim()
    }

    setSaving(true)
    setError(null)

    // NOTE: search_key is a GENERATED ALWAYS column in the DB — do NOT include it
    // Build the fields we want to write
    const fields: Record<string, unknown> = {
      full_name: effectiveName,
      address_line_1: addressLine1.trim() || null,
      address_line_2: addressLine2.trim() || null,
      city: city.trim() || null,
      postcode: postcode.trim() || null,
      nhs_number: nhsNumber.trim() || null,
      date_of_birth: dateOfBirth || null,
      prescriber_type: prescriberType.trim() || null,
      gmc_number: registrationNumber.trim() || null,
      gphc_number: null,
    }

    // Patient-specific: store first_name and last_name
    if (contactType === 'patient') {
      fields.first_name = firstName.trim()
      fields.last_name = lastName.trim()
    }

    try {
      if (isEditing && existingContact) {
        // Only send mutable fields for update (don't resend organisation_id / contact_type)
        const { data, error: updateError } = await getUserClient()
          .from('ps_known_contacts')
          .update(fields)
          .eq('id', existingContact.id)
          .select()
          .single()

        if (updateError) {
          setError(updateError.message)
          return
        }
        onSaved(data as KnownContact)
      } else {
        // Insert includes immutable org/type fields
        const insertRecord = {
          organisation_id: organisation.id,
          contact_type: contactType,
          ...fields,
        }
        const { data, error: insertError } = await getUserClient()
          .from('ps_known_contacts')
          .insert(insertRecord)
          .select()
          .single()

        if (insertError) {
          setError(insertError.message)
          return
        }
        onSaved(data as KnownContact)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!existingContact) return
    setDeleting(true)
    setError(null)
    try {
      const { error: deleteError } = await getUserClient()
        .from('ps_known_contacts')
        .delete()
        .eq('id', existingContact.id)
      if (deleteError) {
        setError(deleteError.message)
        return
      }
      onDeleted?.(existingContact.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const title = isEditing
    ? `Edit ${CONTACT_LABELS[contactType]}`
    : `Add New ${CONTACT_LABELS[contactType]}`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="500px">
      <div className="cd-entry-form">
        {error && <div className="auth-error">{error}</div>}

        {/* Patient: First + Last name on one row */}
        {contactType === 'patient' ? (
          <div className="form-row">
            <div className="form-group">
              <label>First Name *</label>
              <input
                className="ps-input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Last Name *</label>
              <input
                className="ps-input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
              />
            </div>
          </div>
        ) : (
          <div className="form-group">
            <label>{CONTACT_LABELS[contactType]} Name *</label>
            <input
              className="ps-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              autoFocus
            />
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Address Line 1</label>
            <input
              className="ps-input"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Address Line 2</label>
            <input
              className="ps-input"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>City</label>
            <input
              className="ps-input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Postcode</label>
            <input
              className="ps-input"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
            />
          </div>
        </div>

        {/* Patient-specific fields */}
        {contactType === 'patient' && (
          <div className="form-row">
            <div className="form-group">
              <label>NHS Number</label>
              <input
                className="ps-input"
                value={nhsNumber}
                onChange={(e) => setNhsNumber(e.target.value)}
                placeholder="e.g. 123 456 7890"
              />
            </div>
            <div className="form-group">
              <label>Date of Birth</label>
              <input
                type="date"
                className="ps-input"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Prescriber-specific fields */}
        {contactType === 'prescriber' && (
          <div className="form-row">
            <div className="form-group">
              <label>Prescriber Type</label>
              <select
                className="ps-input"
                value={prescriberType}
                onChange={(e) => setPrescriberType(e.target.value)}
              >
                <option value="">Select...</option>
                <option value="GP">GP</option>
                <option value="Consultant">Consultant</option>
                <option value="Dentist">Dentist</option>
                <option value="Nurse Prescriber">Nurse Prescriber</option>
                <option value="Pharmacist Prescriber">Pharmacist Prescriber</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label>Registration</label>
              <input
                className="ps-input"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="Registration number"
              />
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {isEditing && confirmDelete && (
          <div className="auth-error" style={{ background: 'var(--ps-error-bg, #fef2f2)', border: '1px solid var(--ps-error)', borderRadius: 'var(--ps-radius-sm)', padding: 'var(--ps-space-sm)' }}>
            <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Are you sure you want to delete this {CONTACT_LABELS[contactType].toLowerCase()}?</p>
            <p style={{ margin: '0 0 8px', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>This will remove <strong>{existingContact?.full_name}</strong> from your contacts. Existing register entries will not be affected.</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="ps-btn ps-btn-ghost"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                style={{ fontSize: 'var(--ps-font-sm)' }}
              >
                No, keep
              </button>
              <button
                type="button"
                className="ps-btn ps-btn-primary"
                onClick={handleDelete}
                disabled={deleting}
                style={{ background: 'var(--ps-error)', fontSize: 'var(--ps-font-sm)' }}
              >
                {deleting ? 'Deleting...' : 'Yes, delete'}
              </button>
            </div>
          </div>
        )}

        <div className="form-actions" style={{ justifyContent: 'space-between' }}>
          {isEditing ? (
            <button
              type="button"
              className="ps-btn ps-btn-ghost"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting || confirmDelete}
              style={{ color: 'var(--ps-error)' }}
            >
              🗑 Delete
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="ps-btn ps-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="ps-btn ps-btn-primary"
              onClick={handleSave}
              disabled={saving || deleting}
            >
              {saving ? 'Saving...' : isEditing ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
