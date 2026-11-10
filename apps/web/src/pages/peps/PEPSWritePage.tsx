import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, usePepsStore, useAppointmentStore, useMessagingStore, PepsWrongPinError } from '@pharmstation/core'
import {
  pepsCdSchedule,
  pepsDate,
  pepsCdBlocked,
  PEPS_CD_LABELS,
  type Patient,
  type PepsOrg,
  type PepsDmdResult,
  type PepsPrescriptionItem,
  type PepsPrescriptionType,
} from '@pharmstation/types'
import { Autocomplete } from '../../components/forms/Autocomplete'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/ui'

interface DraftItem {
  key: string
  drug_name: string
  dmd_code: string | null
  dmd_type: 'vmp' | 'amp' | 'free_text'
  cd_category: string | null
  quantity: string
  dosage: string
}

function newItem(): DraftItem {
  return { key: Math.random().toString(36).slice(2), drug_name: '', dmd_code: null, dmd_type: 'free_text', cd_category: null, quantity: '', dosage: '' }
}

function patientAddress(p: Patient): string {
  return [p.address_line_1, p.address_line_2, p.city, p.postcode].filter(Boolean).join(', ')
}

function ageFromDob(dob: string): number | null {
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age
}

export function PEPSWritePage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    myPrescriber, prescriberLoaded, fetchMyPrescriber,
    searchPepsOrgs, createPepsOrg, searchDmd, searchPatients,
    searchPharmacies, createPrescription, hasSigningPin,
  } = usePepsStore()
  const { notify } = useMessagingStore()
  const { createPatient, updatePatient } = useAppointmentStore()

  // Patient
  const [patientText, setPatientText] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [npFirst, setNpFirst] = useState('')
  const [npLast, setNpLast] = useState('')
  const [npDob, setNpDob] = useState('')
  const [npNhs, setNpNhs] = useState('')
  const [npAddr, setNpAddr] = useState('')
  const [npCity, setNpCity] = useState('')
  const [npPostcode, setNpPostcode] = useState('')
  const [npError, setNpError] = useState<string | null>(null)
  // Required legal details for the selected patient (editable if the record is missing them)
  const [ptDob, setPtDob] = useState('')
  const [ptAddress, setPtAddress] = useState('')

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
  const [ownerAddress, setOwnerAddress] = useState('')
  const [useCascade, setUseCascade] = useState(false)
  const [confirmNoSch123, setConfirmNoSch123] = useState(false)
  const [repeats, setRepeats] = useState(0)
  const [items, setItems] = useState<DraftItem[]>([newItem()])

  // Send
  const [showPreview, setShowPreview] = useState(false)
  const [route, setRoute] = useState<'spine' | 'pharmacy'>('spine')
  const [pharmacyText, setPharmacyText] = useState('')
  const [targetPharmacy, setTargetPharmacy] = useState<{ id: string; name: string; ods_code: string | null } | null>(null)
  const [sendPatientSms, setSendPatientSms] = useState(false)
  const [patientSmsNumber, setPatientSmsNumber] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [pinSet, setPinSet] = useState<boolean | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const CASCADE_TEXT =
    'Prescribed under the veterinary cascade. For administration to the animal(s) under my care.'

  useEffect(() => {
    fetchMyPrescriber().then((p) => {
      if (p) hasSigningPin().then(setPinSet).catch(() => setPinSet(false))
    })
  }, [fetchMyPrescriber, hasSigningPin])

  const selectPatient = (p: Patient) => {
    setPatient(p)
    setPatientText(`${p.first_name} ${p.last_name}`)
    setPtDob(p.dob ?? '')
    setPtAddress(patientAddress(p))
  }

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
    if (!npDob) {
      setNpError('Date of birth is required on a prescription.')
      return
    }
    if (!npAddr.trim() || !npPostcode.trim()) {
      setNpError('Address and postcode are required on a prescription.')
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
        city: npCity.trim() || null,
        postcode: npPostcode.trim().toUpperCase() || null,
      })
      selectPatient(created)
      setShowNewPatient(false)
    } catch (e: any) {
      setNpError(
        e.message?.includes('unique') || e.message?.includes('duplicate')
          ? 'A patient with that NHS number already exists in this organisation. Search for them instead.'
          : e.message,
      )
    }
  }, [npFirst, npLast, npDob, npNhs, npAddr, npCity, npPostcode, organisation, createPatient]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const filledItems = items.filter((it) => it.drug_name.trim() && it.quantity.trim())
  const hasFreeText = filledItems.some((it) => !it.dmd_code)
  const hasSch4 = filledItems.some((it) => pepsCdSchedule(it.cd_category) === 'sch4')
  const hasCd = filledItems.some((it) => pepsCdSchedule(it.cd_category) !== 'none')

  // Reasons the prescription can't be previewed yet (shown under the button)
  const problems: string[] = []
  if (type === 'private') {
    if (!patient) problems.push('Choose the patient from your records, or add them.')
    else {
      if (!ptDob) problems.push("Enter the patient's date of birth.")
      if (ptAddress.trim().length < 5) problems.push("Enter the patient's address.")
    }
  } else {
    if (!animalName.trim()) problems.push("Enter the animal's name.")
    if (!animalOwner.trim()) problems.push("Enter the owner's name.")
    if (ownerAddress.trim().length < 5) problems.push("Enter the owner's address.")
  }
  if (filledItems.length === 0) problems.push('Add at least one medicine with a quantity.')
  if (filledItems.some((it) => pepsCdBlocked(it.cd_category))) {
    problems.push('Remove the Schedule 1, 2 or 3 controlled drug. These need a paper FP10PCD.')
  }
  if (type === 'private' && hasFreeText) problems.push('Choose every medicine from the dm+d list.')
  if (type === 'vet' && hasFreeText && !confirmNoSch123) {
    problems.push('Confirm that no free-text item is a Schedule 1, 2 or 3 controlled drug.')
  }
  if (sendPatientSms && !patientSmsNumber.trim()) problems.push('Enter the phone number for the SMS.')
  if (!myPrescriber?.address || myPrescriber.address.trim().length < 5) {
    problems.push('Add your practice address in Prescriber setup.')
  }
  if (pinSet === false) problems.push('Set your signing PIN in Prescriber setup.')

  const handleSend = async () => {
    setError(null)
    if (!myPrescriber) return
    if (route === 'pharmacy' && !targetPharmacy) {
      setError('Select a pharmacy to send to, or choose the spine.')
      return
    }
    if (!/^\d{6}$/.test(pin)) {
      setError('Enter your 6-digit signing PIN.')
      return
    }
    if (sendPatientSms && !patientSmsNumber.trim()) {
      setError('Enter a phone number to send the patient confirmation SMS.')
      return
    }
    setSending(true)
    try {
      let patientSnapshot
      if (type === 'private' && patient) {
        patientSnapshot = {
          full_name: `${patient.first_name} ${patient.last_name}`,
          first_name: patient.first_name,
          last_name: patient.last_name,
          dob: ptDob,
          nhs_number: patient.nhs_number,
          address: ptAddress.trim(),
        }
        // Keep the patient record up to date if details were filled in here
        if (!patient.dob || !patientAddress(patient)) {
          const updates: Partial<Patient> = {}
          if (!patient.dob) updates.dob = ptDob
          if (!patientAddress(patient)) updates.address_line_1 = ptAddress.trim()
          updatePatient(patient.id, updates).catch(() => undefined)
        }
      } else {
        patientSnapshot = { full_name: animalOwner.trim(), address: ownerAddress.trim() }
      }

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
        patient_id: type === 'private' ? patient?.id ?? null : null,
        patient_snapshot: patientSnapshot,
        prescribing_org_id: prescribingOrg?.id ?? null,
        prescribing_org_snapshot: orgSnapshot,
        prescription_type: type,
        animal_name: type === 'vet' ? animalName.trim() || null : null,
        animal_owner: type === 'vet' ? animalOwner.trim() : null,
        cascade_wording: type === 'vet' && useCascade ? CASCADE_TEXT : null,
        repeats,
        items: items
          .filter((it) => it.drug_name.trim() && it.quantity.trim())
          .map<Partial<PepsPrescriptionItem>>((it) => ({
            drug_name: it.drug_name.trim(),
            dmd_code: it.dmd_code,
            dmd_type: it.dmd_code ? it.dmd_type : 'free_text',
            quantity: it.quantity.trim(),
            dosage: it.dosage.trim() || null,
          })),
        assigned_org_id: route === 'pharmacy' ? targetPharmacy!.id : null,
        created_metadata: { source: 'web_write_page' },
        pin,
        confirm_no_sch123: type === 'vet' && hasFreeText ? confirmNoSch123 : false,
      })
      setPin('')

      if (sendPatientSms && patientSmsNumber.trim() && organisation?.id) {
        try {
          await notify({
            org_id: organisation.id,
            channel: 'sms',
            patient_id: patient?.id,
            to: patientSmsNumber.trim(),
            feature: 'prescription',
            subject: 'Prescription confirmation',
            body: route === 'spine'
              ? `Your private prescription ${rx.prescription_ref} has been issued. Give this reference and your surname or date of birth to any PharmStation pharmacy to collect it.`
              : `Your private prescription ${rx.prescription_ref} has been sent to ${targetPharmacy?.name ?? 'your pharmacy'}.`,
          })
        } catch (smsError) {
          console.warn('PEPS SMS send failed', smsError)
        }
      }

      navigate(`/peps/${rx.id}`)
    } catch (e: any) {
      setError(e instanceof PepsWrongPinError ? e.message : e.message ?? 'Could not send the prescription.')
      setPin('')
      setSending(false)
    }
  }

  if (!prescriberLoaded) return <div style={{ padding: 'var(--ps-space-lg)' }}>Loading…</div>

  if (!myPrescriber || myPrescriber.status !== 'active') {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: 'PEPS', to: '/peps' }, { label: 'Write prescription' }]} title="Write prescription" />
        <div className="ps-card" style={{ maxWidth: 560, padding: 'var(--ps-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            {!myPrescriber
              ? 'You need to register as a prescriber before you can write private prescriptions.'
              : 'Your prescriber account is not active yet.'}
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/me/prescriber')}>
            Go to prescriber setup →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'PEPS', to: '/peps' }, { label: 'Write prescription' }]}
        title="Write prescription"
        subtitle="Write a private or veterinary prescription, sign it with your PIN and send it to a pharmacy."
      />

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div className="ps-card" style={{ maxWidth: 820, padding: 'var(--ps-space-lg)', display: 'grid', gap: 'var(--ps-space-lg)' }}>
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

        {/* Patient (human prescriptions) */}
        {type === 'private' && (
          <div className="form-group">
            <label>Patient *</label>
            <Autocomplete<Patient>
              value={patientText}
              onChange={(t) => { setPatientText(t); setPatient(null) }}
              onSearch={(q) => searchPatients(organisation!.id, q)}
              onSelect={selectPatient}
              getKey={(p) => p.id}
              getLabel={(p) => `${p.first_name} ${p.last_name}`}
              getDetail={(p) => [p.dob, p.postcode, p.nhs_number].filter(Boolean).join(' · ') || null}
              placeholder="Search your patients by name or NHS number…"
              addNewLabel="Add new patient"
              onAddNew={(text) => {
                const parts = text.trim().split(/\s+/)
                setNpFirst(parts[0] ?? '')
                setNpLast(parts.slice(1).join(' '))
                setShowNewPatient(true)
              }}
            />
            {!patient && patientText.trim().length > 1 && (
              <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', margin: '4px 0 0' }}>
                Pick the patient from the list, or choose “Add new patient”.
              </p>
            )}
            {patient && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--ps-space-md)', marginTop: 'var(--ps-space-sm)' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Date of birth *</label>
                  <input className="ps-input" type="date" value={ptDob} max={today} onChange={(e) => setPtDob(e.target.value)} />
                  {ptDob && ageFromDob(ptDob) !== null && (
                    <span style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>Age {ageFromDob(ptDob)}</span>
                  )}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Address *</label>
                  <input className="ps-input" value={ptAddress} onChange={(e) => setPtAddress(e.target.value)} placeholder="House, street, town, postcode" />
                </div>
              </div>
            )}
          </div>
        )}

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--ps-space-md)' }}>
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
            <input className="ps-input" value={pepsDate(today)} disabled />
          </div>
        </div>

        {type === 'vet' && (
          <div style={{ padding: 'var(--ps-space-md)', background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-md)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--ps-space-md)' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Animal name *</label>
                <input className="ps-input" value={animalName} onChange={(e) => setAnimalName(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Owner's name *</label>
                <input className="ps-input" value={animalOwner} onChange={(e) => setAnimalOwner(e.target.value)} />
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 'var(--ps-space-sm)', marginBottom: 0 }}>
              <label>Owner's address *</label>
              <input className="ps-input" value={ownerAddress} onChange={(e) => setOwnerAddress(e.target.value)} placeholder="House, street, town, postcode" />
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
            Choose each medicine from the dm+d dictionary. Schedule 1, 2 and 3 controlled drugs can't be sent
            through PEPS and need a paper FP10PCD. Schedule 4 items make the prescription valid for 28 days.
            {type === 'vet' && ' Veterinary prescriptions may use free text for products not in dm+d.'}
          </p>
          {items.map((it) => {
            const sch = pepsCdSchedule(it.cd_category)
            const blocked = pepsCdBlocked(it.cd_category)
            const freeTextOnHuman = type === 'private' && it.drug_name.trim() && !it.dmd_code
            return (
              <div key={it.key} style={{ marginBottom: 'var(--ps-space-sm)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ps-space-sm)', alignItems: 'flex-start' }}>
                  <div style={{ flex: '2 1 240px', minWidth: 0 }}>
                  <Autocomplete<PepsDmdResult>
                    value={it.drug_name}
                    onChange={(t) => updateItem(it.key, { drug_name: t, dmd_code: null, dmd_type: 'free_text', cd_category: null })}
                    onSearch={(q) => searchDmd(q, true)}
                    onSelect={(d) => updateItem(it.key, { drug_name: d.name, dmd_code: d.code, dmd_type: d.dmd_type, cd_category: d.cd_category ?? null })}
                    getKey={(d) => `${d.dmd_type}-${d.code}`}
                    getLabel={(d) => d.name}
                    getDetail={(d) => {
                      const label = PEPS_CD_LABELS[pepsCdSchedule(d.cd_category)]
                      return [d.dmd_type.toUpperCase(), label, pepsCdBlocked(d.cd_category) ? 'not allowed' : ''].filter(Boolean).join(' · ')
                    }}
                    placeholder="Drug name & strength…"
                  />
                  </div>
                  <input className="ps-input" style={{ flex: '0 1 100px', minWidth: 80 }} placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(it.key, { quantity: e.target.value })} />
                  <input className="ps-input" style={{ flex: '1 1 120px', minWidth: 0 }} placeholder="Dosage / directions" value={it.dosage} onChange={(e) => updateItem(it.key, { dosage: e.target.value })} />
                  <button className="ps-btn ps-btn-ghost" onClick={() => removeItem(it.key)} disabled={items.length === 1} title="Remove medicine" aria-label="Remove medicine">✕</button>
                </div>
                {blocked && (
                  <div className="ps-alert ps-alert-error" style={{ marginTop: 4 }}>
                    {it.drug_name} is a {PEPS_CD_LABELS[sch]} controlled drug. Private prescriptions for it must be written on the paper FP10PCD form.
                  </div>
                )}
                {!blocked && sch !== 'none' && (
                  <span className="ps-badge" style={{ marginTop: 4, display: 'inline-block' }}>{PEPS_CD_LABELS[sch]}</span>
                )}
                {freeTextOnHuman && (
                  <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-danger, #b42318)', margin: '4px 0 0' }}>
                    Pick this medicine from the dm+d list.
                  </p>
                )}
              </div>
            )
          })}
          <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => setItems((p) => [...p, newItem()])}>＋ Add medication</button>
        </div>

        {type === 'vet' && hasFreeText && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--ps-font-sm)' }}>
            <input type="checkbox" checked={confirmNoSch123} onChange={(e) => setConfirmNoSch123(e.target.checked)} />
            I confirm that no free-text item is a Schedule 1, 2 or 3 controlled drug.
          </label>
        )}

        {hasSch4 && (
          <div className="ps-alert ps-alert-warning">
            This prescription has a Schedule 4 controlled drug, so it is valid for 28 days from today.
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-xs)' }}>
          <button className="ps-btn ps-btn-primary" disabled={problems.length > 0} onClick={() => setShowPreview(true)}>
            Preview & sign →
          </button>
        </div>
        {problems.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>

      {/* New patient modal */}
      <Modal isOpen={showNewPatient} onClose={() => setShowNewPatient(false)} title="Add new patient">
        {npError && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{npError}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--ps-space-md)' }}>
          <div className="form-group"><label>First name *</label><input className="ps-input" value={npFirst} onChange={(e) => setNpFirst(e.target.value)} /></div>
          <div className="form-group"><label>Last name *</label><input className="ps-input" value={npLast} onChange={(e) => setNpLast(e.target.value)} /></div>
          <div className="form-group"><label>Date of birth *</label><input className="ps-input" type="date" value={npDob} max={today} onChange={(e) => setNpDob(e.target.value)} /></div>
          <div className="form-group"><label>NHS number</label><input className="ps-input" value={npNhs} onChange={(e) => setNpNhs(e.target.value)} /></div>
        </div>
        <div className="form-group"><label>Address *</label><input className="ps-input" value={npAddr} onChange={(e) => setNpAddr(e.target.value)} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--ps-space-md)' }}>
          <div className="form-group"><label>Town</label><input className="ps-input" value={npCity} onChange={(e) => setNpCity(e.target.value)} /></div>
          <div className="form-group"><label>Postcode *</label><input className="ps-input" value={npPostcode} onChange={(e) => setNpPostcode(e.target.value)} /></div>
        </div>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--ps-space-md)' }}>
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
              {type === 'private' ? (
                <>
                  <strong style={{ fontSize: 'var(--ps-font-lg)' }}>{patientText}</strong>
                  <div style={{ fontSize: 'var(--ps-font-sm)' }}>
                    DOB {pepsDate(ptDob)}{ptDob && ageFromDob(ptDob) !== null ? ` (age ${ageFromDob(ptDob)})` : ''}
                  </div>
                  <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>{ptAddress}</div>
                </>
              ) : (
                <>
                  <strong style={{ fontSize: 'var(--ps-font-lg)' }}>{animalName}</strong>
                  <div style={{ fontSize: 'var(--ps-font-sm)' }}>Owner: {animalOwner}</div>
                  <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>{ownerAddress}</div>
                </>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: 'var(--ps-font-sm)' }}>
              <div>{pepsDate(today)}</div>
              {repeats > 0 && <div>{repeats} repeat{repeats > 1 ? 's' : ''}</div>}
            </div>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)', margin: 'var(--ps-space-md) 0' }} />
          <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {items.filter((it) => it.drug_name.trim()).map((it) => (
              <li key={it.key} style={{ marginBottom: 8 }}>
                <strong>{it.drug_name}</strong> — {it.quantity}
                {pepsCdSchedule(it.cd_category) !== 'none' && (
                  <span className="ps-badge" style={{ marginLeft: 6 }}>{PEPS_CD_LABELS[pepsCdSchedule(it.cd_category)]}</span>
                )}
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
              <div style={{ color: 'var(--ps-slate)' }}>{myPrescriber.address}</div>
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
              <input type="radio" checked={route === 'spine'} onChange={() => setRoute('spine')} /> PEPS spine (the patient takes the reference to any pharmacy)
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

        <div className="form-group">
          <label>Patient confirmation SMS (optional)</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 'var(--ps-font-sm)' }}>
            <input type="checkbox" checked={sendPatientSms} onChange={(e) => setSendPatientSms(e.target.checked)} />
            Send a text confirmation after prescribing
          </label>
          {sendPatientSms && (
            <input
              className="ps-input"
              placeholder="Patient phone number"
              value={patientSmsNumber}
              onChange={(e) => setPatientSmsNumber(e.target.value)}
            />
          )}
        </div>

        <div className="form-group">
          <label>Signing PIN *</label>
          <input
            className="ps-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            style={{ maxWidth: 180, letterSpacing: '0.3em' }}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 6 && !sending) handleSend() }}
          />
          <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', margin: '4px 0 0' }}>
            Entering your PIN signs this prescription. It is sealed when sent, so any later change can be detected.
          </p>
        </div>
        {hasCd && !hasSch4 && (
          <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>Includes a Schedule 5 controlled drug.</p>
        )}

        {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button className="ps-btn ps-btn-ghost" onClick={() => setShowPreview(false)}>Back</button>
          <button className="ps-btn ps-btn-primary" onClick={handleSend} disabled={sending || pin.length !== 6}>
            {sending ? 'Sending…' : route === 'spine' ? 'Sign & send to spine' : 'Sign & send to pharmacy'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
