// SOPs — staff read and sign their assigned SOPs; SOP managers see who has
// signed and keep reviews up to date. Building and assigning SOPs is web-only.
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { SOPReader, sopHtml } from '@/components/sop/SOPReader'
import {
  fetchMySOPs,
  fetchReviews,
  fetchSOPForReading,
  fetchTeamSOPs,
  markReviewed,
  reviewStatus,
  signSOP,
  ukDate,
  type MySOP,
  type ReadState,
  type SOPDoc,
  type SOPReview,
  type TeamSOP,
} from '@/lib/sops'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import { EmptyState as SharedEmptyState } from '@/components/ui/EmptyState'

export const SOP_COLOR = palette.brand

const STATE: Record<ReadState, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  signed: { label: 'Signed', color: palette.success, icon: 'checkmark-circle' },
  reread: { label: 'New version: re-read', color: palette.warning, icon: 'refresh-circle' },
  todo: { label: 'To read', color: palette.textMuted, icon: 'ellipse-outline' },
}

const OUTCOME: Record<SOPReview['outcome'], string> = {
  first_published: 'First published',
  new_version: 'New version published',
  no_changes: 'Reviewed, no changes',
}

function ReviewChip({ doc }: { doc: Pick<SOPDoc, 'status' | 'next_review_due'> }) {
  const s = reviewStatus(doc)
  if (s !== 'overdue' && s !== 'due_soon') return null
  const color = s === 'overdue' ? palette.danger : palette.warning
  return (
    <Text style={[styles.badge, { color, borderColor: color }]}>
      {s === 'overdue' ? 'Review overdue' : `Review due ${ukDate(doc.next_review_due)}`}
    </Text>
  )
}

function Empty({ icon, text, sub }: { icon: keyof typeof Ionicons.glyphMap; text: string; sub?: string }) {
  return (
    <SharedEmptyState icon={icon} title={text} text={sub} color={SOP_COLOR} />
  )
}

// ── My SOPs ──────────────────────────────────────────────────

function MySOPsScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const memberId = useAuthStore((s) => s.membership?.id)
  const [items, setItems] = useState<MySOP[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<MySOP | null>(null)
  const [reader, setReader] = useState<{ html: string | null; doc: SOPDoc | null; error: string | null }>({ html: null, doc: null, error: null })
  const [signing, setSigning] = useState(false)

  const load = useCallback(async () => {
    if (!orgId || !memberId) return
    setLoading(true)
    try {
      setItems(await fetchMySOPs(orgId, memberId))
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your SOPs')
    }
    setLoading(false)
  }, [orgId, memberId])

  useEffect(() => { void load() }, [load])

  const openSOP = async (item: MySOP) => {
    setOpen(item)
    setReader({ html: null, doc: null, error: null })
    try {
      const { doc, sections } = await fetchSOPForReading(item.id)
      setReader({ html: sopHtml(doc.title, doc.description, sections, SOP_COLOR), doc, error: null })
    } catch (e: any) {
      setReader({ html: null, doc: null, error: e?.message ?? 'Could not open this SOP' })
    }
  }

  const sign = () => {
    const doc = reader.doc
    if (!doc || !memberId) return
    Alert.alert(
      'Sign this SOP?',
      `You confirm you have read and understood "${doc.title}" (version ${doc.version}). Your sign-off is recorded and can't be changed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign',
          onPress: async () => {
            setSigning(true)
            try {
              await signSOP(doc, memberId)
              setOpen(null)
              await load()
            } catch (e: any) {
              Alert.alert('Could not sign', e?.message ?? 'Please try again.')
            }
            setSigning(false)
          },
        },
      ],
    )
  }

  const outstanding = items.filter((i) => i.state !== 'signed').length

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text style={styles.summary}>
              {outstanding === 0 ? 'All your SOPs are signed.' : `${outstanding} SOP${outstanding === 1 ? '' : 's'} to read and sign`}
            </Text>
          ) : null
        }
        ListEmptyComponent={loading ? null : <Empty icon="book-outline" text="No SOPs assigned to you" sub="When your pharmacy assigns you an SOP it will appear here." />}
        renderItem={({ item }) => {
          const st = STATE[item.state]
          return (
            <Pressable style={styles.card} onPress={() => openSOP(item)} accessibilityRole="button">
              <Ionicons name={st.icon} size={24} color={st.color} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.title}</Text>
                <Text style={styles.muted}>
                  Version {item.version}
                  {item.state === 'signed' && item.completion ? ` · signed ${ukDate(item.completion.completed_at)}` : ''}
                  {item.state === 'reread' && item.completion ? ` · you signed v${item.completion.document_version}` : ''}
                </Text>
              </View>
              <Text style={[styles.badge, { color: st.color, borderColor: st.color }]}>{st.label}</Text>
            </Pressable>
          )
        }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      />

      <SOPReader
        visible={!!open}
        onClose={() => setOpen(null)}
        title={reader.doc?.title ?? open?.title ?? 'SOP'}
        subtitle={reader.doc ? `Version ${reader.doc.version}` : undefined}
        html={reader.html}
        loading={!reader.html && !reader.error}
        error={reader.error}
        accent={SOP_COLOR}
        footer={
          open && reader.doc ? (
            open.state === 'signed' && open.completion?.document_version === reader.doc.version ? (
              <View style={styles.signedRow}>
                <Ionicons name="checkmark-circle" size={20} color={palette.success} />
                <Text style={styles.signedText}>You signed this version on {ukDate(open.completion.completed_at)}</Text>
              </View>
            ) : (
              <Pressable
                style={[styles.primary, signing && { opacity: 0.6 }]}
                onPress={sign}
                disabled={signing}
                accessibilityRole="button"
              >
                {signing ? <ActivityIndicator color="#fff" /> : <Ionicons name="create-outline" size={18} color="#fff" />}
                <Text style={styles.primaryText}>I have read and understood this SOP</Text>
              </Pressable>
            )
          ) : null
        }
      />
    </View>
  )
}

// ── Team progress (SOP managers) ─────────────────────────────

function TeamSOPsScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [items, setItems] = useState<TeamSOP[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<TeamSOP | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const list = await fetchTeamSOPs(orgId)
      setItems(list)
      setOpen((o) => (o ? list.find((d) => d.id === o.id) ?? null : null))
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load SOPs')
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { void load() }, [load])

  const published = items.filter((d) => d.status === 'published')
  const dueCount = published.filter((d) => {
    const s = reviewStatus(d)
    return s === 'overdue' || s === 'due_soon'
  }).length

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text style={styles.summary}>
              {published.length} published SOP{published.length === 1 ? '' : 's'}
              {dueCount > 0 ? ` · ${dueCount} due for review` : ''}
            </Text>
          ) : null
        }
        ListEmptyComponent={loading ? null : <Empty icon="library-outline" text="No published SOPs yet" sub="Build and publish SOPs in the web app, then track sign-offs here." />}
        renderItem={({ item }) => {
          const pct = item.assigned > 0 ? item.signed / item.assigned : 0
          return (
            <Pressable style={[styles.card, { alignItems: 'flex-start' }]} onPress={() => setOpen(item)} accessibilityRole="button">
              <View style={{ flex: 1, gap: 6 }}>
                <View style={styles.rowWrap}>
                  <Text style={[styles.name, { flexShrink: 1 }]}>{item.title}</Text>
                  {item.status === 'archived' ? <Text style={[styles.badge, { color: palette.textMuted, borderColor: palette.border }]}>Archived</Text> : null}
                  <ReviewChip doc={item} />
                </View>
                <Text style={styles.muted}>
                  v{item.version} · {item.assigned === 0 ? 'Not assigned' : `${item.signed} of ${item.assigned} signed`}
                </Text>
                {item.assigned > 0 ? (
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: pct === 1 ? palette.success : SOP_COLOR }]} />
                  </View>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
            </Pressable>
          )
        }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      />
      <TeamSOPDetail doc={open} onClose={() => setOpen(null)} onChanged={load} />
    </View>
  )
}

function TeamSOPDetail({ doc, onClose, onChanged }: { doc: TeamSOP | null; onClose: () => void; onChanged: () => void }) {
  const [reviews, setReviews] = useState<SOPReview[] | null>(null)
  const [notes, setNotes] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setReviews(null)
    setReviewing(false)
    setNotes('')
    if (doc) fetchReviews(doc.id).then(setReviews).catch(() => setReviews([]))
  }, [doc?.id])

  if (!doc) return null
  const canMark = doc.status === 'published' && !doc.has_unpublished_changes

  const confirm = async () => {
    setSaving(true)
    try {
      await markReviewed(doc.id, notes)
      setReviewing(false)
      setNotes('')
      setReviews(await fetchReviews(doc.id))
      onChanged()
    } catch (e: any) {
      Alert.alert('Could not record the review', e?.message ?? 'Please try again.')
    }
    setSaving(false)
  }

  const groups: { state: ReadState; title: string }[] = [
    { state: 'todo', title: 'Not signed yet' },
    { state: 'reread', title: 'Signed an older version' },
    { state: 'signed', title: 'Signed this version' },
  ]

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.bg }]} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={palette.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{doc.title}</Text>
            <Text style={styles.muted}>Version {doc.version} · {doc.signed} of {doc.assigned} signed</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
          {doc.review_interval_months !== undefined ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Review</Text>
            <View style={styles.rowWrap}>
              <Text style={styles.body}>
                {doc.next_review_due ? `Next review due ${ukDate(doc.next_review_due)}` : 'No review date set'}
                {doc.review_interval_months ? ` (every ${doc.review_interval_months} months)` : ''}
              </Text>
              <ReviewChip doc={doc} />
            </View>
            {doc.has_unpublished_changes ? (
              <Text style={styles.muted}>There are edits that aren't published. Publish a new version on the web instead.</Text>
            ) : null}
            {reviewing ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.muted}>Record that the SOP is still correct. Staff won't need to sign again.</Text>
                <TextInput
                  style={styles.input}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Notes (optional)"
                  placeholderTextColor={palette.textMuted}
                  multiline
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable style={[styles.secondary, { flex: 1 }]} onPress={() => setReviewing(false)}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={[styles.primary, { flex: 1 }, saving && { opacity: 0.6 }]} onPress={confirm} disabled={saving}>
                    {saving ? <ActivityIndicator color="#fff" /> : null}
                    <Text style={styles.primaryText}>Mark reviewed</Text>
                  </Pressable>
                </View>
              </View>
            ) : canMark ? (
              <Pressable style={styles.secondary} onPress={() => setReviewing(true)} accessibilityRole="button">
                <Ionicons name="checkmark-done-outline" size={18} color={SOP_COLOR} />
                <Text style={styles.secondaryText}>Reviewed, no changes needed</Text>
              </Pressable>
            ) : null}
          </View>
          ) : null}

          {doc.assigned === 0 ? (
            <View style={styles.panel}>
              <Text style={styles.muted}>This SOP isn't assigned to anyone yet. Assign it in the web app.</Text>
            </View>
          ) : (
            groups.map((g) => {
              const people = doc.members.filter((m) => m.state === g.state)
              if (people.length === 0) return null
              return (
                <View key={g.state} style={styles.panel}>
                  <Text style={styles.panelTitle}>{g.title} ({people.length})</Text>
                  {people.map((m) => (
                    <View key={m.memberId} style={styles.personRow}>
                      <Ionicons name={STATE[m.state].icon} size={18} color={STATE[m.state].color} />
                      <Text style={[styles.body, { flex: 1 }]}>{m.name}</Text>
                      <Text style={styles.muted}>{m.signedAt ? ukDate(m.signedAt) : m.role}</Text>
                    </View>
                  ))}
                </View>
              )
            })
          )}

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Review history</Text>
            {reviews === null ? (
              <ActivityIndicator color={SOP_COLOR} />
            ) : reviews.length === 0 ? (
              <Text style={styles.muted}>No reviews recorded yet.</Text>
            ) : (
              reviews.map((r) => (
                <View key={r.id} style={styles.reviewRow}>
                  <Text style={styles.body}>
                    {ukDate(r.reviewed_at)} · v{r.version} · {OUTCOME[r.outcome] ?? r.outcome}
                  </Text>
                  <Text style={styles.muted}>
                    {r.reviewer_name ?? 'Not recorded'}
                    {r.next_review_due ? ` · next due ${ukDate(r.next_review_due)}` : ''}
                  </Text>
                  {r.notes ? <Text style={styles.body}>{r.notes}</Text> : null}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

export const sopScreens: Record<string, ComponentType> = {
  mine: MySOPsScreen,
  team: TeamSOPsScreen,
}

export const sopStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  error: { color: palette.danger, paddingHorizontal: 16, paddingTop: 12 },
  summary: { fontSize: 14, fontWeight: '600', color: palette.text, marginBottom: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginBottom: 10,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  name: { fontSize: 15, fontWeight: '600', color: palette.text },
  muted: { fontSize: 13, color: palette.textMuted },
  body: { fontSize: 14, color: palette.text },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  empty: { alignItems: 'center', gap: 8, paddingTop: 60, paddingHorizontal: 24 },
  emptyText: { fontSize: 16, fontWeight: '600', color: palette.text },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: SOP_COLOR,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: SOP_COLOR,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  secondaryText: { color: SOP_COLOR, fontWeight: '600', fontSize: 15 },
  signedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  signedText: { color: palette.success, fontWeight: '600' },
  rowWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  bar: { height: 6, borderRadius: 3, backgroundColor: palette.border, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.text },
  panel: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 10 },
  panelTitle: { fontSize: 13, fontWeight: '700', color: palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewRow: { gap: 2, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.sm,
    padding: 10,
    minHeight: 60,
    color: palette.text,
    textAlignVertical: 'top',
  },
})
const styles = sopStyles
