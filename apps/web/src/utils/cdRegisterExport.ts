// ============================================
// cdRegisterExport — turns CD register entries into report rows.
//
// Column order follows the Misuse of Drugs Regulations 2001,
// Schedule 6: receipts record date, supplier name and address and
// quantity; supplies record date, patient name and address, prescriber
// name and address, whether ID was requested and provided, and quantity.
// Each drug (class, form, strength) is its own section, mirroring the
// "separate part of the register" rule.
// ============================================

import type { RegisterEntry, RegisterLedger, TransactionType } from '@pharmstation/types'
import { fmtDate, fmtDateTime, yesNo, type ExportCell, type ReportSection } from './registerExport'

const TX_LABELS: Partial<Record<TransactionType, string>> = {
  receipt: 'Received',
  supply: 'Supplied',
  return_to_supplier: 'Returned to supplier',
  patient_return: 'Patient return',
  disposal: 'Destroyed',
  correction: 'Correction',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  balance_check: 'Balance check',
}

export const CD_EXPORT_HEADERS = [
  'Entry',
  'Date',
  'Type',
  'Received from (supplier)',
  'Invoice',
  'Supplied to (patient)',
  'Patient address',
  'Prescriber',
  'Prescriber address',
  'Prescriber reg.',
  'ID requested',
  'ID provided',
  'Qty in',
  'Qty out',
  'Balance',
  'Entered by',
  'Entered at',
  'Notes and corrections',
]

/** Shorter column set for print, where width is limited. */
export const CD_PRINT_HEADERS = [
  'Entry',
  'Date',
  'Type',
  'Received from',
  'Supplied to',
  'Prescriber',
  'ID req / given',
  'In',
  'Out',
  'Balance',
  'Entered by',
  'Notes and corrections',
]

function entryTypeLabel(e: RegisterEntry): string {
  if (e.entry_type === 'balance_check') return 'Balance check'
  const tx = e.transaction_type ? TX_LABELS[e.transaction_type] ?? e.transaction_type : ''
  return e.entry_type === 'correction' ? `Correction${tx && tx !== 'Correction' ? ` (${tx})` : ''}` : tx
}

function notesText(e: RegisterEntry, numberById: Map<string, number>): string {
  const parts: string[] = []
  if (e.notes) parts.push(e.notes)
  if (e.entry_type === 'correction') {
    const target = e.corrects_entry_id ? numberById.get(e.corrects_entry_id) : undefined
    parts.push(`Corrects entry ${target ?? '?'}${e.correction_reason ? `: ${e.correction_reason}` : ''}`)
  }
  if (e.source === 'ai_scan') parts.push('Entered from scanned document')
  for (const a of e.annotations ?? []) {
    const who = a.created_by_profile?.full_name ?? 'staff'
    parts.push(`[${fmtDateTime(a.created_at)} ${who}] ${a.annotation_text}`)
  }
  return parts.join('\n')
}

function enteredBy(e: RegisterEntry): string {
  return e.entered_by_profile?.full_name || e.authorised_by || ''
}

export function cdEntryCsvRow(e: RegisterEntry, numberById: Map<string, number>): ExportCell[] {
  const isSupply = !!e.patient_name
  return [
    e.entry_number,
    fmtDate(e.date_of_transaction),
    entryTypeLabel(e),
    e.supplier_name ?? '',
    e.invoice_number ?? '',
    e.patient_name ?? '',
    e.patient_address ?? '',
    e.prescriber_name ?? '',
    e.prescriber_address ?? '',
    e.prescriber_registration ?? '',
    isSupply ? yesNo(e.was_id_requested) : '',
    isSupply ? yesNo(e.was_id_provided) : '',
    e.quantity_received ?? '',
    e.quantity_deducted ?? '',
    e.running_balance ?? '',
    enteredBy(e),
    fmtDateTime(e.entered_at),
    notesText(e, numberById),
  ]
}

export function cdEntryPrintRow(e: RegisterEntry, numberById: Map<string, number>): ExportCell[] {
  const isSupply = !!e.patient_name
  const supplier = [e.supplier_name, e.invoice_number ? `Inv: ${e.invoice_number}` : null]
    .filter(Boolean)
    .join('\n')
  const patient = [e.patient_name, e.patient_address].filter(Boolean).join('\n')
  const prescriber = [
    e.prescriber_name,
    e.prescriber_address,
    e.prescriber_registration ? `Reg: ${e.prescriber_registration}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  return [
    e.entry_number,
    fmtDate(e.date_of_transaction),
    entryTypeLabel(e),
    supplier,
    patient,
    prescriber,
    isSupply ? `${yesNo(e.was_id_requested) || 'No'} / ${yesNo(e.was_id_provided) || 'No'}` : '',
    e.quantity_received ?? '',
    e.quantity_deducted ?? '',
    e.running_balance ?? '',
    `${enteredBy(e)}\n${fmtDateTime(e.entered_at)}`.trim(),
    notesText(e, numberById),
  ]
}

export function ledgerTitle(l: Pick<RegisterLedger, 'drug_name' | 'drug_strength' | 'drug_form'>): string {
  return [l.drug_name, l.drug_strength, l.drug_form].filter(Boolean).join(' ') || 'Controlled drug'
}

export function ledgerSubtitle(
  l: Pick<RegisterLedger, 'drug_class' | 'drug_form' | 'drug_strength' | 'register_type'>,
  entries: RegisterEntry[],
): string {
  const parts = [
    l.register_type === 'PRIVATE_CD' ? 'Private CD register' : 'CD register',
    l.drug_class ? `Class: ${l.drug_class}` : null,
    l.drug_form ? `Form: ${l.drug_form}` : null,
    l.drug_strength ? `Strength: ${l.drug_strength}` : null,
  ]
  if (entries.length > 0) {
    const first = entries[0]
    const last = entries[entries.length - 1]
    const broughtForward =
      first.previous_balance ??
      (first.running_balance !== null
        ? first.running_balance - (first.quantity_received ?? 0) + (first.quantity_deducted ?? 0)
        : null)
    if (broughtForward !== null) parts.push(`Brought forward: ${broughtForward}`)
    if (last.running_balance !== null) parts.push(`Carried forward: ${last.running_balance}`)
  }
  return parts.filter(Boolean).join(' · ')
}

/** Build a printable section for one drug ledger. */
export function cdLedgerSection(
  ledger: Pick<RegisterLedger, 'drug_name' | 'drug_strength' | 'drug_form' | 'drug_class' | 'register_type'>,
  entries: RegisterEntry[],
  allLedgerEntries: RegisterEntry[] = entries,
): ReportSection {
  const numberById = new Map(allLedgerEntries.map((e) => [e.id, e.entry_number]))
  return {
    heading: ledgerTitle(ledger),
    subheading: ledgerSubtitle(ledger, entries),
    headers: CD_PRINT_HEADERS,
    rows: entries.map((e) => cdEntryPrintRow(e, numberById)),
  }
}

// ─── Person collecting a Schedule 2 supply ───────────────────
// Schedule 6 asks whether the person who collected was the patient,
// the patient's representative or a healthcare professional (and if a
// healthcare professional, their name and address). There is no column
// for this yet, so it is written into the entry's own notes, which are
// part of the immutable entry and appear in every export.

export type CollectorType = '' | 'patient' | 'representative' | 'hcp'

export const COLLECTOR_OPTIONS: { value: CollectorType; label: string }[] = [
  { value: '', label: 'Not recorded' },
  { value: 'patient', label: 'Patient' },
  { value: 'representative', label: "Patient's representative" },
  { value: 'hcp', label: 'Healthcare professional' },
]

export function collectorNote(type: CollectorType, details: string | null | undefined): string | null {
  const label = COLLECTOR_OPTIONS.find((o) => o.value === type)?.label
  if (!type || !label) return details?.trim() ? `Collected by: ${details.trim()}` : null
  return details?.trim() ? `Collected by: ${label} (${details.trim()})` : `Collected by: ${label}`
}

export function joinNotes(...parts: (string | null | undefined)[]): string | null {
  const text = parts.map((p) => p?.trim()).filter(Boolean).join('. ')
  return text || null
}
