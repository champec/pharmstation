// Pharmacy Network setup on mobile: link this pharmacy to its NHS record,
// choose whether to accept messages, and manage urgent text alert numbers.
// Mirrors the web's Network onboarding and settings pages.
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useCommsStore, type NetworkContact, type NetworkSetup } from '@/stores/comms-store'
import { palette, radius } from '@/theme/palette'

const COLOR = '#0EA5E9'
const COLOR_TINT = '#E0F2FE'

/** What stops this pharmacy using the network, if anything. */
export function networkBlocker(setup: NetworkSetup | null): { title: string; text: string; action?: string } | null {
  if (!setup) return null
  if (setup.verification === 'pending') {
    return {
      title: 'Your pharmacy is being verified',
      text: 'We check every pharmacy against the GPhC register before it joins the network, so others know who they are talking to. This usually takes one working day.',
    }
  }
  if (setup.verification === 'rejected') {
    return {
      title: 'We couldn’t verify this pharmacy',
      text: `${setup.verificationNote ?? ''} Contact hello@pharmstation.co.uk.`.trim(),
    }
  }
  if (!setup.link) {
    return {
      title: 'Link your pharmacy to join the network',
      text: 'Choose your NHS pharmacy record once so nearby pharmacies can find and message you.',
      action: 'Link pharmacy',
    }
  }
  if (!setup.networkEnabled) {
    return {
      title: 'You are not accepting new messages',
      text: 'Other pharmacies can’t start conversations with you. Turn it back on in network settings.',
      action: 'Open settings',
    }
  }
  return null
}

export function NetworkStatusBanner({ onOpenSetup }: { onOpenSetup: () => void }) {
  const setup = useCommsStore((s) => s.setup)
  const blocker = networkBlocker(setup)
  if (!blocker) return null
  return (
    <View style={styles.banner}>
      <Ionicons name={setup?.verification && setup.verification !== 'verified' ? 'time-outline' : 'link-outline'} size={20} color={COLOR} />
      <View style={styles.flex}>
        <Text style={styles.bannerTitle}>{blocker.title}</Text>
        <Text style={styles.bannerText}>{blocker.text}</Text>
        {blocker.action ? (
          <Pressable onPress={onOpenSetup} hitSlop={8}>
            <Text style={styles.bannerAction}>{blocker.action}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

export function NetworkSetupModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const setup = useCommsStore((s) => s.setup)
  const loading = useCommsStore((s) => s.setupLoading)
  const loadSetup = useCommsStore((s) => s.loadSetup)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    if (visible) {
      setLinking(false)
      void loadSetup()
    }
  }, [visible, loadSetup])

  const verified = setup?.verification == null || setup.verification === 'verified'

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable onPress={linking ? () => setLinking(false) : onClose} hitSlop={12} accessibilityLabel="Back" style={styles.back}>
            <Ionicons name="chevron-back" size={24} color={palette.text} />
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.title}>{linking ? 'Find your pharmacy' : 'Network settings'}</Text>
            <Text style={styles.subtitle}>PharmStation network</Text>
          </View>
        </View>

        {!setup && loading ? (
          <View style={styles.loading}><ActivityIndicator color={COLOR} /></View>
        ) : !setup ? null : linking ? (
          <LinkSearch onDone={() => setLinking(false)} />
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <NetworkStatusBanner onOpenSetup={() => (setup.link ? undefined : setLinking(true))} />

            <Section title="Your pharmacy">
              {setup.link?.pharmacy ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{setup.link.pharmacy.organisation_name}</Text>
                  <Text style={styles.cardMeta}>
                    {[setup.link.pharmacy.ods_code && `ODS ${setup.link.pharmacy.ods_code}`, setup.link.pharmacy.address1, setup.link.pharmacy.city, setup.link.pharmacy.postcode].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={styles.cardActions}>
                    <SmallButton label="Change" onPress={() => setLinking(true)} disabled={!verified} />
                    <SmallButton
                      label="Unlink"
                      danger
                      onPress={() => Alert.alert(
                        'Leave the network?',
                        'Other pharmacies will no longer find you or be able to start new conversations. Existing conversations stay.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Unlink', style: 'destructive', onPress: () => void useCommsStore.getState().unlinkPharmacy().catch((e) => Alert.alert('Could not unlink', (e as Error).message)) },
                        ],
                      )}
                    />
                  </View>
                </View>
              ) : (
                <Pressable
                  style={[styles.primary, !verified && styles.disabled]}
                  disabled={!verified}
                  onPress={() => setLinking(true)}
                >
                  <Ionicons name="link-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryText}>Link your pharmacy</Text>
                </Pressable>
              )}
            </Section>

            <Section title="Messages">
              <ToggleRow
                title="Accept new messages"
                text="Let other pharmacies on PharmStation find you and start conversations. You can always reply to existing ones."
                value={setup.networkEnabled}
                onChange={(v) => void useCommsStore.getState().saveNetworkSettings({ network_enabled: v }).catch((e) => Alert.alert('Not saved', (e as Error).message))}
              />
              <ToggleRow
                title="Urgent text alerts"
                text="When a pharmacy marks a message urgent, text the numbers below. The text says who wrote and links to the message; it never includes the message itself. The sender pays for the text."
                value={setup.smsPingsEnabled}
                disabled={!setup.networkEnabled}
                onChange={(v) => void useCommsStore.getState().saveNetworkSettings({ sms_pings_enabled: v }).catch((e) => Alert.alert('Not saved', (e as Error).message))}
              />
            </Section>

            {setup.smsPingsEnabled ? <ContactsSection contacts={setup.contacts} /> : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function LinkSearch({ onDone }: { onDone: () => void }) {
  const search = useCommsStore((s) => s.searchOds)
  const results = useCommsStore((s) => s.odsResults)
  const searching = useCommsStore((s) => s.odsLoading)
  const currentId = useCommsStore((s) => s.setup?.link?.pharmacy_id)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => void search(query), 350)
    return () => clearTimeout(t)
  }, [query, search])

  const link = async (id: number) => {
    setBusyId(id)
    try {
      await useCommsStore.getState().linkPharmacy(id)
      onDone()
    } catch (e) {
      Alert.alert('Could not link', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Pharmacy name, postcode or ODS code"
          placeholderTextColor={palette.textMuted}
          style={styles.searchInput}
          autoFocus
          autoCorrect={false}
        />
      </View>
      <Text style={styles.hint}>Pick your pharmacy from the NHS list. You only do this once.</Text>
      {searching ? (
        <View style={styles.loading}><ActivityIndicator color={COLOR} /></View>
      ) : query.trim().length >= 2 && results.length === 0 ? (
        <Text style={styles.empty}>No pharmacies match “{query.trim()}”.</Text>
      ) : results.map((p) => {
        const current = p.id === currentId
        return (
          <View key={p.id} style={styles.card}>
            <Text style={styles.cardTitle}>{p.organisation_name}</Text>
            <Text style={styles.cardMeta}>{[p.ods_code && `ODS ${p.ods_code}`, p.address1, p.city, p.postcode].filter(Boolean).join(' · ')}</Text>
            <View style={styles.cardActions}>
              {current ? (
                <Text style={styles.tag}>Your pharmacy</Text>
              ) : p.taken ? (
                <Text style={styles.tagMuted}>Already on PharmStation</Text>
              ) : (
                <SmallButton label={busyId === p.id ? 'Linking…' : 'This is my pharmacy'} onPress={() => void link(p.id)} disabled={busyId !== null} />
              )}
            </View>
          </View>
        )
      })}
    </ScrollView>
  )
}

function ContactsSection({ contacts }: { contacts: NetworkContact[] }) {
  const [adding, setAdding] = useState(false)
  const [phone, setPhone] = useState('')
  const [label, setLabel] = useState('')
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('20:00')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      Alert.alert('Check the hours', 'Use 24-hour times like 08:00 and 20:00.')
      return
    }
    setSaving(true)
    try {
      await useCommsStore.getState().addContact({ phone, label: label.trim() || null, start, end })
      setPhone(''); setLabel(''); setStart('08:00'); setEnd('20:00'); setAdding(false)
    } catch (e) {
      Alert.alert('Number not added', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const paused = (c: NetworkContact) => !!c.pause_until && new Date(c.pause_until) > new Date()
  const act = (p: Promise<unknown>) => void p.catch((e) => Alert.alert('Not saved', (e as Error).message))

  return (
    <Section title="Numbers to text" hint="UK mobiles. Up to 3 are texted each time, during their hours (UK time).">
      {contacts.length === 0 && !adding ? <Text style={styles.empty}>No numbers yet. Add the phone of whoever should hear about urgent messages.</Text> : null}
      {contacts.map((c) => (
        <View key={c.id} style={styles.card}>
          <View style={styles.contactTop}>
            <View style={[styles.statusDot, { backgroundColor: !c.is_enabled ? palette.textMuted : paused(c) ? '#F59E0B' : palette.success }]} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{c.phone_number.replace(/^\+44/, '0')}</Text>
              <Text style={styles.cardMeta}>
                {[c.label, `${c.notify_start.slice(0, 5)}–${c.notify_end.slice(0, 5)}`].filter(Boolean).join(' · ')}
                {!c.is_enabled ? ' · Off' : paused(c) ? ` · Paused until ${new Date(c.pause_until!).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
              </Text>
            </View>
          </View>
          <View style={styles.cardActions}>
            <SmallButton
              label={c.is_enabled ? 'Turn off' : 'Turn on'}
              onPress={() => act(useCommsStore.getState().updateContact(c.id, { is_enabled: !c.is_enabled, pause_until: null }))}
            />
            {c.is_enabled ? (
              paused(c)
                ? <SmallButton label="Resume" onPress={() => act(useCommsStore.getState().updateContact(c.id, { pause_until: null }))} />
                : <SmallButton label="Pause 8 hours" onPress={() => act(useCommsStore.getState().updateContact(c.id, { pause_until: new Date(Date.now() + 8 * 3600_000).toISOString() }))} />
            ) : null}
            <SmallButton
              label="Remove"
              danger
              onPress={() => Alert.alert('Remove this number?', c.phone_number, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => act(useCommsStore.getState().deleteContact(c.id)) },
              ])}
            />
          </View>
        </View>
      ))}

      {adding ? (
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Mobile number</Text>
          <TextInput value={phone} onChangeText={setPhone} placeholder="07700 900123" placeholderTextColor={palette.textMuted} style={styles.input} keyboardType="phone-pad" autoComplete="tel" />
          <Text style={styles.fieldLabel}>Label (optional)</Text>
          <TextInput value={label} onChangeText={setLabel} placeholder="e.g. Duty pharmacist" placeholderTextColor={palette.textMuted} style={styles.input} maxLength={40} />
          <View style={styles.hoursRow}>
            <View style={styles.flex}>
              <Text style={styles.fieldLabel}>From</Text>
              <TextInput value={start} onChangeText={setStart} placeholder="08:00" placeholderTextColor={palette.textMuted} style={styles.input} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.fieldLabel}>Until</Text>
              <TextInput value={end} onChangeText={setEnd} placeholder="20:00" placeholderTextColor={palette.textMuted} style={styles.input} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
          </View>
          <View style={styles.cardActions}>
            <SmallButton label="Cancel" onPress={() => setAdding(false)} />
            <SmallButton label={saving ? 'Adding…' : 'Add number'} primary onPress={() => void save()} disabled={saving || !phone.trim()} />
          </View>
        </View>
      ) : (
        <Pressable style={styles.secondary} onPress={() => setAdding(true)}>
          <Ionicons name="add" size={18} color={COLOR} />
          <Text style={styles.secondaryText}>Add a number</Text>
        </Pressable>
      )}
    </Section>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  )
}

function ToggleRow({ title, text, value, onChange, disabled }: { title: string; text: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[styles.toggleRow, disabled && styles.disabled]}>
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardMeta}>{text}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: COLOR, false: '#CBD5E1' }} />
    </View>
  )
}

function SmallButton({ label, onPress, disabled, danger, primary }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.smallButton, primary && styles.smallPrimary, (pressed || disabled) && styles.disabled]}
    >
      <Text style={[styles.smallText, danger && { color: palette.danger }, primary && { color: '#FFFFFF' }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  disabled: { opacity: 0.5 },
  modal: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: palette.textMuted, fontSize: 12, marginTop: 1 },
  loading: { paddingVertical: 40, alignItems: 'center' },
  content: { padding: 16, gap: 12, paddingBottom: 48 },

  banner: { flexDirection: 'row', gap: 10, backgroundColor: COLOR_TINT, borderRadius: radius.md, padding: 12, marginBottom: 12 },
  bannerTitle: { color: palette.text, fontWeight: '800', fontSize: 14 },
  bannerText: { color: palette.text, fontSize: 13, lineHeight: 18, marginTop: 2 },
  bannerAction: { color: COLOR, fontWeight: '800', marginTop: 6 },

  section: { gap: 8 },
  sectionTitle: { color: palette.text, fontSize: 15, fontWeight: '800', marginTop: 4 },
  hint: { color: palette.textMuted, fontSize: 12 },
  empty: { color: palette.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 16 },

  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12, gap: 4 },
  cardTitle: { color: palette.text, fontSize: 15, fontWeight: '700' },
  cardMeta: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  tag: { color: palette.success, fontWeight: '800', fontSize: 13 },
  tagMuted: { color: palette.textMuted, fontWeight: '700', fontSize: 13 },

  contactTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12 },

  primary: { minHeight: 48, borderRadius: radius.md, backgroundColor: COLOR, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  secondary: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: COLOR, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secondaryText: { color: COLOR, fontWeight: '800' },
  smallButton: { minHeight: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: palette.surface },
  smallPrimary: { backgroundColor: COLOR, borderColor: COLOR },
  smallText: { color: palette.text, fontWeight: '700', fontSize: 13 },

  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 16, color: palette.text, paddingVertical: 10 },
  fieldLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '700', marginTop: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.bg, paddingHorizontal: 14, fontSize: 16, color: palette.text },
  hoursRow: { flexDirection: 'row', gap: 10 },
})
