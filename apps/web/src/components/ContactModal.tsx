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
}: ContactModalProps) {
  const { organisation } = useAuthStore()
  const isEditing = !!existingContact

  const [fullName, setFullName] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')
  const [gmcNumber, setGmcNumber] = useState('')
  const [gphcNumber, setGphcNumber] = useState('')
  const [prescriberType, setPrescriberType] = useState('')
  const [nhsNumber, setNhsNumber] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Populate from existing contact or reset
  useEffect(() => {
    if (!isOpen) return
    if (existingContact) {
      setFullName(existingContact.full_name)
      setAddressLine1(existingContact.address_line_1 ?? '')
      setAddressLine2(existingContact.address_line_2 ?? '')
      setCity(existingContact.city ?? '')
      setPostcode(existingContact.postcode ?? '')
      setGmcNumber(existingContact.gmc_number ?? '')
      setGphcNumber(existingContact.gphc_number ?? '')
      setPrescriberType(existingContact.prescriber_type ?? '')
      setNhsNumber(existingContact.nhs_number ?? '')
      setDateOfBirth(existingContact.date_of_birth ?? '')
    } else {
      setFullName(initialName)
      setAddressLine1('')
      setAddressLine2('')
      setCity('')
      setPostcode('')
      setGmcNumber('')
      setGphcNumber('')
      setPrescriberType('')
      setNhsNumber('')
      setDateOfBirth('')
    }
    setError(null)
  }, [isOpen, existingContact, initialName])

  const handleSave = async () => {
    if (!organisation) return
    if (!fullName.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError(null)

    // NOTE: search_key is a GENERATED ALWAYS column in the DB — do NOT include it
    const record: Record<string, unknown> = {
      organisation_id: organisation.id,
      contact_type: contactType,
      full_name: fullName.trim(),
      address_line_1: addressLine1.trim() || null,
      address_line_2: addressLine2.trim() || null,
      city: city.trim() || null,
      postcode: postcode.trim() || null,
      gmc_number: gmcNumber.trim() || null,
      gphc_number: gphcNumber.trim() || null,
      prescriber_type: prescriberType.trim() || null,
      nhs_number: nhsNumber.trim() || null,
      date_of_birth: dateOfBirth || null,
    }

    try {
      if (isEditing && existingContact) {
        const { data, error: updateError } = await getUserClient()
          .from('ps_known_contacts')
          .update(record)
          .eq('id', existingContact.id)
          .select()
          .single()

        if (updateError) {
          setError(updateError.message)
          return
        }
        onSaved(data as KnownContact)
      } else {
        const { data, error: insertError } = await getUserClient()
          .from('ps_known_contacts')
          .insert(record)
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

  const title = isEditing
    ? `Edit ${CONTACT_LABELS[contactType]}`
    : `Add New ${CONTACT_LABELS[contactType]}`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="500px">
      <div className="cd-entry-form">
        {error && <div className="auth-error">{error}</div>}

        <div className="form-group">
          <label>{CONTACT_LABELS[contactType]} Name *</label>
          <input
            className="ps-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={`Full name`}
            autoFocus
          />
        </div>

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
              <label>GMC / GPhC Number</label>
              <input
                className="ps-input"
                value={gmcNumber || gphcNumber}
                onChange={(e) => {
                  setGmcNumber(e.target.value)
                  setGphcNumber('')
                }}
                placeholder="Registration number"
              />
            </div>
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="ps-btn ps-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ps-btn ps-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : isEditing ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
