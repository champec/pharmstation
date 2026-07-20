import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeSupplyLine } from '@pharmstation/types'

function total(lines: CareHomeSupplyLine[], field: 'quantity_expected' | 'quantity_packed' | 'quantity_sent' | 'quantity_received') {
  return lines.reduce((sum, line) => sum + (line[field] ?? 0), 0)
}

function SupplyLineEditor({ line, mode, saving, onSave }: {
  line: CareHomeSupplyLine
  mode: 'pack' | 'receive' | 'read'
  saving: boolean
  onSave: (quantity: number, notes?: string) => void
}) {
  const initialQuantity = mode === 'receive' ? line.quantity_received ?? line.quantity_sent : line.quantity_packed || line.quantity_expected
  const [quantity, setQuantity] = useState(String(initialQuantity))
  const [notes, setNotes] = useState(mode === 'pack' ? line.omission_reason ?? '' : line.discrepancy_notes ?? '')
  const needsNotes = Number(quantity) === 0 && mode === 'pack'
  const isMismatch = mode === 'receive' && Number(quantity) !== line.quantity_sent

  return (
    <div className="care-home-supply-line">
      <div className="care-home-supply-medicine"><span className={`ps-badge ${line.supply_type === 'acute' ? 'ps-badge-danger' : 'ps-badge-blue'}`}>{line.supply_type}</span><strong>{line.medicine_name}</strong><small>{[line.strength, line.form, line.dose].filter(Boolean).join(' · ')}</small></div>
      <div className="care-home-supply-quantities"><span><small>Expected</small><strong>{line.quantity_expected}</strong></span><span><small>Packed</small><strong>{line.quantity_packed}</strong></span><span><small>Sent</small><strong>{line.quantity_sent}</strong></span><span className={line.quantity_received !== null && line.quantity_received !== line.quantity_sent ? 'mismatch' : ''}><small>Received</small><strong>{line.quantity_received ?? '-'}</strong></span></div>
      {mode !== 'read' ? <div className="care-home-supply-edit"><label>{mode === 'pack' ? 'Pack quantity' : 'Received quantity'}<input className="ps-input" type="number" min="0" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>{needsNotes ? 'Omission reason' : isMismatch ? 'Discrepancy notes' : 'Notes'}<input className="ps-input" required={needsNotes} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button className="ps-btn ps-btn-primary ps-btn-sm" type="button" disabled={saving || !quantity || (needsNotes && !notes.trim())} onClick={() => onSave(Number(quantity), notes)}>Save</button></div> : <div className="care-home-supply-result"><span className={`ps-badge ${['received', 'packed', 'sent'].includes(line.line_status) ? 'ps-badge-success' : ['short', 'over', 'damaged', 'omitted'].includes(line.line_status) ? 'ps-badge-danger' : 'ps-badge-muted'}`}>{line.line_status}</span>{line.omission_reason && <small>{line.omission_reason}</small>}{line.discrepancy_notes && <small>{line.discrepancy_notes}</small>}</div>}
    </div>
  )
}

export function CareHomeSupplyBatchPage() {
  const navigate = useNavigate()
  const { linkId, batchId } = useParams<{ linkId: string; batchId: string }>()
  const { organisation, permissions } = useAuthStore()
  const { activeSupplyBatch: batch, loading, saving, error, fetchSupplyBatch, packSupplyLine, receiveSupplyLine, generateDeliveryRound, markGroupReady, clearError, groups } = useCareHomeStore()
  const isCareHome = organisation?.organisation_type === 'carehome'
  const canPack = !isCareHome && permissions?.care_home_medications === true
  const group = batch?.group_id ? groups.find((item) => item.id === batch.group_id) ?? null : null
  const packages = batch?.packages ?? []
  const lines = useMemo(() => packages.flatMap((item) => item.lines ?? []), [packages])
  const unresolved = lines.filter((line) => line.line_status === 'expected').length
  const omitted = lines.filter((line) => line.line_status === 'omitted').length
  const discrepancies = lines.filter((line) => ['short', 'over', 'damaged'].includes(line.line_status)).length
  const receiptMode = isCareHome && ['dispatched', 'delivered', 'reconciled'].includes(batch?.status ?? '')

  useEffect(() => {
    if (batchId) void fetchSupplyBatch(batchId)
  }, [batchId, fetchSupplyBatch])

  const handleGenerateRoute = async () => {
    if (!batchId) return
    if (batch.group_id) {
      await markGroupReady(batch.group_id)
      navigate(`/care-homes/${linkId}/groups/${batch.group_id}`)
      return
    }
    const roundId = await generateDeliveryRound(batchId)
    navigate(`/deliveries/${roundId}`)
  }

  if (loading && !batch) return <div className="care-home-loading">Loading medicine supply batch...</div>
  if (!batch || batch.id !== batchId) return <div className="care-home-inline-empty">Supply batch not found.</div>

  return (
    <div className="care-home-page care-home-supply-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs"><a href="/care-homes" onClick={(event) => { event.preventDefault(); navigate('/care-homes') }}>Care homes</a>{group && <><span className="separator">/</span><a href={`/care-homes/${linkId}/groups/${group.id}`} onClick={(event) => { event.preventDefault(); navigate(`/care-homes/${linkId}/groups/${group.id}`) }}>{group.name}</a></>}<span className="separator">/</span><span>Round #{batch.batch_number}</span></div>
        <div className="care-home-title-row"><div><p className="care-home-eyebrow">Round review{group ? ` · ${group.name}` : ''}</p><h1>{batch.title}</h1><p className="care-home-subtitle">{batch.supply_scope === 'all' ? 'Regular and acute medicines' : `${batch.supply_scope[0].toUpperCase()}${batch.supply_scope.slice(1)} medicines`} · {batch.period_start} to {batch.period_end}</p></div><div className="care-home-heading-actions">{group && <button className="ps-btn ps-btn-ghost" type="button" onClick={() => navigate(`/care-homes/${linkId}/groups/${group.id}`)}>← Back to round</button>}<span className={`ps-badge ${batch.status === 'reconciled' ? 'ps-badge-success' : discrepancies > 0 ? 'ps-badge-danger' : 'ps-badge-warning'}`}>{batch.status.replaceAll('_', ' ')}</span>{batch.delivery_round_id ? <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/deliveries/${batch.delivery_round_id}`)}>Open delivery</button> : canPack && <button className="ps-btn ps-btn-primary" type="button" disabled={saving || unresolved > 0} onClick={() => void handleGenerateRoute()}>{group ? 'Mark ready & generate run' : 'Generate delivery round'}</button>}</div></div>
      </div>

      {error && <div className="auth-error care-home-alert" role="alert"><span>{error}</span><button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button></div>}

      <div className="care-home-metrics care-home-supply-metrics"><article><span>Resident packages</span><strong>{packages.length}</strong><small>grouped by unit and room</small></article><article><span>Expected items</span><strong>{total(lines, 'quantity_expected')}</strong><small>{lines.length} medicine lines</small></article><article><span>Packed / sent</span><strong>{total(lines, 'quantity_packed')} / {total(lines, 'quantity_sent')}</strong><small>{unresolved} lines not resolved</small></article><article><span>Received</span><strong>{total(lines, 'quantity_received')}</strong><small>{omitted} omitted · {discrepancies} discrepancies</small></article></div>

      <div className="care-home-reconciliation-key"><span><i className="expected" /> Expected: active medicines due in this supply period</span><span><i className="packed" /> Packed: pharmacy-confirmed contents</span><span><i className="received" /> Received: care-home-confirmed contents</span></div>

      {packages.map((carePackage) => {
        const packageLines = carePackage.lines ?? []
        return <section className="care-home-package" key={carePackage.id}><header><div><p>{carePackage.unit?.floor_name || 'Floor not set'} · {carePackage.unit?.name || 'Unit unassigned'}</p><h2>{carePackage.package_label}</h2></div><div><span className={`ps-badge ${carePackage.package_status === 'discrepancy' ? 'ps-badge-danger' : carePackage.package_status === 'received' ? 'ps-badge-success' : 'ps-badge-blue'}`}>{carePackage.package_status}</span><small>{packageLines.length} medicines · Expected {total(packageLines, 'quantity_expected')}</small></div></header><div>{packageLines.map((line) => <SupplyLineEditor key={line.id} line={line} mode={canPack && !batch.delivery_round_id ? 'pack' : receiptMode ? 'receive' : 'read'} saving={saving} onSave={(quantity, notes) => canPack && !batch.delivery_round_id ? void packSupplyLine(line.id, quantity, notes) : void receiveSupplyLine(line.id, quantity, notes)} />)}</div></section>
      })}

      {packages.length === 0 && <div className="care-home-inline-empty">This batch has no resident packages.</div>}

      <section className="care-home-batch-exceptions"><div className="care-home-section-heading"><div><p>Exception report</p><h2>Missing, omitted and mismatched medicines</h2></div></div>{lines.filter((line) => ['omitted', 'short', 'over', 'damaged'].includes(line.line_status)).length === 0 ? <div className="care-home-inline-empty">No omissions or receipt discrepancies are recorded.</div> : <div className="care-home-table-wrap"><table className="care-home-table"><thead><tr><th>Medicine</th><th>Type</th><th>Expected</th><th>Packed</th><th>Sent</th><th>Received</th><th>Reason</th></tr></thead><tbody>{lines.filter((line) => ['omitted', 'short', 'over', 'damaged'].includes(line.line_status)).map((line) => <tr key={line.id}><td><strong>{line.medicine_name}</strong></td><td>{line.supply_type}</td><td>{line.quantity_expected}</td><td>{line.quantity_packed}</td><td>{line.quantity_sent}</td><td>{line.quantity_received ?? '-'}</td><td>{line.omission_reason || line.discrepancy_notes || line.line_status}</td></tr>)}</tbody></table></div>}</section>
    </div>
  )
}