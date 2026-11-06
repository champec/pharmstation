import { Link } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { WeeklyTimesheets } from '../../components/locum/WeeklyTimesheets'

export function ShiftTimesheetsPage() {
  const { organisation } = useAuthStore()
  if (!organisation?.id) return null
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="breadcrumbs">
          <Link to="/shifts">Shifts</Link>
          <span className="separator">/</span>
          <span>Timesheets</span>
        </div>
        <h1 className="page-title">Locum timesheets</h1>
        <p className="page-subtitle">Completed locum shifts each week, one sheet per locum. Check a locum's invoice against these before paying them.</p>
      </div>
      <WeeklyTimesheets mode={{ kind: 'org', orgId: organisation.id }} />
    </div>
  )
}
