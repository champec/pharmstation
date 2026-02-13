import { useUIStore } from '@pharmstation/core'

export function RightPanel() {
  const { rightPanelContent, closeRightPanel } = useUIStore()

  return (
    <>
      <div className="right-panel-backdrop" onClick={closeRightPanel} />
      <div className="right-panel">
        <div className="right-panel-header">
          <h2>{rightPanelContent ?? 'Panel'}</h2>
          <button className="ps-btn ps-btn-ghost" onClick={closeRightPanel}>
            ✕
          </button>
        </div>
        <div className="right-panel-body">
          {/* Content rendered based on rightPanelContent */}
          <p style={{ color: 'var(--ps-slate)' }}>Panel content will appear here.</p>
        </div>
      </div>
    </>
  )
}
