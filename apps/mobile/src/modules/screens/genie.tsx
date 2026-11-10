// Genie — the pharmacy AI assistant on mobile. Same assistant, rules and
// monthly allowance as the web panel (the ai-chat edge function does the work).
import { useEffect, useRef, useState, type ComponentType } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuthStore } from '@/stores/auth-store'
import {
  useGenieStore,
  type GenieAction,
  type GenieMessage,
  type GeniePageContext,
  type GenieToolCall,
} from '@/stores/genie-store'
import { palette, radius } from '@/theme/palette'

const COLOR = palette.brand
const COLOR_TINT = palette.brandTint

type Suggestion = { label: string; text: string }

const GENERAL_SUGGESTIONS: Suggestion[] = [
  { label: 'Today’s CD entries', text: 'Show me today’s CD register entries' },
  { label: 'Yesterday’s RP', text: 'Who was the RP yesterday?' },
  { label: 'Upcoming shifts', text: 'Show our upcoming locum shifts and who is booked.' },
  { label: 'Today’s appointments', text: 'What appointments do we have today?' },
]

/** Suggestions that fit the screen Genie was opened from. */
function suggestionsFor(context?: GeniePageContext | null): Suggestion[] {
  const path = context?.path ?? ''
  if (path.includes('/services') || path.includes('bookings')) {
    return [
      { label: 'Today’s appointments', text: 'What appointments do we have today?' },
      { label: 'Free slots this week', text: 'Which appointment slots are still free this week?' },
      { label: 'Our services', text: 'What services do we offer and what do they cost?' },
    ]
  }
  if (path.includes('/pharmacy')) {
    return [
      { label: 'Today’s CD entries', text: 'Show me today’s CD register entries' },
      { label: 'A CD balance', text: 'What is the current balance for morphine?' },
      { label: 'Yesterday’s RP', text: 'Who was the RP yesterday?' },
    ]
  }
  return GENERAL_SUGGESTIONS
}

const TOOL_LABELS: Record<string, string> = {
  search_cd_register: 'Searching the CD register',
  search_rp_log: 'Searching the RP log',
  get_drug_info: 'Looking up the drug',
  list_organisation_members: 'Checking your team',
  get_register_balance: 'Checking the balance',
  list_locum_shifts: 'Checking locum shifts',
  create_locum_shift: 'Preparing the shift',
  update_locum_shift: 'Preparing the change',
  cancel_locum_shift: 'Preparing the cancellation',
  review_locum_application: 'Checking the application',
  list_services: 'Checking your services',
  list_appointment_slots: 'Checking appointment times',
  create_appointment_slots: 'Preparing appointment times',
  list_appointments: 'Checking appointments',
  set_appointment_status: 'Preparing the change',
  reschedule_appointment: 'Preparing the move',
  find_patients: 'Finding the patient',
  book_appointment: 'Preparing the booking',
}

function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ')
}

function when(iso: string) {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ---------------------------------------------------------------- text

/** Inline **bold** and `code`. */
function Inline({ text, style }: { text: string; style?: object }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} style={styles.bold}>{p.slice(2, -2)}</Text>
        ) : p.startsWith('`') && p.endsWith('`') ? (
          <Text key={i} style={styles.code}>{p.slice(1, -1)}</Text>
        ) : (
          p
        ),
      )}
    </Text>
  )
}

/** Small Markdown subset: headings, bullets, numbered lists, tables, paragraphs. */
function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  return (
    <View style={styles.rich}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd()
        if (!line.trim()) return <View key={i} style={styles.spacer} />
        if (/^\s*\|?\s*:?-{2,}/.test(line)) return null // table divider
        if (line.trim().startsWith('|')) {
          const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
          return (
            <View key={i} style={styles.tableRow}>
              {cells.map((c, j) => (
                <Inline key={j} text={c} style={styles.tableCell} />
              ))}
            </View>
          )
        }
        const heading = line.match(/^#{1,6}\s+(.*)$/)
        if (heading) return <Inline key={i} text={heading[1]} style={[styles.answer, styles.bold]} />
        const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/)
        if (bullet) {
          return (
            <View key={i} style={[styles.listRow, { paddingLeft: Math.min(bullet[1].length, 6) * 4 }]}>
              <Text style={styles.answer}>•</Text>
              <Inline text={bullet[2]} style={[styles.answer, styles.flex]} />
            </View>
          )
        }
        const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/)
        if (numbered) {
          return (
            <View key={i} style={styles.listRow}>
              <Text style={styles.answer}>{numbered[2]}.</Text>
              <Inline text={numbered[3]} style={[styles.answer, styles.flex]} />
            </View>
          )
        }
        return <Inline key={i} text={line} style={styles.answer} />
      })}
    </View>
  )
}

// ---------------------------------------------------------------- pieces

function ToolChips({ tools, running }: { tools: GenieToolCall[]; running?: boolean }) {
  if (!tools.length) return null
  return (
    <View style={styles.chips}>
      {tools.map((t) => (
        <View key={t.id} style={styles.chip}>
          {running ? (
            <ActivityIndicator size="small" color={COLOR} />
          ) : (
            <Ionicons name="checkmark-circle" size={14} color={palette.success} />
          )}
          <Text style={styles.chipText}>{toolLabel(t.name)}{running ? '…' : ''}</Text>
        </View>
      ))}
    </View>
  )
}

const ACTION_STATUS: Record<string, string> = {
  done: 'Done',
  cancelled: 'Cancelled',
  failed: 'Not done',
  expired: 'Expired',
}

/** A change Genie proposed. Nothing happens until Confirm is tapped. */
function ActionCard({ action, waiting = false }: { action: GenieAction; waiting?: boolean }) {
  const decideAction = useGenieStore((s) => s.decideAction)
  const busy = action.status === 'running'
  const open = action.status === 'pending' || busy
  const accent =
    action.status === 'done' ? palette.success
      : action.status === 'failed' || action.status === 'expired' ? palette.danger
        : action.status === 'cancelled' ? palette.border
          : COLOR
  return (
    <View style={[styles.action, { borderLeftColor: accent }]}>
      <Text style={styles.actionSummary}>{action.summary}</Text>
      {action.details.map((d, i) => (
        <Text key={i} style={styles.actionDetail}>• {d}</Text>
      ))}
      {open ? (
        <>
          {action.result?.message ? <Text style={styles.actionResult}>{action.result.message}</Text> : null}
          <View style={styles.actionButtons}>
            <Pressable
              style={({ pressed }) => [styles.actionButton, styles.actionCancel, pressed && styles.pressed]}
              onPress={() => void decideAction(action.id, 'cancel')}
              disabled={busy || waiting}
              accessibilityRole="button"
            >
              <Text style={styles.actionCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.actionButton, styles.actionConfirm, (busy || waiting) && styles.sendDisabled, pressed && styles.pressed]}
              onPress={() => void decideAction(action.id, 'confirm')}
              disabled={busy || waiting}
              accessibilityRole="button"
            >
              {busy ? <ActivityIndicator size="small" color={palette.textInverse} /> : <Text style={styles.actionConfirmText}>Confirm</Text>}
            </Pressable>
          </View>
          {waiting ? <Text style={styles.actionResult}>You can confirm once Genie has finished.</Text> : null}
        </>
      ) : (
        <Text style={styles.actionResult}>
          <Text style={styles.bold}>{ACTION_STATUS[action.status] ?? action.status}</Text>
          {action.result?.message ? ` · ${action.result.message}` : ''}
        </Text>
      )}
    </View>
  )
}

function Bubble({ m, onRetry, actions }: { m: GenieMessage; onRetry: () => void; actions: GenieAction[] }) {
  if (m.role === 'user') {
    return (
      <View style={[styles.row, styles.rowUser]}>
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.userText}>{m.content}</Text>
        </View>
      </View>
    )
  }
  if (m.status === 'error') {
    return (
      <View style={styles.row}>
        <View style={[styles.bubble, styles.bubbleError]}>
          <Text style={styles.errorText}>{m.error || m.content}</Text>
          <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      </View>
    )
  }
  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Ionicons name="sparkles" size={14} color={COLOR} />
      </View>
      <View style={[styles.bubble, styles.bubbleGenie]}>
        <ToolChips tools={m.toolCalls} />
        <RichText text={m.content} />
        {actions.map((a) => (
          <ActionCard key={a.id} action={a} />
        ))}
        <Text style={styles.time}>{when(m.created_at)}</Text>
      </View>
    </View>
  )
}

function ChatsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { conversations, conversationsLoading, activeConversationId, openConversation, deleteConversation } =
    useGenieStore()
  const confirmDelete = (id: string, title: string) =>
    Alert.alert('Delete this chat?', title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteConversation(id) },
    ])
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Your Genie chats</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={palette.text} />
          </Pressable>
        </View>
        {conversationsLoading && conversations.length === 0 ? (
          <ActivityIndicator style={styles.loading} color={COLOR} />
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.chatList}
            ListEmptyComponent={<Text style={styles.empty}>No chats yet. Ask Genie something to start one.</Text>}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.chatRow,
                  item.id === activeConversationId && styles.chatRowActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  void openConversation(item.id)
                  onClose()
                }}
                onLongPress={() => confirmDelete(item.id, item.title)}
              >
                <View style={styles.flex}>
                  <Text style={styles.chatTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.chatMeta}>{when(item.updated_at)}</Text>
                </View>
                <Pressable onPress={() => confirmDelete(item.id, item.title)} hitSlop={10} accessibilityLabel="Delete chat">
                  <Ionicons name="trash-outline" size={18} color={palette.textMuted} />
                </Pressable>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  )
}

// ---------------------------------------------------------------- screen

/**
 * The Genie chat. Used as the Genie module's screen, and inside the floating
 * Genie sheet that opens over any module (then `context` says where the user is).
 */
export function GenieChat({
  context = null,
  onClose,
  keyboardOffset = 100,
}: {
  context?: GeniePageContext | null
  onClose?: () => void
  keyboardOffset?: number
}) {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const {
    messages,
    messagesLoading,
    isStreaming,
    streamingContent,
    streamingTools,
    usage,
    patientDataOn,
    selectOrg,
    loadOverview,
    loadConversations,
    newConversation,
    send,
    stop,
    actions,
  } = useGenieStore()
  const [input, setInput] = useState('')
  const [showChats, setShowChats] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    if (!orgId) return
    selectOrg(orgId)
    void loadOverview(orgId)
    void loadConversations(orgId)
  }, [orgId, selectOrg, loadOverview, loadConversations])

  const usedUp = !!usage && usage.limit > 0 && usage.used >= usage.limit

  const resetDate = (() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  })()
  const usedUpMessage = `Your pharmacy has used all ${usage?.limit ?? ''} Genie questions for this month. They reset on ${resetDate}.`
  const showUsedUp = () => Alert.alert('Monthly Genie allowance used', usedUpMessage)

  const submit = (text: string) => {
    if (!orgId || !text.trim() || isStreaming || usedUp) return
    setInput('')
    void send(orgId, text, context)
  }

  const retry = () => {
    const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')
    if (lastQuestion) submit(lastQuestion.content)
  }

  const empty = messages.length === 0 && !isStreaming && !messagesLoading

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? keyboardOffset : 0}
    >
      <View style={styles.toolbar}>
        <Pressable
          style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}
          onPress={() => setShowChats(true)}
          accessibilityRole="button"
        >
          <Ionicons name="time-outline" size={16} color={COLOR} />
          <Text style={styles.toolButtonText}>Chats</Text>
        </Pressable>
        <Text style={styles.usage} numberOfLines={1}>
          {usage ? `${usage.used} of ${usage.limit} questions this month` : ' '}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}
          onPress={newConversation}
          accessibilityRole="button"
        >
          <Ionicons name="create-outline" size={16} color={COLOR} />
          <Text style={styles.toolButtonText}>New</Text>
        </Pressable>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close Genie" style={styles.closeButton}>
            <Ionicons name="close" size={22} color={palette.text} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messagesLoading ? <ActivityIndicator style={styles.loading} color={COLOR} /> : null}

        {empty ? (
          <View style={styles.welcome}>
            <View style={styles.welcomeIcon}>
              <Ionicons name="sparkles" size={28} color={COLOR} />
            </View>
            <Text style={styles.welcomeTitle}>Ask Genie</Text>
            <Text style={styles.welcomeText}>
              Genie can search your CD register and RP log, check CD balances, look up controlled drugs and your
              team, and answer pharmacy questions.
            </Text>
            {!patientDataOn ? (
              <View style={styles.privacy}>
                <Ionicons name="shield-checkmark-outline" size={16} color={palette.textMuted} />
                <Text style={styles.privacyText}>
                  Patient details are hidden from Genie. Please don’t type patient names or details.
                </Text>
              </View>
            ) : null}
            <View style={styles.suggestions}>
              {suggestionsFor(context).map((s) => (
                <Pressable
                  key={s.label}
                  style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
                  onPress={() => (usedUp ? showUsedUp() : submit(s.text))}
                >
                  <Text style={styles.suggestionText}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {messages.map((m) => (
          <Bubble key={m.id} m={m} onRetry={retry} actions={actions.filter((a) => a.message_id === m.id)} />
        ))}

        {isStreaming ? (
          <View style={styles.row}>
            <View style={styles.avatar}>
              <Ionicons name="sparkles" size={14} color={COLOR} />
            </View>
            <View style={[styles.bubble, styles.bubbleGenie]}>
              <ToolChips tools={streamingTools} running={!streamingContent} />
              {streamingContent ? (
                <RichText text={streamingContent} />
              ) : (
                <ActivityIndicator size="small" color={COLOR} style={styles.thinking} />
              )}
              {actions.filter((a) => !a.message_id).map((a) => (
                <ActionCard key={a.id} action={a} waiting />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        {context ? (
          <View style={styles.contextChip}>
            <Ionicons name="eye-outline" size={13} color={palette.textMuted} />
            <Text style={styles.contextText} numberOfLines={1}>Using this screen: {context.title}</Text>
          </View>
        ) : null}
        {usedUp ? (
          <View style={styles.usedUp}>
            <Ionicons name="hourglass-outline" size={16} color={palette.warning} />
            <Text style={styles.usedUpText}>{usedUpMessage}</Text>
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={usedUp ? 'This month’s Genie questions are used up' : 'Ask Genie…'}
            placeholderTextColor={palette.textMuted}
            multiline
            maxLength={4000}
            editable={!isStreaming && !usedUp}
          />
          {isStreaming ? (
            <Pressable style={[styles.send, styles.stop]} onPress={stop} accessibilityLabel="Stop">
              <Ionicons name="stop" size={18} color={palette.textInverse} />
            </Pressable>
          ) : (
            <Pressable
              style={[styles.send, (!input.trim() || usedUp) && styles.sendDisabled]}
              onPress={() => submit(input)}
              disabled={!input.trim() || usedUp}
              accessibilityLabel="Send"
            >
              <Ionicons name="arrow-up" size={20} color={palette.textInverse} />
            </Pressable>
          )}
        </View>
        <Text style={styles.footnote}>Genie can make mistakes. Check answers and changes before you rely on them.</Text>
      </View>

      <ChatsModal visible={showChats} onClose={() => setShowChats(false)} />
    </KeyboardAvoidingView>
  )
}

function AskScreen() {
  return <GenieChat />
}

export const genieScreens: Record<string, ComponentType> = {
  ask: AskScreen,
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  bold: { fontWeight: '700' },
  code: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13 },
  loading: { marginTop: 24 },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.surface,
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: COLOR_TINT,
  },
  toolButtonText: { color: COLOR, fontWeight: '700', fontSize: 13 },
  usage: { flex: 1, textAlign: 'center', fontSize: 12, color: palette.textMuted },

  messages: { padding: 12, gap: 10, paddingBottom: 20 },
  welcome: { alignItems: 'center', gap: 10, paddingVertical: 24, paddingHorizontal: 8 },
  welcomeIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLOR_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeTitle: { fontSize: 20, fontWeight: '800', color: palette.text },
  welcomeText: { fontSize: 15, color: palette.textMuted, textAlign: 'center', lineHeight: 21 },
  privacy: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    padding: 10,
  },
  privacyText: { flex: 1, fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 6 },
  suggestion: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: COLOR + '55',
    backgroundColor: palette.surface,
  },
  suggestionText: { color: COLOR, fontWeight: '600', fontSize: 14 },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLOR_TINT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  bubble: { maxWidth: '86%', borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 9, gap: 6 },
  bubbleUser: { backgroundColor: palette.brand, borderBottomRightRadius: 4 },
  bubbleGenie: {
    flexShrink: 1,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderBottomLeftRadius: 4,
  },
  bubbleError: { backgroundColor: palette.dangerTint, gap: 6 },
  userText: { color: palette.textInverse, fontSize: 15, lineHeight: 21 },
  errorText: { color: palette.danger, fontSize: 14, lineHeight: 20 },
  retry: { color: palette.danger, fontWeight: '700', fontSize: 14 },
  time: { fontSize: 11, color: palette.textMuted, alignSelf: 'flex-end' },
  thinking: { alignSelf: 'flex-start', marginVertical: 4 },

  rich: { gap: 2 },
  spacer: { height: 6 },
  answer: { fontSize: 15, lineHeight: 21, color: palette.text },
  listRow: { flexDirection: 'row', gap: 6 },
  tableRow: {
    flexDirection: 'row',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    paddingVertical: 3,
  },
  tableCell: { flex: 1, fontSize: 13, lineHeight: 18, color: palette.text },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: palette.bg,
  },
  chipText: { fontSize: 12, color: palette.textMuted, fontWeight: '600' },

  composer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    gap: 4,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 21,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: palette.text,
    backgroundColor: palette.bg,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  stop: { backgroundColor: palette.text },
  usedUp: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6 },
  usedUpText: { flex: 1, fontSize: 13, lineHeight: 18, color: palette.text },
  closeButton: { padding: 2, marginLeft: 2 },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: palette.bg,
  },
  contextText: { fontSize: 12, color: palette.textMuted, flexShrink: 1 },
  action: {
    marginTop: 4,
    padding: 10,
    gap: 3,
    borderWidth: 1,
    borderColor: palette.border,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  actionSummary: { fontSize: 14, fontWeight: '700', color: palette.text, lineHeight: 19 },
  actionDetail: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  actionResult: { fontSize: 12, color: palette.textMuted, marginTop: 4, lineHeight: 17 },
  actionButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  actionButton: {
    minWidth: 92,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCancel: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  actionCancelText: { color: palette.text, fontWeight: '600', fontSize: 14 },
  actionConfirm: { backgroundColor: palette.brand },
  actionConfirmText: { color: palette.textInverse, fontWeight: '700', fontSize: 14 },
  footnote: { fontSize: 11, color: palette.textMuted, textAlign: 'center' },

  modal: { flex: 1, backgroundColor: palette.bg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.surface,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: palette.text },
  chatList: { padding: 12, gap: 8 },
  empty: { textAlign: 'center', color: palette.textMuted, marginTop: 32, fontSize: 15 },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  chatRowActive: { borderColor: COLOR },
  chatTitle: { fontSize: 15, fontWeight: '600', color: palette.text },
  chatMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
})
