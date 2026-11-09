// ============================================
// RpStatusCard (mobile): who is the Responsible Pharmacist right now, with
// sign in, step out, back, sign out and take over. Same rules as the web card.
// ============================================

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import { addDays, formatTime, ukDate } from '@/lib/logs'
import {
  MAX_ABSENCE_MINUTES,
  buildSessions,
  formatDuration,
  loadRpData,
  minutesBetween,
  openAbsence,
  rpEndAbsence,
  rpErrorMessage,
  rpSignIn,
  rpSignOut,
  rpStartAbsence,
  type RpSession,
} from '@/lib/rp-log'

interface Props {
  refreshKey?: number
  onChange?: () => void
}

export function RpStatusCard({ refreshKey, onChange }: Props) {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const profile = useAuthStore((s) => s.userProfile)
  const canSign = useAuthStore((s) => !!s.permissions?.rp_log_sign)
  const [session, setSession] = useState<RpSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepOutOpen, setStepOutOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const data = await loadRpData(orgId, addDays(ukDate(), -2))
      setSession(buildSessions(data.entries, data.absences).find((s) => s.isOpen) ?? null)
      setError(null)
    } catch (e) {
      setError(rpErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load, refreshKey])
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setStepOutOpen(false)
      setReason('')
      await load()
      onChange?.()
    } catch (e) {
      setError(rpErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!orgId) return null

  const gphc = profile?.gphc_number?.trim()
  const isMe = !!session && !!gphc && session.current.gphc_number === gphc
  const away = openAbsence(session)
  const awayMins = away ? minutesBetween(away.absent_from, null) : 0
  const onMins = session?.current.rp_signed_in_at ? minutesBetween(session.current.rp_signed_in_at, null) : 0
  const state = loading && !session ? 'loading' : !session ? 'none' : away ? 'away' : 'on'
  const tone = state === 'on' ? palette.success : state === 'away' ? palette.warning : state === 'none' ? palette.danger : palette.textMuted

  const confirmSignIn = (takeOver: boolean) => {
    if (!gphc) {
      Alert.alert('GPhC number needed', 'Add your GPhC number to your profile on the website before signing in as RP.')
      return
    }
    Alert.alert(
      takeOver ? 'Take over as RP?' : 'Sign in as RP?',
      `${takeOver && session ? `${session.current.pharmacist_name} will be signed out at the same moment.\n\n` : ''}You are signing in as ${profile?.full_name} (GPhC ${gphc}). This is a legal record: you are taking responsibility for the safe and effective running of this pharmacy.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'I accept, sign me in', onPress: () => run(() => rpSignIn(orgId, takeOver)) },
      ],
    )
  }

  const confirmSignOut = () => {
    if (!session) return
    Alert.alert(
      'Sign out as RP?',
      `Your sign-out time will be recorded as now (${formatTime(new Date().toISOString())}). The pharmacy has no RP until another pharmacist signs in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out now', style: 'destructive', onPress: () => run(() => rpSignOut(session.root.id)) },
      ],
    )
  }

  return (
    <View style={[styles.card, { borderLeftColor: tone }]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={styles.label}>RESPONSIBLE PHARMACIST</Text>
        {loading && session ? <ActivityIndicator size="small" color={palette.textMuted} /> : null}
      </View>

      {state === 'loading' && <Text style={styles.sub}>Checking…</Text>}
      {state === 'none' && (
        <>
          <Text style={styles.name}>No RP signed in</Text>
          <Text style={styles.sub}>
            {canSign
              ? 'The pharmacy can’t sell P medicines or hand out prescriptions until a pharmacist signs in.'
              : 'Ask a pharmacist to sign in as RP.'}
          </Text>
        </>
      )}
      {session && (
        <>
          <Text style={styles.name}>
            {session.current.pharmacist_name}
            {isMe ? ' (you)' : ''}
          </Text>
          <Text style={styles.gphc}>GPhC {session.current.gphc_number}</Text>
          <Text style={[styles.sub, away && awayMins > MAX_ABSENCE_MINUTES ? { color: palette.danger } : null]}>
            {away
              ? `Away since ${formatTime(away.absent_from)} (${formatDuration(awayMins)})${away.reason ? ` · ${away.reason}` : ''}${awayMins > MAX_ABSENCE_MINUTES ? ' · over the 2 hour limit' : ''}`
              : `On duty since ${formatTime(session.current.rp_signed_in_at)} · ${formatDuration(onMins)}`}
          </Text>
        </>
      )}

      {canSign && state !== 'loading' && (
        <View style={styles.actions}>
          {state === 'none' && <Button label="Sign in as RP" loading={busy} onPress={() => confirmSignIn(false)} style={styles.grow} />}
          {session && isMe && !away && (
            <>
              <Button label="Step out" variant="secondary" disabled={busy} onPress={() => setStepOutOpen(true)} style={styles.grow} />
              <Button label="Sign out" loading={busy} onPress={confirmSignOut} style={styles.grow} />
            </>
          )}
          {session && away && (
            <Button
              label={isMe ? 'I’m back' : `${session.current.pharmacist_name?.split(' ')[0] ?? 'RP'} is back`}
              loading={busy}
              onPress={() => run(() => rpEndAbsence(away.id))}
              style={styles.grow}
            />
          )}
          {session && isMe && away && <Button label="Sign out" variant="ghost" disabled={busy} onPress={confirmSignOut} style={styles.grow} />}
          {session && !isMe && <Button label="Take over as RP" variant="secondary" disabled={busy} onPress={() => confirmSignIn(true)} style={styles.grow} />}
        </View>
      )}

      {error ? (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Modal visible={stepOutOpen} transparent animationType="fade" onRequestClose={() => setStepOutOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Step out of the pharmacy</Text>
            <Text style={styles.sub}>
              You stay the RP while you’re away, for up to 2 hours in a working day. Stay contactable and able to come back quickly.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Reason (optional), e.g. lunch"
              placeholderTextColor={palette.textMuted}
              value={reason}
              onChangeText={setReason}
              maxLength={300}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.actions}>
              <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => setStepOutOpen(false)} style={styles.grow} />
              <Button
                label="Record absence"
                loading={busy}
                onPress={() => session && run(() => rpStartAbsence(session.root.id, reason.trim() || null))}
                style={styles.grow}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderLeftWidth: 5,
    padding: 16,
    gap: 4,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: palette.textMuted },
  name: { fontSize: 20, fontWeight: '800', color: palette.text },
  gphc: { fontSize: 13, color: palette.textMuted },
  sub: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  grow: { flexGrow: 1, flexBasis: 120 },
  error: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 8 },
  errorText: { flex: 1, color: palette.danger, fontSize: 13, lineHeight: 18 },
  overlay: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: palette.text },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: palette.text,
  },
})
