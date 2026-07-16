import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, usePepsStore, useAppointmentStore } from '@pharmstation/core'
import type {
  Patient,
  PepsOrg,
  PepsDmdResult,
  PepsPrescriptionItem,
  PepsPrescriptionType,
} from '@pharmstation/types'
import { Autocomplete } from '../../components/forms/Autocomplete'
import { Modal } from '../../components/Modal'

interface DraftItem {
  key: string
  drug_name: string
  dmd_code: string | null
  dmd_type: 'vmp' | 'amp' | 'free_text'
  quantity: string
  dosage: string
}

function newItem(): DraftItem {
  return { key: Math.random().toString(36).slice(2), drug_name: '', dmd_code: null, dmd_type: 'free_text', quantity: '', dosage: '' }
}

export function PEPSWritePage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    myPrescriber, prescriberLoaded, fetchMyPrescriber,
    searchPepsOrgs, createPepsOrg, searchDmd, searchPatients,
    searchPharmacies, createPrescription,
  } = usePepsStore()
  const { createPatient } = useAppointmentStore()

  // Patient
  const [patientText, setPatientText] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [npFirst, setNpFirst] = useState('')
  const [npLast, setNpLast] = useState('')
  const [npDob, setNpDob] = useState('')
  const [npNhs, setNpNhs] = useState('')
  const [npAddr, setNpAddr] = useState('')
  const [npError, setNpError] = useState<string | null>(null)

  // Prescribing org
  const [orgText, setOrgText] = useState('')
  const [prescribingOrg, setPrescribingOrg] = useState<PepsOrg | null>(null)
  const [showNewOrg, setShowNewOrg] = useState(false)
  const [noName, setNoName] = useState('')
  const [noOds, setNoOds] = useState('')
  const [noAddr1, setNoAddr1] = useState('')
  const [noCity, setNoCity] = useState('')
  const [noPostcode, setNoPostcode] = useState('')

  // Clinical
  const [type, setType] = useState<PepsPrescriptionType>('private')
  const [animalName, setAnimalName] = useState('')
  const [animalOwner, setAnimalOwner] = useState('')
  const [useCascade, setUseCascade] = useState(false)
  const [repeats, setRepeats] = useState(0)
  const [items, setItems] = useState<DraftItem[]>([newItem()])

  // Send
  const [showPreview, setShowPreview] = useState(false)
  const [route, setRoute] = useState<'spine' | 'pharmacy'>('spine')
  const [pharmacyText, setPharmacyText] = useState('')
  const [targetPharmacy, setTargetPharmacy] = useState<{ id: string; name: string; ods_code: string | null } | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const CASCADE_TEXT =
    'Prescribed under the veterinary cascade. For administration to the animal(s) under my care.'

  useEffect(() => { fetchMyPrescriber() }, [fetchMyPrescriber])

  // Prefill prescribing org with the logged-in organisation's name
  useEffect(() => {
    if (organisation?.name && !orgText) setOrgText(organisation.name)
  }, [organisation]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddNewPatient = useCallback(async () => {
    setNpError(null)
    if (!npFirst.trim() || !npLast.trim()) {
      setNpError('First and last name are required.')
      return
    }
    if (!organisation?.id) return
    try {
      const created = await createPatient({
        organisation_id: organisation.id,
        first_name: npFirst.trim(),
        last_name: npLast.trim(),
        dob: npDob || null,
        nhs_number: npNhs.trim() || null,
        address_line_1: npAddr.trim() || null,
      })
      setPatient(created)
      setPatientText(`${created.first_name} ${created.last_name}`)
      setShowNewPatient(false)
    } catch (e: any) {
      setNpError(
        e.message?.includes('unique') || e.message?.includes('duplicate')
          ? 'A patient with that NHS number already exists in this organisation. Search for them instead.'
          : e.message,
      )
    }
  }, [npFirst, npLast, npDob, npNhs, npAddr, organisation, createPatient])

  const handleCreateOrg = useCallback(async () => {
    if (!noName.trim()) return
    try {
      const created = await createPepsOrg(
        {
          name: noName.trim(),
          ods_code: noOds.trim() || null,
          address_line_1: noAddr1.trim() || null,
          city: noCity.trim() || null,
          postcode: noPostcode.trim() || null,
        },
        organisation?.id ?? null,
      )
      setPrescribingOrg(created)
      setOrgText(created.name)
      setShowNewOrg(false)
    } catch (e: any) {
      setError(e.message)
    }
  }, [noName, noOds, noAddr1, noCity, noPostcode, organisation, createPepsOrg])

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }
  const removeItem = (key: string) => setItems((prev) => prev.filter((it) => it.key !== key))

  const validForPreview = () => {
    if (!myPrescriber || myPrescriber.status !== 'active') return false
    if (!patientText.trim()) return false
    const filled = items.filter((it) => it.drug_name.trim() && it.quantity.trim())
    if (filled.length === 0) return false
    if (type === 'vet' && !animalName.trim()) return false
    return true
  }

  const handleSend = async () => {
    setError(null)
    if (!myPrescriber) return
    if (route === 'pharmacy' && !targetPharmacy) {
      setError('Select a pharmacy to send to, or choose the spine.')
      return
    }
    setSending(true)
    try {
      const patientSnapshot = patient
        ? {
            full_name: `${patient.first_name} ${patient.last_name}`,
            first_name: patient.first_name,
            last_name: patient.last_name,
            dob: patient.dob,
            nhs_number: patient.nhs_number,
            address: [patient.address_line_1, patient.city, patient.postcode].filter(Boolean).join(', ') || null,
          }
        : { full_name: patientText.trim() }

      const orgSnapshot = prescribingOrg
        ? {
            name: prescribingOrg.name,
            ods_code: prescribingOrg.ods_code,
            address: [prescribingOrg.address_line_1, prescribingOrg.city, prescribingOrg.postcode].filter(Boolean).join(', ') || null,
          }
        : { name: orgText.trim() || undefined }

      const rx = await createPrescription({
        prescriber: myPrescriber,
        origin_org_id: organisation?.id ?? null,
        patient_id: patient?.id ?? null,
        patient_snapshot: patientSnapshot,
        prescribing_org_id: prescribingOrg?.id ?? null,
        prescribing_org_snapshot: orgSnapshot,
        prescription_type: type,
        animal_name: type === 'vet' ? animalName.trim() || null : null,
        animal_owner: type === 'vet' ? animalOwner.trim() || null : null,
        cascade_wording: type === 'vet' && useCascade ? CASCADE_TEXT : null,
        repeats,
        signature_data: myPrescriber.signature_data,
        items: items
          .filter((it) => it.drug_name.trim() && it.quantity.trim())
          .map<Partial<PepsPrescriptionItem>>((it) => ({
            drug_name: it.drug_name.trim(),
            dmd_code: it.dmd_code,
            dmd_type: it.dmd_type,
            quantity: it.quantity.trim(),
            dosage: it.dosage.trim() || null,
          })),
        assigned_org_id: route === 'pharmacy' ? targetPharmacy!.id : null,
      })
      navigate(`/peps/${rx.id}`)
    } catch (e: any) {
      setError(e.message)
      setSending(false)
    }
  }

  if (!prescriberLoaded) return <div style={{ padding: 'var(--ps-space-lg)' }}>Loading…</div>

  if (!myPrescriber || myPrescriber.status !== 'active') {
    return (
      <div>
        <div className="page-header">
          <h1>✍️ Write Prescription</h1>
        </div>
        <div className="ps-card" style={{ maxWidth: 560 }}>
          <p style={{ marginTop: 0 }}>
            {!myPrescriber
              ? 'You need to register as a prescriber before you can write private prescriptions.'
              : 'Your prescriber account is not active yet.'}
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/peps/prescriber')}>
            Go to Prescriber Setup →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/peps" onClick={(e) => { e.preventDefault(); navigate('/peps') }}>PEPS</a>
          <span className="separator">/</span>
          <span>Write Prescription</span>
        </div>
        <h1>✍️ Write Prescription</h1>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div className="ps-card" style={{ maxWidth: 820 }}>
        {/* Prescriber */}
        <div className="form-group">
          <label>Prescriber</label>
          <div style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)' }}>
            <strong>{myPrescriber.full_name}</strong>{' '}
            <span style={{ color: 'var(--ps-slate)' }}>
              · {myPrescriber.registration_body || ''} {myPrescriber.registration_number}
            </span>
          </div>
        </div>

        {/* Patient */}
        <div className="form-group">
          <label>Patient *</label>
          <Autocomplete<Patient>
            value={patientText}
            onChange={(t) => { setPatientText(t); setPatient(null) }}
            onSearch={(q) => searchPatients(organisation!.id, q)}
            onSelect={(p) => { setPatient(p); setPatientText(`${p.first_name} ${p.last_name}`) }}
            getKey={(p) => p.id}
            getLabel={(p) => `${p.first_name} ${p.last_name}`}
            getDetail={(p) => [p.dob, p.nhs_number].filter(Boolean).join(' · ') || null}
            placeholder="Search existing patients by name or NHS number…"
            addNewLabel="Add new patient"
            onAddNew={(text) => {
              const parts = text.trim().split(/\s+/)
              setNpFirst(parts[0] ?? '')
              setNpLast(parts.slice(1).join(' '))
              setShowNewPatient(true)
            }}
          />
          {patient && (
            <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', margin: '4px 0 0' }}>
              Linked to patient record · {patient.nhs_number ?? 'no NHS number'}
            </p>
          )}
        </div>

        {/* Prescribing organisation */}
        <div className="form-group">
          <label>Prescribing organisation</label>
          <Autocomplete<PepsOrg>
            value={orgText}
            onChange={(t) => { setOrgText(t); setPrescribingOrg(null) }}
            onSearch={(q) => searchPepsOrgs(q, organisation?.id ?? null)}
            onSelect={(o) => { setPrescribingOrg(o); setOrgText(o.name) }}
            getKey={(o) => o.id}
            getLabel={(o) => o.name}
            getDetail={(o) => o.ods_code ? `ODS ${o.ods_code}` : (o.is_global ? 'global' : 'private')}
            placeholder="Clinic / practice name…"
            addNewLabel="Add new organisation"
            onAddNew={(text) => { setNoName(text); setShowNewOrg(true) }}
          />
          <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', margin: '4px 0 0' }}>
            Organisations with an ODS code are shared globally; those without are private to your pharmacy.
          </p>
        </div>

        {/* Type + repeats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--ps-space-md)' }}>
          <div className="form-group">
            <label>Type</label>
            <select className="ps-input" value={type} onChange={(e) => setType(e.target.value as PepsPrescriptionType)}>
              <option value="private">Private (human)</option>
              <option value="vet">Veterinary</option>
            </select>
          </div>
          <div className="form-group">
            <label>Repeats</label>
            <select className="ps-input" value={repeats} onChange={(e) => setRepeats(Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'No repeat' : `${n} repeat${n > 1 ? 's' : ''}`}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Date</label>
            <input className="ps-input" value={today} disabled />
          </div>
        </div>

        {type === 'vet' && (
          <div style={{ padding: 'var(--ps-space-md)', background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-md)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Animal name *</label>
                <input className="ps-input" value={animalName} onChange={(e) => setAnimalName(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Owner</label>
                <input className="ps-input" value={animalOwner} onChange={(e) => setAnimalOwner(e.target.value)} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
              <input type="checkbox" checked={useCascade} onChange={(e) => setUseCascade(e.target.checked)} />
              Prescribed under the veterinary cascade
            </label>
          </div>
        )}

        {/* Drug lines */}
        <div className="form-group">
          <label>Medication *</label>
          <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', margin: '0 0 8px' }}>
            Drugs are searched from the dm+d dictionary. Controlled drugs are excluded — they require a specific form.
          </p>
          {items.map((it) => (
            <div key={it.key} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr auto', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-sm)', alignItems: 'start' }}>
              <Autocomplete<PepsDmdResult>
                value={it.drug_name}
                onChange={(t) => updateItem(it.key, { drug_name: t, dmd_code: null, dmd_type: 'free_text' })}
                onSearch={searchDmd}
                onSelect={(d) => updateItem(it.key, { drug_name: d.name, dmd_code: d.code, dmd_type: d.dmd_type })}
                getKey={(d) => d.code}
                getLabel={(d) => d.name}
                getDetail={(d) => d.dmd_type.toUpperCase()}
                placeholder="Drug name & strength…"
              />
              <input className="ps-input" placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(it.key, { quantity: e.target.value })} />
              <input className="ps-input" placeholder="Dosage / directions" value={it.dosage} onChange={(e) => updateItem(it.key, { dosage: e.target.value })} />
              <button className="ps-btn ps-btn-ghost" onClick={() => removeItem(it.key)} disabled={items.length === 1} title="Remove">✕</button>
            </div>
          ))}
          <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => setItems((p) => [...p, newItem()])}>＋ Add medication</button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-md)' }}>
          <button className="ps-btn ps-btn-primary" disabled={!validForPreview()} onClick={() => setShowPreview(true)}>
            Preview & sign →
          </button>
        </div>
      </div>

      {/* New patient modal */}
      <Modal isOpen={showNewPatient} onClose={() => setShowNewPatient(false)} title="Add new patient">
        {npError && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{npError}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
          <div className="form-group"><label>First name *</label><input className="ps-input" value={npFirst} onChange={(e) => setNpFirst(e.target.value)} /></div>
          <div className="form-group"><label>Last name *</label><input className="ps-input" value={npLast} onChange={(e) => setNpLast(e.target.value)} /></div>
          <div className="form-group"><label>Date of birth</label><input className="ps-input" type="date" value={npDob} onChange={(e) => setNpDob(e.target.value)} /></div>
          <div className="form-group"><label>NHS number</label><input className="ps-input" value={npNhs} onChange={(e) => setNpNhs(e.target.value)} /></div>
        </div>
        <div className="form-group"><label>Address</label><input className="ps-input" value={npAddr} onChange={(e) => setNpAddr(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowNewPatient(false)}>Cancel</button>
          <button className="ps-btn ps-btn-primary" onClick={handleAddNewPatient}>Add patient</button>
        </div>
      </Modal>

      {/* New org modal */}
      <Modal isOpen={showNewOrg} onClose={() => setShowNewOrg(false)} title="Add prescribing organisation">
        <div className="form-group"><label>Name *</label><input className="ps-input" value={noName} onChange={(e) => setNoName(e.target.value)} /></div>
        <div className="form-group">
          <label>ODS code</label>
          <input className="ps-input" value={noOds} onChange={(e) => setNoOds(e.target.value)} placeholder="Leave blank for a private clinic" />
          <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', margin: '4px 0 0' }}>
            With an ODS code the organisation is shared globally; without one it stays private to your pharmacy.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 'var(--ps-space-md)' }}>
          <div className="form-group"><label>Address</label><input className="ps-input" value={noAddr1} onChange={(e) => setNoAddr1(e.target.value)} /></div>
          <div className="form-group"><label>City</label><input className="ps-input" value={noCity} onChange={(e) => setNoCity(e.target.value)} /></div>
          <div className="form-group"><label>Postcode</label><input className="ps-input" value={noPostcode} onChange={(e) => setNoPostcode(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowNewOrg(false)}>Cancel</button>
          <button className="ps-btn ps-btn-primary" onClick={handleCreateOrg}>Add organisation</button>
        </div>
      </Modal>

      {/* Preview / send modal */}
      <Modal isOpen={showPreview} onClose={() => setShowPreview(false)} title="Preview & send prescription" width="720px">
        <div style={{ border: '1px solid var(--ps-cloud-blue)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-lg)', background: '#fff', marginBottom: 'var(--ps-space-md)', boxShadow: 'var(--ps-shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
            <div>
              <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', textTransform: 'uppercase' }}>
                {type === 'vet' ? 'Veterinary' : 'Private'} prescription
              </div>
              <strong style={{ fontSize: 'var(--ps-font-lg)' }}>{patientText}</strong>
              {type === 'vet' && animalName && <div>Animal: {animalName}{animalOwner ? ` (owner: ${animalOwner})` : ''}</div>}
            </div>
            <div style={{ textAlign: 'right', fontSize: 'var(--ps-font-sm)' }}>
              <div>{today}</div>
              {repeats > 0 && <div>{repeats} repeat{repeats > 1 ? 's' : ''}</div>}
            </div>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)', margin: 'var(--ps-space-md) 0' }} />
          <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {items.filter((it) => it.drug_name.trim()).map((it) => (
              <li key={it.key} style={{ marginBottom: 8 }}>
                <strong>{it.drug_name}</strong> — {it.quantity}
                {it.dosage && <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>{it.dosage}</div>}
              </li>
            ))}
          </ol>
          {type === 'vet' && useCascade && (
            <p style={{ fontSize: 'var(--ps-font-xs)', fontStyle: 'italic', color: 'var(--ps-slate)' }}>{CASCADE_TEXT}</p>
          )}
          <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)', margin: 'var(--ps-space-md) 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 'var(--ps-font-sm)' }}>
              <div><strong>{myPrescriber.full_name}</strong></div>
              <div style={{ color: 'var(--ps-slate)' }}>{myPrescriber.registration_body} {myPrescriber.registration_number}</div>
              <div style={{ color: 'var(--ps-slate)' }}>{orgText}</div>
            </div>
            {myPrescriber.signature_data && (
              <img src={myPrescriber.signature_data} alt="signature" style={{ height: 56, maxWidth: 200, objectFit: 'contain' }} />
            )}
          </div>
        </div>

        {/* Routing */}
        <div className="form-group">
          <label>Send to</label>
          <div style={{ display: 'flex', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-sm)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" checked={route === 'spine'} onChange={() => setRoute('spine')} /> PEPS spine (any pharmacy can collect)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" checked={route === 'pharmacy'} onChange={() => setRoute('pharmacy')} /> A specific pharmacy
            </label>
          </div>
          {route === 'pharmacy' && (
            <Autocomplete<{ id: string; name: string; ods_code: string | null }>
              value={pharmacyText}
              onChange={(t) => { setPharmacyText(t); setTargetPharmacy(null) }}
              onSearch={searchPharmacies}
              onSelect={(ph) => { setTargetPharmacy(ph); setPharmacyText(ph.name) }}
              getKey={(ph) => ph.id}
              getLabel={(ph) => ph.name}
              getDetail={(ph) => ph.ods_code ? `ODS ${ph.ods_code}` : null}
              placeholder="Search pharmacies by name or ODS…"
            />
          )}
        </div>

        {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowPreview(false)}>Back</button>
          <button className="ps-btn ps-btn-primary" onClick={handleSend} disabled={sending}>
            {sending ? 'Sending…' : route === 'spine' ? 'Sign & send to spine' : 'Sign & send to pharmacy'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
