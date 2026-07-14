import type { EntryAnnotation, RegisterEntry } from '@pharmstation/types'

export interface CDEntryWarningInput {
  direction: 'in' | 'out'
  date: string
  quantity: number
  supplierName?: string | null
  invoiceNumber?: string | null
  patientName?: string | null
  wasIdRequested?: boolean
  wasIdProvided?: boolean
  packLabel?: string | null
  currentBalance?: number | null
}

export interface CDEntryWarning {
  id: string
  title: string
  detail: string
}

const normalise = (value?: string | null) => value?.trim().toLocaleLowerCase('en-GB') ?? ''

const wholeNumber = (value: number) => Number.isInteger(value) && value > 0

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function quantityScaleWarning(
  quantity: number,
  priorQuantities: number[],
  fallbackPackSize?: number | null,
): CDEntryWarning | null {
  const typical = priorQuantities.length >= 3 ? median(priorQuantities) : null
  const smallBelow = typical ? typical / 4 : fallbackPackSize ? fallbackPackSize / 2 : null
  const largeAbove = typical ? typical * 4 : fallbackPackSize ? fallbackPackSize * 20 : null

  if (smallBelow !== null && quantity < smallBelow) {
    return {
      id: 'unusually-small-quantity',
      title: 'Unusually small quantity',
      detail: typical
        ? `${quantity} is much lower than the usual quantity of around ${typical}.`
        : `${quantity} is unusually small for a pack quantity of ${fallbackPackSize}.`,
    }
  }

  if (largeAbove !== null && quantity > largeAbove) {
    return {
      id: 'unusually-large-quantity',
      title: 'Unusually large quantity',
      detail: typical
        ? `${quantity} is much higher than the usual quantity of around ${typical}.`
        : `${quantity} is unusually large for a pack quantity of ${fallbackPackSize}.`,
    }
  }

  return null
}

function packSizeFromLabel(label?: string | null): number | null {
  if (!label) return null
  const values = label.match(/\d+(?:\.\d+)?/g)?.map(Number).filter((value) => value > 0) ?? []
  if (values.length === 0) return null

  // Common dm+d-style labels include "100s" and multipacks such as "10 x 10".
  const size = /\d\s*[x×]\s*\d/i.test(label) && values.length >= 2
    ? values[0] * values[1]
    : values[0]
  return wholeNumber(size) ? size : null
}

function inferredReceiptPackSize(entries: RegisterEntry[], packLabel?: string | null): number | null {
  const labelledSize = packSizeFromLabel(packLabel)
  if (labelledSize) return labelledSize

  const priorQuantities = entries
    .filter((entry) => entry.transaction_type === 'receipt')
    .map((entry) => entry.quantity_received)
    .filter((quantity): quantity is number => quantity !== null && wholeNumber(quantity))

  if (priorQuantities.length === 0) return null
  if (priorQuantities.length === 1) return priorQuantities[0]

  const inferred = priorQuantities.reduce(gcd)
  // Very small common factors are more likely incidental than a manufacturer pack size.
  return inferred >= 5 ? inferred : null
}

function hasOutstandingPartSupply(entry: RegisterEntry): boolean {
  const annotations = entry.annotations ?? []
  return annotations.some((annotation: EntryAnnotation) => annotation.annotation_type === 'part_supply') &&
    !annotations.some((annotation: EntryAnnotation) => annotation.annotation_type === 'part_supply_closed')
}

function calendarDayDifference(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00Z`)
  const toDate = new Date(`${to}T00:00:00Z`)
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000)
}

export function getCDEntryWarnings(
  input: CDEntryWarningInput,
  entries: RegisterEntry[],
): CDEntryWarning[] {
  const warnings: CDEntryWarning[] = []
  const transactionDate = new Date(`${input.date}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (transactionDate > today) {
    warnings.push({
      id: 'future-date',
      title: 'Future date',
      detail: `The transaction date is ${transactionDate.toLocaleDateString('en-GB')}.`,
    })
  }

  if (input.direction === 'in') {
    const supplier = normalise(input.supplierName)
    const invoice = normalise(input.invoiceNumber)
    const receiptEntries = entries.filter((entry) => entry.transaction_type === 'receipt')
    const packSize = inferredReceiptPackSize(receiptEntries, input.packLabel)
    const priorReceiptQuantities = receiptEntries
      .map((entry) => entry.quantity_received)
      .filter((quantity): quantity is number => quantity !== null && quantity > 0)
    const scaleWarning = quantityScaleWarning(input.quantity, priorReceiptQuantities, packSize)
    if (scaleWarning) warnings.push(scaleWarning)

    if (packSize && wholeNumber(input.quantity) && input.quantity % packSize !== 0) {
      warnings.push({
        id: 'unusual-pack-quantity',
        title: 'Unusual receipt quantity',
        detail: `${input.quantity} is not a multiple of the usual pack quantity (${packSize}).`,
      })
    }

    if (supplier && receiptEntries.length > 0 && !receiptEntries.some((entry) => normalise(entry.supplier_name) === supplier)) {
      warnings.push({
        id: 'new-supplier',
        title: 'New supplier',
        detail: `${input.supplierName?.trim()} has not been used for this drug before.`,
      })
    }

    if (supplier && invoice) {
      const duplicateInvoice = receiptEntries.find(
        (entry) => normalise(entry.supplier_name) === supplier && normalise(entry.invoice_number) === invoice,
      )
      if (duplicateInvoice) {
        warnings.push({
          id: 'duplicate-invoice',
          title: 'Invoice already entered',
          detail: `Invoice ${input.invoiceNumber?.trim()} appears on entry #${duplicateInvoice.entry_number}.`,
        })
      }
    }
  } else {
    const patient = normalise(input.patientName)
    const priorSupplyQuantities = entries
      .filter((entry) => entry.transaction_type === 'supply')
      .map((entry) => entry.quantity_deducted)
      .filter((quantity): quantity is number => quantity !== null && quantity > 0)
    const scaleWarning = quantityScaleWarning(input.quantity, priorSupplyQuantities)
    if (scaleWarning) warnings.push(scaleWarning)

    const patientEntries = entries.filter(
      (entry) => entry.transaction_type === 'supply' && normalise(entry.patient_name) === patient,
    )

    if (input.currentBalance !== null && input.currentBalance !== undefined && input.quantity > input.currentBalance) {
      warnings.push({
        id: 'negative-balance',
        title: 'Negative balance',
        detail: `The balance would change from ${input.currentBalance} to ${input.currentBalance - input.quantity}.`,
      })
    }

    if (patient && patientEntries.length === 0 && entries.some((entry) => entry.transaction_type === 'supply')) {
      warnings.push({
        id: 'new-patient',
        title: 'First supply to this patient',
        detail: `${input.patientName?.trim()} has not received this drug from this register before.`,
      })
    }

    const recentEntry = patientEntries
      .filter((entry) => entry.date_of_transaction <= input.date)
      .sort((a, b) => b.date_of_transaction.localeCompare(a.date_of_transaction))[0]
    if (recentEntry && !hasOutstandingPartSupply(recentEntry)) {
      const days = calendarDayDifference(recentEntry.date_of_transaction, input.date)
      if (days >= 0 && days <= 7) {
        warnings.push({
          id: 'recent-patient-supply',
          title: 'Recent supply to this patient',
          detail: `Entry #${recentEntry.entry_number} was ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} (${recentEntry.quantity_deducted ?? 'unknown'} supplied).`,
        })
      }
    }

    if (input.wasIdRequested && !input.wasIdProvided) {
      warnings.push({
        id: 'id-not-provided',
        title: 'ID not provided',
        detail: 'ID is marked as requested but not provided.',
      })
    }
  }

  return warnings
}
