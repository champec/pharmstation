import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import {
  Calendar,
  CalendarProvider,
  WeekCalendar,
  type DateData,
} from 'react-native-calendars'

import {
  shiftHours,
  shiftTotal,
  useLocumStore,
  type LocumBooking,
  type LocumShift,
} from '@/stores/locum-store'
import { palette, radius } from '@/theme/palette'

const ACCENT = '#6D28D9'
const ACCENT_TINT = '#F1EAFE'
const TODAY = new Date().toISOString().slice(0, 10)

type Eligibility = 'eligible' | 'applied' | 'clash' | 'services'
type CalendarView = 'month' | 'week' | 'agenda'
type BookingFilter = 'upcoming' | 'requests' | 'history'

function dateLabel(date: string, long = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : undefined,
  })
}

const timeLabel = (time: string) => time.slice(0, 5)
const money = (value: number) => `£${value.toFixed(2)}`

function useLocumData() {
  const load = useLocumStore((state) => state.load)
  const loading = useLocumStore((state) => state.loading)
  useEffect(() => {
    void load()
  }, [load])
  return { loading, refresh: () => void load(true) }
}

function eligibilityFor(shift: LocumShift): Eligibility {
  const state = useLocumStore.getState()
  if (state.bookings.some((booking) => booking.shift_id === shift.id && ['pending', 'approved'].includes(booking.status))) return 'applied'
  if (state.clashIds.includes(shift.id)) return 'clash'
  if (shift.required_service_ids.some((id) => !state.serviceIds.includes(id))) return 'services'
  return 'eligible'
}

const eligibilityText: Record<Eligibility, string> = {
  eligible: 'Eligible',
  applied: 'Booked',
  clash: 'Time clash',
  services: 'Criteria not met',
}

function FindShiftsScreen() {
  const { loading, refresh } = useLocumData()
  const shifts = useLocumStore((state) => state.shifts)
  const error = useLocumStore((state) => state.error)
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | 'week' | 'weekend'>('all')
  const [eligibleOnly, setEligibleOnly] = useState(true)
  const [minimumRate, setMinimumRate] = useState(0)

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const weekEnd = new Date()
    weekEnd.setDate(weekEnd.getDate() + 7)
    const weekEndKey = weekEnd.toISOString().slice(0, 10)
    return shifts.filter((shift) => {
      if (normalized && !`${shift.org_name} ${shift.org_address} ${shift.notes ?? ''}`.toLowerCase().includes(normalized)) return false
      if (eligibleOnly && eligibilityFor(shift) !== 'eligible') return false
      if (Number(shift.rate_per_hour) < minimumRate) return false
      if (dateFilter === 'week' && shift.date > weekEndKey) return false
      if (dateFilter === 'weekend') {
        const day = new Date(`${shift.date}T12:00:00`).getDay()
        if (day !== 0 && day !== 6) return false
      }
      return true
    })
  }, [dateFilter, eligibleOnly, minimumRate, query, shifts])

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={ACCENT} />}>
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>LOCUM NETWORK</Text>
          <Text style={styles.heroTitle}>Find your next shift</Text>
          <Text style={styles.heroText}>{shifts.length} open across the network</Text>
        </View>
        <View style={styles.heroIcon}><Ionicons name="briefcase" size={25} color={ACCENT} /></View>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={19} color={palette.textMuted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Pharmacy, town or postcode" placeholderTextColor={palette.textMuted} style={styles.searchInput} returnKeyType="search" />
        {query ? <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={19} color={palette.textMuted} /></Pressable> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <FilterChip label="All dates" active={dateFilter === 'all'} onPress={() => setDateFilter('all')} />
        <FilterChip label="Next 7 days" active={dateFilter === 'week'} onPress={() => setDateFilter('week')} />
        <FilterChip label="Weekends" active={dateFilter === 'weekend'} onPress={() => setDateFilter('weekend')} />
        <FilterChip label="Eligible" active={eligibleOnly} onPress={() => setEligibleOnly(!eligibleOnly)} icon="checkmark-circle-outline" />
        <FilterChip label={minimumRate ? `£${minimumRate}+/hr` : 'Any rate'} active={minimumRate > 0} onPress={() => setMinimumRate(minimumRate === 0 ? 25 : minimumRate === 25 ? 30 : 0)} />
      </ScrollView>

      <ErrorBanner message={error} />
      <View style={styles.resultRow}><Text style={styles.sectionTitle}>Available shifts</Text><Text style={styles.resultCount}>{visible.length} found</Text></View>
      {loading && shifts.length === 0 ? <LoadingState /> : null}
      {!loading && visible.length === 0 ? <EmptyState icon="search-outline" title="No matching shifts" text="Try widening your filters or check again soon." /> : null}
      {visible.map((shift) => <ShiftCard key={shift.id} shift={shift} eligibility={eligibilityFor(shift)} />)}
    </ScrollView>
  )
}

function ShiftCard({ shift, eligibility }: { shift: LocumShift; eligibility: Eligibility }) {
  const [expanded, setExpanded] = useState(false)
  const actionId = useLocumStore((state) => state.actionId)
  const book = useLocumStore((state) => state.book)
  const canBook = eligibility === 'eligible'

  const confirmBooking = () => {
    const instant = shift.booking_mode === 'auto'
    Alert.alert(
      instant ? 'Book this shift?' : 'Request this shift?',
      `${dateLabel(shift.date, true)}, ${timeLabel(shift.start_time)}-${timeLabel(shift.end_time)} at ${shift.org_name}.`,
      [{ text: 'Not now', style: 'cancel' }, { text: instant ? 'Book shift' : 'Send request', onPress: () => void book(shift) }],
    )
  }

  return (
    <View style={styles.shiftCard}>
      <Pressable onPress={() => setExpanded(!expanded)} style={styles.shiftMain}>
        <View style={styles.dateTile}>
          <Text style={styles.dateTileMonth}>{new Date(`${shift.date}T12:00:00`).toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</Text>
          <Text style={styles.dateTileDay}>{new Date(`${shift.date}T12:00:00`).getDate()}</Text>
          <Text style={styles.dateTileWeekday}>{new Date(`${shift.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</Text>
        </View>
        <View style={styles.shiftInfo}>
          <View style={styles.between}><Text style={styles.orgName} numberOfLines={1}>{shift.org_name}</Text><Text style={styles.rate}>£{Number(shift.rate_per_hour).toFixed(0)}<Text style={styles.rateUnit}>/hr</Text></Text></View>
          <Text style={styles.shiftTime}>{timeLabel(shift.start_time)} - {timeLabel(shift.end_time)} · {shiftHours(shift).toFixed(1)} hours</Text>
          {shift.org_address ? <Fact icon="location-outline" text={shift.org_address} /> : null}
          <View style={styles.badgeRow}>
            <StatusPill label={eligibilityText[eligibility]} tone={eligibility === 'eligible' ? 'success' : eligibility === 'applied' ? 'accent' : 'warning'} />
            <StatusPill label={shift.booking_mode === 'auto' ? 'Instant booking' : 'Approval needed'} tone="neutral" />
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.details}>
          <View style={styles.totalRow}><Text style={styles.detailLabel}>Estimated earnings</Text><Text style={styles.totalValue}>{money(shiftTotal(shift))}</Text></View>
          {shift.notes ? <Text style={styles.notes}>{shift.notes}</Text> : null}
          {shift.required_service_ids.length > 0 ? <Requirement icon="medkit-outline" text={`${shift.required_service_ids.length} service qualification${shift.required_service_ids.length === 1 ? '' : 's'} required`} /> : null}
          {shift.references_required ? <Requirement icon="people-outline" text="References required" /> : null}
          {shift.sop_required ? <Requirement icon="document-text-outline" text="SOP acknowledgement required before shift" /> : null}
        </View>
      ) : null}

      <View style={styles.cardActions}>
        <Pressable onPress={() => setExpanded(!expanded)} style={styles.iconAction} accessibilityLabel={expanded ? 'Hide shift details' : 'Show shift details'}><Ionicons name={expanded ? 'chevron-up' : 'information-circle-outline'} size={20} color={palette.textMuted} /></Pressable>
        <Pressable onPress={confirmBooking} disabled={!canBook || actionId === shift.id} style={[styles.primaryAction, !canBook && styles.actionDisabled]}>
          {actionId === shift.id ? <ActivityIndicator size="small" color={palette.textInverse} /> : null}
          <Text style={styles.primaryActionText}>{eligibility === 'applied' ? 'Already booked' : shift.booking_mode === 'auto' ? 'Book now' : 'Request shift'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function CalendarScreen() {
  const { loading, refresh } = useLocumData()
  const bookings = useLocumStore((state) => state.bookings)
  const [view, setView] = useState<CalendarView>('month')
  const [selected, setSelected] = useState(TODAY)
  const calendarBookings = useMemo(() => bookings.filter((booking) => booking.shift && ['approved', 'pending'].includes(booking.status)), [bookings])
  const selectedBookings = calendarBookings.filter((booking) => booking.shift?.date === selected)
  const markedDates = useMemo(() => {
    const marks: Record<string, { marked?: boolean; dotColor?: string; selected?: boolean; selectedColor?: string }> = {}
    for (const booking of calendarBookings) {
      if (booking.shift) marks[booking.shift.date] = { marked: true, dotColor: booking.status === 'approved' ? palette.success : palette.warning }
    }
    marks[selected] = { ...marks[selected], selected: true, selectedColor: ACCENT }
    return marks
  }, [calendarBookings, selected])
  const agenda = [...calendarBookings].filter((booking) => (booking.shift?.date ?? '') >= TODAY).sort((a, b) => (a.shift?.date ?? '').localeCompare(b.shift?.date ?? ''))

  return (
    <View style={styles.screen}>
      <ScreenHeader title="My calendar" subtitle={`${calendarBookings.filter((booking) => booking.status === 'approved' && (booking.shift?.date ?? '') >= TODAY).length} confirmed upcoming`} loading={loading} onRefresh={refresh} />
      <SegmentedControl options={['month', 'week', 'agenda']} value={view} onChange={(value) => setView(value as CalendarView)} />
      {view === 'agenda' ? (
        <ScrollView contentContainerStyle={styles.agendaContent} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={ACCENT} />}>
          {agenda.length === 0 ? <EmptyState icon="calendar-outline" title="Your calendar is clear" text="Booked and requested shifts will appear here." /> : null}
          {agenda.map((booking, index) => <CalendarBooking key={booking.id} booking={booking} showDate={index === 0 || agenda[index - 1].shift?.date !== booking.shift?.date} />)}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.calendarContent}>
          <View style={styles.calendarCard}>
            {view === 'month' ? <Calendar current={selected} onDayPress={(day: DateData) => setSelected(day.dateString)} markedDates={markedDates} firstDay={1} theme={calendarTheme} /> : <CalendarProvider date={selected} onDateChanged={setSelected}><WeekCalendar firstDay={1} markedDates={markedDates} theme={calendarTheme} /></CalendarProvider>}
          </View>
          <Text style={styles.dayHeading}>{dateLabel(selected, true)}</Text>
          {selectedBookings.length === 0 ? <Text style={styles.noDayEvents}>No shifts on this day.</Text> : null}
          {selectedBookings.map((booking) => <CalendarBooking key={booking.id} booking={booking} />)}
        </ScrollView>
      )}
    </View>
  )
}

function CalendarBooking({ booking, showDate = false }: { booking: LocumBooking; showDate?: boolean }) {
  if (!booking.shift) return null
  return (
    <View>
      {showDate ? <Text style={styles.agendaDate}>{dateLabel(booking.shift.date, true)}</Text> : null}
      <View style={styles.calendarEvent}>
        <View style={[styles.eventRail, { backgroundColor: booking.status === 'approved' ? palette.success : palette.warning }]} />
        <View style={styles.eventCopy}><Text style={styles.eventTime}>{timeLabel(booking.shift.start_time)} - {timeLabel(booking.shift.end_time)}</Text><Text style={styles.eventOrg}>{booking.shift.org_name}</Text><Text style={styles.metaText}>{money(shiftTotal(booking.shift))} estimated</Text></View>
        <StatusPill label={booking.status === 'approved' ? 'Confirmed' : 'Requested'} tone={booking.status === 'approved' ? 'success' : 'warning'} />
      </View>
    </View>
  )
}

function BookingsScreen() {
  const { loading, refresh } = useLocumData()
  const bookings = useLocumStore((state) => state.bookings)
  const error = useLocumStore((state) => state.error)
  const [filter, setFilter] = useState<BookingFilter>('upcoming')
  const visible = bookings.filter((booking) => {
    if (!booking.shift) return false
    if (filter === 'upcoming') return booking.status === 'approved' && booking.shift.date >= TODAY
    if (filter === 'requests') return booking.status === 'pending'
    return booking.shift.date < TODAY || ['completed', 'cancelled', 'rejected', 'no_show'].includes(booking.status)
  })

  return (
    <View style={styles.screen}>
      <ScreenHeader title="My bookings" subtitle="Manage every shift in one place" loading={loading} onRefresh={refresh} />
      <SegmentedControl options={['upcoming', 'requests', 'history']} value={filter} onChange={(value) => setFilter(value as BookingFilter)} />
      <ErrorBanner message={error} />
      <ScrollView contentContainerStyle={styles.bookingContent} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={ACCENT} />}>
        {visible.length === 0 ? <EmptyState icon="calendar-clear-outline" title="Nothing here yet" text={filter === 'upcoming' ? 'Confirmed shifts will appear here.' : filter === 'requests' ? 'You have no requests awaiting approval.' : 'Completed and cancelled shifts will appear here.'} /> : null}
        {visible.map((booking) => <BookingCard key={booking.id} booking={booking} />)}
      </ScrollView>
    </View>
  )
}

function BookingCard({ booking }: { booking: LocumBooking }) {
  const actionId = useLocumStore((state) => state.actionId)
  const withdraw = useLocumStore((state) => state.withdraw)
  const clockIn = useLocumStore((state) => state.clockIn)
  const clockOut = useLocumStore((state) => state.clockOut)
  if (!booking.shift) return null
  const isToday = booking.shift.date === TODAY
  const canWithdraw = ['pending', 'approved'].includes(booking.status) && booking.shift.date >= TODAY && !booking.sign_in
  const confirmWithdraw = () => Alert.alert(booking.status === 'pending' ? 'Withdraw request?' : 'Cancel booking?', 'This action will be visible to the pharmacy.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Withdraw', style: 'destructive', onPress: () => void withdraw(booking.id) }])

  return (
    <View style={styles.bookingCard}>
      <View style={styles.between}><Text style={styles.bookingDate}>{dateLabel(booking.shift.date, true)}</Text><StatusPill label={booking.status === 'approved' ? 'Confirmed' : booking.status === 'pending' ? 'Requested' : booking.status.replace('_', ' ')} tone={booking.status === 'approved' || booking.status === 'completed' ? 'success' : booking.status === 'pending' ? 'warning' : 'neutral'} /></View>
      <Text style={styles.bookingOrg}>{booking.shift.org_name}</Text>
      <View style={styles.bookingFacts}><Fact icon="time-outline" text={`${timeLabel(booking.shift.start_time)} - ${timeLabel(booking.shift.end_time)}`} /><Fact icon="cash-outline" text={`${money(shiftTotal(booking.shift))} estimated`} /></View>
      {booking.shift.org_address ? <Fact icon="location-outline" text={booking.shift.org_address} /> : null}
      {booking.sign_in ? <View style={styles.clockStatus}><Ionicons name="radio-button-on" size={14} color={booking.sign_in.signed_out_at ? palette.textMuted : palette.success} /><Text style={styles.clockText}>{booking.sign_in.signed_out_at ? `Shift recorded · ${((booking.sign_in.duration_minutes ?? 0) / 60).toFixed(1)}h` : `Clocked in at ${new Date(booking.sign_in.signed_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}</Text></View> : null}
      <View style={styles.bookingActions}>
        {canWithdraw ? <Pressable onPress={confirmWithdraw} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>{booking.status === 'pending' ? 'Withdraw request' : 'Cancel booking'}</Text></Pressable> : null}
        {booking.status === 'approved' && isToday && !booking.sign_in ? <Pressable onPress={() => void clockIn(booking)} disabled={actionId === booking.id} style={styles.clockButton}><Ionicons name="log-in-outline" size={18} color={palette.textInverse} /><Text style={styles.clockButtonText}>Clock in</Text></Pressable> : null}
        {booking.status === 'approved' && isToday && booking.sign_in && !booking.sign_in.signed_out_at ? <Pressable onPress={() => void clockOut(booking)} disabled={actionId === booking.id} style={styles.clockButton}><Ionicons name="log-out-outline" size={18} color={palette.textInverse} /><Text style={styles.clockButtonText}>Clock out</Text></Pressable> : null}
      </View>
    </View>
  )
}

function EarningsScreen() {
  const { loading, refresh } = useLocumData()
  const bookings = useLocumStore((state) => state.bookings)
  const completed = bookings.filter((booking) => booking.status === 'completed' && booking.shift)
  const total = completed.reduce((sum, booking) => sum + (booking.shift ? shiftTotal(booking.shift) : 0), 0)
  const hours = completed.reduce((sum, booking) => sum + (booking.sign_in?.duration_minutes ? booking.sign_in.duration_minutes / 60 : booking.shift ? shiftHours(booking.shift) : 0), 0)

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={ACCENT} />}>
      <View style={styles.earningsHero}><Text style={styles.earningsLabel}>ESTIMATED SHIFT EARNINGS</Text><Text style={styles.earningsValue}>{money(total)}</Text><Text style={styles.earningsMeta}>{completed.length} completed shifts · {hours.toFixed(1)} hours</Text></View>
      <View style={styles.statGrid}><Stat label="Average shift" value={completed.length ? money(total / completed.length) : '£0.00'} icon="trending-up-outline" /><Stat label="Average rate" value={hours ? `${money(total / hours)}/hr` : '£0.00/hr'} icon="speedometer-outline" /></View>
      <View style={styles.infoBanner}><Ionicons name="information-circle-outline" size={19} color={palette.brandDark} /><Text style={styles.infoText}>Final invoice and payment amounts may differ from estimates after recorded hours and platform fees are applied.</Text></View>
      <Text style={styles.sectionTitle}>Completed work</Text>
      {completed.length === 0 ? <EmptyState icon="receipt-outline" title="No completed shifts" text="Your earnings history will build as shifts are completed." /> : null}
      {completed.map((booking) => booking.shift ? <View key={booking.id} style={styles.earningRow}><View style={styles.earningIcon}><Ionicons name="checkmark" size={18} color={palette.success} /></View><View style={styles.eventCopy}><Text style={styles.eventOrg}>{booking.shift.org_name}</Text><Text style={styles.metaText}>{dateLabel(booking.shift.date)} · {shiftHours(booking.shift).toFixed(1)}h</Text></View><Text style={styles.earningAmount}>{money(shiftTotal(booking.shift))}</Text></View> : null)}
    </ScrollView>
  )
}

function ScreenHeader({ title, subtitle, loading, onRefresh }: { title: string; subtitle: string; loading: boolean; onRefresh: () => void }) {
  return <View style={styles.calendarHeader}><View><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.calendarSubtitle}>{subtitle}</Text></View><Pressable onPress={onRefresh} style={styles.refreshButton} accessibilityLabel={`Refresh ${title}`}>{loading ? <ActivityIndicator size="small" color={ACCENT} /> : <Ionicons name="refresh" size={19} color={ACCENT} />}</Pressable></View>
}

function FilterChip({ label, active, onPress, icon }: { label: string; active: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return <Pressable onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]}>{icon ? <Ionicons name={icon} size={15} color={active ? ACCENT : palette.textMuted} /> : null}<Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text></Pressable>
}

function SegmentedControl({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  return <View style={styles.segmented}>{options.map((option) => <Pressable key={option} onPress={() => onChange(option)} style={[styles.segment, value === option && styles.segmentActive]}><Text style={[styles.segmentText, value === option && styles.segmentTextActive]}>{option.charAt(0).toUpperCase() + option.slice(1)}</Text></Pressable>)}</View>
}

function StatusPill({ label, tone }: { label: string; tone: 'success' | 'warning' | 'accent' | 'neutral' }) {
  return <View style={[styles.pill, styles[`pill_${tone}`]]}><Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{label}</Text></View>
}

function Requirement({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.requirement}><Ionicons name={icon} size={16} color={palette.textMuted} /><Text style={styles.requirementText}>{text}</Text></View>
}

function Fact({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.inlineMeta}><Ionicons name={icon} size={15} color={palette.textMuted} /><Text style={styles.metaText}>{text}</Text></View>
}

function Stat({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={styles.stat}><View style={styles.statIcon}><Ionicons name={icon} size={18} color={ACCENT} /></View><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>
}

function ErrorBanner({ message }: { message: string | null }) {
  return message ? <View style={styles.errorBanner}><Ionicons name="alert-circle-outline" size={18} color={palette.danger} /><Text style={styles.errorText}>{message}</Text></View> : null
}

function LoadingState() {
  return <View style={styles.loading}><ActivityIndicator color={ACCENT} /><Text style={styles.metaText}>Loading shifts...</Text></View>
}

function EmptyState({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  return <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name={icon} size={25} color={ACCENT} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>
}

const calendarTheme = {
  calendarBackground: palette.surface,
  textSectionTitleColor: palette.textMuted,
  selectedDayBackgroundColor: ACCENT,
  selectedDayTextColor: '#FFFFFF',
  todayTextColor: ACCENT,
  dayTextColor: palette.text,
  textDisabledColor: '#CBD5E1',
  arrowColor: ACCENT,
  monthTextColor: palette.text,
  textMonthFontWeight: '700' as const,
  textDayFontWeight: '500' as const,
  textDayHeaderFontWeight: '600' as const,
}

export const locumScreens: Record<string, ComponentType> = {
  find: FindShiftsScreen,
  calendar: CalendarScreen,
  bookings: BookingsScreen,
  earnings: EarningsScreen,
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { paddingBottom: 28, gap: 12 },
  hero: { backgroundColor: '#17142B', borderRadius: radius.lg, padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  heroCopy: { flex: 1 },
  eyebrow: { color: '#C4B5FD', fontSize: 10, fontWeight: '800', letterSpacing: 0 },
  heroTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', marginTop: 5 },
  heroText: { color: '#C7C4D7', fontSize: 13, marginTop: 4 },
  heroIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: '#EEE9FF', alignItems: 'center', justifyContent: 'center' },
  searchBox: { height: 48, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, color: palette.text, fontSize: 15, paddingVertical: 0 },
  filters: { gap: 8, paddingVertical: 2 },
  filterChip: { height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 12, flexDirection: 'row', gap: 5, alignItems: 'center' },
  filterChipActive: { borderColor: '#C4B5FD', backgroundColor: ACCENT_TINT },
  filterText: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: ACCENT },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: palette.text },
  resultCount: { color: palette.textMuted, fontSize: 12, fontWeight: '600' },
  shiftCard: { backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, overflow: 'hidden' },
  shiftMain: { flexDirection: 'row', padding: 14, gap: 13 },
  dateTile: { width: 54, height: 68, borderRadius: radius.md, backgroundColor: ACCENT_TINT, alignItems: 'center', justifyContent: 'center' },
  dateTileMonth: { fontSize: 9, color: ACCENT, fontWeight: '800' },
  dateTileDay: { fontSize: 24, color: palette.text, fontWeight: '800', lineHeight: 28 },
  dateTileWeekday: { fontSize: 10, color: palette.textMuted, fontWeight: '600' },
  shiftInfo: { flex: 1, gap: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  orgName: { color: palette.text, fontSize: 15, fontWeight: '800', flex: 1 },
  rate: { color: ACCENT, fontSize: 17, fontWeight: '800' },
  rateUnit: { fontSize: 10, fontWeight: '600' },
  shiftTime: { color: palette.text, fontSize: 13, fontWeight: '600' },
  inlineMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: palette.textMuted, fontSize: 12, flexShrink: 1 },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 3 },
  pill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  pill_success: { backgroundColor: '#D1FAE5' },
  pill_warning: { backgroundColor: '#FEF3C7' },
  pill_accent: { backgroundColor: ACCENT_TINT },
  pill_neutral: { backgroundColor: '#F1F5F9' },
  pillText: { fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  pillText_success: { color: '#047857' },
  pillText_warning: { color: '#B45309' },
  pillText_accent: { color: ACCENT },
  pillText_neutral: { color: palette.textMuted },
  details: { borderTopWidth: 1, borderTopColor: palette.border, marginHorizontal: 14, paddingVertical: 12, gap: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { color: palette.textMuted, fontSize: 12, fontWeight: '600' },
  totalValue: { color: palette.text, fontSize: 18, fontWeight: '800' },
  notes: { color: palette.text, fontSize: 13, lineHeight: 19, backgroundColor: '#F8FAFC', padding: 10, borderRadius: radius.sm },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  requirementText: { color: palette.textMuted, fontSize: 12, flex: 1 },
  cardActions: { borderTopWidth: 1, borderTopColor: palette.border, padding: 10, flexDirection: 'row', gap: 8 },
  iconAction: { width: 42, height: 40, borderRadius: radius.sm, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  primaryAction: { height: 40, borderRadius: radius.sm, backgroundColor: ACCENT, flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  actionDisabled: { backgroundColor: '#A8A3B3' },
  primaryActionText: { color: palette.textInverse, fontSize: 13, fontWeight: '800' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12 },
  calendarSubtitle: { color: palette.textMuted, fontSize: 12, marginTop: 2 },
  refreshButton: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: ACCENT_TINT, alignItems: 'center', justifyContent: 'center' },
  segmented: { height: 40, backgroundColor: '#E9EDF3', borderRadius: radius.sm, padding: 3, flexDirection: 'row', marginBottom: 12 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: palette.surface },
  segmentText: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: ACCENT },
  calendarContent: { paddingBottom: 26, gap: 12 },
  agendaContent: { paddingBottom: 26, gap: 8 },
  calendarCard: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, overflow: 'hidden' },
  dayHeading: { color: palette.text, fontSize: 14, fontWeight: '800', marginTop: 2 },
  noDayEvents: { color: palette.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 22 },
  agendaDate: { color: palette.text, fontSize: 13, fontWeight: '800', marginTop: 7, marginBottom: 2 },
  calendarEvent: { minHeight: 76, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, overflow: 'hidden', paddingRight: 11 },
  eventRail: { width: 5, alignSelf: 'stretch', marginRight: 11 },
  eventCopy: { flex: 1, gap: 2 },
  eventTime: { color: palette.text, fontSize: 13, fontWeight: '800' },
  eventOrg: { color: palette.text, fontSize: 13, fontWeight: '700' },
  bookingContent: { paddingBottom: 26, gap: 10 },
  bookingCard: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 9 },
  bookingDate: { color: palette.textMuted, fontSize: 11, fontWeight: '700', flex: 1 },
  bookingOrg: { color: palette.text, fontSize: 17, fontWeight: '800' },
  bookingFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  clockStatus: { backgroundColor: '#ECFDF5', borderRadius: radius.sm, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  clockText: { color: '#047857', fontSize: 12, fontWeight: '700' },
  bookingActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
  secondaryAction: { height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 13, justifyContent: 'center' },
  secondaryActionText: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
  clockButton: { height: 38, borderRadius: radius.sm, backgroundColor: palette.success, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  clockButtonText: { color: palette.textInverse, fontSize: 12, fontWeight: '800' },
  earningsHero: { backgroundColor: '#17142B', borderRadius: radius.lg, padding: 20 },
  earningsLabel: { color: '#C4B5FD', fontSize: 10, fontWeight: '800' },
  earningsValue: { color: '#FFFFFF', fontSize: 36, fontWeight: '800', marginTop: 5 },
  earningsMeta: { color: '#C7C4D7', fontSize: 12, marginTop: 3 },
  statGrid: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, minHeight: 112, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 13 },
  statIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: ACCENT_TINT, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: palette.text, fontSize: 17, fontWeight: '800', marginTop: 8 },
  statLabel: { color: palette.textMuted, fontSize: 11, marginTop: 2 },
  infoBanner: { flexDirection: 'row', gap: 8, backgroundColor: palette.brandTint, borderRadius: radius.md, padding: 12 },
  infoText: { color: palette.brandDark, fontSize: 12, lineHeight: 17, flex: 1 },
  earningRow: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  earningIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: '#D1FAE5', alignItems: 'center', justifyContent: 'center' },
  earningAmount: { color: palette.text, fontSize: 14, fontWeight: '800' },
  errorBanner: { flexDirection: 'row', gap: 7, backgroundColor: palette.dangerTint, borderRadius: radius.sm, padding: 10, alignItems: 'center' },
  errorText: { color: palette.danger, fontSize: 12, flex: 1 },
  loading: { alignItems: 'center', paddingVertical: 36, gap: 9 },
  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 18 },
  emptyIcon: { width: 50, height: 50, borderRadius: radius.md, backgroundColor: ACCENT_TINT, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  emptyText: { color: palette.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4 },
})