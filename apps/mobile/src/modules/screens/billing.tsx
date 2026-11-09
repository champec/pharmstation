// Plan & billing — read-only view of the pharmacy's PharmStation plan and
// prepaid text credits. Buying or changing a plan happens on the web: app
// store rules don't allow selling a subscription inside the app outside
// in-app purchase, so this screen has no buy buttons or payment links.
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

type PlanId = 'network' | 'essential' | 'complete'

// Keep in step with packages/core/src/billing/plans.ts.
const PLAN_NAMES: Record<PlanId, string> = {
  network: 'Network',
  essential: 'Essential',
  complete: 'Complete',
}
const PLAN_RANK: Record<PlanId, number> = { network: 1, essential: 2, complete: 3 }

interface Subscription {
  plan: PlanId
  status: string
  stripe_subscription_id: string | null
  billing_interval: 'month' | 'year' | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  override_plan: PlanId | null
  override_until: string | null
  is_founding_member: boolean
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

/** Mirrors ps_org_effective_plan() in the database. */
function effectivePlan(s: Subscription | null): PlanId {
  if (!s) return 'network'
  const paid: PlanId = ['trialing', 'active', 'past_due'].includes(s.status) ? s.plan : 'network'
  const comp =
    s.override_plan && (!s.override_until || new Date(s.override_until) > new Date()) ? s.override_plan : null
  return comp && PLAN_RANK[comp] > PLAN_RANK[paid] ? comp : paid
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

function PlanTab() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const canManage = useAuthStore((s) => s.permissions?.billing === true)
  const [sub, setSub] = useState<Subscription | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!orgId) return
    setError('')
    const [subRes, creditRes] = await Promise.all([
      userClient.from('ps_org_subscriptions').select('*').eq('org_id', orgId).maybeSingle(),
      userClient.rpc('ps_sms_credit_balance', { p_org_id: orgId }),
    ])
    if (subRes.error) setError('Could not load your plan. Pull down to try again.')
    setSub((subRes.data as Subscription | null) ?? null)
    setCredits(creditRes.error ? null : ((creditRes.data as number | null) ?? 0))
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.brand} />
      </View>
    )
  }

  const plan = effectivePlan(sub)
  const hasStripeSub =
    !!sub?.stripe_subscription_id && ['trialing', 'active', 'past_due', 'unpaid', 'incomplete'].includes(sub.status)
  const comped =
    !!sub?.override_plan && (!sub.override_until || new Date(sub.override_until) > new Date())

  let status = ''
  if (hasStripeSub && sub) {
    if (sub.status === 'past_due' || sub.status === 'unpaid') status = 'Last payment failed. Update the card on the web.'
    else if (sub.cancel_at_period_end) status = `Cancelled. Ends ${fmtDate(sub.current_period_end)}`
    else status = `Renews ${fmtDate(sub.current_period_end)}`
  } else if (comped && sub) {
    status = sub.override_until ? `Complimentary until ${fmtDate(sub.override_until)}` : 'Complimentary'
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Current plan</Text>
        <Text style={styles.planName}>
          {PLAN_NAMES[plan]}
          {sub?.is_founding_member ? '  ·  Founding member' : ''}
        </Text>
        {status ? <Text style={styles.muted}>{status}</Text> : null}
        {hasStripeSub && sub?.billing_interval ? (
          <Row label="Billed" value={sub.billing_interval === 'year' ? 'Yearly' : 'Monthly'} />
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Text message credits</Text>
        <Text style={styles.planName}>{credits === null ? '—' : credits.toLocaleString('en-GB')}</Text>
        <Text style={styles.muted}>One credit sends one text of up to 160 characters.</Text>
      </View>

      <Text style={styles.muted}>
        {canManage
          ? 'To change your plan, update your card or buy text credits, open PharmStation on the web and go to Settings, then Plan & billing.'
          : 'Only the pharmacy owner, or staff they give billing access, can change the plan or buy text credits.'}
      </Text>
    </ScrollView>
  )
}

export const billingScreens: Record<string, ComponentType> = {
  plan: PlanTab,
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 4, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 8,
  },
  eyebrow: { fontSize: 12, fontWeight: '600', color: palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  planName: { fontSize: 24, fontWeight: '700', color: palette.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  rowLabel: { fontSize: 14, color: palette.textMuted },
  rowValue: { fontSize: 14, fontWeight: '600', color: palette.text },
  muted: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
  error: { fontSize: 14, color: palette.danger },
})
