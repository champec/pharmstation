export function RPLogPage() {
  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/">Dashboard</a>
          <span className="separator">/</span>
          <span>Registers</span>
          <span className="separator">/</span>
          <span>RP Log</span>
        </div>
        <h1>👤 RP Log</h1>
      </div>

      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
        <p style={{ color: 'var(--ps-slate)' }}>
          The Responsible Pharmacist log will be built here with TanStack Table.
          Features: sign-in/sign-out tracking, pharmacist details, inline entry.
        </p>
      </div>
    </div>
  )
}
