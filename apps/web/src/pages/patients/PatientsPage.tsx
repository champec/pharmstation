import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppointmentStore } from '@pharmstation/core'
import type { Patient } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

export function PatientsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    patients,
    loading,
    error,
    fetchPatients,
    createPatient,
    clearError,
  } = useAppointmentStore()

  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<'last_name' | 'created_at'>('last_name')
  const [sortAsc, setSortAsc] = useState(true)

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newDob, setNewDob] = useState('')
  const [newNhsNumber, setNewNhsNumber] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newAddress1, setNewAddress1] = useState('')
  const [newAddress2, setNewAddress2] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newPostcode, setNewPostcode] = useState('')
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (organisation?.id) fetchPatients(organisation.id)
  }, [organisation?.id, fetchPatients])

  useEffect(() => { load() }, [load])

  const resetForm = () => {
    setNewFirstName(''); setNewLastName(''); setNewDob(''); setNewNhsNumber('')
    setNewEmail(''); setNewPhone(''); setNewAddress1(''); setNewAddress2('')
    setNewCity(''); setNewPostcode(''); setCreateError(null)
  }

  const handleCreate = async () => {
    if (!organisation?.id || !newFirstName.trim() || !newLastName.trim()) return
    setSaving(true)
    setCreateError(null)
    try {
      const created = await createPatient({
        organisation_id: organisation.id,
        first_name: newFirstName.trim(),
        last_name: newLastName.trim(),
        dob: newDob || null,
        nhs_number: newNhsNumber.trim() || null,
        email: newEmail.trim() || null,
        phone: newPhone.trim() || null,
        address_line_1: newAddress1.trim() || null,
        address_line_2: newAddress2.trim() || null,
        city: newCity.trim() || null,
        postcode: newPostcode.trim() || null,
      })
      setShowCreateModal(false)
      resetForm()
      navigate(`/patients/${created.id}`)
    } catch (e: any) {
      setCreateError(e.message)
    }
    setSaving(false)
  }

  // Filter + sort
  const filteredPatients = useMemo(() => {
    let list = patients
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((p) =>
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
        (p.nhs_number && p.nhs_number.includes(q)) ||
        (p.phone && p.phone.includes(q)) ||
        (p.email && p.email.toLowerCase().includes(q))
      )
    }
    list = [...list].sort((a, b) => {
      const aVal = sortField === 'last_name' ? `${a.last_name} ${a.first_name}` : a.created_at
      const bVal = sortField === 'last_name' ? `${b.last_name} ${b.first_name}` : b.created_at
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })
    return list
  }, [patients, search, sortField, sortAsc])

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(true) }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    <span style={{ marginLeft: 4, opacity: sortField === field ? 1 : 0.3 }}>
      {sortField === field ? (sortAsc ? '↑' : '↓') : '↕'}
    </span>
  )

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Patients</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>👥 Patients</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => { resetForm(); setShowCreateModal(true) }}>
            + Add Patient
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 'var(--ps-space-md)' }}>
        <input
          className="ps-input"
          placeholder="Search by name, NHS number, phone, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 400 }}
        />
      </div>

      {/* Loading */}
      {loading && patients.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading patients…</div>
      )}

      {/* Empty */}
      {!loading && patients.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>👥</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No patients yet</h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            Add your first patient to get started.
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => { resetForm(); setShowCreateModal(true) }}>+ Add Patient</button>
        </div>
      )}

      {/* Table */}
      {filteredPatients.length > 0 && (
        <div className="ps-card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--ps-off-white)' }}>
                <th
                  style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)', cursor: 'pointer' }}
                  onClick={() => toggleSort('last_name')}
                >
                  Name <SortIcon field="last_name" />
                </th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>DOB</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>NHS Number</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>Phone</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>Email</th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>Postcode</th>
                <th
                  style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)', cursor: 'pointer' }}
                  onClick={() => toggleSort('created_at')}
                >
                  Created <SortIcon field="created_at" />
                </th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right', color: 'var(--ps-slate)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPatients.map((p) => (
                <tr
                  key={p.id}
                  style={{ borderBottom: '1px solid var(--ps-off-white)', cursor: 'pointer' }}
                  onClick={() => navigate(`/patients/${p.id}`)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--ps-off-white)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                >
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 500 }}>
                    {p.first_name} {p.last_name}
                  </td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)' }}>
                    {p.dob ? new Date(p.dob).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)' }}>{p.nhs_number || '—'}</td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)' }}>{p.phone || '—'}</td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)' }}>{p.email || '—'}</td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)' }}>{p.postcode || '—'}</td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)' }}>
                    {new Date(p.created_at).toLocaleDateString('en-GB')}
                  </td>
                  <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right' }}>
                    <button
                      className="ps-btn ps-btn-secondary ps-btn-sm"
                      onClick={(e) => { e.stopPropagation(); navigate(`/patients/${p.id}`) }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No search results */}
      {search && filteredPatients.length === 0 && patients.length > 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-lg)', color: 'var(--ps-slate)' }}>
          No patients match "{search}"
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add Patient" width="640px">
        <div>
          {createError && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{createError}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
            <div className="form-group">
              <label>First Name *</label>
              <input className="ps-input" value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Last Name *</label>
              <input className="ps-input" value={newLastName} onChange={(e) => setNewLastName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date of Birth</label>
              <input className="ps-input" type="date" value={newDob} onChange={(e) => setNewDob(e.target.value)} />
            </div>
            <div className="form-group">
              <label>NHS Number</label>
              <input className="ps-input" value={newNhsNumber} onChange={(e) => setNewNhsNumber(e.target.value)} placeholder="e.g. 123 456 7890" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="ps-input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input className="ps-input" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>Address Line 1</label>
            <input className="ps-input" value={newAddress1} onChange={(e) => setNewAddress1(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Address Line 2</label>
            <input className="ps-input" value={newAddress2} onChange={(e) => setNewAddress2(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
            <div className="form-group">
              <label>City</label>
              <input className="ps-input" value={newCity} onChange={(e) => setNewCity(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Postcode</label>
              <input className="ps-input" value={newPostcode} onChange={(e) => setNewPostcode(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowCreateModal(false)} disabled={saving}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleCreate} disabled={saving || !newFirstName.trim() || !newLastName.trim()}>
              {saving ? 'Creating…' : 'Add Patient'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
