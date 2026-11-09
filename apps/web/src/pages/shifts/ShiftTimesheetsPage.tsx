import { useAuthStore } from '@pharmstation/core'
import { PageHeader } from '../../components/ui'
import { WeeklyTimesheets } from '../../components/locum/WeeklyTimesheets'

export function ShiftTimesheetsPage() {
  const { organisation } = useAuthStore()
  if (!organisation?.id) return null
  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={[{ label: 'Shifts', to: '/shifts' }, { label: 'Timesheets' }]}
        title="Locum timesheets"
        subtitle="Completed locum shifts each week, one sheet per locum. Check a locum's invoice against these before paying them."
      />
      <WeeklyTimesheets mode={{ kind: 'org', orgId: organisation.id }} />
    </div>
  )
}
