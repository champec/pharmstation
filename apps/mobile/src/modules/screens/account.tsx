// Account — real tab screens (user-tier, always available).
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import {
  cancelAccountDeletion,
  changeMyEmail,
  changeMyPassword,
  logAuthEvent,
  myDeletionRequest,
  passwordProblem,
  requestAccountDeletion,
  updateMyProfile,
  type DeletionRequest,
} from '@/lib/account'
import { SecurityTab } from '@/modules/screens/authenticator'
import { HelpTab } from '@/modules/screens/help'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

// Shown so people (and support) can tell which app and update a phone runs.
function appVersionLabel() {
  const v = Constants.expoConfig?.version ?? '?'
  return Updates.channel ? `${v} (${Updates.channel})` : v
}

function ProfileTab() {
  const router = useRouter()
  const userLogout = useAuthStore((s) => s.userLogout)
  const busy = useAuthStore((s) => s.busy)

  const onSignOut = async () => {
    await userLogout()
    router.replace('/(auth)/user-login')
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <DetailsCard />
      <EmailCard />
      <PasswordCard />
      <DeleteCard />
      <Button label="Sign out" variant="danger" onPress={onSignOut} loading={busy} />
      <View style={styles.card}>
        <Row label="App version" value={appVersionLabel()} />
        <Row label="Installed build" value={(Updates.runtimeVersion ?? 'dev').slice(0, 8)} />
        <Row
          label="Latest update"
          value={
            Updates.isEmbeddedLaunch || !Updates.updateId
              ? 'none yet (built-in)'
              : `${Updates.updateId.slice(0, 8)}${Updates.createdAt ? ` · ${Updates.createdAt.toLocaleDateString('en-GB')}` : ''}`
          }
        />
      </View>
    </ScrollView>
  )
}

function Notice({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null
  return <Text style={msg.ok ? styles.ok : styles.error}>{msg.text}</Text>
}

function DetailsCard() {
  const userProfile = useAuthStore((s) => s.userProfile)
  const [firstName, setFirstName] = useState(userProfile?.first_name ?? '')
  const [lastName, setLastName] = useState(userProfile?.last_name ?? '')
  const [phone, setPhone] = useState(userProfile?.phone ?? '')
  const [gphc, setGphc] = useState(userProfile?.gphc_number ?? '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    // A profile that loads after the screen opens fills the form in.
    if (!userProfile) return
    setFirstName(userProfile.first_name ?? userProfile.full_name?.split(' ')[0] ?? '')
    setLastName(userProfile.last_name ?? userProfile.full_name?.split(' ').slice(1).join(' ') ?? '')
    setPhone(userProfile.phone ?? '')
    setGphc(userProfile.gphc_number ?? '')
  }, [userProfile?.id])

  const save = async () => {
    if (!userProfile) return
    setSaving(true)
    setMsg(null)
    try {
      const update = await updateMyProfile(
        userProfile.id,
        { first_name: firstName, last_name: lastName, phone, gphc_number: gphc },
        userProfile.full_name,
      )
      useAuthStore.setState({ userProfile: { ...userProfile, ...update } as typeof userProfile })
      setMsg({ ok: true, text: 'Saved.' })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Couldn’t save. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Your details</Text>
      <Field label="First name" value={firstName} onChangeText={setFirstName} autoComplete="given-name" textContentType="givenName" />
      <Field label="Last name" value={lastName} onChangeText={setLastName} autoComplete="family-name" textContentType="familyName" />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
      <Field label="GPhC number (pharmacists and technicians)" value={gphc} onChangeText={setGphc} keyboardType="number-pad" />
      <Notice msg={msg} />
      <Button label="Save details" onPress={save} loading={saving} />
    </View>
  )
}

function EmailCard() {
  const userProfile = useAuthStore((s) => s.userProfile)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await changeMyEmail(email)
      setMsg({ ok: true, text: `We’ve emailed ${userProfile?.email ?? 'your current address'} and ${email.trim()}. Open the link in both emails to finish the change.` })
      setOpen(false)
      setEmail('')
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Couldn’t change your email.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Email</Text>
      <Row label="Signs in as" value={userProfile?.email ?? '—'} />
      {open ? (
        <>
          <Field label="New email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
          <Button label="Send confirmation emails" onPress={submit} loading={saving} disabled={!email.trim()} />
          <Button label="Cancel" variant="ghost" onPress={() => { setOpen(false); setMsg(null) }} />
        </>
      ) : (
        <Button label="Change email" variant="secondary" onPress={() => setOpen(true)} />
      )}
      <Notice msg={msg} />
    </View>
  )
}

function PasswordCard() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const organisation = useAuthStore((s) => s.organisation)
  const membership = useAuthStore((s) => s.membership)

  const submit = async () => {
    setMsg(null)
    if (next !== confirm) {
      setMsg({ ok: false, text: 'The new passwords don’t match.' })
      return
    }
    const problem = passwordProblem(next)
    if (problem) {
      setMsg({ ok: false, text: problem })
      return
    }
    setSaving(true)
    try {
      await changeMyPassword(current, next)
      if (membership) void logAuthEvent(organisation?.id, 'password_changed')
      setMsg({ ok: true, text: 'Password changed. Use the new one next time you sign in.' })
      setOpen(false)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Couldn’t change your password.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Password</Text>
      {open ? (
        <>
          <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
          <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <Field label="New password again" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <Text style={styles.muted}>At least 10 characters, with letters and numbers.</Text>
          <Button label="Change password" onPress={submit} loading={saving} disabled={!current || !next || !confirm} />
          <Button label="Cancel" variant="ghost" onPress={() => { setOpen(false); setMsg(null) }} />
        </>
      ) : (
        <Button label="Change password" variant="secondary" onPress={() => setOpen(true)} />
      )}
      <Notice msg={msg} />
    </View>
  )
}

function DeleteCard() {
  const [request, setRequest] = useState<DeletionRequest | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    myDeletionRequest().then(setRequest).catch(() => setRequest(null))
  }, [])
  useEffect(load, [load])

  const submit = () => {
    Alert.alert(
      'Ask to delete your account?',
      'PharmStation will delete your account and personal details. Records you made at a pharmacy (registers, logs) stay with that pharmacy, as the law requires, under “Deleted user”.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Ask to delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true)
            setMsg(null)
            try {
              await requestAccountDeletion(reason.trim())
              setOpen(false)
              setReason('')
              load()
            } catch (err) {
              setMsg({ ok: false, text: err instanceof Error ? err.message : 'Couldn’t send the request.' })
            } finally {
              setSaving(false)
            }
          },
        },
      ],
    )
  }

  const cancel = async () => {
    setSaving(true)
    try {
      await cancelAccountDeletion()
      load()
      setMsg({ ok: true, text: 'Request cancelled. Your account stays as it is.' })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Couldn’t cancel the request.' })
    } finally {
      setSaving(false)
    }
  }

  if (request === undefined) return null
  const pending = request?.status === 'pending'

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Delete account</Text>
      {pending ? (
        <>
          <Text style={styles.muted}>
            You asked to delete your account on {new Date(request!.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. We’ll delete it within 30 days, and you can cancel until then.
          </Text>
          <Button label="Cancel the request" variant="secondary" onPress={cancel} loading={saving} />
        </>
      ) : open ? (
        <>
          <Field label="Why are you leaving? (optional)" value={reason} onChangeText={setReason} multiline />
          <Button label="Ask to delete my account" variant="danger" onPress={submit} loading={saving} />
          <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
        </>
      ) : (
        <>
          {request?.status === 'declined' && request.admin_note ? (
            <Text style={styles.muted}>Your last request was declined: {request.admin_note}</Text>
          ) : null}
          <Button label="Delete my account" variant="ghost" onPress={() => setOpen(true)} />
        </>
      )}
      <Notice msg={msg} />
    </View>
  )
}

function PharmaciesTab() {
  const router = useRouter()
  const organisation = useAuthStore((s) => s.organisation)
  const membership = useAuthStore((s) => s.membership)
  const isOrgConnected = useAuthStore((s) => s.isOrgConnected)

  return (
    <View style={styles.content}>
      <View style={styles.card}>
        {isOrgConnected ? (
          <>
            <Row label="Connected to" value={organisation?.name ?? '—'} />
            <Row label="Your role" value={membership?.role ?? '—'} />
          </>
        ) : (
          <Text style={styles.muted}>No pharmacy connected.</Text>
        )}
      </View>
      <Button
        label={isOrgConnected ? 'Manage pharmacy' : 'Connect a pharmacy'}
        variant="secondary"
        onPress={() => router.push('/(app)/connect-pharmacy')}
      />
    </View>
  )
}

export const accountScreens: Record<string, ComponentType> = {
  profile: ProfileTab,
  pharmacies: PharmaciesTab,
  security: SecurityTab,
  help: HelpTab,
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 4, paddingBottom: 24 },
  title: { fontSize: 17, fontWeight: '700', color: palette.text },
  ok: { fontSize: 14, lineHeight: 20, color: palette.success, fontWeight: '600' },
  error: { fontSize: 14, lineHeight: 20, color: palette.danger, fontWeight: '600' },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 14,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 14, color: palette.textMuted },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  muted: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
})
