// ============================================
// Pharmacy Management > Team: staff list, invites and sign-in activity
// for owners and managers. Fine-grained permission ticks stay on the website.
// ============================================

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import {
  EVENT_LABELS,
  ROLE_LABELS,
  listInvites,
  listMembers,
  listSignInActivity,
  resetMemberTwoStep,
  revokeInvite,
  sendInvite,
  teamErrorMessage,
  updateMember,
  type InvitableRole,
  type PendingInvite,
  type SignInEvent,
  type TeamMember,
} from '@/lib/team'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

const STAFF_ROLES: InvitableRole[] = ['pharmacist', 'technician', 'dispenser', 'locum']
const SENIOR_ROLES: InvitableRole[] = ['owner', 'manager']

function shortDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function TeamScreen() {
  const organisation = useAuthStore((s) => s.organisation)
  const membership = useAuthStore((s) => s.membership)
  const permissions = useAuthStore((s) => s.permissions)
  const me = useAuthStore((s) => s.userProfile)
  const orgId = organisation?.id
  const isOwner = membership?.role === 'owner'
  const canSeeActivity = permissions?.view_audit === true

  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [activity, setActivity] = useState<SignInEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('dispenser')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ email: string; link: string; emailed: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setError(null)
    try {
      const [m, i, a] = await Promise.all([
        listMembers(orgId),
        listInvites(orgId).catch(() => [] as PendingInvite[]),
        canSeeActivity ? listSignInActivity(orgId, 30).catch(() => [] as SignInEvent[]) : Promise.resolve([] as SignInEvent[]),
      ])
      setMembers(m)
      setInvites(i)
      setActivity(a)
    } catch (err) {
      setMembers([])
      setError(teamErrorMessage(err))
    }
  }, [orgId, canSeeActivity])

  useEffect(() => { void load() }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const invite = async () => {
    if (!orgId) return
    setError(null)
    setInviteResult(null)
    setInviting(true)
    try {
      const clean = email.trim().toLowerCase()
      const res = await sendInvite(orgId, clean, role)
      setInviteResult({ email: clean, link: res.link, emailed: res.emailed })
      setEmail('')
      void load()
    } catch (err) {
      setError(teamErrorMessage(err))
    } finally {
      setInviting(false)
    }
  }

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(teamErrorMessage(err))
    }
  }

  const canEdit = (m: TeamMember) =>
    m.user_id !== me?.id && (isOwner || !SENIOR_ROLES.includes(m.role as InvitableRole))

  const memberOptions = (m: TeamMember) => {
    const roles = (isOwner ? [...SENIOR_ROLES, ...STAFF_ROLES] : STAFF_ROLES).filter((r) => r !== m.role)
    const changeRole = () =>
      Alert.alert(`Change ${m.full_name}’s role`, undefined, [
        ...roles.map((r) => ({ text: ROLE_LABELS[r], onPress: () => run(() => updateMember(m.member_id, { role: r })) })),
        { text: 'Cancel', style: 'cancel' as const },
      ])
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = []
    if (m.status === 'active') {
      buttons.push({ text: 'Change role', onPress: changeRole })
      buttons.push({
        text: 'Reset two-step sign-in',
        onPress: () =>
          Alert.alert('Reset two-step sign-in?', `${m.full_name} will set it up again next time they sign in. Use this when they’ve lost their phone.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: () => run(() => resetMemberTwoStep(m.member_id)) },
          ]),
      })
      buttons.push({ text: 'Suspend', style: 'destructive', onPress: () => run(() => updateMember(m.member_id, { status: 'suspended' })) })
    } else {
      buttons.push({ text: 'Reactivate', onPress: () => run(() => updateMember(m.member_id, { status: 'active' })) })
    }
    if (m.status !== 'revoked') {
      buttons.push({
        text: 'Remove from pharmacy',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Remove from the pharmacy?', `${m.full_name} will lose access straight away. Their past records stay.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => run(() => updateMember(m.member_id, { status: 'revoked' })) },
          ]),
      })
    }
    buttons.push({ text: 'Cancel', style: 'cancel' })
    Alert.alert(m.full_name, `${ROLE_LABELS[m.role] ?? m.role}${m.email ? ` · ${m.email}` : ''}`, buttons)
  }

  if (!orgId) return <Text style={styles.muted}>Connect a pharmacy first.</Text>

  const active = (members ?? []).filter((m) => m.status !== 'revoked')

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.title}>Invite someone</Text>
        <Field label="Their email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <View style={styles.chips}>
          {(isOwner ? [...STAFF_ROLES, ...SENIOR_ROLES] : STAFF_ROLES).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              style={[styles.chip, role === r && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: role === r }}
            >
              <Text style={[styles.chipText, role === r && styles.chipTextOn]}>{ROLE_LABELS[r]}</Text>
            </Pressable>
          ))}
        </View>
        <Button label="Send invite" onPress={invite} loading={inviting} disabled={!email.trim()} />
        {inviteResult ? (
          <View style={styles.result}>
            <Text style={styles.muted}>
              {inviteResult.emailed
                ? `We’ve emailed an invite to ${inviteResult.email}.`
                : `The invite for ${inviteResult.email} is ready, but we couldn’t email it. Share the link yourself.`}
            </Text>
            <Button
              label="Share the link"
              variant="secondary"
              onPress={() => Share.share({ message: `Join ${organisation?.name ?? 'our pharmacy'} on PharmStation: ${inviteResult.link}` })}
            />
          </View>
        ) : null}
      </View>

      {invites.length > 0 ? (
        <>
          <Text style={styles.section}>Waiting to join</Text>
          {invites.map((inv) => (
            <View key={inv.id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.name}>{inv.email}</Text>
                <Text style={styles.meta}>{ROLE_LABELS[inv.role]} · expires {shortDate(inv.expires_at)}</Text>
              </View>
              <Pressable onPress={() => run(() => revokeInvite(inv.id))} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.section}>Team</Text>
      {members === null ? (
        <ActivityIndicator color={palette.brand} />
      ) : (
        active.map((m) => (
          <Pressable
            key={m.member_id}
            style={[styles.row, m.status !== 'active' && styles.rowMuted]}
            onPress={() => (canEdit(m) ? memberOptions(m) : undefined)}
            disabled={!canEdit(m)}
            accessibilityRole="button"
          >
            <View style={styles.flex}>
              <Text style={styles.name}>{m.full_name}{m.user_id === me?.id ? ' (you)' : ''}</Text>
              <Text style={styles.meta}>
                {ROLE_LABELS[m.role] ?? m.role}
                {m.is_locum ? ' · locum' : ''}
                {m.status !== 'active' ? ` · ${m.status}` : ''}
              </Text>
            </View>
            {canEdit(m) ? <Text style={styles.chev}>›</Text> : null}
          </Pressable>
        ))
      )}
      <Text style={styles.hint}>Tap someone to change their role, reset their two-step sign-in or remove them. Fine-grained permissions are on the website under Settings &gt; Team.</Text>

      {canSeeActivity && activity.length > 0 ? (
        <>
          <Text style={styles.section}>Recent sign-in activity</Text>
          {activity.map((e) => (
            <View key={e.id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={[styles.name, (e.event === 'failed_sign_in' || e.event.startsWith('two_step')) && styles.warn]}>
                  {EVENT_LABELS[e.event] ?? e.event}
                </Text>
                <Text style={styles.meta}>{e.full_name ?? e.email ?? 'Unknown'} · {shortDate(e.created_at)}</Text>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingTop: 4, paddingBottom: 32 },
  flex: { flex: 1 },
  card: { backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, padding: 16, gap: 12 },
  title: { fontSize: 17, fontWeight: '700', color: palette.text },
  section: { fontSize: 13, fontWeight: '700', color: palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  muted: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
  hint: { fontSize: 12, lineHeight: 18, color: palette.textMuted },
  error: { color: palette.danger, fontSize: 14, fontWeight: '600' },
  warn: { color: palette.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { borderColor: palette.brand, backgroundColor: palette.brand },
  chipText: { fontSize: 13, fontWeight: '600', color: palette.text },
  chipTextOn: { color: '#fff' },
  result: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
  },
  rowMuted: { opacity: 0.6 },
  name: { fontSize: 15, fontWeight: '600', color: palette.text },
  meta: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
  link: { fontSize: 14, fontWeight: '600', color: palette.brand },
  chev: { fontSize: 22, color: palette.textMuted },
})
