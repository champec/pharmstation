// Shop — staff side of the online shop, matching the web pages
// /shop-admin/orders and /shop-admin (stock).
//
// Orders: incoming orders, pharmacist check for P medicines (approve or
// reject with a reason), move orders on (confirm, ready, collected, out for
// delivery, completed) and cancel. Cancelling or rejecting a card-paid order
// goes through the stripe-checkout function so the customer is refunded.
// The database enforces the rules (review guard, payment guard, restock on
// cancel), so this screen only hides actions that would be refused.
//
// Stock: search products, change stock counts and switch products on or off.
// Adding and editing products (photos, questionnaires) stays on the web.
import type { ComponentType } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

export const SHOP_COLOR = '#DB2777'

type OrderStatus = 'new' | 'confirmed' | 'ready' | 'out_for_delivery' | 'collected' | 'completed' | 'cancelled'
type ReviewStatus = 'not_required' | 'pending' | 'approved' | 'rejected'
type PaymentStatus = 'not_required' | 'awaiting_payment' | 'paid' | 'refunded' | 'partially_refunded' | 'expired'

type OrderItem = { id: string; product_id: string | null; product_name: string; quantity: number; line_total_pence: number }
type Answer = { question_id: string; label: string; answer: string }
type Response = { id: string; product_id: string | null; answers: Answer[] }
type Order = {
  id: string
  order_number: string
  status: OrderStatus
  review_status: ReviewStatus
  payment_method: 'in_store' | 'card'
  payment_status: PaymentStatus
  fulfilment_method: 'collection' | 'delivery'
  delivery_address: { line_1?: string; line_2?: string; city?: string; postcode?: string } | null
  guest_name: string | null
  guest_phone: string | null
  customer_notes: string | null
  org_notes: string | null
  delivery_fee_pence: number
  total_pence: number
  created_at: string
  reviewed_by_name: string | null
  reviewed_by_gphc: string | null
  reviewed_at: string | null
  review_notes: string | null
  delivery_round_id: string | null
  items: OrderItem[]
  responses: Response[]
}

const ORDER_SELECT = '*, items:ps_shop_order_items(*), responses:ps_shop_questionnaire_responses(*)'

const STATUS: Record<OrderStatus, { label: string; color: string }> = {
  new: { label: 'New', color: palette.brand },
  confirmed: { label: 'Confirmed', color: palette.warning },
  ready: { label: 'Ready', color: palette.success },
  out_for_delivery: { label: 'Out for delivery', color: '#7C3AED' },
  collected: { label: 'Collected', color: palette.success },
  completed: { label: 'Completed', color: palette.textMuted },
  cancelled: { label: 'Cancelled', color: palette.danger },
}

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed'],
  confirmed: ['ready'],
  ready: ['out_for_delivery', 'collected'],
  out_for_delivery: ['completed'],
  collected: ['completed'],
  completed: [],
  cancelled: [],
}

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Confirm order',
  ready: 'Mark ready',
  out_for_delivery: 'Mark out for delivery',
  collected: 'Mark collected',
  completed: 'Mark completed',
}

const price = (p: number) => `£${(p / 100).toFixed(2)}`
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

async function errorMessage(error: unknown, data: unknown): Promise<string | null> {
  const fromData = (data as { error?: string } | null)?.error
  if (fromData) return fromData
  if (!error) return null
  const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context
  if (ctx?.json) {
    try {
      const body = await ctx.json()
      if (body?.error) return body.error
    } catch {
      /* fall through */
    }
  }
  return (error as Error).message || 'Request failed'
}

/** Cancel (or reject) an order that was paid by card: refunds the customer. */
async function cancelPaid(orderId: string, rejectNotes?: string) {
  const { data, error } = await userClient.functions.invoke('stripe-checkout', {
    body: { action: 'cancel_shop_order', order_id: orderId, ...(rejectNotes !== undefined ? { reject_notes: rejectNotes } : {}) },
  })
  const msg = await errorMessage(error, data)
  if (msg) throw new Error(msg)
  return ((data as { refund_error?: string } | null)?.refund_error as string | undefined) ?? null
}

// ---------------------------------------------------------------- orders

type Filter = 'active' | 'check' | 'done'

function OrdersScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error: err } = await userClient
      .from('ps_shop_orders')
      .select(ORDER_SELECT)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (err) setError(err.message)
    else {
      setError(null)
      setOrders((data ?? []) as Order[])
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const needsCheck = (o: Order) => o.review_status === 'pending' && o.status !== 'cancelled'
  const isDone = (o: Order) => o.status === 'completed' || o.status === 'cancelled'
  const shown = orders.filter((o) => (filter === 'check' ? needsCheck(o) : filter === 'done' ? isDone(o) : !isDone(o)))
  const checkCount = orders.filter(needsCheck).length
  const open = orders.find((o) => o.id === openId) ?? null

  const replace = (fresh: Order) => setOrders((all) => all.map((o) => (o.id === fresh.id ? fresh : o)))
  const refetch = async (id: string) => {
    const { data } = await userClient.from('ps_shop_orders').select(ORDER_SELECT).eq('id', id).single()
    if (data) replace(data as Order)
  }

  return (
    <View style={styles.screen}>
      <View style={styles.pills}>
        {([
          ['active', 'Active'],
          ['check', checkCount ? `Needs check (${checkCount})` : 'Needs check'],
          ['done', 'Done'],
        ] as [Filter, string][]).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => setFilter(id)}
            style={[styles.pill, filter === id && styles.pillOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === id }}
          >
            <Text style={[styles.pillText, filter === id && styles.pillTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={shown}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name="bag-handle-outline" size={36} color={SHOP_COLOR} />
              <Text style={styles.emptyText}>
                {filter === 'check' ? 'Nothing waiting for a pharmacist' : filter === 'done' ? 'No finished orders yet' : 'No open orders'}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <OrderCard order={item} onPress={() => setOpenId(item.id)} />}
      />
      <OrderSheet
        order={open}
        onClose={() => setOpenId(null)}
        onChanged={(id) => void refetch(id)}
      />
    </View>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.badge, { color, borderColor: color }]}>{label}</Text>
}

function paymentBadge(o: Order) {
  if (o.payment_status === 'awaiting_payment' && o.status !== 'cancelled') return <Badge label="Waiting for card payment" color={palette.textMuted} />
  if (o.payment_status === 'paid') return <Badge label="Paid by card" color={palette.success} />
  if (o.payment_status === 'refunded') return <Badge label="Refunded" color={palette.brand} />
  if (o.payment_status === 'partially_refunded') return <Badge label="Part refunded" color={palette.brand} />
  if (o.payment_method === 'in_store' && o.status !== 'cancelled') return <Badge label={o.fulfilment_method === 'delivery' ? 'Pay on delivery' : 'Pay in store'} color={palette.textMuted} />
  return null
}

function reviewBadge(o: Order) {
  if (o.review_status === 'pending' && o.status !== 'cancelled') return <Badge label="Needs pharmacist check" color={palette.warning} />
  if (o.review_status === 'approved') return <Badge label="Pharmacist approved" color={palette.success} />
  if (o.review_status === 'rejected') return <Badge label="Rejected by pharmacist" color={palette.danger} />
  return null
}

function OrderCard({ order: o, onPress }: { order: Order; onPress: () => void }) {
  const st = STATUS[o.status]
  const count = o.items.reduce((n, it) => n + it.quantity, 0)
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowBetween}>
        <Text style={styles.orderNo}>{o.order_number}</Text>
        <Text style={styles.total}>{price(o.total_pence)}</Text>
      </View>
      <Text style={styles.name}>{o.guest_name || 'Registered customer'}</Text>
      <Text style={styles.muted}>
        {count} item{count === 1 ? '' : 's'} · {o.fulfilment_method === 'delivery' ? 'Delivery' : 'Collection'} · {when(o.created_at)}
      </Text>
      <View style={styles.badges}>
        <Badge label={st.label} color={st.color} />
        {reviewBadge(o)}
        {paymentBadge(o)}
      </View>
    </Pressable>
  )
}

function OrderSheet({ order, onClose, onChanged }: { order: Order | null; onClose: () => void; onChanged: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'view' | 'approve' | 'reject'>('view')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    setMode('view')
    setNotes('')
  }, [order?.id])

  if (!order) return null
  const o = order
  const paid = o.payment_status === 'paid'
  const blocked = o.review_status === 'pending' || o.review_status === 'rejected' || o.payment_status === 'awaiting_payment'
  const next = blocked
    ? []
    : NEXT[o.status]
        .filter((s) => !(s === 'out_for_delivery' && o.fulfilment_method !== 'delivery'))
        .filter((s) => !(s === 'collected' && o.fulfilment_method !== 'collection'))
  const canCancel = o.status !== 'completed' && o.status !== 'cancelled'

  const run = async (fn: () => Promise<string | null | void>, done: string) => {
    setBusy(true)
    try {
      const warning = await fn()
      if (warning) Alert.alert('Order updated, but the refund failed', warning)
      else Alert.alert(done)
      setMode('view')
      setNotes('')
      onChanged(o.id)
    } catch (e) {
      Alert.alert('Could not update the order', (e as Error).message)
    }
    setBusy(false)
  }

  const setStatus = (status: OrderStatus) =>
    run(async () => {
      const { error } = await userClient.from('ps_shop_orders').update({ status }).eq('id', o.id)
      if (error) throw new Error(error.message)
    }, `Order ${STATUS[status].label.toLowerCase()}`)

  const cancel = () =>
    Alert.alert(
      `Cancel ${o.order_number}?`,
      `The items go back into stock${paid ? ' and the customer is refunded in full' : ''}. A cancelled order can't be reopened.`,
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Cancel order',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              if (paid) return cancelPaid(o.id)
              const { error } = await userClient.from('ps_shop_orders').update({ status: 'cancelled' }).eq('id', o.id)
              if (error) throw new Error(error.message)
            }, 'Order cancelled'),
        },
      ],
    )

  const submitReview = (approve: boolean) => {
    const text = notes.trim()
    if (!approve && !text) {
      Alert.alert('Add a reason', 'A reason is needed to reject an order. It is kept on record.')
      return
    }
    void run(async () => {
      if (!approve && paid) return cancelPaid(o.id, text)
      const { error } = await userClient.rpc('ps_shop_review_order', {
        p_order_id: o.id,
        p_approve: approve,
        p_notes: text || null,
      })
      if (error) throw new Error(error.message)
    }, approve ? 'Sale approved' : 'Order rejected and cancelled')
  }

  const address = o.delivery_address
    ? [o.delivery_address.line_1, o.delivery_address.line_2, o.delivery_address.city, o.delivery_address.postcode].filter(Boolean).join(', ')
    : null

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{o.order_number}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
            <Ionicons name="close" size={26} color={palette.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <View style={styles.badges}>
            <Badge label={STATUS[o.status].label} color={STATUS[o.status].color} />
            {reviewBadge(o)}
            {paymentBadge(o)}
          </View>

          <View style={styles.block}>
            <Text style={styles.name}>{o.guest_name || 'Registered customer'}</Text>
            {o.guest_phone ? <Text style={styles.muted}>{o.guest_phone}</Text> : null}
            <Text style={styles.muted}>
              {o.fulfilment_method === 'delivery' ? 'Delivery' : 'Collection'} · ordered {when(o.created_at)}
            </Text>
            {address ? <Text style={styles.muted}>{address}</Text> : null}
            {o.delivery_round_id ? <Text style={styles.muted}>On a delivery run</Text> : null}
          </View>

          <View style={styles.block}>
            {o.items.map((it) => (
              <View key={it.id} style={styles.rowBetween}>
                <Text style={[styles.body, { flex: 1 }]}>
                  {it.quantity} × {it.product_name}
                </Text>
                <Text style={styles.body}>{price(it.line_total_pence)}</Text>
              </View>
            ))}
            {o.delivery_fee_pence > 0 ? (
              <View style={styles.rowBetween}>
                <Text style={styles.muted}>Delivery</Text>
                <Text style={styles.muted}>{price(o.delivery_fee_pence)}</Text>
              </View>
            ) : null}
            <View style={[styles.rowBetween, styles.totalRow]}>
              <Text style={styles.name}>Total</Text>
              <Text style={styles.name}>{price(o.total_pence)}</Text>
            </View>
          </View>

          {o.customer_notes ? (
            <View style={styles.block}>
              <Text style={styles.label}>Customer note</Text>
              <Text style={styles.body}>{o.customer_notes}</Text>
            </View>
          ) : null}

          {o.responses.map((r) => {
            const item = o.items.find((it) => it.product_id === r.product_id)
            return (
              <View key={r.id} style={[styles.block, styles.answers]}>
                <Text style={[styles.label, { color: '#5B21B6' }]}>Consultation answers{item ? `: ${item.product_name}` : ''}</Text>
                {r.answers.map((a) => (
                  <View key={a.question_id} style={{ marginTop: 6 }}>
                    <Text style={styles.muted}>{a.label}</Text>
                    <Text style={styles.answer}>{a.answer || 'No answer'}</Text>
                  </View>
                ))}
              </View>
            )
          })}

          {o.review_status === 'pending' && o.status !== 'cancelled' ? (
            <View style={[styles.block, styles.check]}>
              <Text style={[styles.label, { color: '#92400E' }]}>A pharmacist needs to check this order</Text>
              <Text style={styles.muted}>
                Read the answers above. The order can't move on until a pharmacist approves it. Your name and GPhC number are recorded with the decision.
              </Text>
              {mode === 'view' ? (
                <View style={{ gap: 10, marginTop: 6 }}>
                  <Action label="Approve sale" color={palette.success} onPress={() => setMode('approve')} disabled={busy} />
                  <Action label="Reject and cancel" color={palette.danger} outline onPress={() => setMode('reject')} disabled={busy} />
                </View>
              ) : (
                <View style={{ gap: 10, marginTop: 6 }}>
                  <Text style={styles.label}>
                    {mode === 'approve' ? 'Note for the record (optional)' : 'Reason for rejecting (required, kept on record)'}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    maxLength={2000}
                    placeholder={mode === 'approve' ? 'For example: checked, suitable' : 'For example: taking a medicine that interacts'}
                    placeholderTextColor={palette.textMuted}
                    autoFocus
                  />
                  {mode === 'reject' ? (
                    <Text style={styles.muted}>The order is cancelled and its stock goes back{paid ? '. The customer is refunded in full.' : '.'}</Text>
                  ) : null}
                  <Action
                    label={mode === 'approve' ? 'Approve sale' : 'Reject and cancel order'}
                    color={mode === 'approve' ? palette.success : palette.danger}
                    onPress={() => submitReview(mode === 'approve')}
                    disabled={busy}
                  />
                  <Action label="Back" color={palette.textMuted} outline onPress={() => setMode('view')} disabled={busy} />
                </View>
              )}
            </View>
          ) : null}

          {(o.review_status === 'approved' || o.review_status === 'rejected') && o.reviewed_at ? (
            <Text style={styles.muted}>
              {o.review_status === 'approved' ? 'Approved' : 'Rejected'} by {o.reviewed_by_name || 'pharmacist'}
              {o.reviewed_by_gphc ? ` (GPhC ${o.reviewed_by_gphc})` : ''} on {when(o.reviewed_at)}
              {o.review_notes ? `. “${o.review_notes}”` : ''}
            </Text>
          ) : null}

          {o.payment_status === 'awaiting_payment' && o.status !== 'cancelled' ? (
            <Text style={styles.warn}>The customer is still paying by card. If they don't finish within 45 minutes the order is cancelled.</Text>
          ) : null}

          {busy ? <ActivityIndicator color={SHOP_COLOR} /> : null}

          {mode === 'view' && (next.length > 0 || canCancel) ? (
            <View style={{ gap: 10, marginTop: 4 }}>
              {next.map((s) => (
                <Action key={s} label={ACTION_LABEL[s] ?? s} color={SHOP_COLOR} onPress={() => void setStatus(s)} disabled={busy} />
              ))}
              {o.fulfilment_method === 'delivery' && !o.delivery_round_id && !blocked && canCancel ? (
                <Text style={styles.muted}>To add this order to a delivery run, use Shop › Orders on the website.</Text>
              ) : null}
              {canCancel ? <Action label="Cancel order" color={palette.danger} outline onPress={cancel} disabled={busy} /> : null}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  )
}

// ---------------------------------------------------------------- stock

type Product = {
  id: string
  name: string
  sku: string | null
  price_pence: number
  stock_quantity: number
  is_active: boolean
  medicine_class: 'general' | 'gsl' | 'p'
}

function StockScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [setting, setSetting] = useState<Product | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error: err } = await userClient
      .from('ps_shop_products')
      .select('id, name, sku, price_pence, stock_quantity, is_active, medicine_class')
      .eq('org_id', orgId)
      .order('name')
    if (err) setError(err.message)
    else {
      setError(null)
      setProducts((data ?? []) as Product[])
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
  }, [products, query])

  const save = async (p: Product, patch: Partial<Pick<Product, 'stock_quantity' | 'is_active'>>) => {
    const before = p
    setProducts((all) => all.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))
    setSavingId(p.id)
    const { error: err } = await userClient.from('ps_shop_products').update(patch).eq('id', p.id)
    setSavingId(null)
    if (err) {
      setProducts((all) => all.map((x) => (x.id === p.id ? before : x)))
      Alert.alert('Could not save', err.message)
    }
  }

  const lowCount = products.filter((p) => p.is_active && p.stock_quantity <= 3).length

  return (
    <View style={styles.screen}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 6 }}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search products or SKU"
          placeholderTextColor={palette.textMuted}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {lowCount ? <Text style={styles.warn}>{lowCount} product{lowCount === 1 ? ' is' : 's are'} running low (3 or fewer left).</Text> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={36} color={SHOP_COLOR} />
              <Text style={styles.emptyText}>{query ? 'No products match' : 'No products yet. Add them on the website under Shop › Products & Stock.'}</Text>
            </View>
          )
        }
        renderItem={({ item: p }) => (
          <View style={[styles.card, !p.is_active && { opacity: 0.6 }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={2}>{p.name}</Text>
              <Switch
                value={p.is_active}
                onValueChange={(v) => void save(p, { is_active: v })}
                trackColor={{ true: SHOP_COLOR, false: palette.border }}
                accessibilityLabel={`${p.name} on sale`}
              />
            </View>
            <Text style={styles.muted}>
              {price(p.price_pence)}
              {p.medicine_class === 'p' ? ' · Pharmacy medicine' : p.medicine_class === 'gsl' ? ' · GSL' : ''}
              {p.sku ? ` · ${p.sku}` : ''}
              {p.is_active ? '' : ' · Hidden from the shop'}
            </Text>
            <View style={styles.stockRow}>
              <Text style={[styles.body, p.stock_quantity <= 3 && { color: palette.danger, fontWeight: '700' }]}>
                {p.stock_quantity === 0 ? 'Out of stock' : `${p.stock_quantity} in stock`}
              </Text>
              <View style={styles.stepper}>
                <Stepper icon="remove" label={`One less ${p.name}`} disabled={p.stock_quantity <= 0 || savingId === p.id}
                  onPress={() => void save(p, { stock_quantity: Math.max(0, p.stock_quantity - 1) })} />
                <Stepper icon="add" label={`One more ${p.name}`} disabled={savingId === p.id}
                  onPress={() => void save(p, { stock_quantity: p.stock_quantity + 1 })} />
                <Pressable
                  style={styles.setBtn}
                  disabled={savingId === p.id}
                  onPress={() => setSetting(p)}
                  accessibilityRole="button"
                >
                  <Text style={styles.setText}>Set</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      />
      <SetStockSheet product={setting} onClose={() => setSetting(null)} onSave={(p, n) => { setSetting(null); void save(p, { stock_quantity: n }) }} />
    </View>
  )
}

function SetStockSheet({ product, onClose, onSave }: { product: Product | null; onClose: () => void; onSave: (p: Product, n: number) => void }) {
  const [value, setValue] = useState('')
  useEffect(() => {
    setValue(product ? String(product.stock_quantity) : '')
  }, [product])
  if (!product) return null
  const n = Number.parseInt(value, 10)
  const ok = Number.isFinite(n) && n >= 0 && n <= 100000
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.name}>Set stock</Text>
          <Text style={styles.muted}>{product.name}</Text>
          <TextInput style={styles.input} value={value} onChangeText={setValue} keyboardType="number-pad" autoFocus selectTextOnFocus />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Action label="Cancel" color={palette.textMuted} outline onPress={onClose} /></View>
            <View style={{ flex: 1 }}><Action label="Save" color={SHOP_COLOR} onPress={() => ok && onSave(product, n)} disabled={!ok} /></View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function Stepper({ icon, label, onPress, disabled }: { icon: 'add' | 'remove'; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.stepBtn, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      <Ionicons name={icon} size={20} color={SHOP_COLOR} />
    </Pressable>
  )
}

function Action({ label, color, outline, onPress, disabled }: { label: string; color: string; outline?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.action, outline ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color }, disabled && { opacity: 0.5 }]}
    >
      <Text style={[styles.actionText, { color: outline ? color : palette.textInverse }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  error: { color: palette.danger, paddingHorizontal: 16, paddingTop: 8 },
  pills: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  pillOn: { backgroundColor: SHOP_COLOR, borderColor: SHOP_COLOR },
  pillText: { fontSize: 14, fontWeight: '600', color: palette.text },
  pillTextOn: { color: palette.textInverse },
  empty: { alignItems: 'center', gap: 8, paddingTop: 80, paddingHorizontal: 24 },
  emptyText: { color: palette.textMuted, fontSize: 15, textAlign: 'center' },
  card: { padding: 14, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, marginBottom: 10, gap: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  orderNo: { fontSize: 13, fontWeight: '700', color: palette.textMuted, fontFamily: 'monospace' },
  total: { fontSize: 16, fontWeight: '700', color: palette.text },
  name: { fontSize: 16, fontWeight: '600', color: palette.text },
  body: { fontSize: 15, color: palette.text },
  muted: { fontSize: 13, color: palette.textMuted },
  label: { fontSize: 13, fontWeight: '700', color: palette.text },
  warn: { fontSize: 13, color: palette.warning },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  badge: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  sheet: { flex: 1, backgroundColor: palette.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: palette.text, flex: 1, fontFamily: 'monospace' },
  block: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 4 },
  totalRow: { borderTopWidth: 1, borderColor: palette.border, paddingTop: 8, marginTop: 4 },
  answers: { backgroundColor: '#FAF5FF', borderColor: '#EDE9FE' },
  answer: { fontSize: 15, fontWeight: '600', color: palette.text },
  check: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface, padding: 12, fontSize: 16, color: palette.text, textAlignVertical: 'top' },
  search: { height: 44, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, paddingHorizontal: 12, fontSize: 16, color: palette.text },
  action: { paddingVertical: 13, borderRadius: radius.md, alignItems: 'center' },
  actionText: { fontSize: 15, fontWeight: '700' },
  stockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1.5, borderColor: SHOP_COLOR, alignItems: 'center', justifyContent: 'center' },
  setBtn: { height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: palette.brandTint, alignItems: 'center', justifyContent: 'center' },
  setText: { fontSize: 14, fontWeight: '700', color: palette.brandDark },
  overlay: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 20, gap: 12 },
})

export const shopScreens: Record<string, ComponentType> = {
  orders: OrdersScreen,
  stock: StockScreen,
}
