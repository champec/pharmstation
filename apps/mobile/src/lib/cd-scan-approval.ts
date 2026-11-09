// ============================================
// Approving AI scan lines into the CD register (mobile).
//
// Mirrors approveScanItem in packages/core/src/stores/scan-store.ts.
// UK law: a scanned entry only goes in the register once a pharmacist or
// pharmacy technician has checked it. The database enforces this too
// (ps_is_cd_scan_reviewer in ps_make_register_entry).
// ============================================

import { userClient } from '@/lib/supabase'
import type { UserRole } from '@/types/auth'

export interface ScanForApproval {
  id: string
  organisation_id: string
  document_type: 'prescription' | 'invoice' | 'unknown' | null
  image_path: string | null
  supplier_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  patient_name: string | null
  patient_address: string | null
  prescriber_name: string | null
  prescriber_address: string | null
  prescriber_registration: string | null
}

export interface ScanItemForApproval {
  id: string
  matched_drug_id: string | null
  matched_drug_brand: string | null
  quantity: number | null
  confidence: number | null
}

export interface SupplyDetails {
  collectorType: 'patient' | 'representative' | 'hcp'
  collectorDetails: string
  wasIdRequested: boolean
  wasIdProvided: boolean
}

/** Pharmacists, technicians and locums (or anyone with a GPhC number). */
export function canApproveCdScan(role: UserRole | null | undefined, gphcNumber: string | null | undefined) {
  return role === 'pharmacist' || role === 'technician' || role === 'locum' || !!gphcNumber?.trim()
}

function ukToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

async function refreshScanStatus(scanId: string, userId: string) {
  const { data } = await userClient.from('ps_ai_scan_items').select('status').eq('scan_id', scanId)
  const items = (data ?? []) as { status: string }[]
  const done = (s: string) => s === 'approved' || s === 'rejected'
  if (items.length && items.every((i) => done(i.status))) {
    await userClient.from('ps_ai_scan_queue').update({ status: 'fully_approved', approved_at: new Date().toISOString(), approved_by: userId }).eq('id', scanId)
  } else if (items.some((i) => done(i.status))) {
    await userClient.from('ps_ai_scan_queue').update({ status: 'partially_approved' }).eq('id', scanId)
  }
}

export async function approveScanLine(params: {
  scan: ScanForApproval
  item: ScanItemForApproval
  quantity: number
  userId: string
  supply?: SupplyDetails
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { scan, item, quantity, userId, supply } = params
  const isInvoice = scan.document_type === 'invoice'
  if (!item.matched_drug_id) return { ok: false, error: 'This line has no matched drug. Pick the drug on the web review screen.' }
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'Enter a quantity greater than 0.' }
  if (!isInvoice && !supply) return { ok: false, error: 'Confirm who collected the medicine and whether ID was checked.' }

  const { data: ledger, error: lErr } = await userClient
    .from('ps_register_ledgers')
    .select('id, lock_version')
    .eq('organisation_id', scan.organisation_id)
    .eq('drug_id', item.matched_drug_id)
    .eq('register_type', 'CD')
    .maybeSingle()
  if (lErr) return { ok: false, error: lErr.message }
  if (!ledger) return { ok: false, error: `Add ${item.matched_drug_brand ?? 'this drug'} to your CD register first (CD Register tab), then approve.` }

  const { data: entry, error } = await userClient.rpc('ps_make_register_entry', {
    p_ledger_id: ledger.id,
    p_register_type: 'CD',
    p_entry_type: 'normal',
    p_date_of_transaction: isInvoice ? scan.invoice_date || ukToday() : ukToday(),
    p_notes: `AI scan entry (confidence: ${item.confidence ?? 0}/3), checked on mobile`,
    p_source: 'ai_scan',
    p_expected_lock_version: ledger.lock_version,
    p_transaction_type: isInvoice ? 'receipt' : 'supply',
    p_quantity_received: isInvoice ? quantity : null,
    p_quantity_deducted: isInvoice ? null : quantity,
    p_supplier_name: isInvoice ? scan.supplier_name : null,
    p_invoice_number: isInvoice ? scan.invoice_number : null,
    p_patient_name: isInvoice ? null : scan.patient_name,
    p_patient_address: isInvoice ? null : scan.patient_address,
    p_prescriber_name: isInvoice ? null : scan.prescriber_name,
    p_prescriber_address: isInvoice ? null : scan.prescriber_address,
    p_prescriber_registration: isInvoice ? null : scan.prescriber_registration,
    p_was_id_requested: isInvoice ? null : supply!.wasIdRequested,
    p_was_id_provided: isInvoice ? null : supply!.wasIdProvided,
    p_collector_type: isInvoice ? null : supply!.collectorType,
    p_collector_details: isInvoice ? null : supply!.collectorDetails.trim() || null,
    p_scan_image_path: scan.image_path,
  })
  if (error) {
    return {
      ok: false,
      error: error.message.includes('CONFLICT')
        ? 'Someone else made an entry on this register a moment ago. Try again.'
        : error.message,
    }
  }

  await userClient
    .from('ps_ai_scan_items')
    .update({
      status: 'approved',
      entry_id: (entry as { id: string } | null)?.id ?? null,
      approved_by: userId,
      approved_at: new Date().toISOString(),
      ...(quantity !== item.quantity ? { edited_quantity: quantity } : {}),
    })
    .eq('id', item.id)
  await refreshScanStatus(scan.id, userId)
  return { ok: true }
}

export async function rejectScanLine(scanId: string, itemId: string, userId: string) {
  const { error } = await userClient.from('ps_ai_scan_items').update({ status: 'rejected' }).eq('id', itemId)
  if (error) return { ok: false as const, error: error.message }
  await refreshScanStatus(scanId, userId)
  return { ok: true as const }
}
