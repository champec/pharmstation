import { create } from 'zustand'
import type {
  SOPDocument,
  SOPNode,
  SOPAssignment,
  SOPCompletion,
  OrganisationMember,
  SOPMemberProgress,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

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

// ============================================================
// Store
// ============================================================

export interface SOPState {
  // Data
  documents: SOPDocument[]
  activeDocument: SOPDocument | null
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
  createDocument: (data: { org_id: string; title: string; description?: string; created_by?: string }) => Promise<SOPDocument>
  updateDocument: (docId: string, updates: Partial<SOPDocument>) => Promise<void>
  publishDocument: (docId: string) => Promise<void>
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

export const useSOPStore = create<SOPState>((set, get) => ({
  documents: [],
  activeDocument: null,
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
        activeNodes: nodes,
        activeNodeTree: tree,
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
    } catch (e: any) {
      set({ error: e.message, saving: false })
    }
  },

  publishDocument: async (docId) => {
    set({ saving: true })
    try {
      // Bump version and set published
      const { data: current } = await getUserClient()
        .from('ps_sop_documents')
        .select('version, status')
        .eq('id', docId)
        .single()

      const newVersion = (current?.version ?? 1) + (current?.status === 'published' ? 1 : 0)
      const { error } = await getUserClient()
        .from('ps_sop_documents')
        .update({
          status: 'published',
          version: newVersion,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', docId)
      if (error) throw error
      set((s) => ({
        saving: false,
        documents: s.documents.map((d) =>
          d.id === docId ? { ...d, status: 'published', version: newVersion } : d
        ),
        activeDocument:
          s.activeDocument?.id === docId
            ? { ...s.activeDocument, status: 'published', version: newVersion }
            : s.activeDocument,
      }))
    } catch (e: any) {
      set({ error: e.message, saving: false })
    }
  },

  archiveDocument: async (docId) => {
    await get().updateDocument(docId, { status: 'archived' })
  },

  deleteDocument: async (docId) => {
    const { error } = await getUserClient().from('ps_sop_documents').delete().eq('id', docId)
    if (error) throw error
    set((s) => ({ documents: s.documents.filter((d) => d.id !== docId) }))
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
    set({
      activeNodes: updated,
      activeNodeTree: buildNodeTree(updated),
      selectedNodeId: get().selectedNodeId && toDelete.has(get().selectedNodeId!) ? null : get().selectedNodeId,
    })
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
  },

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  // ── PDF uploads ────────────────────────────────────────────

  uploadNodePDF: async (nodeId, docId, file) => {
    const path = `${docId}/${nodeId}/${Date.now()}_${file.name}`
    const { error } = await getUserClient().storage.from('sop-pdfs').upload(path, file, {
      upsert: true,
    })
    if (error) throw error
    await get().updateNode(nodeId, { content_type: 'pdf', pdf_storage_path: path })
    return path
  },

  getNodePDFUrl: async (path) => {
    const { data } = await getUserClient().storage.from('sop-pdfs').createSignedUrl(path, 3600)
    return data?.signedUrl ?? ''
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
      .upsert({ document_id: docId, org_id: orgId, member_id: memberId, assigned_by: assignedBy })
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
    if (error) throw error
    set({ completions: data as SOPCompletion[] })
  },

  markComplete: async (docId, version, memberId, orgId) => {
    const { data, error } = await getUserClient()
      .from('ps_sop_completions')
      .upsert({ document_id: docId, document_version: version, member_id: memberId, org_id: orgId })
      .select()
      .single()
    if (error) throw error
    const comp = data as SOPCompletion
    set((s) => ({
      completions: [
        ...s.completions.filter((c) => !(c.document_id === docId && c.member_id === memberId)),
        comp,
      ],
    }))
  },

  fetchMemberProgress: async (docId, orgId) => {
    set({ loading: true })
    try {
      const client = getUserClient()
      const [membersRes, completionsRes, docRes] = await Promise.all([
        client
          .from('ps_organisation_members')
          .select('*, user_profile:ps_user_profiles(*)')
          .eq('organisation_id', orgId)
          .eq('status', 'active'),
        client.from('ps_sop_completions').select('*').eq('document_id', docId).eq('org_id', orgId),
        client.from('ps_sop_documents').select('version').eq('id', docId).single(),
      ])
      if (membersRes.error) throw membersRes.error
      if (completionsRes.error) throw completionsRes.error
      if (docRes.error) throw docRes.error

      const currentVersion = docRes.data.version as number
      const completions = completionsRes.data as SOPCompletion[]

      const progress: SOPMemberProgress[] = (membersRes.data as OrganisationMember[]).map((m) => {
        const comp = completions.find((c) => c.member_id === m.id) ?? null
        return {
          member: m,
          completion: comp,
          is_current_version: comp !== null && comp.document_version === currentVersion,
        }
      })

      set({ memberProgress: progress, loading: false })
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

      const compMap = new Map((completions ?? []).map((c: SOPCompletion) => [c.document_id, c]))

      const enriched = (docs as SOPDocument[]).map((d) => ({
        ...d,
        my_completion: compMap.get(d.id) ?? null,
      }))

      set({ documents: enriched, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
