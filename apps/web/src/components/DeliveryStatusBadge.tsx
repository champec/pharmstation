import type { DeliveryRoundStatus, DeliveryPatientStatus } from '@pharmstation/types'

const ROUND_STATUS: Record<DeliveryRoundStatus, { cls: string; label: string }> = {
  draft: { cls: 'ps-badge-slate', label: 'Draft' },
  scheduled: { cls: 'ps-badge-blue', label: 'Scheduled' },
  in_progress: { cls: 'ps-badge-amber', label: 'In Progress' },
  completed: { cls: 'ps-badge-green', label: 'Completed' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
}

const PATIENT_STATUS: Record<DeliveryPatientStatus, { cls: string; label: string }> = {
  pending: { cls: 'ps-badge-slate', label: 'Pending' },
  in_transit: { cls: 'ps-badge-blue', label: 'In Transit' },
  arrived: { cls: 'ps-badge-amber', label: 'Arrived' },
  delivered: { cls: 'ps-badge-green', label: 'Delivered' },
  failed: { cls: 'ps-badge-red', label: 'Failed' },
  pending_redelivery: { cls: 'ps-badge-red', label: 'Redelivery' },
  skipped: { cls: 'ps-badge-slate', label: 'Skipped' },
  moved_to_round: { cls: 'ps-badge-blue', label: 'Moved' },
  returned: { cls: 'ps-badge-slate', label: 'Returned' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
}

interface RoundStatusBadgeProps {
  status: DeliveryRoundStatus
}

export function RoundStatusBadge({ status }: RoundStatusBadgeProps) {
  const badge = ROUND_STATUS[status] || ROUND_STATUS.draft
  return <span className={`ps-badge ${badge.cls}`}>{badge.label}</span>
}

interface PatientStatusBadgeProps {
  status: DeliveryPatientStatus
}

export function PatientStatusBadge({ status }: PatientStatusBadgeProps) {
  const badge = PATIENT_STATUS[status] || PATIENT_STATUS.pending
  return <span className={`ps-badge ${badge.cls}`}>{badge.label}</span>
}
