import { useEffect, useState } from 'react'
import { usePepsStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { PepsDmdResult, ServiceFormField, ServicePgdRegimen, ServicePrescriptionValue, ServiceSuppliedPack } from '@pharmstation/types'

interface PackResult {
  appid: string
  pack_name: string
  apid: string | null
  vppid: string | null
  quantity: number | null
  quantity_uom_code: string | null
  prescription_charge_code: string | null
  dispensing_fee_code: string | null
  reimbursement_info: string | null
}

interface Config {
  mode?: 'pgd' | 'hybrid' | 'custom'
  allowIpOverride?: boolean
  requirePack?: boolean
  maxItems?: number
  maxPgdItems?: number
  pgdOptions?: ServicePgdRegimen[]
}

function emptyPrescription(basis: ServicePrescriptionValue['prescribing_basis']): ServicePrescriptionValue {
  return {
    prescribing_basis: basis,
    pgd_regimen_id: null,
    clinical_order: {
      dmd_code: null,
      dmd_type: 'free_text',
      manual_entry: false,
      drug_name: '',
      dose: '',
      frequency: '',
      duration: '',
      quantity: null,
      unit: 'units',
    },
    supplied_pack: null,
  }
}

function normalize(value: unknown): ServicePrescriptionValue[] {
  if (Array.isArray(value)) return value as ServicePrescriptionValue[]
  if (value && typeof value === 'object' && 'clinical_order' in value) return [value as ServicePrescriptionValue]
  return []
}

function MedicineEditor({ item, requirePack, onChange, onRemove }: {
  item: ServicePrescriptionValue
  requirePack: boolean
  onChange: (item: ServicePrescriptionValue) => void
  onRemove: () => void
}) {
  const { searchDmd } = usePepsStore()
  const [medicineQuery, setMedicineQuery] = useState('')
  const [medicineResults, setMedicineResults] = useState<PepsDmdResult[]>([])
  const [packQuery, setPackQuery] = useState('')
  const [packResults, setPackResults] = useState<PackResult[]>([])

  useEffect(() => {
    if (item.clinical_order.manual_entry || medicineQuery.trim().length < 2) {
      setMedicineResults([])
      return
    }
    let current = true
    const timer = setTimeout(() => searchDmd(medicineQuery).then((results) => current && setMedicineResults(results)), 250)
    return () => { current = false; clearTimeout(timer) }
  }, [item.clinical_order.manual_entry, medicineQuery, searchDmd])

  useEffect(() => {
    if (packQuery.trim().length < 2) {
      setPackResults([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      getUserClient().rpc('ps_service_dmd_pack_search', { p_query: packQuery.trim() }).then(({ data, error }) => {
        if (current) setPackResults(error ? [] : (data as PackResult[] ?? []))
      })
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [packQuery])

  const updateOrder = (patch: Partial<ServicePrescriptionValue['clinical_order']>) => {
    onChange({ ...item, clinical_order: { ...item.clinical_order, ...patch } })
  }

  const selectMedicine = (medicine: PepsDmdResult) => {
    updateOrder({ dmd_code: medicine.code, dmd_type: medicine.dmd_type, manual_entry: false, drug_name: medicine.name })
    setMedicineQuery('')
    setMedicineResults([])
    setPackQuery(medicine.name)
  }

  const selectPack = (pack: PackResult) => {
    const suppliedPack: ServiceSuppliedPack = {
      appid: pack.appid,
      pack_name: pack.pack_name,
      apid: pack.apid,
      vppid: pack.vppid,
      pack_quantity: pack.quantity,
      quantity_uom_code: pack.quantity_uom_code,
      packs_supplied: 1,
      prescription_charge_code: pack.prescription_charge_code,
      dispensing_fee_code: pack.dispensing_fee_code,
      reimbursement_info: pack.reimbursement_info,
    }
    onChange({ ...item, supplied_pack: suppliedPack })
    setPackQuery('')
    setPackResults([])
  }

  const constrained = item.prescribing_basis === 'pgd'

  return (
    <div className="service-prescribing-item">
      <div className="service-prescribing-item-heading">
        <div>
          <strong>{item.clinical_order.drug_name || 'New medicine'}</strong>
          {item.clinical_order.manual_entry && <span className="ps-badge">Manual entry</span>}
          {constrained && <span className="ps-badge ps-badge-blue">PGD</span>}
        </div>
        <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={onRemove}>Remove</button>
      </div>

      {!constrained && (
        <>
          <label className="service-manual-toggle">
            <input
              type="checkbox"
              checked={item.clinical_order.manual_entry}
              onChange={(event) => updateOrder({ dmd_code: null, dmd_type: 'free_text', manual_entry: event.target.checked, drug_name: '' })}
            />
            Enter this medicine manually
          </label>
          {item.clinical_order.manual_entry ? (
            <label>Medicine name<input className="ps-input" value={item.clinical_order.drug_name} onChange={(event) => updateOrder({ drug_name: event.target.value })} placeholder="Type the medicine exactly as prescribed" /></label>
          ) : item.clinical_order.drug_name ? (
            <div className="service-prescribing-selection"><div><strong>{item.clinical_order.drug_name}</strong><small>dm+d {item.clinical_order.dmd_type.toUpperCase()} {item.clinical_order.dmd_code}</small></div><button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => updateOrder({ dmd_code: null, dmd_type: 'free_text', drug_name: '' })}>Change</button></div>
          ) : (
            <div className="service-prescribing-search-box"><input className="ps-input" value={medicineQuery} onChange={(event) => setMedicineQuery(event.target.value)} placeholder="Search dm+d medicine" />{medicineQuery.length >= 2 && <div className="service-prescribing-results">{medicineResults.map((medicine) => <button type="button" key={`${medicine.dmd_type}-${medicine.code}`} onClick={() => selectMedicine(medicine)}><strong>{medicine.name}</strong><span>{medicine.dmd_type.toUpperCase()} · {medicine.code}</span></button>)}{medicineResults.length === 0 && <p>No match yet. Keep typing or choose manual entry.</p>}</div>}</div>
          )}
        </>
      )}

      {item.clinical_order.drug_name && (
        <>
          <div className="service-regimen-grid">
            <label>Dose<input className="ps-input" readOnly={constrained} value={item.clinical_order.dose} onChange={(event) => updateOrder({ dose: event.target.value })} /></label>
            <label>Frequency<input className="ps-input" readOnly={constrained} value={item.clinical_order.frequency} onChange={(event) => updateOrder({ frequency: event.target.value })} /></label>
            <label>Duration<input className="ps-input" readOnly={constrained} value={item.clinical_order.duration} onChange={(event) => updateOrder({ duration: event.target.value })} /></label>
            <label>Quantity<input className="ps-input" readOnly={constrained} type="number" min="0" value={item.clinical_order.quantity ?? ''} onChange={(event) => updateOrder({ quantity: event.target.value ? Number(event.target.value) : null })} /></label>
            <label>Unit<input className="ps-input" readOnly={constrained} value={item.clinical_order.unit} onChange={(event) => updateOrder({ unit: event.target.value })} /></label>
          </div>
          <div className="service-pack-picker">
            <label>Exact pack supplied {requirePack && <span className="required-mark">*</span>}</label>
            {item.supplied_pack ? (
              <div className="service-prescribing-selection"><div><strong>{item.supplied_pack.pack_name}</strong><small>dm+d AMPP {item.supplied_pack.appid}</small></div><label className="service-pack-count">Packs<input className="ps-input" type="number" min="1" value={item.supplied_pack.packs_supplied} onChange={(event) => onChange({ ...item, supplied_pack: { ...item.supplied_pack!, packs_supplied: Math.max(1, Number(event.target.value) || 1) } })} /></label><button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => onChange({ ...item, supplied_pack: null })}>Change</button></div>
            ) : (
              <div className="service-prescribing-search-box"><input className="ps-input" value={packQuery} onChange={(event) => setPackQuery(event.target.value)} placeholder="Search exact pack supplied" />{packQuery.length >= 2 && <div className="service-prescribing-results">{packResults.map((pack) => <button type="button" key={pack.appid} onClick={() => selectPack(pack)}><strong>{pack.pack_name}</strong><span>AMPP {pack.appid}{pack.quantity != null && ` · Pack ${pack.quantity}`}</span></button>)}</div>}</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function ServicePrescribingField({ field, value, onChange }: {
  field: ServiceFormField
  value: unknown
  onChange: (value: ServicePrescriptionValue[]) => void
}) {
  const config = (!Array.isArray(field.options) && field.options ? field.options : {}) as Config
  const items = normalize(value)
  const pgdOptions = Array.isArray(config.pgdOptions) ? config.pgdOptions : []
  const [ipMode, setIpMode] = useState(config.mode === 'custom' || items.some((item) => item.prescribing_basis === 'independent_prescriber'))
  const openMode = config.mode === 'custom' || ipMode
  const maxItems = typeof config.maxItems === 'number' ? config.maxItems : 0
  const canAdd = maxItems === 0 || items.length < maxItems
  const pgdItemCount = items.filter((item) => item.prescribing_basis === 'pgd').length
  const maxPgdItems = typeof config.maxPgdItems === 'number' ? config.maxPgdItems : 1
  const canAddPgd = canAdd && (maxPgdItems === 0 || pgdItemCount < maxPgdItems)

  const addOpenItem = () => {
    if (!canAdd) return
    onChange([...items, emptyPrescription(config.mode === 'custom' ? 'custom' : 'independent_prescriber')])
  }

  const addRegimen = (regimen: ServicePgdRegimen) => {
    if (!canAddPgd) return
    const next = emptyPrescription('pgd')
    next.pgd_regimen_id = regimen.id
    next.clinical_order = {
      dmd_code: regimen.dmd_code ?? null,
      dmd_type: regimen.dmd_type ?? 'free_text',
      manual_entry: false,
      drug_name: regimen.drug_name,
      dose: regimen.dose,
      frequency: regimen.frequency,
      duration: regimen.duration,
      quantity: regimen.quantity,
      unit: regimen.unit,
    }
    onChange([...items, next])
  }

  return (
    <div className="form-group service-prescribing-field">
      <div className="service-prescribing-heading">
        <label>{field.label}{field.is_required && <span className="required-mark">*</span>}</label>
        {(config.mode === 'hybrid' || config.allowIpOverride) && <label className="service-prescribing-ip-toggle"><input type="checkbox" checked={ipMode} onChange={(event) => setIpMode(event.target.checked)} />Independent prescriber</label>}
      </div>
      {!openMode && <div className="service-pgd-options">{pgdOptions.map((regimen) => <button type="button" key={regimen.id} disabled={!canAddPgd} onClick={() => addRegimen(regimen)}><strong>{regimen.label}</strong><span>{[regimen.dose, regimen.frequency, regimen.duration].join(' · ')}</span></button>)}</div>}
      <div className="service-prescribing-list">
        {items.map((item, index) => <MedicineEditor key={`${item.pgd_regimen_id || item.clinical_order.dmd_code || 'medicine'}-${index}`} item={item} requirePack={config.requirePack === true} onChange={(updated) => onChange(items.map((current, itemIndex) => itemIndex === index ? updated : current))} onRemove={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} />)}
      </div>
      {openMode && canAdd && <button type="button" className="ps-btn ps-btn-secondary ps-btn-sm" onClick={addOpenItem}>+ Add medicine</button>}
      {items.length === 0 && openMode && <p className="service-prescribing-empty">No medicines added.</p>}
    </div>
  )
}