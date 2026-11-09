// ============================================
// SOPs — data access for the mobile app.
//
// Mirrors the web store (packages/core/src/stores/sop-store.ts), which the
// mobile app can't import. All reads go through the personal session
// (userClient), so the database's RLS decides what each person sees:
//   - staff see published SOPs of their pharmacy and sign their own copy
//   - SOP managers (owner, manager, pharmacist or sop_upload) see progress
//   - locums see SOPs of pharmacies they have a booking with
// Sign-offs are insert-only; the database sets the time and signer.
// ============================================

import { userClient } from '@/lib/supabase'
import type { OrganisationMember } from '@/types/auth'

export const SOP_BUCKET = 'sop-pdfs'

export type SOPDoc = {
  id: string
  org_id: string
  title: string
  description: string | null
  version: number
  status: 'draft' | 'published' | 'archived'
  published_at: string | null
  has_unpublished_changes?: boolean
  review_interval_months?: number
  next_review_due?: string | null
  last_reviewed_at?: string | null
}

export type SOPSection = {
  id: string
  parent_id: string | null
  title: string
  content_type: 'rich_text' | 'pdf' | 'none'
  rich_content: string | null
  pdf_storage_path: string | null
  sort_order: number
  depth: number
}

export type SOPCompletion = {
  id: string
  document_id: string
  document_version: number
  member_id: string | null
  user_id?: string | null
  signer_name?: string | null
  completed_at: string
}

export type SOPReview = {
  id: string
  version: number
  outcome: 'first_published' | 'new_version' | 'no_changes'
  notes: string | null
  reviewed_at: string
  reviewer_name: string | null
  next_review_due: string | null
}

export type ReadState = 'signed' | 'reread' | 'todo'

/** Same rule as the web: owner, manager, pharmacist, or the sop_upload permission. */
export function canManageSOPs(m: OrganisationMember | null | undefined): boolean {
  if (!m || m.status !== 'active') return false
  if ((m as { access_expires_at?: string | null }).access_expires_at) return false
  return ['owner', 'manager', 'pharmacist'].includes(m.role) || m.permissions?.sop_upload === true
}

export type ReviewStatus = 'overdue' | 'due_soon' | 'ok' | null

export function reviewStatus(doc: Pick<SOPDoc, 'status' | 'next_review_due'>): ReviewStatus {
  if (doc.status !== 'published' || !doc.next_review_due) return null
  const due = new Date(`${doc.next_review_due}T00:00:00`)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return 'overdue'
  if (days <= 30) return 'due_soon'
  return 'ok'
}

export function ukDate(d: string | null | undefined): string {
  if (!d) return '–'
  return new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Sign-off for the current version, else the newest one. */
export function pickCompletion(list: SOPCompletion[], docId: string, memberId: string, version: number) {
  const mine = list.filter((c) => c.document_id === docId && c.member_id === memberId)
  if (mine.length === 0) return null
  return mine.find((c) => c.document_version === version) ?? mine.reduce((a, b) => (b.document_version > a.document_version ? b : a))
}

function readState(c: SOPCompletion | null, version: number): ReadState {
  if (!c) return 'todo'
  return c.document_version === version ? 'signed' : 'reread'
}

/** Sort a flat node list into reading order with depth. */
function ordered(nodes: Omit<SOPSection, 'depth'>[]): SOPSection[] {
  const byParent = new Map<string | null, Omit<SOPSection, 'depth'>[]>()
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) {
    const key = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null
    byParent.set(key, [...(byParent.get(key) ?? []), n])
  }
  const out: SOPSection[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const n of (byParent.get(parent) ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
      out.push({ ...n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

// ── Staff ─────────────────────────────────────────────────────

export type MySOP = SOPDoc & { completion: SOPCompletion | null; state: ReadState }

export async function fetchMySOPs(orgId: string, memberId: string): Promise<MySOP[]> {
  const { data: assignments, error: aErr } = await userClient
    .from('ps_sop_assignments')
    .select('document_id')
    .eq('org_id', orgId)
    .or(`member_id.is.null,member_id.eq.${memberId}`)
  if (aErr) throw aErr
  const ids = [...new Set((assignments ?? []).map((a: { document_id: string }) => a.document_id))]
  if (ids.length === 0) return []

  const [docsRes, compRes] = await Promise.all([
    userClient.from('ps_sop_documents').select('*').in('id', ids).eq('status', 'published').order('title'),
    userClient.from('ps_sop_completions').select('*').eq('org_id', orgId).eq('member_id', memberId),
  ])
  if (docsRes.error) throw docsRes.error
  if (compRes.error) throw compRes.error
  const comps = (compRes.data ?? []) as SOPCompletion[]
  const order: Record<ReadState, number> = { reread: 0, todo: 1, signed: 2 }
  return ((docsRes.data ?? []) as SOPDoc[])
    .map((d) => {
      const completion = pickCompletion(comps, d.id, memberId, d.version)
      return { ...d, completion, state: readState(completion, d.version) }
    })
    .sort((a, b) => order[a.state] - order[b.state] || a.title.localeCompare(b.title))
}

/** The frozen copy staff sign for (falls back to live sections for SOPs published before versioning). */
export async function fetchSOPForReading(docId: string): Promise<{ doc: SOPDoc; sections: SOPSection[] }> {
  const { data: doc, error } = await userClient.from('ps_sop_documents').select('*').eq('id', docId).single()
  if (error) throw error
  const d = doc as SOPDoc
  const { data: frozen } = await userClient
    .from('ps_sop_document_versions')
    .select('title, description, nodes')
    .eq('document_id', docId)
    .eq('version', d.version)
    .maybeSingle()
  if (frozen) {
    const f = frozen as { title: string; description: string | null; nodes: Omit<SOPSection, 'depth'>[] }
    return { doc: { ...d, title: f.title, description: f.description }, sections: ordered(f.nodes ?? []) }
  }
  const { data: live, error: lErr } = await userClient
    .from('ps_sop_nodes')
    .select('id, parent_id, title, content_type, rich_content, pdf_storage_path, sort_order')
    .eq('document_id', docId)
  if (lErr) throw lErr
  return { doc: d, sections: ordered((live ?? []) as Omit<SOPSection, 'depth'>[]) }
}

export async function signSOP(doc: SOPDoc, memberId: string): Promise<void> {
  const { error } = await userClient
    .from('ps_sop_completions')
    .insert({ document_id: doc.id, document_version: doc.version, member_id: memberId, org_id: doc.org_id })
  if (error && error.code !== '23505') throw error // 23505: already signed this version
}

export async function signedUrl(path: string): Promise<string> {
  if (/^https?:\/\//.test(path)) return path
  const { data, error } = await userClient.storage.from(SOP_BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw error ?? new Error('Could not open the file')
  return data.signedUrl
}

// ── Managers ──────────────────────────────────────────────────

export type TeamMemberStatus = { memberId: string; name: string; role: string; state: ReadState; signedAt: string | null }
export type TeamSOP = SOPDoc & { assigned: number; signed: number; members: TeamMemberStatus[] }

export async function fetchTeamSOPs(orgId: string): Promise<TeamSOP[]> {
  const [docsRes, assignRes, compRes, memRes] = await Promise.all([
    userClient.from('ps_sop_documents').select('*').eq('org_id', orgId).neq('status', 'draft').order('title'),
    userClient.from('ps_sop_assignments').select('document_id, member_id').eq('org_id', orgId),
    userClient.from('ps_sop_completions').select('*').eq('org_id', orgId),
    userClient
      .from('ps_organisation_members')
      .select('id, role, status, access_expires_at, user_profile:ps_user_profiles(full_name)')
      .eq('organisation_id', orgId)
      .eq('status', 'active'),
  ])
  for (const r of [docsRes, assignRes, compRes, memRes]) if (r.error) throw r.error
  const assignments = (assignRes.data ?? []) as { document_id: string; member_id: string | null }[]
  const comps = (compRes.data ?? []) as SOPCompletion[]
  const members = ((memRes.data ?? []) as unknown as {
    id: string
    role: string
    access_expires_at: string | null
    user_profile: { full_name: string | null } | null
  }[]).filter((m) => !m.access_expires_at)

  return ((docsRes.data ?? []) as SOPDoc[]).map((d) => {
    const mine = assignments.filter((a) => a.document_id === d.id)
    const all = mine.some((a) => a.member_id === null)
    const ids = new Set(mine.map((a) => a.member_id))
    const list = members
      .filter((m) => all || ids.has(m.id))
      .map((m) => {
        const c = pickCompletion(comps, d.id, m.id, d.version)
        return {
          memberId: m.id,
          name: m.user_profile?.full_name || 'Team member',
          role: m.role,
          state: readState(c, d.version),
          signedAt: c?.completed_at ?? null,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ...d, assigned: list.length, signed: list.filter((m) => m.state === 'signed').length, members: list }
  })
}

export async function fetchReviews(docId: string): Promise<SOPReview[]> {
  const { data, error } = await userClient
    .from('ps_sop_reviews')
    .select('id, version, outcome, notes, reviewed_at, reviewer_name, next_review_due')
    .eq('document_id', docId)
    .order('reviewed_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as SOPReview[]
}

export async function markReviewed(docId: string, notes?: string): Promise<SOPDoc> {
  const { data, error } = await userClient.rpc('ps_sop_mark_reviewed', {
    p_document_id: docId,
    p_notes: notes?.trim() || null,
  })
  if (error) throw error
  return data as SOPDoc
}

// ── Locums ────────────────────────────────────────────────────

export type LocumSOP = {
  id: string
  org_id: string
  org_name: string
  title: string
  description: string | null
  file_url: string | null
  version: number
  is_required: boolean
  signed_at: string | null
}

export async function fetchLocumSOPs(locumId: string): Promise<LocumSOP[]> {
  const { data: bookings, error: bErr } = await userClient
    .from('ps_locum_bookings')
    .select('shift:ps_locum_shifts(org_id)')
    .eq('locum_id', locumId)
    .in('status', ['pending', 'approved', 'completed'])
  if (bErr) throw bErr
  const orgIds = [
    ...new Set(
      ((bookings ?? []) as unknown as { shift: { org_id: string } | null }[]).flatMap((b) => (b.shift ? [b.shift.org_id] : [])),
    ),
  ]
  if (orgIds.length === 0) return []

  const [sopRes, signRes, orgRes] = await Promise.all([
    userClient
      .from('ps_locum_sop_documents')
      .select('id, title, description, file_url, version, is_required, org_id')
      .in('org_id', orgIds)
      .eq('is_active', true)
      .order('title'),
    userClient.from('ps_locum_sop_signoffs').select('sop_id, sop_version, signed_at').eq('locum_id', locumId),
    userClient.rpc('ps_locum_shift_orgs', { p_org_ids: orgIds }),
  ])
  if (sopRes.error) throw sopRes.error
  if (signRes.error) throw signRes.error
  const names: Record<string, string> = {}
  for (const o of (orgRes.data ?? []) as { id: string; name: string }[]) names[o.id] = o.name
  const signs = (signRes.data ?? []) as { sop_id: string; sop_version: number; signed_at: string }[]

  return ((sopRes.data ?? []) as Omit<LocumSOP, 'org_name' | 'signed_at'>[])
    .map((s) => ({
      ...s,
      org_name: names[s.org_id] ?? 'Pharmacy',
      signed_at: signs.find((x) => x.sop_id === s.id && x.sop_version === s.version)?.signed_at ?? null,
    }))
    .sort((a, b) => a.org_name.localeCompare(b.org_name) || Number(!!a.signed_at) - Number(!!b.signed_at) || a.title.localeCompare(b.title))
}

export async function signLocumSOP(sop: LocumSOP, locumId: string): Promise<void> {
  const { error } = await userClient
    .from('ps_locum_sop_signoffs')
    .insert({ sop_id: sop.id, locum_id: locumId, sop_version: sop.version, signed_at: new Date().toISOString() })
  if (error && error.code !== '23505') throw error
}
