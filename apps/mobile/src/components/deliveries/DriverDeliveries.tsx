import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'

import { SignaturePad, type SignaturePadRef } from './SignaturePad'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/auth-store'
import { useDeliveryStore } from '@/stores/delivery-store'
import {
  isResolvedStop,
  stopAddress,
  type DeliveryMethod,
  type DeliveryRound,
  type DeliveryStop,
  type DeliveryStopStatus,
} from '@/types/deliveries'
import { palette, radius } from '@/theme/palette'

const deliveryGreen = '#059669'
const deliveryGreenTint = '#DDF7EC'
const amberTint = '#FEF3C7'
const DELIVERY_METHODS: Array<{
  value: DeliveryMethod
  label: string
  icon: keyof typeof Ionicons.glyphMap
}> = [
  { value: 'handed_to_patient', label: 'Patient', icon: 'person-outline' },
  { value: 'handed_to_representative', label: 'Representative', icon: 'people-outline' },
  { value: 'left_in_safe_place', label: 'Safe place', icon: 'home-outline' },
]

export function DriverRouteScreen() {
  const organisation = useAuthStore((state) => state.organisation)
  const membership = useAuthStore((state) => state.membership)
  const {
    assignedRounds,
    openRounds,
    activeRound,
    loading,
    saving,
    tracking,
    error,
    fetchDashboard,
    fetchRound,
    claimRound,
    startRound,
    updateStopStatus,
    completeDelivery,
    startTracking,
    stopTracking,
    subscribeToRound,
    unsubscribeFromRound,
    clearError,
  } = useDeliveryStore()
  const [selectedStop, setSelectedStop] = useState<DeliveryStop | null>(null)
  const [completionOpen, setCompletionOpen] = useState(false)
  const [failureOpen, setFailureOpen] = useState(false)
  const [failureReason, setFailureReason] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('handed_to_patient')
  const [recipientName, setRecipientName] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState<ImagePicker.ImagePickerAsset[]>([])
  const signatureRef = useRef<SignaturePadRef>(null)

  const refresh = () => {
    if (organisation?.id && membership?.id) {
      void fetchDashboard(organisation.id, membership.id)
    }
  }

  useEffect(refresh, [organisation?.id, membership?.id, fetchDashboard])

  useEffect(() => {
    if (!activeRound) return
    subscribeToRound(activeRound.id)
    return unsubscribeFromRound
  }, [activeRound?.id, subscribeToRound, unsubscribeFromRound])

  useEffect(() => {
    if (
      activeRound?.status === 'in_progress' &&
      membership?.id &&
      !tracking
    ) {
      void startTracking(activeRound.id, membership.id)
    }
  }, [activeRound?.id, activeRound?.status, membership?.id])

  const pendingStops = useMemo(
    () => activeRound?.patients.filter((stop) => !isResolvedStop(stop.status)) ?? [],
    [activeRound],
  )
  const nextStop = pendingStops[0]

  const selectRound = async (round: DeliveryRound) => {
    await fetchRound(round.id)
  }

  const confirmClaim = (round: DeliveryRound) => {
    if (!membership?.id) return
    Alert.alert(
      'Claim this delivery?',
      `${round.title || 'Delivery round'} will be assigned to you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Claim job',
          onPress: () => void claimRound(round.id, membership.id),
        },
      ],
    )
  }

  const confirmStart = () => {
    if (!activeRound) return
    Alert.alert(
      'Start this round?',
      'The pharmacy will see that deliveries are now in progress.',
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Start', onPress: () => void startRound(activeRound.id) },
      ],
    )
  }

  const openCompletion = (stop: DeliveryStop) => {
    setSelectedStop(stop)
    setDeliveryMethod('handed_to_patient')
    setRecipientName('')
    setEvidenceFiles([])
    setCompletionOpen(true)
    requestAnimationFrame(() => signatureRef.current?.clear())
  }

  const saveDelivery = async () => {
    if (!selectedStop) return
    await completeDelivery(selectedStop.id, {
      signatureData: signatureRef.current?.getData() ?? undefined,
      deliveryMethod,
      recipientName,
      evidenceFiles,
    })
    setCompletionOpen(false)
    setSelectedStop(null)
  }

  const addEvidence = async (source: 'camera' | 'library') => {
    if (evidenceFiles.length >= 3) return
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission required', `Allow ${source === 'camera' ? 'camera' : 'photo library'} access to attach delivery evidence.`)
      return
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75, allowsMultipleSelection: true, selectionLimit: 3 - evidenceFiles.length })
    if (!result.canceled) {
      setEvidenceFiles((current) => [...current, ...result.assets].slice(0, 3))
    }
  }

  const openFailure = (stop: DeliveryStop) => {
    setSelectedStop(stop)
    setFailureReason('')
    setFailureOpen(true)
  }

  const saveFailure = async () => {
    if (!selectedStop || !failureReason.trim()) return
    await updateStopStatus(selectedStop.id, 'failed', failureReason.trim())
    setFailureOpen(false)
    setSelectedStop(null)
  }

  if (activeRound) {
    const resolvedCount = activeRound.patients.filter((stop) =>
      isResolvedStop(stop.status),
    ).length
    const progress = activeRound.patients.length
      ? resolvedCount / activeRound.patients.length
      : 0

    return (
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            style={styles.backLink}
            onPress={() => useDeliveryStore.setState({ activeRound: null })}
          >
            <Ionicons name="chevron-back" size={18} color={deliveryGreen} />
            <Text style={styles.backText}>All rounds</Text>
          </Pressable>

          <View style={styles.routeHero}>
            <View style={styles.heroTop}>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>{formatRoundDate(activeRound)}</Text>
                <Text style={styles.routeTitle} numberOfLines={2}>
                  {activeRound.title || 'Delivery round'}
                </Text>
              </View>
              <StatusPill status={activeRound.status} />
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <View style={styles.progressMeta}>
              <Text style={styles.progressText}>
                {resolvedCount} of {activeRound.patients.length} stops resolved
              </Text>
              {tracking ? (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>Location live</Text>
                </View>
              ) : null}
            </View>
          </View>

          {error ? <ErrorNotice message={error} onDismiss={clearError} /> : null}

          {activeRound.status === 'scheduled' ? (
            <Button label="Start delivery round" loading={saving} onPress={confirmStart} />
          ) : null}

          {activeRound.status === 'in_progress' && nextStop ? (
            <View style={styles.nextPanel}>
              <View style={styles.nextIcon}>
                <Ionicons name="navigate" size={20} color={palette.textInverse} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.nextLabel}>NEXT STOP</Text>
                <Text style={styles.nextName}>{patientName(nextStop)}</Text>
                <Text style={styles.nextAddress} numberOfLines={2}>
                  {stopAddress(nextStop)}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Navigate to next stop"
                style={styles.navigateButton}
                onPress={() => void openStopNavigation(nextStop)}
              >
                <Ionicons name="arrow-forward" size={22} color={deliveryGreen} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Stops</Text>
            {activeRound.patients.length > 1 ? (
              <Pressable onPress={() => void openRoundNavigation(activeRound)}>
                <Text style={styles.sectionAction}>Open route in Maps</Text>
              </Pressable>
            ) : null}
          </View>

          {activeRound.patients.map((stop) => (
            <StopCard
              key={stop.id}
              stop={stop}
              roundActive={activeRound.status === 'in_progress'}
              saving={saving}
              onNavigate={() => void openStopNavigation(stop)}
              onCall={() => void callPatient(stop)}
              onStatus={(status) => void updateStopStatus(stop.id, status)}
              onDeliver={() => openCompletion(stop)}
              onFail={() => openFailure(stop)}
            />
          ))}

          {activeRound.status === 'in_progress' ? (
            <Button
              label={tracking ? 'Pause live location' : 'Resume live location'}
              variant="ghost"
              onPress={() => {
                if (tracking) stopTracking()
                else if (membership?.id) void startTracking(activeRound.id, membership.id)
              }}
            />
          ) : null}
        </ScrollView>

        <Modal visible={completionOpen} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Confirm delivery</Text>
              <Text style={styles.sheetSubtitle}>
                {selectedStop ? patientName(selectedStop) : ''}
              </Text>
              <Text style={styles.fieldLabel}>Delivered to</Text>
              <View style={styles.methodRow}>
                {DELIVERY_METHODS.map((method) => {
                  const selected = method.value === deliveryMethod
                  return (
                    <Pressable
                      key={method.value}
                      style={[styles.methodOption, selected && styles.methodSelected]}
                      onPress={() => setDeliveryMethod(method.value)}
                    >
                      <Ionicons name={method.icon} size={19} color={selected ? deliveryGreen : palette.textMuted} />
                      <Text style={[styles.methodText, selected && styles.methodTextSelected]}>{method.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
              <TextInput
                style={styles.recipientInput}
                value={recipientName}
                onChangeText={setRecipientName}
                placeholder={deliveryMethod === 'left_in_safe_place' ? 'Safe place details (optional)' : 'Recipient name (optional)'}
              />
              <Text style={styles.fieldLabel}>Photo evidence (optional)</Text>
              <View style={styles.photoActions}>
                <Pressable style={styles.photoAction} onPress={() => void addEvidence('camera')}>
                  <Ionicons name="camera-outline" size={20} color={deliveryGreen} />
                  <Text style={styles.photoActionText}>Take photo</Text>
                </Pressable>
                <Pressable style={styles.photoAction} onPress={() => void addEvidence('library')}>
                  <Ionicons name="images-outline" size={20} color={deliveryGreen} />
                  <Text style={styles.photoActionText}>Choose photo</Text>
                </Pressable>
              </View>
              {evidenceFiles.length > 0 ? (
                <View style={styles.photoList}>
                  {evidenceFiles.map((file, index) => (
                    <View key={`${file.uri}-${index}`} style={styles.photoPreview}>
                      <Image source={{ uri: file.uri }} style={styles.photoImage} />
                      <Pressable
                        accessibilityLabel="Remove photo"
                        style={styles.removePhoto}
                        onPress={() => setEvidenceFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <Ionicons name="close" size={16} color={palette.textInverse} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text style={styles.fieldLabel}>Customer signature (optional)</Text>
              <SignaturePad ref={signatureRef} />
              <Pressable onPress={() => signatureRef.current?.clear()}>
                <Text style={styles.clearSignature}>Clear signature</Text>
              </Pressable>
              <View style={styles.sheetActions}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  style={styles.flex}
                  onPress={() => setCompletionOpen(false)}
                />
                <Button
                  label="Mark delivered"
                  style={[styles.flex, styles.deliveryButton]}
                  loading={saving}
                  onPress={() => void saveDelivery()}
                />
              </View>
            </ScrollView>
          </View>
        </Modal>

        <Modal visible={failureOpen} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Delivery not completed</Text>
              <Text style={styles.sheetSubtitle}>
                This stop will move to the pharmacy&apos;s redelivery queue.
              </Text>
              <Text style={styles.fieldLabel}>Reason</Text>
              <TextInput
                style={styles.reasonInput}
                value={failureReason}
                onChangeText={setFailureReason}
                placeholder="e.g. No answer at address"
                multiline
                autoFocus
              />
              <View style={styles.reasonPresets}>
                {['No answer', 'Patient refused', 'Address issue'].map((reason) => (
                  <Pressable
                    key={reason}
                    style={styles.reasonChip}
                    onPress={() => setFailureReason(reason)}
                  >
                    <Text style={styles.reasonChipText}>{reason}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.sheetActions}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  style={styles.flex}
                  onPress={() => setFailureOpen(false)}
                />
                <Button
                  label="Send to redelivery"
                  variant="danger"
                  style={styles.flex}
                  loading={saving}
                  disabled={!failureReason.trim()}
                  onPress={() => void saveFailure()}
                />
              </View>
            </View>
          </View>
        </Modal>
      </View>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View>
        <Text style={styles.dashboardTitle}>Your deliveries</Text>
        <Text style={styles.dashboardSubtitle}>
          Assigned rounds and available pharmacy jobs
        </Text>
      </View>
      {error ? <ErrorNotice message={error} onDismiss={clearError} /> : null}
      {loading && assignedRounds.length === 0 ? (
        <ActivityIndicator color={deliveryGreen} style={styles.loader} />
      ) : null}

      {assignedRounds.map((round) => (
        <RoundCard key={round.id} round={round} onPress={() => void selectRound(round)} />
      ))}

      {!loading && assignedRounds.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Ionicons name="checkmark-circle-outline" size={32} color={deliveryGreen} />
          <Text style={styles.emptyTitle}>No assigned rounds</Text>
          <Text style={styles.emptyText}>You are clear until a delivery is assigned.</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionTitle}>Available jobs</Text>
          <Text style={styles.sectionHint}>Unassigned rounds at this pharmacy</Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{openRounds.length}</Text>
        </View>
      </View>

      {openRounds.map((round) => (
        <OpenJobCard
          key={round.id}
          round={round}
          saving={saving}
          onClaim={() => confirmClaim(round)}
        />
      ))}
      {!loading && openRounds.length === 0 ? (
        <Text style={styles.quietEmpty}>No open delivery jobs right now.</Text>
      ) : null}
    </ScrollView>
  )
}

export function DriverHistoryScreen() {
  const membership = useAuthStore((state) => state.membership)
  const history = useDeliveryStore((state) => state.history)
  const loading = useDeliveryStore((state) => state.loading)
  const fetchHistory = useDeliveryStore((state) => state.fetchHistory)
  const fetchRound = useDeliveryStore((state) => state.fetchRound)

  useEffect(() => {
    if (membership?.id) void fetchHistory(membership.id)
  }, [membership?.id, fetchHistory])

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View>
        <Text style={styles.dashboardTitle}>Delivery history</Text>
        <Text style={styles.dashboardSubtitle}>Completed rounds and proof records</Text>
      </View>
      {loading && history.length === 0 ? <ActivityIndicator color={deliveryGreen} /> : null}
      {history.map((round) => (
        <RoundCard key={round.id} round={round} onPress={() => void fetchRound(round.id)} />
      ))}
      {!loading && history.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Ionicons name="receipt-outline" size={32} color={palette.textMuted} />
          <Text style={styles.emptyTitle}>No completed rounds yet</Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

export function DriverMapScreen() {
  const rounds = useDeliveryStore((state) => state.assignedRounds)
  const activeRound = useDeliveryStore((state) => state.activeRound)
  const candidate = activeRound ?? rounds.find((round) => round.status === 'in_progress') ?? rounds[0]
  const unresolved = candidate?.patients.filter((stop) => !isResolvedStop(stop.status)) ?? []

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View>
        <Text style={styles.dashboardTitle}>Journey</Text>
        <Text style={styles.dashboardSubtitle}>Hand off your stops to your preferred maps app</Text>
      </View>
      {candidate ? (
        <>
          <View style={styles.mapPanel}>
            <Ionicons name="map-outline" size={34} color={deliveryGreen} />
            <Text style={styles.mapTitle}>{candidate.title || 'Delivery round'}</Text>
            <Text style={styles.mapText}>
              {unresolved.length} remaining stop{unresolved.length === 1 ? '' : 's'} in delivery order
            </Text>
            <Button
              label="Open full route in Maps"
              style={styles.deliveryButton}
              disabled={unresolved.length === 0}
              onPress={() => void openRoundNavigation(candidate)}
            />
          </View>
          {unresolved.map((stop) => (
            <Pressable
              key={stop.id}
              style={styles.mapStop}
              onPress={() => void openStopNavigation(stop)}
            >
              <View style={styles.orderCircle}>
                <Text style={styles.orderText}>{stop.delivery_order}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.stopName}>{patientName(stop)}</Text>
                <Text style={styles.stopAddress} numberOfLines={1}>{stopAddress(stop)}</Text>
              </View>
              <Ionicons name="open-outline" size={20} color={deliveryGreen} />
            </Pressable>
          ))}
        </>
      ) : (
        <View style={styles.emptyPanel}>
          <Ionicons name="map-outline" size={32} color={palette.textMuted} />
          <Text style={styles.emptyTitle}>Select a round first</Text>
          <Text style={styles.emptyText}>Your ordered stops will appear here.</Text>
        </View>
      )}
    </ScrollView>
  )
}

function RoundCard({ round, onPress }: { round: DeliveryRound; onPress: () => void }) {
  const resolved = round.patients.filter((stop) => isResolvedStop(stop.status)).length
  return (
    <Pressable style={({ pressed }) => [styles.roundCard, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.cardTop}>
        <View style={styles.roundIcon}>
          <Ionicons name="car-sport-outline" size={22} color={deliveryGreen} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.roundTitle}>{round.title || 'Delivery round'}</Text>
          <Text style={styles.roundMeta}>{formatRoundDate(round)}</Text>
        </View>
        <StatusPill status={round.status} />
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.cardMetric}>{round.patients.length} stops</Text>
        <Text style={styles.cardMetric}>{resolved} resolved</Text>
        <Ionicons name="chevron-forward" size={19} color={palette.textMuted} />
      </View>
    </Pressable>
  )
}

function OpenJobCard({
  round,
  saving,
  onClaim,
}: {
  round: DeliveryRound
  saving: boolean
  onClaim: () => void
}) {
  return (
    <View style={styles.openCard}>
      <View style={styles.cardTop}>
        <View style={[styles.roundIcon, styles.openIcon]}>
          <Ionicons name="flash-outline" size={21} color={palette.warning} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.roundTitle}>{round.title || 'Available delivery'}</Text>
          <Text style={styles.roundMeta}>{formatRoundDate(round)} · {round.patients.length} stops</Text>
        </View>
      </View>
      <Button label="Claim job" variant="secondary" disabled={saving} onPress={onClaim} />
    </View>
  )
}

function StopCard({
  stop,
  roundActive,
  saving,
  onNavigate,
  onCall,
  onStatus,
  onDeliver,
  onFail,
}: {
  stop: DeliveryStop
  roundActive: boolean
  saving: boolean
  onNavigate: () => void
  onCall: () => void
  onStatus: (status: DeliveryStopStatus) => void
  onDeliver: () => void
  onFail: () => void
}) {
  const resolved = isResolvedStop(stop.status)
  return (
    <View style={[styles.stopCard, resolved && styles.resolvedCard]}>
      <View style={styles.stopTop}>
        <View style={[styles.orderCircle, resolved && styles.orderResolved]}>
          {resolved ? (
            <Ionicons name="checkmark" size={17} color={palette.textInverse} />
          ) : (
            <Text style={styles.orderText}>{stop.delivery_order}</Text>
          )}
        </View>
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Text style={styles.stopName}>{patientName(stop)}</Text>
            <StopStatusPill status={stop.status} />
          </View>
          <Text style={styles.stopAddress}>{stopAddress(stop) || 'No address recorded'}</Text>
        </View>
      </View>
      {stop.notes ? <Text style={styles.stopNotes}>{stop.notes}</Text> : null}
      {stop.medications.length > 0 ? (
        <View style={styles.medList}>
          {stop.medications.map((medication) => (
            <Text key={medication.id} style={styles.medText}>
              {medication.quantity ?? 1} × {medication.patient_medication?.drug_name || 'Medication'}
            </Text>
          ))}
        </View>
      ) : null}
      {!resolved ? (
        <View style={styles.quickActions}>
          <IconAction icon="navigate-outline" label="Navigate" onPress={onNavigate} />
          {stop.patient?.phone ? <IconAction icon="call-outline" label="Call" onPress={onCall} /> : null}
          {roundActive && stop.status === 'pending' ? (
            <IconAction icon="play-outline" label="Begin" onPress={() => onStatus('in_transit')} />
          ) : null}
          {roundActive && stop.status === 'in_transit' ? (
            <IconAction icon="location-outline" label="Arrived" onPress={() => onStatus('arrived')} />
          ) : null}
        </View>
      ) : null}
      {roundActive && !resolved ? (
        <View style={styles.stopActions}>
          <Button
            label="Delivered"
            style={[styles.flex, styles.deliveryButton]}
            disabled={saving}
            onPress={onDeliver}
          />
          <Pressable accessibilityLabel="Delivery failed" style={styles.failButton} onPress={onFail}>
            <Ionicons name="close" size={21} color={palette.danger} />
          </Pressable>
          <Pressable
            accessibilityLabel="Mark bags returned"
            style={styles.returnButton}
            onPress={() =>
              Alert.alert('Mark as returned?', 'This records that the bags were returned to the pharmacy.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Returned', onPress: () => onStatus('returned') },
              ])
            }
          >
            <Ionicons name="return-down-back" size={21} color={palette.textMuted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function IconAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.iconAction} onPress={onPress}>
      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={deliveryGreen} />
      <Text style={styles.iconActionText}>{label}</Text>
    </Pressable>
  )
}

function StatusPill({ status }: { status: DeliveryRound['status'] }) {
  const config = {
    draft: ['Draft', palette.textMuted, palette.bg],
    scheduled: ['Ready', palette.brandDark, palette.brandTint],
    in_progress: ['In progress', palette.warning, amberTint],
    completed: ['Complete', deliveryGreen, deliveryGreenTint],
    cancelled: ['Cancelled', palette.danger, palette.dangerTint],
  }[status]
  return (
    <View style={[styles.statusPill, { backgroundColor: config[2] }]}>
      <Text style={[styles.statusText, { color: config[1] }]}>{config[0]}</Text>
    </View>
  )
}

function StopStatusPill({ status }: { status: DeliveryStopStatus }) {
  const labels: Record<DeliveryStopStatus, string> = {
    pending: 'Pending',
    in_transit: 'On way',
    arrived: 'Arrived',
    delivered: 'Delivered',
    failed: 'Failed',
    skipped: 'Skipped',
    pending_redelivery: 'Redelivery',
    moved_to_round: 'Moved',
    returned: 'Returned',
    cancelled: 'Cancelled',
  }
  const success = status === 'delivered'
  const danger = status === 'failed' || status === 'pending_redelivery'
  return (
    <View style={[styles.stopPill, success && styles.stopPillSuccess, danger && styles.stopPillDanger]}>
      <Text style={[styles.stopPillText, success && styles.stopTextSuccess, danger && styles.stopTextDanger]}>
        {labels[status]}
      </Text>
    </View>
  )
}

function ErrorNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Pressable style={styles.errorNotice} onPress={onDismiss}>
      <Ionicons name="alert-circle-outline" size={19} color={palette.danger} />
      <Text style={styles.errorText}>{message}</Text>
      <Ionicons name="close" size={18} color={palette.danger} />
    </Pressable>
  )
}

function patientName(stop: DeliveryStop) {
  return stop.patient
    ? `${stop.patient.first_name} ${stop.patient.last_name}`.trim()
    : 'Patient delivery'
}

function formatRoundDate(round: DeliveryRound) {
  if (!round.scheduled_date) return 'Date to be confirmed'
  const date = new Date(`${round.scheduled_date}T12:00:00`)
  const day = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const time = round.scheduled_time_start?.slice(0, 5)
  return time ? `${day} · ${time}` : day
}

async function callPatient(stop: DeliveryStop) {
  if (stop.patient?.phone) await Linking.openURL(`tel:${stop.patient.phone}`)
}

async function openStopNavigation(stop: DeliveryStop) {
  const address = stopAddress(stop)
  if (!address) return
  const encoded = encodeURIComponent(address)
  const url = Platform.select({
    ios: `http://maps.apple.com/?daddr=${encoded}&dirflg=d`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving&dir_action=navigate`,
  })
  await Linking.openURL(url)
}

async function openRoundNavigation(round: DeliveryRound) {
  const addresses = round.patients
    .filter((stop) => !isResolvedStop(stop.status))
    .map(stopAddress)
    .filter(Boolean)
  if (addresses.length === 0) return
  if (Platform.OS === 'ios') {
    await Linking.openURL(`http://maps.apple.com/?daddr=${encodeURIComponent(addresses[0])}&dirflg=d`)
    return
  }
  const destination = addresses.at(-1)!
  const waypoints = addresses.slice(0, -1).slice(0, 9)
  const waypointQuery = waypoints.length
    ? `&waypoints=${waypoints.map(encodeURIComponent).join('%7C')}`
    : ''
  await Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate${waypointQuery}`,
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { gap: 14, paddingBottom: 28 },
  pressed: { opacity: 0.82 },
  loader: { marginVertical: 28 },
  dashboardTitle: { fontSize: 25, fontWeight: '800', color: palette.text },
  dashboardSubtitle: { fontSize: 14, color: palette.textMuted, marginTop: 3 },
  roundCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 14, gap: 13 },
  openCard: { backgroundColor: '#FFFCF4', borderWidth: 1, borderColor: '#F5D98B', borderRadius: radius.md, padding: 14, gap: 13 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 11 },
  roundIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: deliveryGreenTint, alignItems: 'center', justifyContent: 'center' },
  openIcon: { backgroundColor: amberTint },
  roundTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  roundMeta: { fontSize: 13, color: palette.textMuted, marginTop: 3 },
  cardMetric: { fontSize: 13, color: palette.textMuted, flex: 1 },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 11, fontWeight: '800' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: palette.text },
  sectionHint: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
  sectionAction: { fontSize: 13, fontWeight: '700', color: deliveryGreen },
  countPill: { minWidth: 29, height: 29, borderRadius: radius.pill, backgroundColor: amberTint, alignItems: 'center', justifyContent: 'center' },
  countText: { color: palette.warning, fontSize: 13, fontWeight: '800' },
  emptyPanel: { alignItems: 'center', gap: 7, padding: 24, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  emptyText: { fontSize: 13, color: palette.textMuted, textAlign: 'center' },
  quietEmpty: { color: palette.textMuted, fontSize: 13, paddingVertical: 8 },
  errorNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: radius.md, backgroundColor: palette.dangerTint },
  errorText: { flex: 1, color: palette.danger, fontSize: 13, lineHeight: 18 },
  backLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, paddingVertical: 3 },
  backText: { color: deliveryGreen, fontWeight: '700', fontSize: 14 },
  routeHero: { backgroundColor: '#12372C', borderRadius: radius.md, padding: 16, gap: 13 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#A7D8C7', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  routeTitle: { color: palette.textInverse, fontSize: 22, fontWeight: '800', marginTop: 3 },
  progressTrack: { height: 7, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: '#42D6A4' },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressText: { color: '#D2E9E1', fontSize: 12 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#56E4B3' },
  liveText: { color: '#D2E9E1', fontSize: 11, fontWeight: '700' },
  nextPanel: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: radius.md, backgroundColor: deliveryGreenTint, borderWidth: 1, borderColor: '#A7E7CE' },
  nextIcon: { width: 39, height: 39, borderRadius: radius.pill, backgroundColor: deliveryGreen, alignItems: 'center', justifyContent: 'center' },
  nextLabel: { fontSize: 10, color: deliveryGreen, fontWeight: '900' },
  nextName: { fontSize: 16, color: palette.text, fontWeight: '700', marginTop: 1 },
  nextAddress: { fontSize: 12, color: palette.textMuted, marginTop: 2, lineHeight: 16 },
  navigateButton: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  stopCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 14, gap: 11 },
  resolvedCard: { opacity: 0.68 },
  stopTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  orderCircle: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: deliveryGreenTint, alignItems: 'center', justifyContent: 'center' },
  orderResolved: { backgroundColor: deliveryGreen },
  orderText: { color: deliveryGreen, fontSize: 13, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stopName: { flex: 1, fontSize: 15, fontWeight: '700', color: palette.text },
  stopAddress: { fontSize: 12, color: palette.textMuted, lineHeight: 17, marginTop: 3 },
  stopNotes: { fontSize: 12, lineHeight: 17, color: palette.warning, backgroundColor: amberTint, padding: 9, borderRadius: radius.sm },
  medList: { gap: 3, paddingLeft: 41 },
  medText: { fontSize: 12, color: palette.textMuted },
  stopPill: { backgroundColor: palette.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  stopPillSuccess: { backgroundColor: deliveryGreenTint },
  stopPillDanger: { backgroundColor: palette.dangerTint },
  stopPillText: { color: palette.textMuted, fontSize: 10, fontWeight: '800' },
  stopTextSuccess: { color: deliveryGreen },
  stopTextDanger: { color: palette.danger },
  quickActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  iconAction: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.bg, borderRadius: radius.sm, paddingHorizontal: 10, height: 35 },
  iconActionText: { color: deliveryGreen, fontSize: 12, fontWeight: '700' },
  stopActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  deliveryButton: { backgroundColor: deliveryGreen },
  failButton: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: palette.dangerTint, alignItems: 'center', justifyContent: 'center' },
  returnButton: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: palette.overlay },
  sheet: { maxHeight: '92%', backgroundColor: palette.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  sheetContent: { padding: 18, paddingBottom: 28, gap: 12 },
  sheetHandle: { width: 42, height: 4, backgroundColor: palette.border, borderRadius: radius.pill, alignSelf: 'center' },
  sheetTitle: { fontSize: 21, fontWeight: '800', color: palette.text },
  sheetSubtitle: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  fieldLabel: { fontSize: 12, color: palette.text, fontWeight: '700', marginTop: 3 },
  clearSignature: { color: deliveryGreen, fontSize: 13, fontWeight: '700', alignSelf: 'flex-end' },
  methodRow: { flexDirection: 'row', gap: 7 },
  methodOption: { flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, paddingHorizontal: 5 },
  methodSelected: { borderColor: deliveryGreen, backgroundColor: deliveryGreenTint },
  methodText: { color: palette.textMuted, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  methodTextSelected: { color: deliveryGreen },
  recipientInput: { height: 46, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, paddingHorizontal: 12, color: palette.text },
  photoActions: { flexDirection: 'row', gap: 8 },
  photoAction: { flex: 1, height: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface },
  photoActionText: { color: deliveryGreen, fontSize: 12, fontWeight: '700' },
  photoList: { flexDirection: 'row', gap: 8 },
  photoPreview: { width: 74, height: 74, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: palette.border },
  photoImage: { width: '100%', height: '100%' },
  removePhoto: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.overlay },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  reasonInput: { minHeight: 92, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, padding: 12, color: palette.text, textAlignVertical: 'top' },
  reasonPresets: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  reasonChip: { paddingHorizontal: 10, paddingVertical: 7, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.pill },
  reasonChipText: { fontSize: 12, color: palette.textMuted },
  mapPanel: { backgroundColor: deliveryGreenTint, borderRadius: radius.md, padding: 18, gap: 8, alignItems: 'flex-start' },
  mapTitle: { color: palette.text, fontSize: 19, fontWeight: '800' },
  mapText: { color: palette.textMuted, fontSize: 13, marginBottom: 4 },
  mapStop: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12 },
})