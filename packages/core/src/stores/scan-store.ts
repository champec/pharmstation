// ============================================
// Scan Store — Zustand
// Manages AI scan queue, items, and approval flow
// ============================================

import { create } from 'zustand'
import type {
  ScanQueueItem,
  ScanDrugItem,
  ScanQueueStatus,
  CDDrug,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface ScanState {
  // Queue
  queue: ScanQueueItem[]
  queueLoading: boolean
  activeQueueFilter: ScanQueueStatus | 'all'

  // Active scan being reviewed
  activeScan: ScanQueueItem | null
  activeScanItems: ScanDrugItem[]
  activeScanLoading: boolean

  // Upload state
  isUploading: boolean
  uploadProgress: number

  // Actions
  loadQueue: (orgId: string) => Promise<void>
  setQueueFilter: (filter: ScanQueueStatus | 'all') => void
  loadScan: (scanId: string) => Promise<void>
  setActiveScan: (scan: ScanQueueItem | null) => void
  uploadAndScan: (params: {
    organisationId: string
    imageBase64: string
    mimeType: string
    filename?: string
    supabaseUrl: string
    accessToken: string
  }) => Promise<ScanQueueItem | null>
  approveScanItem: (params: {
    item: ScanDrugItem
    drugId: string
    quantity: number
    scan: ScanQueueItem
    userId: string
  }) => Promise<boolean>
  rejectScanItem: (itemId: string) => Promise<boolean>
  editScanItem: (itemId: string, drugId: string, quantity: number) => Promise<boolean>
  deleteScan: (scanId: string) => Promise<boolean>
  refreshImageUrl: (scanId: string) => Promise<string | null>
  reset: () => void
}

export const useScanStore = create<ScanState>((set, get) => ({
  queue: [],
  queueLoading: false,
  activeQueueFilter: 'all',

  activeScan: null,
  activeScanItems: [],
  activeScanLoading: false,

  isUploading: false,
  uploadProgress: 0,

  // ============================================
  // Load scan queue for organisation
  // ============================================
  loadQueue: async (orgId: string) => {
    set({ queueLoading: true })
    try {
      let query = getUserClient()
        .from('ps_ai_scan_queue')
        .select('*')
        .eq('organisation_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100)

      const filter = get().activeQueueFilter
      if (filter !== 'all') {
        query = query.eq('status', filter)
      }

      const { data, error } = await query
      if (error) throw error
      set({ queue: (data as ScanQueueItem[]) ?? [] })
    } catch (err) {
      console.error('Failed to load scan queue:', err)
    } finally {
      set({ queueLoading: false })
    }
  },

  setQueueFilter: (filter) => set({ activeQueueFilter: filter }),

  // ============================================
  // Load a specific scan with its items
  // ============================================
  loadScan: async (scanId: string) => {
    set({ activeScanLoading: true })
    try {
      const { data: scan, error: scanError } = await getUserClient()
        .from('ps_ai_scan_queue')
        .select('*')
        .eq('id', scanId)
        .single()

      if (scanError) throw scanError

      const { data: items, error: itemsError } = await getUserClient()
        .from('ps_ai_scan_items')
        .select('*')
        .eq('scan_id', scanId)
        .order('created_at', { ascending: true })

      if (itemsError) throw itemsError

      set({
        activeScan: scan as ScanQueueItem,
        activeScanItems: (items as ScanDrugItem[]) ?? [],
      })
    } catch (err) {
      console.error('Failed to load scan:', err)
    } finally {
      set({ activeScanLoading: false })
    }
  },

  setActiveScan: (scan) => set({ activeScan: scan, activeScanItems: [] }),

  // ============================================
  // Upload image and process via edge function
  // ============================================
  uploadAndScan: async ({ organisationId, imageBase64, mimeType, filename, supabaseUrl, accessToken }) => {
    set({ isUploading: true, uploadProgress: 10 })

    try {
      set({ uploadProgress: 30 })

      const response = await fetch(`${supabaseUrl}/functions/v1/ai-scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          organisation_id: organisationId,
          image_base64: imageBase64,
          mime_type: mimeType,
          filename: filename ?? 'scan',
        }),
      })

      set({ uploadProgress: 80 })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(errText || `HTTP ${response.status}`)
      }

      const result = await response.json()
      set({ uploadProgress: 100 })

      // Refresh queue
      await get().loadQueue(organisationId)

      // If scan returned, set it as active
      if (result.scan) {
        set({
          activeScan: result.scan as ScanQueueItem,
          activeScanItems: (result.items as ScanDrugItem[]) ?? [],
        })
        return result.scan as ScanQueueItem
      }

      return null
    } catch (err) {
      console.error('Upload and scan failed:', err)
      throw err
    } finally {
      set({ isUploading: false, uploadProgress: 0 })
    }
  },

  // ============================================
  // Approve a scan item — creates actual register entry
  // ============================================
  approveScanItem: async ({ item, drugId, quantity, scan, userId }) => {
    try {
      // Determine transaction type from document type
      const isInvoice = scan.document_type === 'invoice'
      const transactionType = isInvoice ? 'receipt' : 'supply'

      // Find or create ledger for this drug
      const orgId = scan.organisation_id

      // Get drug info
      const { data: drugData } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('*')
        .eq('id', drugId)
        .single()

      if (!drugData) throw new Error('Drug not found')

      // Find existing ledger
      let ledger: { id: string; lock_version: number; current_balance: number } | null = null
      const { data: existingLedger } = await getUserClient()
        .from('ps_register_ledgers')
        .select('id, lock_version, current_balance')
        .eq('organisation_id', orgId)
        .eq('drug_id', drugId)
        .eq('register_type', 'CD')
        .single()

      if (existingLedger) {
        ledger = existingLedger
      } else {
        // Create new ledger
        const { data: newLedger, error: ledgerError } = await getUserClient()
          .from('ps_register_ledgers')
          .insert({
            organisation_id: orgId,
            register_type: 'CD',
            drug_id: drugId,
            drug_name: (drugData as CDDrug).drug_brand,
            drug_form: (drugData as CDDrug).drug_form,
            drug_strength: (drugData as CDDrug).drug_strength,
            drug_class: (drugData as CDDrug).drug_class,
            current_balance: 0,
            created_by: userId,
          })
          .select('id, lock_version, current_balance')
          .single()

        if (ledgerError || !newLedger) throw new Error(`Failed to create ledger: ${ledgerError?.message}`)
        ledger = newLedger
      }

      // Also ensure subscribed register exists
      await getUserClient()
        .from('ps_subscribed_registers')
        .upsert({
          organisation_id: orgId,
          drug_id: drugId,
          drug_brand: (drugData as CDDrug).drug_brand,
          drug_form: (drugData as CDDrug).drug_form,
          drug_strength: (drugData as CDDrug).drug_strength,
          drug_class: (drugData as CDDrug).drug_class,
          drug_type: (drugData as CDDrug).drug_type,
          created_by: userId,
        }, { onConflict: 'organisation_id,drug_id', ignoreDuplicates: true })

      // Create register entry via RPC
      const today = new Date().toISOString().split('T')[0]
      const entryDate = isInvoice
        ? (scan.invoice_date || today)
        : today

      const { data: entry, error: entryError } = await getUserClient().rpc('ps_make_register_entry', {
        p_ledger_id: ledger.id,
        p_register_type: 'CD',
        p_entry_type: 'normal',
        p_date_of_transaction: entryDate,
        p_notes: `AI scan entry (confidence: ${item.confidence}/3)`,
        p_source: 'ai_scan',
        p_expected_lock_version: ledger.lock_version,
        p_transaction_type: transactionType,
        p_quantity_received: isInvoice ? quantity : null,
        p_quantity_deducted: isInvoice ? null : quantity,
        p_entered_by: userId,
        p_supplier_name: isInvoice ? (scan.supplier_name || null) : null,
        p_invoice_number: isInvoice ? (scan.invoice_number || null) : null,
        p_patient_name: !isInvoice ? (scan.patient_name || null) : null,
        p_patient_address: !isInvoice ? (scan.patient_address || null) : null,
        p_prescriber_name: !isInvoice ? (scan.prescriber_name || null) : null,
        p_prescriber_address: !isInvoice ? (scan.prescriber_address || null) : null,
        p_prescriber_registration: !isInvoice ? (scan.prescriber_registration || null) : null,
        p_prescription_date: null,
        p_witness_name: null,
        p_witness_role: null,
        p_authorised_by: null,
        p_was_id_requested: null,
        p_was_id_provided: null,
        p_scan_image_path: scan.image_path,
      })

      if (entryError) throw new Error(`Failed to create entry: ${entryError.message}`)

      const entryId = (entry as { id: string })?.id ?? null

      // Update scan item status
      await getUserClient()
        .from('ps_ai_scan_items')
        .update({
          status: 'approved',
          entry_id: entryId,
          approved_by: userId,
          approved_at: new Date().toISOString(),
          ...(drugId !== item.matched_drug_id ? { edited_drug_id: drugId, edited_quantity: quantity } : {}),
        })
        .eq('id', item.id)

      // Check if all items are now approved/rejected — update scan status
      const { data: remainingItems } = await getUserClient()
        .from('ps_ai_scan_items')
        .select('status')
        .eq('scan_id', scan.id)

      const allDone = remainingItems?.every(
        (i: { status: string }) => i.status === 'approved' || i.status === 'rejected'
      )
      const someDone = remainingItems?.some(
        (i: { status: string }) => i.status === 'approved' || i.status === 'rejected'
      )

      if (allDone) {
        await getUserClient().from('ps_ai_scan_queue').update({
          status: 'fully_approved',
          approved_at: new Date().toISOString(),
          approved_by: userId,
        }).eq('id', scan.id)
      } else if (someDone) {
        await getUserClient().from('ps_ai_scan_queue').update({
          status: 'partially_approved',
        }).eq('id', scan.id)
      }

      // Reload scan
      await get().loadScan(scan.id)

      return true
    } catch (err) {
      console.error('Failed to approve scan item:', err)
      return false
    }
  },

  // ============================================
  // Reject a scan item
  // ============================================
  rejectScanItem: async (itemId: string) => {
    try {
      await getUserClient()
        .from('ps_ai_scan_items')
        .update({ status: 'rejected' })
        .eq('id', itemId)

      // Update local state
      set({
        activeScanItems: get().activeScanItems.map((i) =>
          i.id === itemId ? { ...i, status: 'rejected' as const } : i,
        ),
      })
      return true
    } catch (err) {
      console.error('Failed to reject scan item:', err)
      return false
    }
  },

  // ============================================
  // Edit a scan item's drug match
  // ============================================
  editScanItem: async (itemId: string, drugId: string, quantity: number) => {
    try {
      // Get drug info for display
      const { data: drug } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('drug_brand, drug_form, drug_strength, drug_class')
        .eq('id', drugId)
        .single()

      await getUserClient()
        .from('ps_ai_scan_items')
        .update({
          edited_drug_id: drugId,
          edited_quantity: quantity,
          matched_drug_id: drugId,
          matched_drug_brand: drug?.drug_brand ?? null,
          matched_drug_form: drug?.drug_form ?? null,
          matched_drug_strength: drug?.drug_strength ?? null,
          matched_drug_class: drug?.drug_class ?? null,
          status: 'edited',
        })
        .eq('id', itemId)

      // Reload
      if (get().activeScan) {
        await get().loadScan(get().activeScan!.id)
      }
      return true
    } catch (err) {
      console.error('Failed to edit scan item:', err)
      return false
    }
  },

  // ============================================
  // Delete a scan (and its storage image)
  // ============================================
  deleteScan: async (scanId: string) => {
    try {
      const scan = get().queue.find((s) => s.id === scanId) ?? get().activeScan
      if (scan?.image_path) {
        await getUserClient().storage.from('scan-images').remove([scan.image_path])
      }
      await getUserClient().from('ps_ai_scan_queue').delete().eq('id', scanId)
      set({
        queue: get().queue.filter((s) => s.id !== scanId),
        ...(get().activeScan?.id === scanId ? { activeScan: null, activeScanItems: [] } : {}),
      })
      return true
    } catch (err) {
      console.error('Failed to delete scan:', err)
      return false
    }
  },

  // ============================================
  // Refresh signed image URL (if expired)
  // ============================================
  refreshImageUrl: async (scanId: string) => {
    try {
      const scan = get().queue.find((s) => s.id === scanId) ?? get().activeScan
      if (!scan?.image_path) return null

      const { data } = await getUserClient().storage
        .from('scan-images')
        .createSignedUrl(scan.image_path, 3600) // 1 hour

      const url = data?.signedUrl ?? null

      if (url) {
        // Update local state
        set({
          queue: get().queue.map((s) => s.id === scanId ? { ...s, image_url: url } : s),
          ...(get().activeScan?.id === scanId ? { activeScan: { ...get().activeScan!, image_url: url } } : {}),
        })
      }

      return url
    } catch {
      return null
    }
  },

  reset: () => set({
    queue: [],
    queueLoading: false,
    activeQueueFilter: 'all',
    activeScan: null,
    activeScanItems: [],
    activeScanLoading: false,
    isUploading: false,
    uploadProgress: 0,
  }),
}))
