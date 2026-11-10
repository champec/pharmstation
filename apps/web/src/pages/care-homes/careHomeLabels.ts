// Plain-English labels for the care homes module. The database stores short
// codes ("active", "in_transit", "prn"); staff should never see those.

const LABELS: Record<string, Record<string, string>> = {
  linkStatus: { invited: 'Invited', active: 'Active', suspended: 'Paused', ended: 'Ended' },
  residentStatus: { active: 'Active', hospital: 'In hospital', leave: 'On leave', discharged: 'Discharged', deceased: 'Deceased' },
  groupType: { monthly: 'Monthly cycle', acute: 'Acute' },
  groupState: { idle: 'Idle', preparing: 'Preparing', ready: 'Ready', in_transit: 'In transit', delivered: 'Delivered' },
  requestType: { regular: 'Regular', repeat: 'Repeat', acute: 'Acute', query: 'Query', change: 'Change' },
  requestStatus: {
    draft: 'Draft', submitted: 'Submitted', acknowledged: 'Acknowledged', approved: 'Approved', sent_to_gp: 'Sent to GP',
    outstanding: 'Outstanding', received: 'Received', part_received: 'Part received', refused: 'Refused by GP',
    ordered: 'Ordered', ready: 'Ready', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled',
  },
  prescriptionOutcome: { pending: 'Awaiting GP', received: 'Received', part_received: 'Part received', refused: 'Refused by GP', not_required: 'Not required' },
  scheduleType: { regular: 'Regular', repeat: 'Repeat', acute: 'Acute', prn: 'When required (PRN)' },
  scheduleLifecycle: { active: 'Active', stopped: 'Stopped', completed: 'Course complete' },
  marCycleStatus: { draft: 'Draft', prepared: 'Prepared', published: 'Published', archived: 'Archived' },
  marEntryStatus: {
    planned: 'Due', administered: 'Given', refused: 'Refused', omitted: 'Omitted', not_available: 'Not available',
    away: 'Away', self_administered: 'Self-administered',
  },
  noteType: { general: 'General', clinical: 'Clinical', hospital: 'Hospital', incident: 'Incident', medication: 'Medication', communication: 'Communication' },
  supplyScope: { all: 'Regular and acute', regular: 'Regular', acute: 'Acute' },
  batchStatus: {
    draft: 'Draft', packing: 'Packing', ready_for_dispatch: 'Ready for dispatch', dispatched: 'Dispatched',
    delivered: 'Delivered', reconciled: 'Reconciled', cancelled: 'Cancelled',
  },
  packageStatus: { open: 'Open', packed: 'Packed', sealed: 'Sealed', sent: 'Sent', received: 'Received', discrepancy: 'Discrepancy' },
  lineStatus: {
    expected: 'To pack', packed: 'Packed', omitted: 'Omitted', sent: 'Sent', received: 'Received', short: 'Short',
    over: 'Over', damaged: 'Damaged', returned: 'Returned',
  },
  gpRequestStatus: {
    draft: 'Draft', ready_to_send: 'Ready to send', sent_to_gp: 'Sent to GP', partially_received: 'Part received',
    received: 'Received', closed: 'Closed', cancelled: 'Cancelled',
  },
  entityType: {
    ps_care_home_links: 'Care home', ps_care_home_residents: 'Resident', ps_care_home_medication_requests: 'Request',
    ps_care_home_medication_schedules: 'Medicine round', ps_care_home_mar_cycles: 'MAR chart', ps_care_home_mar_entries: 'MAR entry',
    ps_care_home_supply_batches: 'Supply round', ps_care_home_supply_packages: 'Bag', ps_care_home_supply_lines: 'Bag item',
    ps_care_home_units: 'Group', ps_care_home_gp_requests: 'GP request', ps_care_home_resident_notes: 'Note',
    link: 'Care home', resident: 'Resident', request: 'Request', medication_request: 'Request', schedule: 'Medicine round',
    medication_schedule: 'Medicine round', mar_cycle: 'MAR chart', mar_entry: 'MAR entry', supply_batch: 'Supply round',
    supply_package: 'Bag', supply_line: 'Bag item', unit: 'Group', group: 'Group', gp_request: 'GP request', note: 'Note',
  },
  eventType: { insert: 'Created', update: 'Updated', delete: 'Removed', created: 'Created', updated: 'Updated', deleted: 'Removed' },
}

export type CareHomeLabelKind = keyof typeof LABELS

/** Human label for a stored code. Unknown codes are tidied ("in_transit" → "In transit"). */
export function chLabel(kind: CareHomeLabelKind, value: string | null | undefined): string {
  if (!value) return 'Not set'
  const known = LABELS[kind]?.[value]
  if (known) return known
  const text = value.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "9 Nov 2026" from a yyyy-mm-dd date. */
export function chDate(value: string | null | undefined): string {
  if (!value) return 'Not set'
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "9 Nov 2026 to 6 Dec 2026" */
export function chRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return 'Dates not set'
  if (!end) return `${chDate(start)} onwards`
  return `${chDate(start)} to ${chDate(end)}`
}
