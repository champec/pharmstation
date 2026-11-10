import { useAuthStore } from '@pharmstation/core'
import { PageHeader } from '../../components/ui'
import { WeeklyTimesheets } from '../../components/locum/WeeklyTimesheets'

export function LocumTimesheetsPage() {
  const { locumProfile } = useAuthStore()
  if (!locumProfile) return null
  return (
    <div className="page-container">
      <PageHeader
        title="Timesheets"
        subtitle="Your completed shifts each week, one sheet per pharmacy. Print or save one as a PDF to send with your invoice."
      />
      <WeeklyTimesheets mode={{ kind: 'locum', locumId: locumProfile.id }} />
    </div>
  )
}
