import { create } from 'zustand'
import type {
  SOPDocument,
  SOPDocumentVersion,
  SOPNode,
  SOPAssignment,
  SOPCompletion,
  OrganisationMember,
  SOPMemberProgress,
} from '@pharmstation/types'
import { resolvePermissions } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

const SOP_BUCKET = 'sop-pdfs'

// ============================================================
// Helpers
// ============================================================

/** Build a flat list into a tree, sorting by sort_order */
export function buildNodeTree(nodes: SOPNode[]): SOPNode[] {
  const map = new Map<string, SOPNode>()
  const roots: SOPNode[] = []

  for (const n of nodes) {
    map.set(n.id, { ...n, children: [], depth: 0 })
  }

  for (const n of map.values()) {
    if (n.parent_id && map.has(n.parent_id)) {
      const parent = map.get(n.parent_id)!
      parent.children = parent.children ?? []
      parent.children.push(n)
      n.depth = (parent.depth ?? 0) + 1
    } else {
      n.parent_id = null
      roots.push(n)
    }
  }

  const sortChildren = (list: SOPNode[]) => {
    list.sort((a, b) => a.sort_order - b.sort_order)
    for (const n of list) n.children && sortChildren(n.children)
  }
  sortChildren(roots)

  return roots
}

/** Flatten a tree back to a list (depth-first pre-order) */
export function flattenNodeTree(nodes: SOPNode[]): SOPNode[] {
  const result: SOPNode[] = []
  const walk = (list: SOPNode[]) => {
    for (const n of list) {
      result.push(n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return result
}

/**
 * Can this staff member build, publish and assign SOPs? Mirrors
 * ps_is_sop_manager() in the database, which is what actually enforces it:
 * owners, managers and pharmacists, or anyone given the sop_upload permission.
 */
export function canManageSOPs(member: Pick<OrganisationMember, 'role' | 'permissions' | 'status'> | null | undefined): boolean {
  if (!member || member.status !== 'active') return false
  if (['owner', 'manager', 'pharmacist'].includes(member.role)) return true
  return !!resolvePermissions(member.role, member.permissions ?? {}).sop_upload
}

/** Locum SOPs (Shifts > SOPs) can also be managed by whoever manages locums. Mirrors ps_can_manage_locum_sops(). */
export function canManageLocumSOPs(member: Pick<OrganisationMember, 'role' | 'permissions' | 'status'> | null | undefined): boolean {
  if (canManageSOPs(member)) return true
  return !!member && member.status === 'active' && !!resolvePermissions(member.role, member.permissions ?? {}).approve_locums
}

/**
 * The sign-off that counts for a staff member: the one for the current version
 * if there is one, otherwise their newest. (A member who has signed several
 * versions has several rows; picking any row at random gave wrong statuses.)
 */
export function pickCompletion(
  completions: SOPCompletion[],
  documentId: string,
  memberId: string | null | undefined,
  currentVersion: number | null | undefined,
): SOPCompletion | null {
  if (!memberId) return null
  const mine = completions.filter((c) => c.document_id === documentId && c.member_id === memberId)
  if (mine.length === 0) return null
  return (
    mine.find((c) => c.document_version === currentVersion) ??
    mine.reduce((a, b) => (b.document_version > a.document_version ? b : a))
  )
}

/** Turn a frozen version's sections into SOPNode rows the reader can show. */
function versionNodes(v: SOPDocumentVersion): SOPNode[] {
  return (v.nodes ?? []).map((n) => ({
    ...n,
    document_id: v.document_id,
    created_at: v.published_at,
    updated_at: v.published_at,
  }))
}

/** Every file path a frozen version of this SOP still points at (these must be kept). */
async function pathsKeptByVersions(docId: string): Promise<Set<string>> {
  const { data } = await getUserClient()
    .from('ps_sop_document_versions')
    .select('nodes')
    .eq('document_id', docId)
  const keep = new Set<string>()
  for (const v of (data ?? []) as { nodes: SOPDocumentVersion['nodes'] }[]) {
    for (const n of v.nodes ?? []) if (n.pdf_storage_path) keep.add(n.pdf_storage_path)
  }
  return keep
}

/** Remove uploaded files nothing points at any more. Best effort: a failure leaves an orphan file, nothing worse. */
async function removeUnusedFiles(docId: string, paths: (string | null | undefined)[], stillUsed: string[] = []) {
  const candidates = [...new Set(paths.filter((p): p is string => !!p))]
  if (candidates.length === 0) return
  const keep = await pathsKeptByVersions(docId)
  for (const p of stillUsed) keep.add(p)
  const remove = candidates.filter((p) => !keep.has(p))
  if (remove.length) await getUserClient().storage.from(SOP_BUCKET).remove(remove)
}

/** List every file under a folder of the sop-pdfs bucket (two levels: <doc>/<node>/<file>). */
async function listFolderFiles(folder: string): Promise<string[]> {
  const storage = getUserClient().storage.from(SOP_BUCKET)
  const { data: top } = await storage.list(folder, { limit: 1000 })
  const out: string[] = []
  for (const entry of top ?? []) {
    const path = `${folder}/${entry.name}`
    if (entry.id) {
      out.push(path)
    } else {
      const { data: inner } = await storage.list(path, { limit: 1000 })
      for (const f of inner ?? []) if (f.id) out.push(`${path}/${f.name}`)
    }
  }
  return out
}

// ============================================================
// Store
// ============================================================

export interface SOPState {
  // Data
  documents: SOPDocument[]
  activeDocument: SOPDocument | null
  /** The frozen published copy staff read (null for a never-published SOP). */
  activeVersion: SOPDocumentVersion | null
  activeNodes: SOPNode[]        // flat list for the active document
  activeNodeTree: SOPNode[]     // tree version
  selectedNodeId: string | null
  assignments: SOPAssignment[]
  completions: SOPCompletion[]
  memberProgress: SOPMemberProgress[]
  loading: boolean
  saving: boolean
  error: string | null

  // --- Document actions ---
  fetchDocuments: (orgId: string) => Promise<void>
  fetchDocument: (docId: string) => Promise<void>
  /** Load an SOP for staff to read: the frozen copy of its current published version. */
  fetchDocumentForReading: (docId: string) => Promise<void>
  createDocument: (data: { org_id: string; title: string; description?: string; created_by?: string }) => Promise<SOPDocument>
  updateDocument: (docId: string, updates: Partial<SOPDocument>) => Promise<void>
  publishDocument: (docId: string) => Promise<boolean>
  archiveDocument: (docId: string) => Promise<void>
  deleteDocument: (docId: string) => Promise<void>

  // --- Node actions ---
  fetchNodes: (docId: string) => Promise<void>
  createNode: (data: { document_id: string; parent_id: string | null; title: string; sort_order: number }) => Promise<SOPNode>
  updateNode: (nodeId: string, updates: Partial<SOPNode>) => Promise<void>
  deleteNode: (nodeId: string) => Promise<void>
  moveNode: (nodeId: string, newParentId: string | null, newOrder: number) => Promise<void>
  setSelectedNode: (nodeId: string | null) => void

  // --- PDF upload ---
  uploadNodePDF: (nodeId: string, docId: string, file: File) => Promise<string>
  /** All sign-offs for an SOP, every version, with names, for the inspection export. */
  fetchSignOffHistory: (docId: string) => Promise<SOPCompletion[]>
  getNodePDFUrl: (path: string) => Promise<string>

  // --- Assignments ---
  fetchAssignments: (docId: string) => Promise<void>
  assignToAll: (docId: string, orgId: string, assignedBy: string) => Promise<void>
  assignToMember: (docId: string, orgId: string, memberId: string, assignedBy: string) => Promise<void>
  removeAssignment: (assignmentId: string) => Promise<void>
  removeAllAssignments: (docId: string) => Promise<void>

  // --- Completions ---
  fetchCompletions: (docId: string, orgId: string) => Promise<void>
  markComplete: (docId: string, version: number, memberId: string, orgId: string) => Promise<void>
  fetchMemberProgress: (docId: string, orgId: string) => Promise<void>

  // --- Staff view ---
  fetchMyDocuments: (orgId: string, memberId: string) => Promise<void>

  clearError: () => void
}

export const useSOPStore = create<SOPState>((set, get) => {
  /** Mirror the database: changing a published SOP's sections leaves unpublished changes. */
  const markChanged = () =>
    set((s) =>
      s.activeDocument?.published_at && !s.activeDocument.has_unpublished_changes
        ? { activeDocument: { ...s.activeDocument, has_unpublished_changes: true } }
        : {},
    )

  return {
  documents: [],
  activeDocument: null,
  activeVersion: null,
  activeNodes: [],
  activeNodeTree: [],
  selectedNodeId: null,
  assignments: [],
  completions: [],
  memberProgress: [],
  loading: false,
  saving: false,
  error: null,

  // ── Documents ──────────────────────────────────────────────

  fetchDocuments: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_sop_documents')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      set({ documents: data as SOPDocument[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchDocument: async (docId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const [docRes, nodesRes] = await Promise.all([
        client.from('ps_sop_documents').select('*').eq('id', docId).single(),
        client.from('ps_sop_nodes').select('*').eq('document_id', docId).order('sort_order'),
      ])
      if (docRes.error) throw docRes.error
      if (nodesRes.error) throw nodesRes.error
      const nodes = nodesRes.data as SOPNode[]
      const tree = buildNodeTree(nodes)
      set({
        activeDocument: docRes.data as SOPDocument,
        activeVersion: null,
        activeNodes: nodes,
        activeNodeTree: tree,
        loading: false,
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchDocumentForReading: async (docId) => {
    set({ loading: true, error: null, activeVersion: null })
    try {
      const client = getUserClient()
      const { data: doc, error: docErr } = await client.from('ps_sop_documents').select('*').eq('id', docId).single()
      if (docErr) throw docErr
      const document = doc as SOPDocument
      const { data: ver, error: verErr } = await client
        .from('ps_sop_document_versions')
        .select('*')
        .eq('document_id', docId)
        .eq('version', document.version)
        .maybeSingle()
      // If the frozen-versions table isn't there yet, fall back to the live sections.
      const frozen = verErr ? null : ver

      let nodes: SOPNode[]
      if (frozen) {
        nodes = versionNodes(frozen as SOPDocumentVersion)
      } else {
        // Never published (a manager previewing a draft): show the live sections.
        const { data: live, error: liveErr } = await client
          .from('ps_sop_nodes')
          .select('*')
          .eq('document_id', docId)
          .order('sort_order')
        if (liveErr) throw liveErr
        nodes = live as SOPNode[]
      }
      set({
        activeDocument: frozen
          ? { ...document, title: (frozen as SOPDocumentVersion).title, description: (frozen as SOPDocumentVersion).description }
          : document,
        activeVersion: (frozen as SOPDocumentVersion) ?? null,
        activeNodes: nodes,
        activeNodeTree: buildNodeTree(nodes),
        loading: false,
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createDocument: async (data) => {
    const { data: doc, error } = await getUserClient()
      .from('ps_sop_documents')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    const created = doc as SOPDocument
    set((s) => ({ documents: [created, ...s.documents] }))
    return created
  },

  updateDocument: async (docId, updates) => {
    set({ saving: true })
    try {
      const { error } = await getUserClient()
        .from('ps_sop_documents')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', docId)
      if (error) throw error
      set((s) => ({
        saving: false,
        documents: s.documents.map((d) => (d.id === docId ? { ...d, ...updates } : d)),
        activeDocument: s.activeDocument?.id === docId ? { ...s.activeDocument, ...updates } : s.activeDocument,
      }))
      if ('title' in updates || 'description' in updates) markChanged()
    } catch (e: any) {
      set({ error: e.message, saving: false })
    }
  },

  publishDocument: async (docId) => {
    set({ saving: true, error: null })
    try {
      // The database freezes a copy of the SOP, works out the version and tells
      // assigned staff to re-read when it is a new version.
      const { data, error } = await getUserClient().rpc('ps_sop_publish', { p_document_id: docId })
      if (error) throw error
      const published = data as SOPDocument
      set((s) => ({
        saving: false,
        documents: s.documents.map((d) => (d.id === docId ? { ...d, ...published } : d)),
        activeDocument: s.activeDocument?.id === docId ? { ...s.activeDocument, ...published } : s.activeDocument,
      }))
      return true
    } catch (e: any) {
      set({ error: e.message, saving: false })
      return false
    }
  },

  archiveDocument: async (docId) => {
    await get().updateDocument(docId, { status: 'archived' })
  },

  deleteDocument: async (docId) => {
    // The database refuses when anyone has signed it (archive instead).
    const { data, error } = await getUserClient().from('ps_sop_documents').delete().eq('id', docId).select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('This SOP could not be deleted. You may not have permission.')
    set((s) => ({ documents: s.documents.filter((d) => d.id !== docId) }))
    // Clean up its uploaded files (best effort).
    try {
      const files = await listFolderFiles(docId)
      if (files.length) await getUserClient().storage.from(SOP_BUCKET).remove(files)
    } catch {
      /* orphaned files are harmless */
    }
  },

  // ── Nodes ──────────────────────────────────────────────────

  fetchNodes: async (docId) => {
    const { data, error } = await getUserClient()
      .from('ps_sop_nodes')
      .select('*')
      .eq('document_id', docId)
      .order('sort_order')
    if (error) throw error
    const nodes = data as SOPNode[]
    set({ activeNodes: nodes, activeNodeTree: buildNodeTree(nodes) })
  },

  createNode: async (data) => {
    const { data: node, error } = await getUserClient()
      .from('ps_sop_nodes')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    const created = node as SOPNode
    const updated = [...get().activeNodes, created]
    set({ activeNodes: updated, activeNodeTree: buildNodeTree(updated), selectedNodeId: created.id })
    markChanged()
    return created
  },

  updateNode: async (nodeId, updates) => {
    set({ saving: true })
    try {
      const { error } = await getUserClient()
        .from('ps_sop_nodes')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', nodeId)
      if (error) throw error
      const updated = get().activeNodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n))
      set({ saving: false, activeNodes: updated, activeNodeTree: buildNodeTree(updated) })
      markChanged()
    } catch (e: any) {
      set({ error: e.message, saving: false })
    }
  },

  deleteNode: async (nodeId) => {
    const { error } = await getUserClient().from('ps_sop_nodes').delete().eq('id', nodeId)
    if (error) throw error
    // Remove node and all its descendants
    const allNodes = get().activeNodes
    const toDelete = new Set<string>()
    const collect = (id: string) => {
      toDelete.add(id)
      allNodes.filter((n) => n.parent_id === id).forEach((n) => collect(n.id))
    }
    collect(nodeId)
    const updated = allNodes.filter((n) => !toDelete.has(n.id))
    const docId = allNodes.find((n) => n.id === nodeId)?.document_id
    if (docId) {
      // Files of deleted sections, unless a published version still shows them.
      removeUnusedFiles(
        docId,
        allNodes.filter((n) => toDelete.has(n.id)).map((n) => n.pdf_storage_path),
        updated.map((n) => n.pdf_storage_path).filter((p): p is string => !!p),
      ).catch(() => {})
    }
    set({
      activeNodes: updated,
      activeNodeTree: buildNodeTree(updated),
      selectedNodeId: get().selectedNodeId && toDelete.has(get().selectedNodeId!) ? null : get().selectedNodeId,
    })
    markChanged()
  },

  moveNode: async (nodeId, newParentId, newOrder) => {
    const { error } = await getUserClient()
      .from('ps_sop_nodes')
      .update({ parent_id: newParentId, sort_order: newOrder, updated_at: new Date().toISOString() })
      .eq('id', nodeId)
    if (error) throw error
    const updated = get().activeNodes.map((n) =>
      n.id === nodeId ? { ...n, parent_id: newParentId, sort_order: newOrder } : n
    )
    set({ activeNodes: updated, activeNodeTree: buildNodeTree(updated) })
    markChanged()
  },

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  // ── PDF uploads ────────────────────────────────────────────

  uploadNodePDF: async (nodeId, docId, file) => {
    if (file.type && file.type !== 'application/pdf') throw new Error('Please choose a PDF file.')
    if (file.size > 20 * 1024 * 1024) throw new Error('That file is over 20 MB.')
    const previous = get().activeNodes.find((n) => n.id === nodeId)?.pdf_storage_path ?? null
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    const path = `${docId}/${nodeId}/${Date.now()}_${safeName}`
    const { error } = await getUserClient().storage.from(SOP_BUCKET).upload(path, file, {
      upsert: false,
      contentType: 'application/pdf',
    })
    if (error) throw error
    await get().updateNode(nodeId, { content_type: 'pdf', pdf_storage_path: path })
    if (get().error) throw new Error(get().error!)
    // The replaced file, unless a published version still shows it.
    if (previous && previous !== path) removeUnusedFiles(docId, [previous], [path]).catch(() => {})
    return path
  },

  getNodePDFUrl: async (path) => {
    const { data } = await getUserClient().storage.from(SOP_BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl ?? ''
  },

  fetchSignOffHistory: async (docId) => {
    const { data, error } = await getUserClient()
      .from('ps_sop_completions')
      .select('*')
      .eq('document_id', docId)
      .order('completed_at', { ascending: false })
    if (error) throw error
    return data as SOPCompletion[]
  },

  // ── Assignments ────────────────────────────────────────────

  fetchAssignments: async (docId) => {
    const { data, error } = await getUserClient()
      .from('ps_sop_assignments')
      .select('*')
      .eq('document_id', docId)
    if (error) throw error
    set({ assignments: data as SOPAssignment[] })
  },

  assignToAll: async (docId, orgId, assignedBy) => {
    // Remove any specific assignments first, then add a null-member assignment
    await getUserClient().from('ps_sop_assignments').delete().eq('document_id', docId)
    const { data, error } = await getUserClient()
      .from('ps_sop_assignments')
      .insert({ document_id: docId, org_id: orgId, member_id: null, assigned_by: assignedBy })
      .select()
      .single()
    if (error) throw error
    set({ assignments: [data as SOPAssignment] })
  },

  assignToMember: async (docId, orgId, memberId, assignedBy) => {
    // Remove the "all" assignment if present
    await getUserClient()
      .from('ps_sop_assignments')
      .delete()
      .eq('document_id', docId)
      .is('member_id', null)
    const { data, error } = await getUserClient()
      .from('ps_sop_assignments')
      .upsert(
        { document_id: docId, org_id: orgId, member_id: memberId, assigned_by: assignedBy },
        { onConflict: 'document_id,member_id' },
      )
      .select()
      .single()
    if (error) throw error
    const existing = get().assignments.filter((a) => a.member_id !== memberId && a.member_id !== null)
    set({ assignments: [...existing, data as SOPAssignment] })
  },

  removeAssignment: async (assignmentId) => {
    const { error } = await getUserClient().from('ps_sop_assignments').delete().eq('id', assignmentId)
    if (error) throw error
    set((s) => ({ assignments: s.assignments.filter((a) => a.id !== assignmentId) }))
  },

  removeAllAssignments: async (docId) => {
    const { error } = await getUserClient().from('ps_sop_assignments').delete().eq('document_id', docId)
    if (error) throw error
    set({ assignments: [] })
  },

  // ── Completions ────────────────────────────────────────────

  fetchCompletions: async (docId, orgId) => {
    const { data, error } = await getUserClient()
      .from('ps_sop_completions')
      .select('*')
      .eq('document_id', docId)
      .eq('org_id', orgId)
      .order('document_version', { ascending: false })
    if (error) throw error
    set({ completions: data as SOPCompletion[] })
  },

  markComplete: async (docId, version, memberId, orgId) => {
    // Sign-offs are permanent: the database sets the time and signer, and only
    // accepts the current published version.
    const client = getUserClient()
    const { error } = await client
      .from('ps_sop_completions')
      .insert({ document_id: docId, document_version: version, member_id: memberId, org_id: orgId })
    if (error && error.code !== '23505') throw error // 23505: already signed this version
    await get().fetchCompletions(docId, orgId)
  },

  fetchMemberProgress: async (docId, orgId) => {
    set({ loading: true })
    try {
      const client = getUserClient()
      const [membersRes, completionsRes, docRes, assignRes] = await Promise.all([
        client
          .from('ps_organisation_members')
          .select('*, user_profile:ps_user_profiles(*)')
          .eq('organisation_id', orgId)
          .eq('status', 'active'),
        client.from('ps_sop_completions').select('*').eq('document_id', docId).eq('org_id', orgId),
        client.from('ps_sop_documents').select('version').eq('id', docId).single(),
        client.from('ps_sop_assignments').select('*').eq('document_id', docId),
      ])
      if (membersRes.error) throw membersRes.error
      if (completionsRes.error) throw completionsRes.error
      if (docRes.error) throw docRes.error
      if (assignRes.error) throw assignRes.error

      const currentVersion = docRes.data.version as number
      const completions = completionsRes.data as SOPCompletion[]
      const assignments = assignRes.data as SOPAssignment[]
      const assignedToAll = assignments.some((a) => a.member_id === null)
      const assignedIds = new Set(assignments.map((a) => a.member_id))

      // Only the people it was assigned to (everyone when assigned to all).
      const members = (membersRes.data as OrganisationMember[]).filter(
        (m) => assignedToAll || assignedIds.has(m.id),
      )

      const progress: SOPMemberProgress[] = members.map((m) => {
        const comp = pickCompletion(completions, docId, m.id, currentVersion)
        return {
          member: m,
          completion: comp,
          is_current_version: comp !== null && comp.document_version === currentVersion,
        }
      })

      set({ memberProgress: progress, assignments, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  // ── Staff: fetch my assigned docs ─────────────────────────

  fetchMyDocuments: async (orgId, memberId) => {
    set({ loading: true, error: null })
    try {
      // Docs assigned to all OR specifically to this member
      const { data: assignments, error: assignErr } = await getUserClient()
        .from('ps_sop_assignments')
        .select('document_id')
        .eq('org_id', orgId)
        .or(`member_id.is.null,member_id.eq.${memberId}`)
      if (assignErr) throw assignErr

      const docIds = [...new Set((assignments ?? []).map((a: any) => a.document_id))]
      if (docIds.length === 0) {
        set({ documents: [], loading: false })
        return
      }

      const { data: docs, error: docsErr } = await getUserClient()
        .from('ps_sop_documents')
        .select('*')
        .in('id', docIds)
        .eq('status', 'published')
        .order('title')
      if (docsErr) throw docsErr

      // Fetch completions for this member
      const { data: completions, error: compErr } = await getUserClient()
        .from('ps_sop_completions')
        .select('*')
        .eq('org_id', orgId)
        .eq('member_id', memberId)
      if (compErr) throw compErr

      const enriched = (docs as SOPDocument[]).map((d) => ({
        ...d,
        my_completion: pickCompletion((completions ?? []) as SOPCompletion[], d.id, memberId, d.version),
      }))

      set({ documents: enriched, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  clearError: () => set({ error: null }),
  }
})
