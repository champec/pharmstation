import { useState } from 'react'
import type { OutcomeType } from '@pharmstation/types'
import {
  MedicationPrescriber,
  createEmptyMedication,
  type PrescribedMedication,
} from './MedicationPrescriber'

export interface OutcomeData {
  outcome_type: OutcomeType
  medications: PrescribedMedication[]
  referral_to: string
  referral_reason: string
  referral_urgency: 'routine' | 'urgent' | 'emergency'
  advice_given: string
}

export interface DeliveryOutcomePanelProps {
  value: OutcomeData
  onChange: (data: OutcomeData) => void
  /** Max medications (0 = unlimited) */
  maxMedications?: number
  readOnly?: boolean
}

const OUTCOME_OPTIONS: { value: OutcomeType; label: string; icon: string; desc: string }[] = [
  { value: 'prescription', label: 'Prescription / Supply', icon: '💊', desc: 'Medication was prescribed or dispensed' },
  { value: 'referral', label: 'Referral', icon: '📋', desc: 'Patient referred to GP, A&E, or another service' },
  { value: 'advice', label: 'Advice Given', icon: '💬', desc: 'Patient received advice or information' },
  { value: 'no_treatment', label: 'No Treatment', icon: '🚫', desc: 'No treatment required or patient declined' },
]

export function createEmptyOutcome(): OutcomeData {
  return {
    outcome_type: 'advice',
    medications: [],
    referral_to: '',
    referral_reason: '',
    referral_urgency: 'routine',
    advice_given: '',
  }
}

export function DeliveryOutcomePanel({
  value,
  onChange,
  maxMedications = 0,
  readOnly = false,
}: DeliveryOutcomePanelProps) {
  const update = <K extends keyof OutcomeData>(key: K, val: OutcomeData[K]) => {
    onChange({ ...value, [key]: val })
  }

  return (
    <div className="delivery-outcome-panel">
      {/* Outcome type selector */}
      <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
        <label style={{ fontWeight: 600, color: 'var(--ps-midnight)', fontSize: '14px', display: 'block', marginBottom: 'var(--ps-space-sm)' }}>
          Outcome Type
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--ps-space-sm)' }}>
          {OUTCOME_OPTIONS.map((opt) => (
            <div
              key={opt.value}
              onClick={() => {
                if (readOnly) return
                update('outcome_type', opt.value)
                // When switching to prescription, add an empty med if none
                if (opt.value === 'prescription' && value.medications.length === 0) {
                  onChange({ ...value, outcome_type: opt.value, medications: [createEmptyMedication()] })
                }
              }}
              style={{
                padding: 'var(--ps-space-md)',
                border: `2px solid ${value.outcome_type === opt.value ? 'var(--ps-primary)' : 'var(--ps-border)'}`,
                borderRadius: 'var(--ps-radius-md)',
                cursor: readOnly ? 'default' : 'pointer',
                background: value.outcome_type === opt.value ? '#f0f9ff' : 'white',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>{opt.icon}</div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--ps-midnight)' }}>{opt.label}</div>
              <div style={{ fontSize: '12px', color: 'var(--ps-slate)', marginTop: '2px' }}>{opt.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Prescription/Supply — MedicationPrescriber */}
      {value.outcome_type === 'prescription' && (
        <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
          <MedicationPrescriber
            value={value.medications}
            onChange={(meds) => update('medications', meds)}
            maxItems={maxMedications}
            readOnly={readOnly}
          />
        </div>
      )}

      {/* Referral */}
      {value.outcome_type === 'referral' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-lg)' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
              Referred To
            </label>
            <select
              className="ps-input"
              value={value.referral_to}
              disabled={readOnly}
              onChange={(e) => update('referral_to', e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— Select —</option>
              <option value="GP">GP</option>
              <option value="A&E">A&E</option>
              <option value="999">999</option>
              <option value="Walk-in Centre">Walk-in Centre</option>
              <option value="NHS 111">NHS 111</option>
              <option value="Dentist">Dentist</option>
              <option value="Optician">Optician</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
              Urgency
            </label>
            <div style={{ display: 'flex', gap: 'var(--ps-space-md)' }}>
              {(['routine', 'urgent', 'emergency'] as const).map((u) => (
                <label
                  key={u}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px',
                    cursor: readOnly ? 'default' : 'pointer',
                    color: value.referral_urgency === u ? 'var(--ps-primary)' : 'var(--ps-slate)',
                  }}
                >
                  <input
                    type="radio"
                    name="referral_urgency"
                    checked={value.referral_urgency === u}
                    disabled={readOnly}
                    onChange={() => update('referral_urgency', u)}
                  />
                  {u.charAt(0).toUpperCase() + u.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
              Reason for Referral
            </label>
            <textarea
              className="ps-input"
              rows={3}
              placeholder="Describe why the patient is being referred..."
              value={value.referral_reason}
              readOnly={readOnly}
              onChange={(e) => update('referral_reason', e.target.value)}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
        </div>
      )}

      {/* Advice / No Treatment — shared notes field */}
      {(value.outcome_type === 'advice' || value.outcome_type === 'no_treatment') && (
        <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
          <label style={{ fontSize: '12px', color: 'var(--ps-slate)', display: 'block', marginBottom: '4px' }}>
            {value.outcome_type === 'advice' ? 'Advice Given' : 'Notes'}
          </label>
          <textarea
            className="ps-input"
            rows={4}
            placeholder={
              value.outcome_type === 'advice'
                ? 'Describe the advice provided to the patient...'
                : 'Describe the reason for no treatment...'
            }
            value={value.advice_given}
            readOnly={readOnly}
            onChange={(e) => update('advice_given', e.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>
      )}
    </div>
  )
}
