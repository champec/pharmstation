// Services → History tab with "Deliver a service": pick a service, find or
// add the patient (or walk-in), fill the consultation form, record the
// outcome and medicines, then save. The save goes through
// ps_complete_service_delivery in one transaction, with a client reference
// so a retry after a dropped connection never saves the record twice.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import { Action, Chip, Labelled, RecordModal, ServiceHistoryScreen, SimpleInput } from './service-history'
import {
  OUTCOME_LABELS, SERVICES_COLOR as COLOR, cleanSearch, errorMessage, fieldOptions, fmtDate,
  isLayoutField, type FieldType, type FormField, type OutcomeType,
} from './services-shared'

// NHS services stay "coming soon" until NHS approval, as on the website.
const NHS_SERVICES_ENABLED = process.env.EXPO_PUBLIC_NHS_SERVICES_ENABLED === 'true'

// Fields the phone can't fill yet. A form that needs one is done on the website.
const WEB_ONLY_FIELDS = new Set<FieldType>(['prescribing', 'canvas'])

type ServiceRow = { id: string; name: string; description: string | null; is_nhs_service: boolean; library_service_id: string | null }
type FormRow = { id: string; name: string; is_default: boolean }
type Patient = { id: string; first_name: string; last_name: string; nhs_number: string | null; dob: string | null; phone: string | null }
type Med = { drug_name: string; drug_strength: string; dose: string; quantity: string; unit: string; is_controlled_drug: boolean }
type Step = 'service' | 'patient' | 'form' | 'outcome'

/** Hermes has no crypto.randomUUID. */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function hasValue(v: unknown) {
  if (v === undefined || v === null || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  return true
}

export function ServicesHistoryTab() {
  const [delivering, setDelivering] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [savedId, setSavedId] = useState<string | null>(null)
  return (
    <View style={{ flex: 1 }}>
      <ServiceHistoryScreen refreshKey={refreshKey} />
      <Pressable style={styles.fab} onPress={() => setDelivering(true)} accessibilityRole="button" accessibilityLabel="Deliver a service">
        <Ionicons name="add" size={22} color={palette.textInverse} />
        <Text style={styles.fabText}>Deliver a service</Text>
      </Pressable>
      {delivering ? (
        <DeliverModal
          onClose={() => setDelivering(false)}
          onSaved={(id) => { setDelivering(false); setRefreshKey((k) => k + 1); setSavedId(id) }}
        />
      ) : null}
      <RecordModal deliveryId={savedId} onClose={() => setSavedId(null)} />
    </View>
  )
}

function DeliverModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [step, setStep] = useState<Step>('service')
  const [service, setService] = useState<ServiceRow | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [walkIn, setWalkIn] = useState(false)
  const [form, setForm] = useState<FormRow | null>(null)
  const [fields, setFields] = useState<FormField[]>([])
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [notes, setNotes] = useState('')
  const [outcome, setOutcome] = useState<OutcomeType>('advice')
  const [referralTo, setReferralTo] = useState('')
  const [referralReason, setReferralReason] = useState('')
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'emergency'>('routine')
  const [advice, setAdvice] = useState('')
  const [meds, setMeds] = useState<Med[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clientRef = useRef(uuid())

  const dirty = !!service && (step !== 'service')

  const close = () => {
    if (!dirty || saving) return onClose()
    Alert.alert('Leave without saving?', 'This consultation has not been saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: onClose },
    ])
  }

  const pickService = async (s: ServiceRow) => {
    setError(null)
    setService(s)
    // Custom forms belong to the org service; canonical ones to its library template.
    const owner = s.library_service_id
      ? `org_service_id.eq.${s.id},service_id.eq.${s.library_service_id}`
      : `org_service_id.eq.${s.id}`
    const { data, error: fErr } = await userClient
      .from('ps_service_forms')
      .select('id, name, is_default')
      .or(owner)
      .is('archived_at', null)
      .order('created_at')
    if (fErr) return setError(fErr.message)
    const forms = (data ?? []) as FormRow[]
    const chosen = forms.find((f) => f.is_default) ?? forms[0] ?? null
    setForm(chosen)
    if (chosen) {
      const { data: fd, error: fdErr } = await userClient
        .from('ps_service_form_fields')
        .select('field_key, label, field_type, options, is_required')
        .eq('form_id', chosen.id)
        .order('display_order')
      if (fdErr) return setError(fdErr.message)
      setFields((fd ?? []) as FormField[])
    } else setFields([])
    setAnswers({})
    setStep('patient')
  }

  const webOnly = fields.filter((f) => WEB_ONLY_FIELDS.has(f.field_type))
  const missing = fields.filter((f) => f.is_required && !isLayoutField(f.field_type) && !hasValue(answers[f.field_key]))

  const goToOutcome = () => {
    // Start from what the form says, as the website does.
    const o = answers.OUTCOME
    if (o === 'MEDICINE_SUPPLIED' || answers.MEDICINE_SUPPLIED === true) setOutcome('prescription')
    else if (o === 'REFERRAL_TO_GP' || o === 'REFERRAL_TO_ED') {
      setOutcome('referral')
      if (!referralTo) setReferralTo(o === 'REFERRAL_TO_GP' ? 'GP' : 'Emergency department')
    }
    setStep('outcome')
  }

  const save = async () => {
    if (!orgId || !service) return
    setSaving(true)
    setError(null)
    try {
      const medications = outcome === 'prescription'
        ? meds.filter((m) => m.drug_name.trim()).map((m, i) => ({
          drug_id: null,
          drug_name: m.drug_name.trim(),
          drug_form: null,
          drug_strength: m.drug_strength.trim() || null,
          dose: m.dose.trim() || null,
          quantity: m.quantity.trim() === '' ? null : Number(m.quantity),
          unit: m.unit.trim() || null,
          is_controlled_drug: m.is_controlled_drug,
          sort_order: i,
        }))
        : []
      const { data, error: rErr } = await userClient.rpc('ps_complete_service_delivery', {
        p_org_id: orgId,
        p_service_id: service.id,
        p_client_ref: clientRef.current,
        p_patient_id: patient?.id ?? null,
        p_form_id: form?.id ?? null,
        p_form_data: answers,
        p_notes: notes,
        p_outcome: {
          outcome_type: outcome,
          referral_to: outcome === 'referral' ? referralTo.trim() || null : null,
          referral_reason: outcome === 'referral' ? referralReason.trim() || null : null,
          referral_urgency: outcome === 'referral' ? urgency : null,
          advice_given: advice.trim() || null,
        },
        p_medications: medications,
        p_draft_id: null,
      })
      if (rErr) throw rErr
      onSaved((data as { id: string }).id)
    } catch (e) {
      setError(errorMessage(e, 'The record could not be saved. Check your connection and try again.'))
    }
    setSaving(false)
  }

  const back = () => {
    setError(null)
    if (step === 'patient') setStep('service')
    else if (step === 'form') setStep('patient')
    else if (step === 'outcome') setStep('form')
  }

  const STEPS: Step[] = ['service', 'patient', 'form', 'outcome']
  const titles: Record<Step, string> = { service: 'Choose a service', patient: 'Patient', form: 'Consultation', outcome: 'Outcome' }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          {step !== 'service' ? (
            <Pressable onPress={back} accessibilityLabel="Back" hitSlop={8} disabled={saving}><Ionicons name="chevron-back" size={26} color={palette.text} /></Pressable>
          ) : <View style={{ width: 26 }} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{titles[step]}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              Step {STEPS.indexOf(step) + 1} of 4{service && step !== 'service' ? ` · ${service.name}` : ''}
            </Text>
          </View>
          <Pressable onPress={close} accessibilityLabel="Close" hitSlop={8}><Ionicons name="close" size={26} color={palette.text} /></Pressable>
        </View>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

        {step === 'service' ? <ServicePicker orgId={orgId} onPick={pickService} /> : null}

        {step === 'patient' ? (
          <PatientStep orgId={orgId} selected={patient} walkIn={walkIn}
            onSelect={(p) => { setPatient(p); setWalkIn(false); setStep('form') }}
            onWalkIn={() => { setPatient(null); setWalkIn(true); setStep('form') }} />
        ) : null}

        {step === 'form' ? (
          <>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.patientBar}>
                <Ionicons name="person-circle-outline" size={22} color={COLOR} />
                <Text style={styles.name}>{patient ? `${patient.first_name} ${patient.last_name}` : 'Walk-in, no patient record'}</Text>
              </View>
              {webOnly.length > 0 ? (
                <View style={styles.warn}>
                  <Text style={styles.warnText}>
                    This form has a {webOnly.map((f) => f.field_type === 'prescribing' ? 'prescribing' : 'drawing').join(' and ')} section that needs the website.
                    {webOnly.some((f) => f.is_required) ? ' Please deliver this service on the website.' : ' You can leave it out here.'}
                  </Text>
                </View>
              ) : null}
              {!form ? <Text style={styles.muted}>This service has no consultation form. Add notes and the outcome on the next step.</Text> : null}
              {fields.map((f) => (
                <FieldInput key={f.field_key} field={f} value={answers[f.field_key]}
                  onChange={(v) => setAnswers((a) => ({ ...a, [f.field_key]: v }))} />
              ))}
              <Labelled label="Notes">
                <TextInput style={[styles.input, styles.multi]} multiline value={notes} onChangeText={setNotes} accessibilityLabel="Notes" />
              </Labelled>
            </ScrollView>
            <View style={styles.footer}>
              {missing.length > 0 ? <Text style={styles.small}>Still needed: {missing.slice(0, 3).map((f) => f.label).join(', ')}{missing.length > 3 ? ` and ${missing.length - 3} more` : ''}</Text> : null}
              <Action label="Next: outcome" color={COLOR} onPress={goToOutcome}
                disabled={missing.length > 0 || webOnly.some((f) => f.is_required)} />
            </View>
          </>
        ) : null}

        {step === 'outcome' ? (
          <>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Labelled label="What was the outcome?">
                <View style={styles.chips}>
                  {(Object.keys(OUTCOME_LABELS) as OutcomeType[]).map((o) => (
                    <Chip key={o} label={OUTCOME_LABELS[o]} selected={outcome === o} onPress={() => setOutcome(o)} />
                  ))}
                </View>
              </Labelled>
              {outcome === 'referral' ? (
                <>
                  <Labelled label="Referred to">
                    <TextInput style={styles.input} value={referralTo} onChangeText={setReferralTo} placeholder="e.g. GP, A&E, optician" placeholderTextColor={palette.textMuted} />
                  </Labelled>
                  <Labelled label="Urgency">
                    <View style={styles.chips}>
                      {(['routine', 'urgent', 'emergency'] as const).map((u) => (
                        <Chip key={u} label={u[0].toUpperCase() + u.slice(1)} selected={urgency === u} onPress={() => setUrgency(u)} />
                      ))}
                    </View>
                  </Labelled>
                  <Labelled label="Reason">
                    <TextInput style={[styles.input, styles.multi]} multiline value={referralReason} onChangeText={setReferralReason} />
                  </Labelled>
                </>
              ) : null}
              {outcome === 'prescription' ? (
                <MedsEditor meds={meds} onChange={setMeds} />
              ) : null}
              <Labelled label="Advice given">
                <TextInput style={[styles.input, styles.multi]} multiline value={advice} onChangeText={setAdvice} accessibilityLabel="Advice given" />
              </Labelled>
            </ScrollView>
            <View style={styles.footer}>
              {outcome === 'referral' && !referralTo.trim() ? <Text style={styles.small}>Say who the patient was referred to.</Text> : null}
              <Action label={saving ? 'Saving…' : 'Complete and save'} color={COLOR} onPress={save}
                disabled={saving || (outcome === 'referral' && !referralTo.trim())} />
              <Text style={styles.small}>Once saved, the record can't be edited, only amended with a reason.</Text>
            </View>
          </>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  )
}

function ServicePicker({ orgId, onPick }: { orgId?: string; onPick: (s: ServiceRow) => Promise<void> }) {
  const [items, setItems] = useState<ServiceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    userClient
      .from('ps_services')
      .select('id, name, description, is_nhs_service, library_service_id')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .is('archived_at', null)
      .order('name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setItems((data ?? []) as ServiceRow[])
      })
  }, [orgId])

  if (error) return <Text style={styles.error}>{error}</Text>
  if (!items) return <ActivityIndicator color={COLOR} style={{ marginTop: 40 }} />
  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="medkit-outline" size={36} color={COLOR} />
        <Text style={styles.name}>No services set up yet</Text>
        <Text style={styles.muted}>A manager or pharmacist adds services from the Service Library on the website.</Text>
      </View>
    )
  }
  return (
    <ScrollView contentContainerStyle={styles.body}>
      {items.map((s) => {
        const locked = s.is_nhs_service && !NHS_SERVICES_ENABLED
        return (
          <Pressable key={s.id} style={[styles.card, locked && { opacity: 0.55 }]} disabled={locked || !!busy}
            accessibilityRole="button" accessibilityState={{ disabled: locked }}
            onPress={async () => { setBusy(s.id); await onPick(s); setBusy(null) }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{s.name}</Text>
              {s.description ? <Text style={styles.muted} numberOfLines={2}>{s.description}</Text> : null}
              {locked ? <Text style={styles.small}>NHS service, coming soon</Text> : null}
            </View>
            {busy === s.id ? <ActivityIndicator color={COLOR} /> : <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />}
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

function PatientStep({ orgId, selected, walkIn, onSelect, onWalkIn }: {
  orgId?: string; selected: Patient | null; walkIn: boolean; onSelect: (p: Patient) => void; onWalkIn: () => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Patient[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [dob, setDob] = useState('')
  const [nhs, setNhs] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const term = cleanSearch(q)
    if (!orgId || term.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const compact = term.replace(/\s/g, '')
      const { data, error: e } = await userClient
        .from('ps_patients')
        .select('id, first_name, last_name, nhs_number, dob, phone')
        .eq('organisation_id', orgId)
        .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,nhs_number.ilike.%${compact}%,phone.ilike.%${compact}%`)
        .order('last_name')
        .limit(25)
      if (e) setError(e.message)
      else setResults((data ?? []) as Patient[])
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [q, orgId])

  const dobOk = dob === '' || /^\d{4}-\d{2}-\d{2}$/.test(dob)
  const nhsDigits = nhs.replace(/\s/g, '')
  const nhsOk = nhsDigits === '' || /^\d{10}$/.test(nhsDigits)

  const addPatient = async () => {
    if (!orgId) return
    setBusy(true)
    setError(null)
    try {
      if (nhsDigits) {
        const { data: existing, error: fErr } = await userClient
          .from('ps_patients')
          .select('id, first_name, last_name, nhs_number, dob, phone')
          .eq('organisation_id', orgId)
          .eq('nhs_number', nhsDigits)
          .limit(1)
          .maybeSingle()
        if (fErr) throw fErr
        if (existing) {
          setBusy(false)
          return onSelect(existing as Patient)
        }
      }
      const { data, error: iErr } = await userClient
        .from('ps_patients')
        .insert({
          organisation_id: orgId,
          first_name: first.trim(),
          last_name: last.trim(),
          dob: dob || null,
          nhs_number: nhsDigits || null,
          phone: phone.trim() || null,
        })
        .select('id, first_name, last_name, nhs_number, dob, phone')
        .single()
      if (iErr) throw iErr
      onSelect(data as Patient)
    } catch (e) {
      setError(errorMessage(e, 'The patient could not be added.'))
    }
    setBusy(false)
  }

  if (adding) {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Labelled label="First name *"><TextInput style={styles.input} value={first} onChangeText={setFirst} autoCapitalize="words" /></Labelled>
        <Labelled label="Last name *"><TextInput style={styles.input} value={last} onChangeText={setLast} autoCapitalize="words" /></Labelled>
        <Labelled label="Date of birth (YYYY-MM-DD)">
          <TextInput style={styles.input} value={dob} onChangeText={setDob} placeholder="1980-04-23" placeholderTextColor={palette.textMuted} keyboardType="numbers-and-punctuation" />
        </Labelled>
        {!dobOk ? <Text style={styles.small}>Use the format YYYY-MM-DD.</Text> : null}
        <Labelled label="NHS number"><TextInput style={styles.input} value={nhs} onChangeText={setNhs} keyboardType="number-pad" /></Labelled>
        {!nhsOk ? <Text style={styles.small}>An NHS number has 10 digits.</Text> : null}
        <Labelled label="Mobile number"><TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" /></Labelled>
        {error ? <Text style={styles.errorInline}>{error}</Text> : null}
        <Action label={busy ? 'Adding…' : 'Add patient and continue'} color={COLOR} onPress={addPatient}
          disabled={busy || !first.trim() || !last.trim() || !dobOk || !nhsOk} />
        <Action label="Back to search" color={palette.textMuted} outline onPress={() => setAdding(false)} disabled={busy} />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={palette.textMuted} />
        <TextInput style={styles.search} value={q} onChangeText={setQ} autoFocus autoCorrect={false}
          placeholder="Name, NHS number or phone" placeholderTextColor={palette.textMuted} accessibilityLabel="Find patient" />
        {searching ? <ActivityIndicator color={COLOR} /> : null}
      </View>
      {error ? <Text style={styles.errorInline}>{error}</Text> : null}
      {selected ? (
        <Pressable style={[styles.card, { borderColor: COLOR }]} onPress={() => onSelect(selected)} accessibilityRole="button">
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{selected.first_name} {selected.last_name}</Text>
            <Text style={styles.small}>Selected · tap to continue</Text>
          </View>
          <Ionicons name="checkmark-circle" size={22} color={COLOR} />
        </Pressable>
      ) : null}
      {results.map((p) => (
        <Pressable key={p.id} style={styles.card} onPress={() => onSelect(p)} accessibilityRole="button">
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name}>{p.first_name} {p.last_name}</Text>
            <Text style={styles.small}>{[p.dob ? `Born ${fmtDate(p.dob)}` : null, p.nhs_number ? `NHS ${p.nhs_number}` : null, p.phone].filter(Boolean).join(' · ') || 'No other details'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
        </Pressable>
      ))}
      {cleanSearch(q).length >= 2 && !searching && results.length === 0 ? <Text style={styles.muted}>No patients found.</Text> : null}
      <Action label="Add a new patient" icon="person-add-outline" color={COLOR} outline onPress={() => {
        const parts = cleanSearch(q).split(/\s+/)
        if (/^\d{10}$/.test(q.replace(/\s/g, ''))) setNhs(q.replace(/\s/g, ''))
        else if (parts[0] && !first) { setFirst(parts[0]); setLast(parts.slice(1).join(' ')) }
        setAdding(true)
      }} />
      <Pressable onPress={onWalkIn} style={styles.link} accessibilityRole="button">
        <Text style={[styles.linkText, walkIn && { fontWeight: '700' }]}>Continue without a patient record (walk-in)</Text>
      </Pressable>
    </ScrollView>
  )
}

function FieldInput({ field, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  const t = field.field_type
  if (t === 'heading') return <Text style={styles.heading}>{field.label}</Text>
  if (t === 'info') {
    return (
      <View style={styles.info}>
        <Ionicons name="information-circle-outline" size={18} color={palette.brand} />
        <Text style={[styles.body14, { flex: 1 }]}>{field.label}</Text>
      </View>
    )
  }
  if (WEB_ONLY_FIELDS.has(t)) return null
  if (t === 'signature') return <SignatureField label={field.label} required={field.is_required} value={value} onChange={onChange} />
  if (t === 'table') return <TableField field={field} value={value} onChange={onChange} />
  return <SimpleInput label={field.label} type={t} options={fieldOptions(field)} value={value} onChange={onChange} required={field.is_required} />
}

function SignatureField({ label, required, value, onChange }: { label: string; required: boolean; value: unknown; onChange: (v: unknown) => void }) {
  const [paths, setPaths] = useState<string[]>([])
  const active = useRef('')
  const done = typeof value === 'string' && value.length > 0

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const { locationX, locationY } = e.nativeEvent
      active.current = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`
      setPaths((c) => [...c, active.current])
    },
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent
      active.current += ` L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`
      setPaths((c) => [...c.slice(0, -1), active.current])
    },
  }), [])

  const accept = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 160" width="340" height="160">${paths
      .map((d) => `<path d="${d}" fill="none" stroke="#0F172A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('')}</svg>`
    onChange(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)
  }

  return (
    <Labelled label={required ? `${label} *` : label}>
      {done ? (
        <View style={styles.signed}>
          <Ionicons name="checkmark-circle" size={20} color={palette.success} />
          <Text style={[styles.body14, { flex: 1 }]}>Signed</Text>
          <Pressable onPress={() => { onChange(null); setPaths([]) }} accessibilityRole="button"><Text style={styles.linkText}>Sign again</Text></Pressable>
        </View>
      ) : (
        <>
          <View style={styles.pad} {...responder.panHandlers}>
            <Svg width="100%" height="100%" viewBox="0 0 340 160">
              {paths.map((d, i) => <Path key={`${i}-${d.length}`} d={d} fill="none" stroke={palette.text} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />)}
            </Svg>
            {paths.length === 0 ? <Text style={styles.padHint} pointerEvents="none">Sign here</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Action label="Clear" color={palette.textMuted} outline onPress={() => setPaths([])} disabled={paths.length === 0} />
            <Action label="Use signature" color={COLOR} onPress={accept} disabled={paths.length === 0} />
          </View>
        </>
      )}
    </Labelled>
  )
}

type Column = { key: string; label: string; type?: string; values?: string[] }

function TableField({ field, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  const cfg = field.options && !Array.isArray(field.options) ? (field.options as Record<string, unknown>) : {}
  const columns = (Array.isArray(cfg.columns) ? cfg.columns : []) as Column[]
  const minRows = typeof cfg.minRows === 'number' ? Math.max(0, cfg.minRows) : 1
  const blank = () => Object.fromEntries(columns.map((c) => [c.key, '']))
  const rows = Array.isArray(value) && value.length > 0
    ? (value as Array<Record<string, unknown>>)
    : Array.from({ length: minRows }, blank)

  const setCell = (ri: number, c: Column, v: unknown) => {
    const next = rows.map((r) => ({ ...r }))
    next[ri][c.key] = v
    onChange(next)
  }

  if (columns.length === 0) return null
  return (
    <Labelled label={field.is_required ? `${field.label} *` : field.label}>
      {rows.map((r, ri) => (
        <View key={ri} style={styles.tableRow}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.small}>Row {ri + 1}</Text>
            {rows.length > 1 ? (
              <Pressable onPress={() => onChange(rows.filter((_, i) => i !== ri))} accessibilityLabel={`Remove row ${ri + 1}`} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={palette.danger} />
              </Pressable>
            ) : null}
          </View>
          {columns.map((c) => (
            <SimpleInput key={c.key} label={c.label} type={c.type === 'select' ? 'select' : c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
              options={c.values ?? []} value={r[c.key]} onChange={(v) => setCell(ri, c, v)} />
          ))}
        </View>
      ))}
      <Action label="Add row" icon="add" color={COLOR} outline onPress={() => onChange([...rows, blank()])} />
    </Labelled>
  )
}

function MedsEditor({ meds, onChange }: { meds: Med[]; onChange: (m: Med[]) => void }) {
  const set = (i: number, patch: Partial<Med>) => onChange(meds.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const add = () => onChange([...meds, { drug_name: '', drug_strength: '', dose: '', quantity: '', unit: '', is_controlled_drug: false }])
  useEffect(() => { if (meds.length === 0) add() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Labelled label="Medicines supplied">
      {meds.map((m, i) => (
        <View key={i} style={styles.tableRow}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.small}>Medicine {i + 1}</Text>
            {meds.length > 1 ? (
              <Pressable onPress={() => onChange(meds.filter((_, j) => j !== i))} accessibilityLabel={`Remove medicine ${i + 1}`} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={palette.danger} />
              </Pressable>
            ) : null}
          </View>
          <TextInput style={styles.input} placeholder="Medicine name" placeholderTextColor={palette.textMuted} value={m.drug_name} onChangeText={(v) => set(i, { drug_name: v })} />
          <TextInput style={styles.input} placeholder="Strength, e.g. 500mg" placeholderTextColor={palette.textMuted} value={m.drug_strength} onChangeText={(v) => set(i, { drug_strength: v })} />
          <TextInput style={styles.input} placeholder="Dose, e.g. one three times a day" placeholderTextColor={palette.textMuted} value={m.dose} onChangeText={(v) => set(i, { dose: v })} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Quantity" placeholderTextColor={palette.textMuted} keyboardType="decimal-pad"
              value={m.quantity} onChangeText={(v) => set(i, { quantity: v.replace(/[^0-9.]/g, '') })} />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Unit, e.g. tablets" placeholderTextColor={palette.textMuted} value={m.unit} onChangeText={(v) => set(i, { unit: v })} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.body14}>Controlled drug</Text>
            <Switch value={m.is_controlled_drug} onValueChange={(v) => set(i, { is_controlled_drug: v })} />
          </View>
        </View>
      ))}
      <Action label="Add another medicine" icon="add" color={COLOR} outline onPress={add} />
    </Labelled>
  )
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 16, bottom: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLOR, paddingHorizontal: 18, paddingVertical: 13, borderRadius: radius.pill, elevation: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  fabText: { color: palette.textInverse, fontWeight: '700', fontSize: 15 },
  sheet: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  title: { fontSize: 18, fontWeight: '700', color: palette.text },
  sub: { fontSize: 12, color: palette.textMuted },
  body: { padding: 16, gap: 14, paddingBottom: 40 },
  footer: { padding: 16, gap: 8, borderTopWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  error: { color: palette.danger, paddingHorizontal: 16, paddingTop: 10 },
  errorInline: { color: palette.danger },
  empty: { alignItems: 'center', gap: 8, paddingTop: 60, paddingHorizontal: 24 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  name: { fontSize: 15, fontWeight: '600', color: palette.text },
  muted: { fontSize: 13, color: palette.textMuted, textAlign: 'center' },
  small: { fontSize: 12, color: palette.textMuted },
  body14: { fontSize: 14, color: palette.text },
  heading: { fontSize: 16, fontWeight: '700', color: palette.text, marginTop: 6 },
  info: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: palette.brandTint, borderRadius: radius.md },
  warn: { padding: 12, backgroundColor: '#FEF3C7', borderRadius: radius.md },
  warnText: { fontSize: 13, color: '#92400E' },
  patientBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  input: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: palette.text },
  multi: { minHeight: 90, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  search: { flex: 1, paddingVertical: 11, fontSize: 15, color: palette.text },
  link: { alignItems: 'center', paddingVertical: 10 },
  linkText: { color: palette.brand, fontSize: 14, fontWeight: '600' },
  pad: { height: 160, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, overflow: 'hidden' },
  padHint: { position: 'absolute', bottom: 10, left: 12, color: palette.textMuted, fontSize: 12 },
  signed: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  tableRow: { gap: 8, padding: 12, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
})
