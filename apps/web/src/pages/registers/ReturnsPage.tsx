export function ReturnsPage() {
  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/">Dashboard</a>
          <span className="separator">/</span>
          <span>Registers</span>
          <span className="separator">/</span>
          <span>Returns</span>
        </div>
        <h1>↩ Patient Returns</h1>
      </div>

      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
        <p style={{ color: 'var(--ps-slate)' }}>
          Patient CD returns register will be built here.
          Features: return recording, disposal tracking, witness signatures.
        </p>
      </div>
    </div>
  )
}
