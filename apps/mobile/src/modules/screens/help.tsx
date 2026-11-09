// My Account → Help: the same support form as the website's /contact page.
// Messages go through the `support-request` edge function, which saves a
// ps_support_tickets row and emails the right team inbox. The list below shows
// this person's own recent messages (RLS: own tickets only).
import { useCallback, useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

const TOPICS = [
  { value: 'support', label: 'Help with the app' },
  { value: 'billing', label: 'Billing' },
  { value: 'privacy', label: 'Data protection' },
  { value: 'safety', label: 'Clinical safety' },
  { value: 'sales', label: 'Demo or pricing' },
  { value: 'other', label: 'Something else' },
] as const

const STATUS: Record<string, string> = {
  new: 'Received', open: 'Being looked at', waiting: 'Waiting on you', closed: 'Closed',
}

type MyRequest = { reference: string; status: string; created_at: string }

export function HelpTab() {
  const userProfile = useAuthStore((s) => s.userProfile)
  const organisation = useAuthStore((s) => s.organisation)
  const isOrgConnected = useAuthStore((s) => s.isOrgConnected)

  const [topic, setTopic] = useState<string>('support')
  const [name, setName] = useState(userProfile?.full_name ?? '')
  const [email, setEmail] = useState(userProfile?.email ?? '')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sentRef, setSentRef] = useState<string | null>(null)
  const [mine, setMine] = useState<MyRequest[]>([])

  const loadMine = useCallback(async () => {
    const { data } = await userClient.from('ps_support_tickets')
      .select('reference, status, created_at').order('created_at', { ascending: false }).limit(5)
    setMine((data ?? []) as MyRequest[])
  }, [])

  useEffect(() => { void loadMine() }, [loadMine])

  const send = async () => {
    if (!name.trim() || !email.trim() || message.trim().length < 5) {
      Alert.alert('Almost there', 'Add your name, email and a short message.')
      return
    }
    setSending(true)
    const { data, error } = await userClient.functions.invoke('support-request', {
      body: {
        topic, name, email, message,
        organisation_name: isOrgConnected ? organisation?.name ?? null : null,
        org_id: isOrgConnected ? organisation?.id ?? null : null,
        source: 'app',
      },
    })
    setSending(false)
    if (error || !data?.ok) {
      let msg = data?.error as string | undefined
      if (!msg && error && 'context' in error) {
        try { msg = (await (error as { context: Response }).context.json()).error } catch { /* ignore */ }
      }
      Alert.alert('Not sent', msg || 'Please email support@pharmstation.co.uk instead.')
      return
    }
    setSentRef(data.reference)
    setMessage('')
    void loadMine()
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {sentRef ? (
          <View style={[styles.card, styles.sent]}>
            <Text style={styles.sentTitle}>Thanks, we have your message</Text>
            <Text style={styles.muted}>Your reference is {sentRef}. We'll reply by email, usually within one working day.</Text>
            {topic === 'safety' ? (
              <Text style={styles.muted}>If a patient is at immediate risk, call 999. For urgent medical advice, call NHS 111.</Text>
            ) : null}
            <Button label="Send another message" variant="secondary" onPress={() => setSentRef(null)} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>What is it about?</Text>
            <View style={styles.chips}>
              {TOPICS.map((t) => (
                <Pressable
                  key={t.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: topic === t.value }}
                  onPress={() => setTopic(t.value)}
                  style={[styles.chip, topic === t.value && styles.chipActive]}
                >
                  <Text style={[styles.chipText, topic === t.value && styles.chipTextActive]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="Your name" value={name} onChangeText={setName} maxLength={120} autoComplete="name" />
            <Field label="Email" value={email} onChangeText={setEmail} maxLength={254} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Message</Text>
              <TextInput
                style={styles.textarea}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={5000}
                placeholder="How can we help?"
                placeholderTextColor={palette.textMuted}
                textAlignVertical="top"
              />
              {topic !== 'privacy' && topic !== 'safety' ? (
                <Text style={styles.hint}>Please don't include patient details. We'll ask for them securely if we need them.</Text>
              ) : null}
            </View>
            <Button label="Send message" onPress={send} loading={sending} />
          </View>
        )}

        {mine.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your recent messages</Text>
            {mine.map((r) => (
              <View key={r.reference} style={styles.row}>
                <Text style={styles.muted}>{r.reference} · {new Date(r.created_at).toLocaleDateString('en-GB')}</Text>
                <Text style={styles.rowValue}>{STATUS[r.status] ?? r.status}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Email us directly</Text>
          {[
            ['support@pharmstation.co.uk', 'Help using PharmStation'],
            ['privacy@pharmstation.co.uk', 'Data protection requests'],
            ['safety@pharmstation.co.uk', 'Clinical safety concerns'],
          ].map(([address, label]) => (
            <Pressable key={address} accessibilityRole="link" onPress={() => Linking.openURL(`mailto:${address}`)}>
              <Text style={styles.link}>{address}</Text>
              <Text style={styles.hint}>{label}</Text>
            </Pressable>
          ))}
          <Text style={styles.hint}>For a medical emergency call 999. For urgent medical advice, call NHS 111.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: 16, paddingTop: 4, paddingBottom: 32 },
  card: { backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, padding: 16, gap: 14 },
  sent: { borderColor: palette.success },
  sentTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  label: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  fieldWrap: { gap: 6 },
  textarea: { minHeight: 120, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 14, fontSize: 16, color: palette.text, backgroundColor: palette.surface },
  hint: { fontSize: 12, lineHeight: 17, color: palette.textMuted },
  muted: { fontSize: 14, lineHeight: 20, color: palette.textMuted, flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  chipActive: { backgroundColor: palette.brandTint, borderColor: palette.brand },
  chipText: { fontSize: 13, color: palette.text },
  chipTextActive: { color: palette.brandDark, fontWeight: '700' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowValue: { fontSize: 14, fontWeight: '600', color: palette.text },
  link: { fontSize: 15, fontWeight: '700', color: palette.brand },
})
