// Services → History: every service delivered at this pharmacy, newest first,
// with the full consultation record, amendments (with a reason, through
// ps_amend_service_delivery) and print / save as PDF. Same data and rules as
// the website's Service History and record page.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { Image } from 'expo-image'
import * as Print from 'expo-print'
import { Ionicons } from '@expo/vector-icons'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import {
  DELIVERY_LIST_SELECT, OUTCOME_LABELS, SERVICES_COLOR as COLOR, SIMPLE_FIELD_TYPES,
  amendDeliveryRecord, cleanSearch, errorMessage, fetchDeliveryRecord, fieldOptions, fmtDate,
  fmtDateTime, formatAnswer, isImageAnswer, isLayoutField, patientName,
  type DeliveryRecord, type DeliveryRow,
} from './services-shared'

const PAGE = 25

export function ServiceHistoryScreen({ refreshKey }: { refreshKey?: number } = {}) {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [rows, setRows] = useState<DeliveryRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const reqId = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setSearch(cleanSearch(query)), 350)
    return () => clearTimeout(t)
  }, [query])

  const fetchPage = useCallback(async (from: number) => {
    if (!orgId) return { data: [] as DeliveryRow[], count: 0 }
    let patientIds: string[] | null = null
    if (search.length >= 2) {
      const compact = search.replace(/\s/g, '')
      const { data: pts, error: pErr } = await userClient
        .from('ps_patients')
        .select('id')
        .eq('organisation_id', orgId)
        .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,nhs_number.ilike.%${compact}%`)
        .limit(200)
      if (pErr) throw pErr
      patientIds = (pts ?? []).map((p: { id: string }) => p.id)
      if (patientIds.length === 0) return { data: [], count: 0 }
    }
    let q = userClient
      .from('ps_service_deliveries')
      .select(DELIVERY_LIST_SELECT, { count: 'exact' })
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (patientIds) q = q.in('patient_id', patientIds)
    const { data, error: qErr, count } = await q
    if (qErr) throw qErr
    return { data: (data ?? []) as unknown as DeliveryRow[], count: count ?? 0 }
  }, [orgId, search])

  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const { data, count } = await fetchPage(0)
      if (id !== reqId.current) return
      setRows(data)
      setTotal(count)
      setError(null)
    } catch (e) {
      if (id === reqId.current) setError(errorMessage(e, 'Records could not be loaded.'))
    }
    if (id === reqId.current) setLoading(false)
  }, [fetchPage])

  useEffect(() => { void load() }, [load, refreshKey])

  const loadMore = async () => {
    if (loading || loadingMore || rows.length >= total) return
    setLoadingMore(true)
    try {
      const { data } = await fetchPage(rows.length)
      setRows((cur) => [...cur, ...data.filter((d) => !cur.some((c) => c.id === d.id))])
    } catch (e) {
      setError(errorMessage(e, 'More records could not be loaded.'))
    }
    setLoadingMore(false)
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={palette.textMuted} />
        <TextInput
          style={styles.search}
          placeholder="Search by patient name or NHS number"
          placeholderTextColor={palette.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search records by patient"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={rows.length > 0 ? (
          <Text style={styles.count}>{total} record{total === 1 ? '' : 's'}</Text>
        ) : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={COLOR} style={{ marginVertical: 16 }} /> : null}
        ListEmptyComponent={loading ? null : (
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={36} color={COLOR} />
            <Text style={styles.emptyTitle}>{search ? 'No matching records' : 'No services delivered yet'}</Text>
            <Text style={styles.emptyText}>
              {search ? 'Try another name or NHS number.' : 'Records appear here once a service is delivered.'}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => setOpenId(item.id)} accessibilityRole="button"
            accessibilityLabel={`${item.service?.name ?? 'Service'} for ${patientName(item.patient) || 'walk-in patient'}`}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{item.service?.name ?? 'Unknown service'}</Text>
              <Text style={styles.muted}>{patientName(item.patient) || 'Walk-in'}{item.patient?.nhs_number ? ` · ${item.patient.nhs_number}` : ''}</Text>
              <Text style={styles.small}>{fmtDateTime(item.completed_at || item.created_at)}{item.deliverer?.full_name ? ` · ${item.deliverer.full_name}` : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Badge label={item.status === 'completed' ? 'Completed' : 'Draft'} color={item.status === 'completed' ? palette.success : palette.warning} />
              {(item.amendment_count ?? 0) > 0 ? <Badge label="Amended" color={palette.textMuted} /> : null}
            </View>
          </Pressable>
        )}
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}
      />
      <RecordModal deliveryId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </View>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.badge, { color, borderColor: color }]}>{label}</Text>
}

export function RecordModal({ deliveryId, onClose, onChanged }: { deliveryId: string | null; onClose: () => void; onChanged?: () => void }) {
  const organisation = useAuthStore((s) => s.organisation)
  const canAmendRole = useAuthStore((s) => !!s.permissions?.services_amend)
  const [record, setRecord] = useState<DeliveryRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [amending, setAmending] = useState(false)

  const load = useCallback(async () => {
    if (!deliveryId) return
    try {
      setRecord(await fetchDeliveryRecord(deliveryId))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'This record could not be loaded.'))
    }
  }, [deliveryId])

  useEffect(() => {
    setRecord(null)
    setError(null)
    setAmending(false)
    void load()
  }, [load])

  if (!deliveryId) return null

  const canAmend = !!record && record.status === 'completed' && canAmendRole

  const print = async () => {
    if (!record) return
    try {
      await Print.printAsync({ html: recordHtml(record, organisation) })
    } catch (e) {
      Alert.alert('Could not print', errorMessage(e, 'Printing failed.'))
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle} numberOfLines={1}>{record?.service?.name ?? 'Service record'}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}><Ionicons name="close" size={26} color={palette.text} /></Pressable>
        </View>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {!record && !error ? <ActivityIndicator color={COLOR} style={{ marginTop: 40 }} /> : null}
        {record ? <RecordBody record={record} /> : null}
        {record ? (
          <View style={styles.footer}>
            {canAmend ? <Action label="Amend" icon="create-outline" color={COLOR} outline onPress={() => setAmending(true)} /> : null}
            <Action label="Print / PDF" icon="print-outline" color={COLOR} onPress={print} />
          </View>
        ) : null}
      </View>
      {record && amending ? (
        <AmendModal record={record} onClose={() => setAmending(false)}
          onSaved={async () => { setAmending(false); await load(); onChanged?.() }} />
      ) : null}
    </Modal>
  )
}

function RecordBody({ record }: { record: DeliveryRecord }) {
  const answers = record.form_data ?? {}
  const known = new Set(record.fields.map((f) => f.field_key))
  const extra = Object.keys(answers).filter((k) => !known.has(k))
  const amendments = record.events.filter((e) => e.event === 'amended')
  const labels = Object.fromEntries(record.fields.map((f) => [f.field_key, f.label]))

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
      <View style={styles.panel}>
        <Item label="Patient" value={patientName(record.patient) || 'Walk-in / no patient record'} />
        {record.patient?.nhs_number ? <Item label="NHS number" value={record.patient.nhs_number} /> : null}
        {record.patient?.dob ? <Item label="Date of birth" value={fmtDate(record.patient.dob)} /> : null}
        <Item label={record.status === 'completed' ? 'Completed' : 'Started'} value={fmtDateTime(record.completed_at || record.created_at)} />
        <Item label="Delivered by" value={record.deliverer?.full_name
          ? `${record.deliverer.full_name}${record.deliverer.gphc_number ? ` (GPhC ${record.deliverer.gphc_number})` : ''}`
          : 'Former staff member'} />
        <Item label="Status" value={record.status === 'completed'
          ? (record.amendment_count ? `Completed, amended ${record.amendment_count}×` : 'Completed')
          : 'Draft (not finished)'} />
        {record.form_snapshot?.name ? <Item label="Form" value={`${record.form_snapshot.name} (version ${record.form_snapshot.version})`} /> : null}
        <Item label="Reference" value={record.id.slice(0, 8).toUpperCase()} />
      </View>

      <Text style={styles.section}>Consultation</Text>
      <View style={styles.panel}>
        {record.fields.length === 0 && extra.length === 0 ? <Text style={styles.muted}>No form answers recorded.</Text> : null}
        {record.fields.map((f) => {
          if (isLayoutField(f.field_type)) {
            return f.field_type === 'heading' ? <Text key={f.field_key} style={styles.fieldHeading}>{f.label}</Text> : null
          }
          return <Answer key={f.field_key} label={f.label} value={answers[f.field_key]} />
        })}
        {extra.map((k) => <Answer key={k} label={k.replace(/_/g, ' ')} value={answers[k]} />)}
      </View>

      {record.outcomes.length > 0 ? (
        <>
          <Text style={styles.section}>Outcome</Text>
          {record.outcomes.map((o) => (
            <View key={o.id} style={styles.panel}>
              <Text style={styles.name}>{OUTCOME_LABELS[o.outcome_type] ?? o.outcome_type}</Text>
              {o.referral_to ? <Text style={styles.body}>Referred to {o.referral_to}{o.referral_urgency ? ` (${o.referral_urgency})` : ''}{o.referral_reason ? `: ${o.referral_reason}` : ''}</Text> : null}
              {o.advice_given ? <Text style={styles.body}>{o.advice_given}</Text> : null}
              {(o.medications ?? []).map((m) => (
                <View key={m.id} style={styles.med}>
                  <Text style={styles.body}>{[m.drug_name, m.drug_strength, m.drug_form].filter(Boolean).join(' ')}{m.is_controlled_drug ? ' (CD)' : ''}</Text>
                  <Text style={styles.small}>{[m.dose, m.quantity != null ? `${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : null].filter(Boolean).join(' · ') || '–'}</Text>
                </View>
              ))}
            </View>
          ))}
        </>
      ) : null}

      {record.notes ? (
        <>
          <Text style={styles.section}>Notes</Text>
          <View style={styles.panel}><Text style={styles.body}>{record.notes}</Text></View>
        </>
      ) : null}

      {amendments.length > 0 ? (
        <>
          <Text style={styles.section}>Amendments</Text>
          {amendments.map((e) => (
            <View key={e.id} style={[styles.panel, styles.amend]}>
              <Text style={styles.body}><Text style={{ fontWeight: '700' }}>{fmtDateTime(e.created_at)}</Text> by {e.actor_profile?.full_name ?? 'former staff member'}</Text>
              <Text style={styles.body}>Reason: {e.reason}</Text>
              {diff(e.before, e.after, labels).map((c, i) => (
                <Text key={i} style={styles.small}>{c.label}: “{c.from}” → “{c.to}”</Text>
              ))}
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.small}>Completed records can't be edited. Changes are added as amendments with a reason and your name.</Text>
    </ScrollView>
  )
}

function diff(before: DeliveryRecord['events'][number]['before'], after: DeliveryRecord['events'][number]['after'], labels: Record<string, string>) {
  const out: Array<{ label: string; from: string; to: string }> = []
  const b = before?.form_data ?? {}
  const a = after?.form_data ?? {}
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push({ label: labels[k] ?? k, from: formatAnswer(b[k]), to: formatAnswer(a[k]) })
  }
  if ((before?.notes ?? '') !== (after?.notes ?? '')) out.push({ label: 'Notes', from: before?.notes || '–', to: after?.notes || '–' })
  return out
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.item}>
      <Text style={styles.itemLabel}>{label}</Text>
      <Text style={styles.itemValue}>{value}</Text>
    </View>
  )
}

function Answer({ label, value }: { label: string; value: unknown }) {
  return (
    <View style={styles.answer}>
      <Text style={styles.itemLabel}>{label}</Text>
      {isImageAnswer(value)
        ? <Image source={{ uri: value }} style={styles.signature} contentFit="contain" accessibilityLabel={label} />
        : <Text style={styles.itemValue}>{formatAnswer(value)}</Text>}
    </View>
  )
}

function AmendModal({ record, onClose, onSaved }: { record: DeliveryRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const editable = record.fields.filter((f) => SIMPLE_FIELD_TYPES.has(f.field_type))
  const [values, setValues] = useState<Record<string, unknown>>({ ...(record.form_data ?? {}) })
  const [notes, setNotes] = useState(record.notes ?? '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formChanged = JSON.stringify(values) !== JSON.stringify(record.form_data ?? {})
  const notesChanged = notes !== (record.notes ?? '')
  const ready = (formChanged || notesChanged) && reason.trim().length >= 5

  const set = (k: string, v: unknown) => setValues((c) => ({ ...c, [k]: v }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await amendDeliveryRecord({
        deliveryId: record.id,
        reason: reason.trim(),
        formData: formChanged ? values : null,
        notes: notesChanged ? notes : null,
      })
      await onSaved()
    } catch (e) {
      setError(errorMessage(e, 'The amendment could not be saved.'))
    }
    setSaving(false)
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Amend record</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}><Ionicons name="close" size={26} color={palette.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.muted}>The original answers are kept. Your change, the reason and your name are added to the record's amendment history.</Text>
          {editable.map((f) => (
            <SimpleInput key={f.field_key} label={f.label} type={f.field_type} options={fieldOptions(f)}
              value={values[f.field_key]} onChange={(v) => set(f.field_key, v)} />
          ))}
          {record.fields.length > editable.length + record.fields.filter((f) => isLayoutField(f.field_type)).length ? (
            <Text style={styles.small}>Signatures, tables and prescribing answers can't be changed here. Add a note to explain a correction to those.</Text>
          ) : null}
          <Labelled label="Notes">
            <TextInput style={[styles.input, styles.multi]} multiline value={notes} onChangeText={setNotes} />
          </Labelled>
          <Labelled label="Reason for amendment (required)">
            <TextInput style={styles.input} value={reason} onChangeText={setReason}
              placeholder="e.g. Blood pressure entered in error" placeholderTextColor={palette.textMuted} />
          </Labelled>
          {reason.length > 0 && reason.trim().length < 5 ? <Text style={styles.small}>Give a reason of at least 5 characters.</Text> : null}
          {error ? <Text style={styles.errorInline} accessibilityRole="alert">{error}</Text> : null}
          <Action label={saving ? 'Saving…' : 'Save amendment'} color={COLOR} onPress={save} disabled={!ready || saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** One input for a simple field type. Shared with the Deliver screen. */
export function SimpleInput({ label, type, options, value, onChange, required }: {
  label: string
  type: string
  options: string[]
  value: unknown
  onChange: (v: unknown) => void
  required?: boolean
}) {
  const title = required ? `${label} *` : label
  if (type === 'boolean') {
    return (
      <Labelled label={title}>
        <View style={styles.chips}>
          {[['Yes', true], ['No', false]].map(([l, v]) => (
            <Chip key={String(l)} label={l as string} selected={value === v} onPress={() => onChange(value === v ? null : v)} />
          ))}
        </View>
      </Labelled>
    )
  }
  if ((type === 'select' || type === 'multiselect') && options.length > 0) {
    const multi = type === 'multiselect'
    const arr = Array.isArray(value) ? (value as string[]) : []
    return (
      <Labelled label={title}>
        <View style={styles.chips}>
          {options.map((o) => {
            const on = multi ? arr.includes(o) : value === o
            return (
              <Chip key={o} label={o} selected={on} onPress={() => {
                if (multi) onChange(on ? arr.filter((x) => x !== o) : [...arr, o])
                else onChange(on ? '' : o)
              }} />
            )
          })}
        </View>
      </Labelled>
    )
  }
  const str = value === undefined || value === null ? '' : String(value)
  return (
    <Labelled label={title}>
      <TextInput
        style={[styles.input, type === 'textarea' && styles.multi]}
        multiline={type === 'textarea'}
        value={str}
        keyboardType={type === 'number' ? 'decimal-pad' : 'default'}
        placeholder={type === 'date' ? 'YYYY-MM-DD' : undefined}
        placeholderTextColor={palette.textMuted}
        onChangeText={(t) => {
          if (type === 'number') {
            const n = Number(t.replace(',', '.'))
            onChange(t === '' ? '' : Number.isFinite(n) && !t.endsWith('.') ? n : t)
          } else onChange(t)
        }}
        accessibilityLabel={label}
      />
    </Labelled>
  )
}

export function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
      style={[styles.chip, selected && { backgroundColor: COLOR, borderColor: COLOR }]}>
      <Text style={[styles.chipText, selected && { color: palette.textInverse }]}>{label}</Text>
    </Pressable>
  )
}

export function Action({ label, icon, color, outline, onPress, disabled }: {
  label: string; icon?: keyof typeof Ionicons.glyphMap; color: string; outline?: boolean; onPress: () => void; disabled?: boolean
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={[styles.action, outline ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color }, disabled && { opacity: 0.5 }]}>
      {icon ? <Ionicons name={icon} size={18} color={outline ? color : palette.textInverse} /> : null}
      <Text style={[styles.actionText, { color: outline ? color : palette.textInverse }]}>{label}</Text>
    </Pressable>
  )
}

// --- Print ---------------------------------------------------------------

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function recordHtml(r: DeliveryRecord, org: { name: string; address?: { line_1?: string | null; line_2?: string | null; city?: string | null; postcode?: string | null } | null } | null) {
  const answers = r.form_data ?? {}
  const known = new Set(r.fields.map((f) => f.field_key))
  const row = (label: string, v: unknown) => `<tr><td class="l">${esc(label)}</td><td>${isImageAnswer(v) ? `<img src="${esc(v)}" style="max-width:240px;max-height:120px"/>` : esc(formatAnswer(v)).replace(/\n/g, '<br/>')}</td></tr>`
  const answerRows = [
    ...r.fields.map((f) => isLayoutField(f.field_type)
      ? (f.field_type === 'heading' ? `<tr><td colspan="2" class="h">${esc(f.label)}</td></tr>` : '')
      : row(f.label, answers[f.field_key])),
    ...Object.keys(answers).filter((k) => !known.has(k)).map((k) => row(k.replace(/_/g, ' '), answers[k])),
  ].join('')
  const addr = org?.address ? [org.address.line_1, org.address.line_2, org.address.city, org.address.postcode].filter(Boolean).join(', ') : ''
  const outcomes = r.outcomes.map((o) => `
    <p><b>${esc(OUTCOME_LABELS[o.outcome_type] ?? o.outcome_type)}</b>
    ${o.referral_to ? `<br/>Referred to ${esc(o.referral_to)}${o.referral_urgency ? ` (${esc(o.referral_urgency)})` : ''}${o.referral_reason ? `: ${esc(o.referral_reason)}` : ''}` : ''}
    ${o.advice_given ? `<br/>${esc(o.advice_given)}` : ''}</p>
    ${(o.medications ?? []).length ? `<table><tr><th>Medicine</th><th>Dose</th><th>Quantity</th></tr>${(o.medications ?? []).map((m) => `<tr><td>${esc([m.drug_name, m.drug_strength, m.drug_form].filter(Boolean).join(' '))}${m.is_controlled_drug ? ' (CD)' : ''}</td><td>${esc(m.dose || '–')}</td><td>${m.quantity != null ? esc(`${m.quantity}${m.unit ? ` ${m.unit}` : ''}`) : '–'}</td></tr>`).join('')}</table>` : ''}`).join('')
  const labels = Object.fromEntries(r.fields.map((f) => [f.field_key, f.label]))
  const amendments = r.events.filter((e) => e.event === 'amended').map((e) => `
    <div class="am"><b>${esc(fmtDateTime(e.created_at))}</b> by ${esc(e.actor_profile?.full_name ?? 'former staff member')}<br/>Reason: ${esc(e.reason)}
    ${diff(e.before, e.after, labels).map((c) => `<br/>${esc(c.label)}: “${esc(c.from)}” → “${esc(c.to)}”`).join('')}</div>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    body{font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#0F172A;font-size:12px;margin:24px}
    .top{display:flex;justify-content:space-between;border-bottom:2px solid #E2E8F0;padding-bottom:10px;margin-bottom:12px}
    h2{font-size:14px;margin:16px 0 6px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:4px 8px 4px 0;border-bottom:1px solid #E2E8F0;vertical-align:top}
    td.l{width:40%;color:#64748B}td.h{font-weight:700;padding-top:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .k{color:#64748B;font-size:10px}.am{border-left:3px solid #D97706;padding-left:8px;margin-bottom:8px}.foot{margin-top:20px;color:#64748B;font-size:10px}
  </style></head><body>
    <div class="top"><div><b style="font-size:16px">${esc(org?.name ?? '')}</b><br/><span class="k">${esc(addr)}</span></div>
    <div style="text-align:right"><b>Consultation record</b><br/>${esc(r.service?.name ?? 'Service')}<br/><span class="k">Ref ${esc(r.id.slice(0, 8).toUpperCase())}</span></div></div>
    <div class="grid">
      <div><div class="k">Patient</div>${esc(patientName(r.patient) || 'Walk-in / no patient record')}</div>
      ${r.patient?.nhs_number ? `<div><div class="k">NHS number</div>${esc(r.patient.nhs_number)}</div>` : ''}
      ${r.patient?.dob ? `<div><div class="k">Date of birth</div>${esc(fmtDate(r.patient.dob))}</div>` : ''}
      <div><div class="k">${r.status === 'completed' ? 'Completed' : 'Started'}</div>${esc(fmtDateTime(r.completed_at || r.created_at))}</div>
      <div><div class="k">Delivered by</div>${esc(r.deliverer?.full_name ? `${r.deliverer.full_name}${r.deliverer.gphc_number ? ` (GPhC ${r.deliverer.gphc_number})` : ''}` : 'Former staff member')}</div>
      ${r.form_snapshot?.name ? `<div><div class="k">Form</div>${esc(`${r.form_snapshot.name} (version ${r.form_snapshot.version})`)}</div>` : ''}
    </div>
    <h2>Consultation</h2>${answerRows ? `<table>${answerRows}</table>` : '<p>No form answers recorded.</p>'}
    ${outcomes ? `<h2>Outcome</h2>${outcomes}` : ''}
    ${r.notes ? `<h2>Notes</h2><p style="white-space:pre-wrap">${esc(r.notes)}</p>` : ''}
    ${amendments ? `<h2>Amendments</h2>${amendments}` : ''}
    <div class="foot">Printed from PharmStation ${esc(new Date().toLocaleDateString('en-GB'))}. Completed records cannot be edited; changes are recorded as amendments.</div>
  </body></html>`
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, marginBottom: 8, paddingHorizontal: 12, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  search: { flex: 1, paddingVertical: 11, fontSize: 15, color: palette.text },
  count: { fontSize: 12, color: palette.textMuted, marginBottom: 8 },
  error: { color: palette.danger, paddingHorizontal: 16, paddingVertical: 8 },
  errorInline: { color: palette.danger },
  empty: { alignItems: 'center', gap: 8, paddingTop: 60, paddingHorizontal: 24 },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: '600' },
  emptyText: { color: palette.textMuted, fontSize: 14, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, marginBottom: 8 },
  name: { fontSize: 15, fontWeight: '600', color: palette.text },
  muted: { fontSize: 13, color: palette.textMuted },
  small: { fontSize: 12, color: palette.textMuted },
  body: { fontSize: 14, color: palette.text },
  badge: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  sheet: { flex: 1, backgroundColor: palette.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: palette.text, flex: 1 },
  panel: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 10 },
  section: { fontSize: 13, fontWeight: '700', color: palette.textMuted, textTransform: 'uppercase', marginTop: 4 },
  item: { gap: 2 },
  itemLabel: { fontSize: 12, color: palette.textMuted },
  itemValue: { fontSize: 15, color: palette.text },
  answer: { gap: 2, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
  fieldHeading: { fontSize: 15, fontWeight: '700', color: palette.text, marginTop: 4 },
  signature: { width: 240, height: 110, backgroundColor: palette.bg, borderRadius: radius.sm },
  med: { paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
  amend: { borderLeftWidth: 3, borderLeftColor: palette.warning },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  label: { fontSize: 14, fontWeight: '600', color: palette.text },
  input: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: palette.text },
  multi: { minHeight: 90, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipText: { fontSize: 14, color: palette.text, fontWeight: '500' },
  action: { flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', paddingVertical: 13, borderRadius: radius.md, alignItems: 'center' },
  actionText: { fontSize: 15, fontWeight: '700' },
})
