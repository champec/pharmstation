// ============================================
// LogEntrySheet: fill in one pharmacy log entry on the phone. Renders the
// log's fields, fills "checked by" style fields with your name, flags
// readings outside the safe range and saves through ps_log_save_entry.
// ============================================

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import {
  dataFields,
  displayValue,
  fetchFields,
  fieldChoices,
  fieldRange,
  isEmptyValue,
  isOutOfRange,
  isPersonField,
  isWebOnlyField,
  logErrorMessage,
  saveEntry,
  validateEntry,
  type LogField,
} from '@/lib/logs'

interface Props {
  visible: boolean
  title: string
  subtitle?: string
  subscriptionId: string | null
  templateId: string | null
  /** Override labels/placeholders for a field key */
  hints?: Record<string, string>
  submitLabel?: string
  onClose: () => void
  onSaved: () => void
}

export function LogEntrySheet({ visible, title, subtitle, subscriptionId, templateId, hints, submitLabel, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets()
  const fullName = useAuthStore((s) => s.userProfile?.full_name ?? '')
  const [fields, setFields] = useState<LogField[] | null>(null)
  const [data, setData] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible || !templateId) return
    let cancelled = false
    setFields(null)
    setErrors({})
    setError(null)
    fetchFields(templateId)
      .then((fs) => {
        if (cancelled) return
        const list = dataFields(fs)
        setFields(list)
        const init: Record<string, unknown> = {}
        for (const f of list) {
          if (isPersonField(f) && fullName) init[f.field_key] = fullName
          if (f.field_type === 'boolean') init[f.field_key] = false
        }
        setData(init)
      })
      .catch((e) => !cancelled && setError(logErrorMessage(e)))
    return () => { cancelled = true }
  }, [visible, templateId, fullName])

  const set = (key: string, v: unknown) => {
    setData((d) => ({ ...d, [key]: v }))
    setErrors((e) => {
      if (!e[key]) return e
      const { [key]: _, ...rest } = e
      return rest
    })
  }

  const blockedBySignature = useMemo(
    () => (fields ?? []).some((f) => isWebOnlyField(f) && f.is_required),
    [fields],
  )

  const submit = async () => {
    if (!fields || !subscriptionId) return
    const payload: Record<string, unknown> = {}
    for (const f of fields) {
      if (isWebOnlyField(f)) continue
      let v = data[f.field_key]
      if (typeof v === 'string') v = v.trim()
      if (f.field_type === 'number' && !isEmptyValue(v)) {
        const n = Number(String(v).replace(',', '.'))
        v = Number.isNaN(n) ? v : n
      }
      if (!isEmptyValue(v)) payload[f.field_key] = v
    }
    const errs = validateEntry(fields, payload)
    for (const f of fields) {
      if (f.field_type === 'number' && !isEmptyValue(payload[f.field_key]) && typeof payload[f.field_key] !== 'number') {
        errs[f.field_key] = 'Enter a number'
      }
    }
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveEntry(subscriptionId, payload)
      onSaved()
    } catch (e) {
      setError(logErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 12 : 16 }]}>
          <View style={styles.headText}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={palette.textMuted} />
          </Pressable>
        </View>

        {!fields ? (
          <View style={styles.center}>
            {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={palette.brand} />}
          </View>
        ) : (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
            keyboardShouldPersistTaps="handled"
          >
            {blockedBySignature && (
              <View style={styles.note}>
                <Ionicons name="information-circle-outline" size={18} color={palette.brandDark} />
                <Text style={styles.noteText}>This log needs a drawn signature, so fill it in on the website.</Text>
              </View>
            )}
            {fields.map((f) => (
              <FieldInput
                key={f.id}
                field={f}
                label={hints?.[f.field_key] ?? f.label}
                value={data[f.field_key]}
                error={errors[f.field_key]}
                onChange={(v) => set(f.field_key, v)}
              />
            ))}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Button
              label={submitLabel ?? 'Save entry'}
              loading={saving}
              disabled={blockedBySignature || !subscriptionId}
              onPress={submit}
            />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  )
}

function FieldInput({
  field,
  label,
  value,
  error,
  onChange,
}: {
  field: LogField
  label: string
  value: unknown
  error?: string
  onChange: (v: unknown) => void
}) {
  const range = fieldRange(field)
  const out = isOutOfRange(field, typeof value === 'string' ? value.replace(',', '.') : value)
  const required = field.is_required ? ' *' : ''

  let control: ReactNode = null
  switch (field.field_type) {
    case 'textarea':
      control = (
        <TextInput
          style={[styles.input, styles.textarea, error && styles.inputError]}
          multiline
          textAlignVertical="top"
          value={(value as string) ?? ''}
          onChangeText={onChange}
          placeholderTextColor={palette.textMuted}
        />
      )
      break
    case 'number': {
      const step = (delta: number) => {
        const n = Number(String(value ?? '').replace(',', '.'))
        const base = Number.isNaN(n) || isEmptyValue(value) ? (range?.min !== undefined && range?.max !== undefined ? (range.min + range.max) / 2 : 0) : n
        onChange(String(Math.round((base + delta) * 10) / 10))
      }
      control = (
        <View style={styles.row}>
          <Pressable style={styles.stepper} onPress={() => step(-0.1)} accessibilityLabel={`Lower ${label}`}>
            <Ionicons name="remove" size={22} color={palette.brandDark} />
          </Pressable>
          <TextInput
            style={[styles.input, styles.numberInput, out && styles.inputWarn, error && styles.inputError]}
            keyboardType="decimal-pad"
            value={value === undefined || value === null ? '' : String(value)}
            onChangeText={onChange}
            placeholder={range?.unit ?? ''}
            placeholderTextColor={palette.textMuted}
          />
          <Pressable style={styles.stepper} onPress={() => step(0.1)} accessibilityLabel={`Raise ${label}`}>
            <Ionicons name="add" size={22} color={palette.brandDark} />
          </Pressable>
        </View>
      )
      break
    }
    case 'boolean':
      control = (
        <View style={styles.row}>
          {[true, false].map((b) => (
            <Pressable key={String(b)} style={[styles.chip, value === b && styles.chipOn]} onPress={() => onChange(b)}>
              <Text style={[styles.chipText, value === b && styles.chipTextOn]}>{b ? 'Yes' : 'No'}</Text>
            </Pressable>
          ))}
        </View>
      )
      break
    case 'select':
    case 'multiselect': {
      const multi = field.field_type === 'multiselect'
      const chosen: string[] = multi ? ((value as string[]) ?? []) : value ? [String(value)] : []
      control = (
        <View style={styles.chips}>
          {fieldChoices(field).map((c) => {
            const on = chosen.includes(c)
            return (
              <Pressable
                key={c}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => onChange(multi ? (on ? chosen.filter((x) => x !== c) : [...chosen, c]) : on ? '' : c)}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
              </Pressable>
            )
          })}
        </View>
      )
      break
    }
    case 'date':
      control = (
        <View style={styles.row}>
          <View style={[styles.input, styles.dateBox, error && styles.inputError]}>
            <Text style={{ color: isEmptyValue(value) ? palette.textMuted : palette.text, fontSize: 16 }}>
              {isEmptyValue(value) ? 'Not set' : displayValue(field, value)}
            </Text>
          </View>
          <Pressable style={[styles.chip, styles.chipOn]} onPress={() => onChange(new Date().toISOString())}>
            <Text style={[styles.chipText, styles.chipTextOn]}>Now</Text>
          </Pressable>
          {!isEmptyValue(value) && (
            <Pressable style={styles.chip} onPress={() => onChange('')}>
              <Text style={styles.chipText}>Clear</Text>
            </Pressable>
          )}
        </View>
      )
      break
    case 'canvas':
    case 'signature':
      control = <Text style={styles.muted}>Signatures are added on the website.</Text>
      break
    default:
      control = (
        <TextInput
          style={[styles.input, error && styles.inputError]}
          value={(value as string) ?? ''}
          onChangeText={onChange}
          placeholderTextColor={palette.textMuted}
        />
      )
  }

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required}
        </Text>
        {range ? (
          <Text style={[styles.pill, out && styles.pillWarn]}>
            {out ? 'Out of range' : `Safe ${range.min ?? '…'}–${range.max ?? '…'}${range.unit ? ` ${range.unit}` : ''}`}
          </Text>
        ) : null}
      </View>
      {control}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.bg },
  headText: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  title: { fontSize: 20, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 14, color: palette.textMuted, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  body: { padding: 20, gap: 18 },
  field: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: palette.text },
  pill: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.success,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  pillWarn: { color: palette.danger, backgroundColor: palette.dangerTint },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: palette.text,
    backgroundColor: palette.surface,
  },
  textarea: { minHeight: 110, paddingTop: 12 },
  numberInput: { flex: 1, minWidth: 0, width: 0, textAlign: 'center', fontSize: 22, fontWeight: '700' },
  inputWarn: { borderColor: palette.warning, backgroundColor: '#FFFBEB' },
  inputError: { borderColor: palette.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: palette.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minWidth: 52,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { fontSize: 15, fontWeight: '700', color: palette.text },
  chipTextOn: { color: palette.textInverse },
  dateBox: { flex: 1, justifyContent: 'center' },
  muted: { fontSize: 14, color: palette.textMuted },
  note: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: palette.brandTint,
  },
  noteText: { flex: 1, fontSize: 14, color: palette.brandDark, lineHeight: 20 },
  errorText: { color: palette.danger, fontSize: 13, lineHeight: 18 },
})
