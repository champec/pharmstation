import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore, useCareHomeStore } from '@pharmstation/core'
import type { CareHomeGroupType, CareHomeUnit } from '@pharmstation/types'
import { chLabel, chDate } from './careHomeLabels'
import { AddResidentForm } from './AddResidentForm'
import { PageHeader } from '../../components/ui/PageHeader'

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
    selectedLinkId,
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
  const [showResidentForm, setShowResidentForm] = useState(false)

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

  const residentsLabel = (id: string) => (id === selectedLinkId ? `${residents.length} resident${residents.length === 1 ? '' : 's'}` : 'Open to see residents')

  // ---------- List view ----------
  if (!linkId) {
    return (
      <div className="care-home-page">
        <PageHeader
          breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Care homes', to: '/care-homes' }, { label: 'Manage care homes' }]}
          eyebrow="Care homes"
          title="Manage care homes"
          subtitle="Care home details, delivery groups and the residents in each home."
          actions={canManage ? (
            <button className="ps-btn ps-btn-primary" type="button" onClick={() => setShowCreateForm((v) => !v)}>
              {showCreateForm ? 'Close' : '+ Add care home'}
            </button>
          ) : undefined}
        />

        {(error || actionError) && (
          <div className="auth-error care-home-alert" role="alert">
            <span>{actionError ?? error}</span>
            <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => { clearError(); setActionError(null) }}>Dismiss</button>
          </div>
        )}

        {showCreateForm && canManage && (
          <form className="care-home-request-form" onSubmit={(event) => void handleCreateCareHome(event)}>
            <label className="care-home-form-span-2">Care home name *<input className="ps-input" required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></label>
            <label>Contact name<input className="ps-input" value={createForm.contactName} onChange={(e) => setCreateForm({ ...createForm, contactName: e.target.value })} /></label>
            <label>Contact email<input className="ps-input" type="email" value={createForm.contactEmail} onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })} /></label>
            <label>Contact phone<input className="ps-input" value={createForm.contactPhone} onChange={(e) => setCreateForm({ ...createForm, contactPhone: e.target.value })} /></label>
            <div className="care-home-form-actions"><button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !createForm.name.trim()}>{saving ? 'Creating...' : 'Create care home'}</button></div>
          </form>
        )}

        {links.length === 0 && !loading ? (
          <div className="care-home-inline-empty">{canManage ? 'No care homes yet. Use "Add care home" to set up the first one.' : 'No care homes yet. Ask a pharmacy manager to add one.'}</div>
        ) : (
          <div className="care-home-manage-grid">
            {links.map((item) => (
              <button key={item.id} className="care-home-manage-card" type="button" onClick={() => navigate(`/care-homes/manage/${item.id}`)}>
                <strong>{item.care_home_organisation?.name ?? 'Care home'}</strong>
                <small>{item.service_name ?? 'Care home service'}</small>
                <small>{residentsLabel(item.id)}</small>
                <small>{item.contact_name ?? 'No contact'}{item.contact_phone ? ` · ${item.contact_phone}` : ''}</small>
                <span className={`ps-badge ${item.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{chLabel('linkStatus', item.status)}</span>
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
      <PageHeader
        breadcrumbs={[{ label: 'Care homes', to: '/care-homes' }, { label: 'Manage care homes', to: '/care-homes/manage' }, { label: link?.care_home_organisation?.name ?? 'Care home' }]}
        eyebrow="Care home profile"
        title={link?.care_home_organisation?.name ?? 'Care home'}
        subtitle={`${residents.length} resident${residents.length === 1 ? '' : 's'} · ${groups.length} group${groups.length === 1 ? '' : 's'}`}
        actions={<>
          <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate(`/care-homes?link=${linkId}`)}>Open groups board</button>
          {canManage && <button className="ps-btn ps-btn-primary" type="button" onClick={() => { setShowResidentForm(true); setTimeout(() => document.getElementById('care-home-residents')?.scrollIntoView({ behavior: 'smooth' }), 0) }}>+ Add resident</button>}
        </>}
      />

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
          <article><span>Contact</span><strong>{link?.contact_name ?? 'Not recorded'}</strong><small>{[link?.contact_phone, link?.contact_email].filter(Boolean).join(' · ') || 'No contact details'}</small></article>
          <article><span>Cycle day</span><strong>{link?.cycle_day ?? 'Not set'}</strong><small>Day of the month supplies are due</small></article>
          <article><span>Cycle length</span><strong>{link?.default_cycle_length_days ?? 28} days</strong><small>Default supply period</small></article>
          <article><span>Status</span><strong>{chLabel('linkStatus', link?.status)}</strong><small>{link?.service_name ?? 'Care home service'}{link?.notes ? ` · ${link.notes}` : ''}</small></article>
        </div>
      )}

      <div className="care-home-section-heading" id="care-home-residents">
        <div><p>Residents</p><h2>{residents.length} resident{residents.length === 1 ? '' : 's'}</h2></div>
        {canManage && !showResidentForm && <button className="ps-btn ps-btn-secondary" type="button" onClick={() => setShowResidentForm(true)}>+ Add resident</button>}
      </div>

      {showResidentForm && canManage && linkId && <AddResidentForm linkId={linkId} onDone={() => setShowResidentForm(false)} />}

      {residents.length === 0 ? (
        <div className="care-home-inline-empty">{canManage ? 'No residents yet. Add residents from your patient records, or create a new patient.' : 'No residents yet.'}</div>
      ) : (
        <div className="care-home-table-wrap">
          <table className="care-home-table care-home-clickable-table">
            <thead><tr><th>Resident</th><th>Room</th><th>Groups</th><th>Status</th></tr></thead>
            <tbody>
              {residents.map((resident) => {
                const names = groups.filter((group) => resident.unit_id === group.id || resident.group_memberships?.some((m) => m.group_id === group.id)).map((group) => group.name)
                return (
                  <tr key={resident.id} tabIndex={0} onClick={() => navigate(`/care-homes/${linkId}/residents/${resident.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/care-homes/${linkId}/residents/${resident.id}`) }}>
                    <td><strong>{residentName(resident.patient?.first_name, resident.patient?.last_name)}</strong><small>{resident.patient?.dob ? `Born ${chDate(resident.patient.dob)}` : resident.patient?.nhs_number ?? 'Date of birth not recorded'}</small></td>
                    <td>{resident.room_number ?? 'Not recorded'}</td>
                    <td>{names.length ? names.join(', ') : 'No group'}</td>
                    <td><span className={`ps-badge ${resident.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{chLabel('residentStatus', resident.status)}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
        <div className="care-home-inline-empty">No delivery groups yet. Groups organise residents into delivery rounds.</div>
      ) : (
        <div className="care-home-table-wrap">
          <table className="care-home-table">
            <thead><tr><th>Group</th><th>Unit / floor</th><th>Type</th><th>Cycle day</th><th>Residents</th><th>State</th><th className="care-home-no-print">Actions</th></tr></thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <td><strong>{group.name}</strong></td>
                  <td>{group.floor_name ?? 'Not set'}</td>
                  <td>{chLabel('groupType', group.group_type)}</td>
                  <td>{group.cycle_day ?? 'Not set'}</td>
                  <td>{groupMemberCount(group)}</td>
                  <td><span className={`ps-badge ${group.group_state === 'idle' ? 'ps-badge-muted' : 'ps-badge-blue'}`}>{chLabel('groupState', group.group_state)}</span></td>
                  <td className="care-home-row-actions care-home-no-print">
                    <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={() => setPatientsModalGroup(group)}>Residents</button>
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
                <button className="ps-btn ps-btn-ghost ps-btn-sm modal-close" type="button" aria-label="Close" title="Close" onClick={() => setEditingGroup(null)}>✕</button>
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
            <div className="modal-dialog" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label={`Residents in ${modalGroup.name}`}>
              <div className="modal-header">
                <h2>Residents in {modalGroup.name}</h2>
                <button className="ps-btn ps-btn-ghost ps-btn-sm modal-close" type="button" aria-label="Close" title="Close" onClick={() => setPatientsModalGroup(null)}>✕</button>
              </div>
              <div className="modal-body">
                {canManage && (
                  <form className="care-home-modal-add-row" onSubmit={(event) => void handleAddResidentToGroup(event)}>
                    <select className="ps-input" value={residentToAdd} onChange={(e) => setResidentToAdd(e.target.value)}>
                      <option value="">Add a resident to this group...</option>
                      {modalAvailable.map((r) => <option key={r.id} value={r.id}>{residentName(r.patient?.first_name, r.patient?.last_name)}{r.room_number ? ` · Room ${r.room_number}` : ''}</option>)}
                    </select>
                    <button className="ps-btn ps-btn-primary" type="submit" disabled={saving || !residentToAdd}>Add</button>
                  </form>
                )}
                {modalMembers.length === 0 ? (
                  <div className="care-home-inline-empty">{residents.length === 0 ? 'Add residents to this care home first, then put them in groups.' : 'No residents in this group yet.'}</div>
                ) : (
                  <ul className="care-home-modal-member-list">
                    {modalMembers.map((resident) => (
                      <li key={resident.id}>
                        <button className="care-home-modal-member-name" type="button" onClick={() => navigate(`/care-homes/${linkId}/residents/${resident.id}`)}>
                          <strong>{residentName(resident.patient?.first_name, resident.patient?.last_name)}</strong>
                          <small>{resident.room_number ? `Room ${resident.room_number}` : 'No room'} · {resident.patient?.nhs_number ?? 'No NHS number'}</small>
                        </button>
                        <span className={`ps-badge ${resident.status === 'active' ? 'ps-badge-success' : 'ps-badge-warning'}`}>{chLabel('residentStatus', resident.status)}</span>
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
