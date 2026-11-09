import { useAuthStore } from '@pharmstation/core'
import { WeeklyTimesheets } from '../../components/locum/WeeklyTimesheets'

export function LocumTimesheetsPage() {
  const { locumProfile } = useAuthStore()
  if (!locumProfile) return null
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Timesheets</h1>
        <p className="page-subtitle">Your completed shifts each week, one sheet per pharmacy. Print or save one as a PDF to send with your invoice.</p>
      </div>
      <WeeklyTimesheets mode={{ kind: 'locum', locumId: locumProfile.id }} />
    </div>
  )
}
