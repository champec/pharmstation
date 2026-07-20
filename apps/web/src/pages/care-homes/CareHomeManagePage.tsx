import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeGroupType, CareHomeUnit } from '@pharmstation/types'

function residentName(first?: string, last?: string) {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed resident'
}

export function CareHomeManagePage() {
  const { linkId } = useParams<{ linkId?: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser, permissions } = useAuthStore()
  const {
    links,
    residents,
    groups,
    loading,
    saving,
    error,
    fetchLinks,
    selectLink,
    createCareHome,
    updateCareHomeLink,
    createGroup,
    updateGroup,
    addResidentToGroup,
    removeResidentFromGroup,
    clearError,
  } = useCareHomeStore()

  const isCareHome = organisation?.organisation_type === 'carehome'
  const canManage = !isCareHome && permissions?.care_home_manage === true

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', contactName: '', contactEmail: '', contactPhone: '' })
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({ serviceName: '', contactName: '', contactEmail: '', contactPhone: '', cycleDay: '', cycleLength: '', notes: '' })
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupForm, setGroupForm] = useState({ name: '', floorName: '', groupType: 'monthly' as CareHomeGroupType, cycleDay: '' })
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [editGroupForm, setEditGroupForm] = useState({ name: '', floorName: '', groupType: 'monthly' as CareHomeGroupType, cycleDay: '' })
  const [patientsModalGroup, setPatientsModalGroup] = useState<CareHomeUnit | null>(null)
  const [residentToAdd, setResidentToAdd] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (organisation?.id) void fetchLinks(organisation.id, organisation.organisation_type ?? 'pharmacy')
  }, [organisation?.id, organisation?.organisation_type, fetchLinks])

  useEffect(() => {
    if (linkId) void selectLink(linkId)
  }, [linkId, selectLink])

  const link = useMemo(() => links.find((l) => l.id === linkId) ?? null, [links, linkId])

  const groupMemberCount = (group: CareHomeUnit) =>
    residents.filter((r) => r.group_memberships?.some((m) => m.group_id === group.id) || r.unit_id === group.id).length

  const modalGroup = useMemo(
    () => (patientsModalGroup ? groups.find((g) => g.id === patientsModalGroup.id) ?? patientsModalGroup : null),
    [patientsModalGroup, groups],
  )

  const modalMembers = useMemo(() => {
    if (!modalGroup) return []
    return residents.filter((r) => r.group_memberships?.some((m) => m.group_id === modalGroup.id) || r.unit_id === modalGroup.id)
  }, [modalGroup, residents])

  const modalAvailable = useMemo(() => {
    if (!modalGroup) return []
    const memberIds = new Set(modalMembers.map((m) => m.id))
    return residents.filter((r) => r.status === 'active' && !memberIds.has(r.id))
  }, [modalGroup, modalMembers, residents])

  const handleCreateCareHome = async (event: FormEvent) => {
    event.preventDefault()
    if (!organisation?.id) return
    setActionError(null)
    try {
      const newLinkId = await createCareHome({
        pharmacyOrganisationId: organisation.id,
        name: createForm.name.trim(),
        contactName: createForm.contactName.trim() || undefined,
        contactEmail: createForm.contactEmail.trim() || undefined,
        contactPhone: createForm.contactPhone.trim() || undefined,
      })
      setShowCreateForm(false)
      setCreateForm({ name: '', contactName: '', contactEmail: '', contactPhone: '' })
      await fetchLinks(organisation.id, organisation.organisation_type ?? 'pharmacy')
      navigate(`/care-homes/manage/${newLinkId}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to create the care home')
    }
  }

  const openProfileEdit = () => {
    if (!link) return
    setProfileForm({
      serviceName: link.service_name ?? '',
      contactName: link.contact_name ?? '',
      contactEmail: link.contact_email ?? '',
      contactPhone: link.contact_phone ?? '',
      cycleDay: link.cycle_day != null ? String(link.cycle_day) : '',
      cycleLength: String(link.default_cycle_length_days ?? 28),
      notes: link.notes ?? '',
    })
    setEditingProfile(true)
  }

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!linkId) return
    setActionError(null)
    await updateCareHomeLink(linkId, {
      service_name: profileForm.serviceName.trim() || null,
      contact_name: profileForm.contactName.trim() || null,
      contact_email: profileForm.contactEmail.trim() || null,
      contact_phone: profileForm.contactPhone.trim() || null,
      cycle_day: profileForm.cycleDay ? Number(profileForm.cycleDay) : null,
      default_cycle_length_days: profileForm.cycleLength ? Number(profileForm.cycleLength) : 28,
      notes: profileForm.notes.trim() || null,
    })
    setEditingProfile(false)
  }

  const handleCreateGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!linkId) return
    setActionError(null)
    try {
      await createGroup({
        linkId,
        name: groupForm.name.trim(),
        groupType: groupForm.groupType,
        cycleDay: groupForm.cycleDay ? Number(groupForm.cycleDay) : undefined,
      })
      setShowGroupForm(false)
      setGroupForm({ name: '', floorName: '', groupType: 'monthly', cycleDay: '' })
      await selectLink(linkId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to create the group')
    }
  }

  const openGroupEdit = (group: CareHomeUnit) => {
    setEditGroupForm({
      name: group.name,
      floorName: group.floor_name ?? '',
      groupType: group.group_type,
      cycleDay: group.cycle_day != null ? String(group.cycle_day) : '',
    })
    setEditingGroup(group.id)
  }

  const handleSaveGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingGroup) return
    setActionError(null)
    await updateGroup(editingGroup, {
      name: editGroupForm.name.trim(),
      floor_name: editGroupForm.floorName.trim() || null,
      group_type: editGroupForm.groupType,
      cycle_day: editGroupForm.cycleDay ? Number(editGroupForm.cycleDay) : null,
    })
    setEditingGroup(null)
  }

  const handleAddResidentToGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!modalGroup || !residentToAdd || !activeUser?.id || !linkId) return
    await addResidentToGroup(modalGroup.id, residentToAdd, activeUser.id)
    setResidentToAdd('')
    await selectLink(linkId)
  }

  const handleRemoveResidentFromGroup = async (residentId: string) => {
    if (!modalGroup || !linkId) return
    await removeResidentFromGroup(modalGroup.id, residentId)
    await selectLink(linkId)
  }

  // ---------- List view ----------
  if (!linkId) {
    return (
      <div className="care-home-page">
        <div className="page-header care-home-page-header">
          <div className="care-home-title-row">
            <div>
              <p className="care-home-eyebrow">Care home management</p>
              <h1>Care homes</h1>
              <p className="care-home-subtitle">Manage care home details, groups and the patients inside them.</p>
            </div>
            {canManage && (
              <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowCreateForm((v) => !v)}>
                {showCreateForm ? 'Close' : 'Add care home'}
              </button>
            )}
          </div>
        </div>

        {(error || actionError) && (
          <div className="auth-error care-home-alert" role="alert">
            <span>{actionError ?? error}</span>
            <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => { clearError(); setActionError(null) }}>Dismiss</button>
          </div>
        )}

        {showCreateForm && canManage && (
          <form className="care-home-request-form" onSubmit={(event) => void handleCreateCareHome(event)}>
            <label className="care-home-form-span-2">Care home name<input className="ps-input" required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></label>
            <label>Contact name<input className="ps-input" value={createForm.contactName} onChange={(e) => setCreateForm({ ...createForm, contactName: e.target.value })} /></label>
            <label>Contact email<input className="ps-input" type="email" value={createForm.contactEmail} onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })} /></label>
            <label>Contact phone<input className="ps-input" value={createForm.contactPhone} onChange={(e) => setCreateForm({ ...createForm, contactPhone: e.target.value })} /></label>
            <div className="care-home-form-actions"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !createForm.name.trim()}>{saving ? 'Creating...' : 'Create care home'}</button></div>
          </form>
        )}

        {links.length === 0 && !loading ? (
          <div className="care-home-inline-empty">No care homes linked yet.</div>
        ) : (
          <div className="care-home-manage-grid">
            {links.map((item) => (
              <button key={item.id} className="care-home-manage-card" type="button" onClick={() => navigate(`/care-homes/manage/${item.id}`)}>
                <strong>{item.care_home_organisation?.name ?? 'Care home'}</strong>
                <small>{item.service_name ?? 'Care home service'}</small>
                <small>{item.contact_name ?? 'No contact'}{item.contact_phone ? ` · ${item.contact_phone}` : ''}</small>
                <span className={`ps-badge ${item.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{item.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---------- Detail view ----------
  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs">
          <a href="/care-homes/manage" onClick={(e) => { e.preventDefault(); navigate('/care-homes/manage') }}>Care home management</a>
          <span className="separator">/</span>
          <span>{link?.care_home_organisation?.name ?? 'Care home'}</span>
        </div>
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">Care home profile</p>
            <h1>{link?.care_home_organisation?.name ?? 'Care home'}</h1>
            <p className="care-home-subtitle">{residents.length} patient{residents.length === 1 ? '' : 's'} · {groups.length} group{groups.length === 1 ? '' : 's'}</p>
          </div>
          <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate('/care-homes')}>Open groups board</button>
        </div>
      </div>

      {(error || actionError) && (
        <div className="auth-error care-home-alert" role="alert">
          <span>{actionError ?? error}</span>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => { clearError(); setActionError(null) }}>Dismiss</button>
        </div>
      )}

      <div className="care-home-section-heading">
        <div><p>Details</p><h2>Profile</h2></div>
        {canManage && !editingProfile && <button className="ps-btn ps-btn-secondary" type="button" onClick={openProfileEdit}>Edit details</button>}
      </div>

      {editingProfile ? (
        <form className="care-home-request-form" onSubmit={(event) => void handleSaveProfile(event)}>
          <label>Service name<input className="ps-input" value={profileForm.serviceName} onChange={(e) => setProfileForm({ ...profileForm, serviceName: e.target.value })} /></label>
          <label>Contact name<input className="ps-input" value={profileForm.contactName} onChange={(e) => setProfileForm({ ...profileForm, contactName: e.target.value })} /></label>
          <label>Contact email<input className="ps-input" type="email" value={profileForm.contactEmail} onChange={(e) => setProfileForm({ ...profileForm, contactEmail: e.target.value })} /></label>
          <label>Contact phone<input className="ps-input" value={profileForm.contactPhone} onChange={(e) => setProfileForm({ ...profileForm, contactPhone: e.target.value })} /></label>
          <label>Cycle day (1-31)<input className="ps-input" type="number" min="1" max="31" value={profileForm.cycleDay} onChange={(e) => setProfileForm({ ...profileForm, cycleDay: e.target.value })} /></label>
          <label>Cycle length (days)<input className="ps-input" type="number" min="7" max="56" value={profileForm.cycleLength} onChange={(e) => setProfileForm({ ...profileForm, cycleLength: e.target.value })} /></label>
          <label className="care-home-form-span-2">Notes<textarea className="ps-input" rows={2} value={profileForm.notes} onChange={(e) => setProfileForm({ ...profileForm, notes: e.target.value })} /></label>
          <div className="care-home-form-actions care-home-form-span-2">
            <button className="ps-btn ps-btn-ghost" type="button" onClick={() => setEditingProfile(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save details'}</button>
          </div>
        </form>
      ) : (
        <div className="care-home-metrics">
          <article><span>Contact</span><strong>{link?.contact_name ?? '—'}</strong><small>{[link?.contact_phone, link?.contact_email].filter(Boolean).join(' · ') || 'no contact details'}</small></article>
          <article><span>Cycle day</span><strong>{link?.cycle_day ?? '—'}</strong><small>day of month supplies are due</small></article>
          <article><span>Cycle length</span><strong>{link?.default_cycle_length_days ?? 28} days</strong><small>default supply period</small></article>
          <article><span>Service</span><strong>{link?.service_name ?? '—'}</strong><small>{link?.notes ?? 'no notes'}</small></article>
        </div>
      )}

      <div className="care-home-section-heading">
        <div><p>Delivery groups</p><h2>{groups.length} group{groups.length === 1 ? '' : 's'}</h2></div>
        {canManage && (
          <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowGroupForm((v) => !v)}>
            {showGroupForm ? 'Close' : 'New group'}
          </button>
        )}
      </div>

      {showGroupForm && canManage && (
        <form className="care-home-request-form" onSubmit={(event) => void handleCreateGroup(event)}>
          <label>Group name<input className="ps-input" required placeholder="e.g. Ground floor" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} /></label>
          <label>Type<select className="ps-input" value={groupForm.groupType} onChange={(e) => setGroupForm({ ...groupForm, groupType: e.target.value as CareHomeGroupType })}><option value="monthly">Monthly</option><option value="acute">Acute</option></select></label>
          <label>Cycle day (1-31)<input className="ps-input" type="number" min="1" max="31" value={groupForm.cycleDay} onChange={(e) => setGroupForm({ ...groupForm, cycleDay: e.target.value })} /></label>
          <div className="care-home-form-actions"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !groupForm.name.trim()}>{saving ? 'Creating...' : 'Create group'}</button></div>
        </form>
      )}

      {groups.length === 0 ? (
        <div className="care-home-inline-empty">No groups yet. Groups organise patients into deliveries.</div>
      ) : (
        <div className="care-home-table-wrap">
          <table className="care-home-table">
            <thead><tr><th>Group</th><th>Unit / floor</th><th>Type</th><th>Cycle day</th><th>Patients</th><th>State</th><th className="care-home-no-print">Actions</th></tr></thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <td><strong>{group.name}</strong></td>
                  <td>{group.floor_name ?? '—'}</td>
                  <td>{group.group_type}</td>
                  <td>{group.cycle_day ?? '—'}</td>
                  <td>{groupMemberCount(group)}</td>
                  <td><span className={`ps-badge ${group.group_state === 'idle' ? 'ps-badge-muted' : 'ps-badge-blue'}`}>{group.group_state.replaceAll('_', ' ')}</span></td>
                  <td className="care-home-row-actions care-home-no-print">
                    <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => setPatientsModalGroup(group)}>Patients</button>
                    {canManage && <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => openGroupEdit(group)}>Edit</button>}
                    <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => navigate(`/care-homes/${linkId}/groups/${group.id}`)}>Open round</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingGroup && (
        <>
          <div className="modal-backdrop" onClick={() => setEditingGroup(null)} />
          <div className="modal-container">
            <div className="modal-dialog" style={{ maxWidth: 480 }} role="dialog" aria-modal="true" aria-label="Edit group">
              <div className="modal-header">
                <h2>Edit group</h2>
                <button className="ps-btn ps-btn-ghost ps-btn-sm modal-close" type="button" onClick={() => setEditingGroup(null)}>✕</button>
              </div>
              <form onSubmit={(event) => void handleSaveGroup(event)}>
                <div className="modal-body care-home-new-med-form">
                  <label>Group name<input className="ps-input" required value={editGroupForm.name} onChange={(e) => setEditGroupForm({ ...editGroupForm, name: e.target.value })} /></label>
                  <label>Unit / floor (what the care home calls it)<input className="ps-input" value={editGroupForm.floorName} onChange={(e) => setEditGroupForm({ ...editGroupForm, floorName: e.target.value })} /></label>
                  <label>Type<select className="ps-input" value={editGroupForm.groupType} onChange={(e) => setEditGroupForm({ ...editGroupForm, groupType: e.target.value as CareHomeGroupType })}><option value="monthly">Monthly</option><option value="acute">Acute</option></select></label>
                  <label>Cycle day (1-31)<input className="ps-input" type="number" min="1" max="31" value={editGroupForm.cycleDay} onChange={(e) => setEditGroupForm({ ...editGroupForm, cycleDay: e.target.value })} /></label>
                </div>
                <div className="modal-footer">
                  <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setEditingGroup(null)}>Cancel</button>
                  <button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !editGroupForm.name.trim()}>{saving ? 'Saving...' : 'Save group'}</button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {modalGroup && (
        <>
          <div className="modal-backdrop" onClick={() => setPatientsModalGroup(null)} />
          <div className="modal-container">
            <div className="modal-dialog" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label={`Patients in ${modalGroup.name}`}>
              <div className="modal-header">
                <h2>Patients in {modalGroup.name}</h2>
                <button className="ps-btn ps-btn-ghost ps-btn-sm modal-close" type="button" onClick={() => setPatientsModalGroup(null)}>✕</button>
              </div>
              <div className="modal-body">
                {canManage && (
                  <form className="care-home-modal-add-row" onSubmit={(event) => void handleAddResidentToGroup(event)}>
                    <select className="ps-input" value={residentToAdd} onChange={(e) => setResidentToAdd(e.target.value)}>
                      <option value="">Add a patient to this group...</option>
                      {modalAvailable.map((r) => <option key={r.id} value={r.id}>{residentName(r.patient?.first_name, r.patient?.last_name)}{r.room_number ? ` · Room ${r.room_number}` : ''}</option>)}
                    </select>
                    <button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !residentToAdd}>Add</button>
                  </form>
                )}
                {modalMembers.length === 0 ? (
                  <div className="care-home-inline-empty">No patients in this group yet.</div>
                ) : (
                  <ul className="care-home-modal-member-list">
                    {modalMembers.map((resident) => (
                      <li key={resident.id}>
                        <button className="care-home-modal-member-name" type="button" onClick={() => navigate(`/care-homes/${linkId}/residents/${resident.id}`)}>
                          <strong>{residentName(resident.patient?.first_name, resident.patient?.last_name)}</strong>
                          <small>{resident.room_number ? `Room ${resident.room_number}` : 'No room'} · {resident.patient?.nhs_number ?? 'No NHS number'}</small>
                        </button>
                        <span className={`ps-badge ${resident.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{resident.status}</span>
                        {canManage && (
                          <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" disabled={saving} onClick={() => void handleRemoveResidentFromGroup(resident.id)}>Remove</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="modal-footer">
                <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setPatientsModalGroup(null)}>Done</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
