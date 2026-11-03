// Communications — Messages (pharmacy network + patient SMS) and Alerts.
// Reads the same tables as the web Messaging Hub, Network and bell feed.
import { useEffect, useRef, useState, type ComponentType } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  NETWORK_LABELS,
  labelInfo,
  useCommsStore,
  type AlertItem,
  type NetworkLabel,
  type NetworkPharmacy,
  type NetworkThread,
  type SmsConversation,
} from '@/stores/comms-store'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

const COLOR = '#0EA5E9'
const COLOR_TINT = '#E0F2FE'

// ---------------------------------------------------------------- helpers

function when(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const days = (now.getTime() - d.getTime()) / 86_400_000
  if (days < 6) return d.toLocaleDateString('en-GB', { weekday: 'short' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fullWhen(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function prettyPhone(phone: string) {
  return phone.startsWith('+44') ? `0${phone.slice(3)}` : phone
}

/** Keeps comms data loaded and live while a Communications tab is open. */
function useComms() {
  const subscribe = useCommsStore((s) => s.subscribe)
  const unsubscribe = useCommsStore((s) => s.unsubscribe)
  const orgId = useAuthStore((s) => s.organisation?.id)
  useEffect(() => {
    if (!orgId) return
    const s = useCommsStore.getState()
    void s.loadNetwork()
    void s.loadSms()
    void s.loadAlerts()
    subscribe()
    return () => unsubscribe()
  }, [orgId, subscribe, unsubscribe])
}

// ---------------------------------------------------------------- Messages tab

function MessagesScreen() {
  useComms()
  const [view, setView] = useState<'pharmacies' | 'patients'>('pharmacies')
  const networkUnread = useCommsStore((s) => s.networkUnread)
  const smsUnread = useCommsStore((s) => s.smsUnread)
  const [openThread, setOpenThread] = useState<NetworkThread | null>(null)
  const [openSms, setOpenSms] = useState<SmsConversation | null>(null)
  const [composing, setComposing] = useState(false)

  return (
    <View style={styles.screen}>
      <View style={styles.segmented}>
        <Segment label="Pharmacies" count={networkUnread} active={view === 'pharmacies'} onPress={() => setView('pharmacies')} />
        <Segment label="Patients" count={smsUnread} active={view === 'patients'} onPress={() => setView('patients')} />
      </View>

      {view === 'pharmacies'
        ? <NetworkList onOpen={setOpenThread} onCompose={() => setComposing(true)} />
        : <SmsList onOpen={setOpenSms} />}

      <NetworkThreadModal thread={openThread} onClose={() => setOpenThread(null)} />
      <SmsThreadModal conversation={openSms} onClose={() => setOpenSms(null)} />
      <ComposeModal
        visible={composing}
        onClose={() => setComposing(false)}
        onSent={() => setComposing(false)}
      />
    </View>
  )
}

function Segment({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active && styles.segmentActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
      {count > 0 ? <View style={styles.countBadge}><Text style={styles.countText}>{count}</Text></View> : null}
    </Pressable>
  )
}

function NetworkList({ onOpen, onCompose }: { onOpen: (t: NetworkThread) => void; onCompose: () => void }) {
  const threads = useCommsStore((s) => s.threads)
  const loading = useCommsStore((s) => s.networkLoading)
  const error = useCommsStore((s) => s.networkError)
  const load = useCommsStore((s) => s.loadNetwork)

  return (
    <View style={styles.flex}>
      <Pressable style={({ pressed }) => [styles.newButton, pressed && styles.pressed]} onPress={onCompose}>
        <Ionicons name="create-outline" size={18} color="#FFFFFF" />
        <Text style={styles.newButtonText}>Message a pharmacy</Text>
      </Pressable>
      <ErrorBanner message={error} />
      <FlatList
        data={threads}
        keyExtractor={(t) => t.threadId}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={COLOR} />}
        ListEmptyComponent={loading ? <Loading /> : (
          <Empty icon="people-outline" title="No network messages yet" text="Ask nearby pharmacies about stock, prescriptions or local alerts. Their replies appear here." />
        )}
        renderItem={({ item }) => {
          const info = labelInfo(item.label)
          return (
            <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => onOpen(item)}>
              <View style={[styles.avatar, { backgroundColor: COLOR_TINT }]}>
                <Ionicons name="business" size={20} color={COLOR} />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={[styles.rowTitle, item.unread > 0 && styles.bold]} numberOfLines={1}>{item.otherOrgName}</Text>
                  <Text style={styles.rowTime}>{when(item.lastAt)}</Text>
                </View>
                <View style={styles.rowTop}>
                  <View style={[styles.labelPill, { backgroundColor: info.tint }]}>
                    <Text style={[styles.labelText, { color: info.color }]}>{info.label}</Text>
                  </View>
                  {item.subject ? <Text style={styles.rowSubject} numberOfLines={1}>{item.subject}</Text> : null}
                </View>
                <View style={styles.rowTop}>
                  <Text style={[styles.rowPreview, item.unread > 0 && styles.previewUnread]} numberOfLines={2}>
                    {item.lastFromMe ? 'You: ' : ''}{item.lastBody}
                  </Text>
                  {item.unread > 0 ? <View style={styles.dot} /> : null}
                </View>
              </View>
            </Pressable>
          )
        }}
      />
    </View>
  )
}

function SmsList({ onOpen }: { onOpen: (c: SmsConversation) => void }) {
  const sms = useCommsStore((s) => s.sms)
  const loading = useCommsStore((s) => s.smsLoading)
  const error = useCommsStore((s) => s.smsError)
  const load = useCommsStore((s) => s.loadSms)

  return (
    <View style={styles.flex}>
      <ErrorBanner message={error} />
      <FlatList
        data={sms}
        keyExtractor={(c) => c.phone}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={COLOR} />}
        ListEmptyComponent={loading ? <Loading /> : (
          <Empty icon="chatbubble-ellipses-outline" title="No patient texts" text="When patients reply to your texts, their messages appear here and you can answer from your phone." />
        )}
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => onOpen(item)}>
            <View style={[styles.avatar, { backgroundColor: '#ECFDF5' }]}>
              <Ionicons name={item.patientName ? 'person' : 'call'} size={19} color={palette.success} />
            </View>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text style={[styles.rowTitle, item.unread > 0 && styles.bold]} numberOfLines={1}>
                  {item.patientName ?? prettyPhone(item.phone)}
                </Text>
                <Text style={styles.rowTime}>{when(item.lastAt)}</Text>
              </View>
              {item.patientName ? <Text style={styles.rowMeta}>{prettyPhone(item.phone)}</Text> : <Text style={styles.rowMeta}>Unknown number</Text>}
              <View style={styles.rowTop}>
                <Text style={[styles.rowPreview, item.unread > 0 && styles.previewUnread]} numberOfLines={2}>{item.lastBody}</Text>
                {item.unread > 0 ? <View style={styles.dot} /> : null}
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  )
}

// ---------------------------------------------------------------- thread modals

function ModalShell({ visible, title, subtitle, onClose, children }: { visible: boolean; title: string; subtitle?: string | null; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Back" style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={palette.text} />
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.modalTitle} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.modalSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </View>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

export function NetworkThreadModal({ thread, threadId, onClose }: { thread?: NetworkThread | null; threadId?: string | null; onClose: () => void }) {
  const id = thread?.threadId ?? threadId ?? null
  const myOrg = useAuthStore((s) => s.organisation?.id)
  const messages = useCommsStore((s) => s.thread)
  const loading = useCommsStore((s) => s.threadLoading)
  const openThread = useCommsStore((s) => s.openThread)
  const send = useCommsStore((s) => s.sendNetworkMessage)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    if (id) void openThread(id)
    setDraft('')
  }, [id, openThread])

  const first = messages[0]
  const otherName = thread?.otherOrgName
    ?? (first ? (first.from_org_id === myOrg ? first.to_org_name : first.from_org_name) : null)
    ?? 'Pharmacy'
  const otherOrgId = thread?.otherOrgId ?? (first ? (first.from_org_id === myOrg ? first.to_org_id : first.from_org_id) : null)
  const info = labelInfo(first?.label ?? thread?.label)

  const reply = async () => {
    const body = draft.trim()
    if (!body || !id || !otherOrgId) return
    setSending(true)
    try {
      await send({ toOrgIds: [otherOrgId], body, label: (first?.label ?? 'other') as NetworkLabel, subject: first?.subject ?? null, threadId: id })
      setDraft('')
    } catch (e) {
      Alert.alert('Message not sent', (e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <ModalShell visible={!!id} title={otherName} subtitle={[info.label, first?.subject].filter(Boolean).join(' · ')} onClose={onClose}>
      {loading && messages.length === 0 ? <Loading /> : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.from_org_id === myOrg
            return (
              <View style={[styles.bubbleWrap, mine ? styles.bubbleRight : styles.bubbleLeft]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
                </View>
                <Text style={styles.bubbleMeta}>
                  {mine ? 'You' : (item.from_org_name ?? otherName)} · {fullWhen(item.created_at)}{item.request_sms_ping ? ' · urgent' : ''}
                </Text>
              </View>
            )
          }}
        />
      )}
      <Composer value={draft} onChange={setDraft} onSend={reply} sending={sending} placeholder={`Reply to ${otherName}`} />
    </ModalShell>
  )
}

export function SmsThreadModal({ conversation, phone, onClose }: { conversation?: SmsConversation | null; phone?: string | null; onClose: () => void }) {
  const number = conversation?.phone ?? phone ?? null
  const messages = useCommsStore((s) => s.smsThread)
  const loading = useCommsStore((s) => s.smsThreadLoading)
  const openSmsThread = useCommsStore((s) => s.openSmsThread)
  const send = useCommsStore((s) => s.sendSmsReply)
  const known = useCommsStore((s) => s.sms.find((c) => c.phone === number))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    if (number) void openSmsThread(number)
    setDraft('')
  }, [number, openSmsThread])

  const name = conversation?.patientName ?? known?.patientName ?? null
  const patientId = conversation?.patientId ?? known?.patientId ?? null

  const reply = async () => {
    const body = draft.trim()
    if (!body || !number) return
    setSending(true)
    try {
      await send(number, patientId, body)
      setDraft('')
    } catch (e) {
      Alert.alert('Text not sent', (e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <ModalShell visible={!!number} title={name ?? (number ? prettyPhone(number) : '')} subtitle={name && number ? prettyPhone(number) : 'Text message'} onClose={onClose}>
      {loading && messages.length === 0 ? <Loading /> : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => `${m.direction}-${m.id}`}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.direction === 'outbound'
            return (
              <View style={[styles.bubbleWrap, mine ? styles.bubbleRight : styles.bubbleLeft]}>
                <View style={[styles.bubble, mine ? styles.bubbleSms : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
                </View>
                <Text style={styles.bubbleMeta}>
                  {fullWhen(item.at)}{mine && item.status ? ` · ${item.status}` : ''}
                </Text>
              </View>
            )
          }}
        />
      )}
      <Text style={styles.smsNote}>Replies are sent as a text from your pharmacy and use SMS credits.</Text>
      <Composer value={draft} onChange={setDraft} onSend={reply} sending={sending} placeholder="Write a text" color={palette.success} />
    </ModalShell>
  )
}

function Composer({ value, onChange, onSend, sending, placeholder, color = COLOR }: { value: string; onChange: (v: string) => void; onSend: () => void; sending: boolean; placeholder: string; color?: string }) {
  const disabled = sending || !value.trim()
  return (
    <View style={styles.composer}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        style={styles.composerInput}
        multiline
        maxLength={1600}
      />
      <Pressable
        onPress={onSend}
        disabled={disabled}
        accessibilityLabel="Send"
        style={[styles.sendButton, { backgroundColor: color }, disabled && styles.disabled]}
      >
        {sending ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send" size={18} color="#FFFFFF" />}
      </Pressable>
    </View>
  )
}

// ---------------------------------------------------------------- compose

function ComposeModal({ visible, onClose, onSent }: { visible: boolean; onClose: () => void; onSent: () => void }) {
  const search = useCommsStore((s) => s.searchPharmacies)
  const results = useCommsStore((s) => s.searchResults)
  const searching = useCommsStore((s) => s.searchLoading)
  const send = useCommsStore((s) => s.sendNetworkMessage)
  const [query, setQuery] = useState('')
  const [to, setTo] = useState<NetworkPharmacy | null>(null)
  const [label, setLabel] = useState<NetworkLabel>('stock_query')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!visible) return
    setQuery(''); setTo(null); setLabel('stock_query'); setSubject(''); setBody(''); setUrgent(false)
    void search('')
  }, [visible, search])

  useEffect(() => {
    if (!visible || to) return
    const t = setTimeout(() => void search(query), 350)
    return () => clearTimeout(t)
  }, [query, visible, to, search])

  const submit = async () => {
    if (!to?.linked_org_id || !body.trim()) return
    setSending(true)
    try {
      const note = await send({ toOrgIds: [to.linked_org_id], body: body.trim(), subject: subject.trim() || null, label, urgent })
      if (note) Alert.alert('Message sent', note)
      onSent()
    } catch (e) {
      Alert.alert('Message not sent', (e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <ModalShell visible={visible} title="Message a pharmacy" subtitle="PharmStation network" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.composeContent} keyboardShouldPersistTaps="handled">
        {!to ? (
          <>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={palette.textMuted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Pharmacy name, town or postcode" placeholderTextColor={palette.textMuted} style={styles.searchInput} autoFocus />
            </View>
            <Text style={styles.hint}>{query.trim() ? 'Pharmacies on PharmStation' : 'Nearby pharmacies on PharmStation'}</Text>
            {searching ? <Loading /> : results.length === 0 ? (
              <Empty icon="search-outline" title="No pharmacies found" text="Only pharmacies that have joined the PharmStation network can receive messages." />
            ) : results.map((p) => (
              <Pressable key={`${p.pharmacy_id}-${p.linked_org_id}`} style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => setTo(p)}>
                <View style={[styles.avatar, { backgroundColor: COLOR_TINT }]}><Ionicons name="business" size={20} color={COLOR} /></View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.linked_org_name ?? p.organisation_name}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {[p.address1, p.city, p.postcode].filter(Boolean).join(', ')}
                    {p.distance_km != null ? ` · ${p.distance_km.toFixed(1)} km` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
              </Pressable>
            ))}
          </>
        ) : (
          <>
            <Pressable style={styles.toCard} onPress={() => setTo(null)}>
              <Text style={styles.fieldLabel}>To</Text>
              <View style={styles.rowTop}>
                <Text style={styles.rowTitle} numberOfLines={1}>{to.linked_org_name ?? to.organisation_name}</Text>
                <Text style={styles.changeLink}>Change</Text>
              </View>
            </Pressable>

            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.chips}>
              {(Object.keys(NETWORK_LABELS) as NetworkLabel[]).map((key) => {
                const info = NETWORK_LABELS[key]
                const active = key === label
                return (
                  <Pressable key={key} onPress={() => setLabel(key)} style={[styles.chip, active && { backgroundColor: info.tint, borderColor: info.color }]}>
                    <Text style={[styles.chipText, active && { color: info.color }]}>{info.label}</Text>
                  </Pressable>
                )
              })}
            </View>

            <Text style={styles.fieldLabel}>Subject (optional)</Text>
            <TextInput value={subject} onChangeText={setSubject} placeholder="e.g. Sertraline 50mg" placeholderTextColor={palette.textMuted} style={styles.input} maxLength={120} />

            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput value={body} onChangeText={setBody} placeholder="Write your message" placeholderTextColor={palette.textMuted} style={[styles.input, styles.textArea]} multiline maxLength={2000} />

            <View style={styles.urgentRow}>
              <View style={styles.flex}>
                <Text style={styles.urgentTitle}>Urgent: also send a text alert</Text>
                <Text style={styles.urgentText}>Texts their pharmacy to check PharmStation, if they allow it.</Text>
              </View>
              <Switch value={urgent} onValueChange={setUrgent} trackColor={{ true: COLOR, false: '#CBD5E1' }} />
            </View>

            <Pressable
              onPress={submit}
              disabled={sending || !body.trim()}
              style={[styles.newButton, (sending || !body.trim()) && styles.disabled]}
            >
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send" size={17} color="#FFFFFF" />}
              <Text style={styles.newButtonText}>Send message</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ModalShell>
  )
}

// ---------------------------------------------------------------- Alerts tab

const ALERT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  network_message: 'business-outline',
  patient_message: 'chatbubble-ellipses-outline',
  appointment: 'calendar-outline',
  peps: 'document-text-outline',
  shop_order: 'bag-handle-outline',
  sop_assignment: 'book-outline',
  system: 'information-circle-outline',
}

function AlertsScreen() {
  useComms()
  const alerts = useCommsStore((s) => s.alerts)
  const loading = useCommsStore((s) => s.alertsLoading)
  const error = useCommsStore((s) => s.alertsError)
  const unread = useCommsStore((s) => s.alertsUnread)
  const load = useCommsStore((s) => s.loadAlerts)
  const markRead = useCommsStore((s) => s.markAlertRead)
  const markAll = useCommsStore((s) => s.markAllAlertsRead)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)

  const open = (item: AlertItem) => {
    void markRead(item.id)
    const meta = item.notification.metadata ?? {}
    if (item.notification.event_type === 'network_message' && typeof meta.thread_id === 'string') setThreadId(meta.thread_id)
    else if (item.notification.event_type === 'patient_message' && typeof meta.from_number === 'string') setPhone(meta.from_number)
  }

  return (
    <View style={styles.screen}>
      <View style={styles.alertsHeader}>
        <Text style={styles.alertsCount}>{unread > 0 ? `${unread} unread` : 'All caught up'}</Text>
        {unread > 0 ? (
          <Pressable onPress={() => void markAll()} hitSlop={8}><Text style={styles.changeLink}>Mark all read</Text></Pressable>
        ) : null}
      </View>
      <ErrorBanner message={error} />
      <FlatList
        data={alerts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={COLOR} />}
        ListEmptyComponent={loading ? <Loading /> : (
          <Empty icon="notifications-outline" title="No alerts" text="New network messages, patient texts, bookings and prescriptions for your pharmacy show up here." />
        )}
        renderItem={({ item }) => {
          const opens = ['network_message', 'patient_message'].includes(item.notification.event_type)
          return (
            <Pressable style={({ pressed }) => [styles.row, !item.is_read && styles.rowUnread, pressed && styles.pressed]} onPress={() => open(item)}>
              <View style={[styles.avatar, { backgroundColor: item.is_read ? '#F1F5F9' : COLOR_TINT }]}>
                <Ionicons name={ALERT_ICONS[item.notification.event_type] ?? 'notifications-outline'} size={19} color={item.is_read ? palette.textMuted : COLOR} />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={[styles.rowTitle, !item.is_read && styles.bold]} numberOfLines={2}>{item.notification.title}</Text>
                  <Text style={styles.rowTime}>{when(item.created_at)}</Text>
                </View>
                {item.notification.body ? <Text style={styles.rowPreview} numberOfLines={3}>{item.notification.body}</Text> : null}
                {!opens ? <Text style={styles.rowMeta}>Open PharmStation on the web for details</Text> : null}
              </View>
              {!item.is_read ? <View style={styles.dot} /> : null}
            </Pressable>
          )
        }}
      />
      <NetworkThreadModal threadId={threadId} onClose={() => { setThreadId(null); void useCommsStore.getState().loadNetwork() }} />
      <SmsThreadModal phone={phone} onClose={() => { setPhone(null); void useCommsStore.getState().loadSms() }} />
    </View>
  )
}

// ---------------------------------------------------------------- shared bits

function ErrorBanner({ message }: { message: string | null }) {
  return message ? (
    <View style={styles.errorBanner}>
      <Ionicons name="alert-circle-outline" size={18} color={palette.danger} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  ) : null
}

function Loading() {
  return <View style={styles.loading}><ActivityIndicator color={COLOR} /></View>
}

function Empty({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={26} color={COLOR} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  )
}

export const communicationsScreens: Record<string, ComponentType> = {
  messages: MessagesScreen,
  notifications: AlertsScreen,
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 8 },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  bold: { fontWeight: '800' },

  segmented: { height: 42, backgroundColor: '#E9EDF3', borderRadius: radius.sm, padding: 3, flexDirection: 'row', marginBottom: 12 },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 6 },
  segmentActive: { backgroundColor: palette.surface },
  segmentText: { color: palette.textMuted, fontWeight: '700' },
  segmentTextActive: { color: palette.text },
  countBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: COLOR, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },

  newButton: { minHeight: 48, borderRadius: radius.md, backgroundColor: COLOR, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  newButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  listContent: { paddingBottom: 24, gap: 8, flexGrow: 1 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12 },
  rowUnread: { borderColor: '#7DD3FC' },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 4, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  rowTitle: { flex: 1, color: palette.text, fontSize: 15, fontWeight: '700' },
  rowTime: { color: palette.textMuted, fontSize: 12 },
  rowSubject: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '600' },
  rowMeta: { color: palette.textMuted, fontSize: 12 },
  rowPreview: { flex: 1, color: palette.textMuted, fontSize: 14, lineHeight: 19 },
  previewUnread: { color: palette.text },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR, marginTop: 4 },
  labelPill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  labelText: { fontSize: 11, fontWeight: '800' },

  modal: { flex: 1, backgroundColor: palette.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: palette.text, fontSize: 17, fontWeight: '800' },
  modalSubtitle: { color: palette.textMuted, fontSize: 12, marginTop: 1 },

  chatContent: { padding: 14, gap: 10, flexGrow: 1 },
  bubbleWrap: { maxWidth: '85%', gap: 3 },
  bubbleLeft: { alignSelf: 'flex-start' },
  bubbleRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMine: { backgroundColor: COLOR, borderBottomRightRadius: 4 },
  bubbleSms: { backgroundColor: palette.success, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderBottomLeftRadius: 4 },
  bubbleText: { color: palette.text, fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: '#FFFFFF' },
  bubbleMeta: { color: palette.textMuted, fontSize: 11 },
  smsNote: { color: palette.textMuted, fontSize: 11, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 4 },

  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 130, borderWidth: 1, borderColor: palette.border, borderRadius: 22, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 16, color: palette.text, backgroundColor: palette.bg },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  composeContent: { padding: 16, gap: 10, paddingBottom: 40 },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 16, color: palette.text, paddingVertical: 10 },
  hint: { color: palette.textMuted, fontSize: 12, fontWeight: '700', marginTop: 4 },
  toCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12, gap: 4 },
  changeLink: { color: COLOR, fontWeight: '800', fontSize: 14 },
  fieldLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '700', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: palette.textMuted, fontWeight: '700', fontSize: 13 },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, paddingHorizontal: 14, fontSize: 16, color: palette.text },
  textArea: { minHeight: 130, paddingTop: 12, textAlignVertical: 'top' },
  urgentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12, marginVertical: 6 },
  urgentTitle: { color: palette.text, fontWeight: '700' },
  urgentText: { color: palette.textMuted, fontSize: 12, marginTop: 2 },

  alertsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  alertsCount: { color: palette.textMuted, fontWeight: '700' },

  errorBanner: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: palette.dangerTint, borderRadius: radius.sm, padding: 10, marginBottom: 10 },
  errorText: { flex: 1, color: palette.danger, fontSize: 13 },
  loading: { paddingVertical: 40, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20, gap: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLOR_TINT, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: '800' },
  emptyText: { color: palette.textMuted, textAlign: 'center', lineHeight: 20 },
})
