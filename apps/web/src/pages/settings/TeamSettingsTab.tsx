import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuthStore } from '@pharmstation/core'
import {
  createInvite,
  listInvites,
  listMembers,
  revokeInvite,
  updateMember,
  resetMemberTwoStep,
  inviteLink,
} from '@pharmstation/supabase-client'
import {
  ROLE_LABELS,
  type InvitableRole,
  type OrganisationInvite,
  type TeamMember,
  type UserRole,
} from '@pharmstation/types'
import { alertDialog, confirmDialog, promptDialog } from '../../components/ui/dialog'

const STAFF_ROLES: InvitableRole[] = ['pharmacist', 'technician', 'dispenser', 'locum']
const SENIOR_ROLES: InvitableRole[] = ['owner', 'manager']

const ROLE_HINTS: Record<InvitableRole, string> = {
  owner: 'Everything, including billing and removing other owners.',
  manager: 'Manages staff, SOPs and settings. Can’t write to the CD register by default.',
  pharmacist: 'Signs the RP log and writes and corrects CD register entries.',
  technician: 'Writes CD register entries and patient returns. Can’t correct entries.',
  dispenser: 'Day-to-day tasks, deliveries and logs. No CD register access by default.',
  locum: 'Like a pharmacist, for a locum who works here regularly.',
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function statusBadge(status: TeamMember['status']) {
  const cls = status === 'active' ? 'ps-badge-green' : status === 'suspended' ? 'ps-badge-amber' : 'ps-badge-red'
  const label = status === 'revoked' ? 'Removed' : status[0].toUpperCase() + status.slice(1)
  return <span className={`ps-badge ${cls}`}>{label}</span>
}

export function TeamSettingsTab() {
  const { organisation, membership, permissions, activeUser } = useAuthStore()
  const orgId = organisation?.id
  const canManage = permissions?.manage_users === true
  const isOwner = membership?.role === 'owner'
  const invitableRoles: InvitableRole[] = isOwner ? [...SENIOR_ROLES, ...STAFF_ROLES] : STAFF_ROLES

  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<OrganisationInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InvitableRole>('dispenser')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [newInvite, setNewInvite] = useState<{ email: string; role: InvitableRole; link: string; expiresAt: string; emailed: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setError(null)
    try {
      const [m, i] = await Promise.all([
        listMembers(orgId),
        canManage ? listInvites(orgId) : Promise.resolve([] as OrganisationInvite[]),
      ])
      setMembers(m)
      setInvites(i)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your team')
    } finally {
      setLoading(false)
    }
  }, [orgId, canManage])

  useEffect(() => { load() }, [load])

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault()
    if (!orgId) return
    setInviteError(null)
    setNewInvite(null)
    setCopied(false)
    setInviting(true)
    try {
      const email = inviteEmail.trim().toLowerCase()
      const res = await createInvite(orgId, email, inviteRole)
      setNewInvite({ email, role: inviteRole, link: inviteLink(res.token), expiresAt: res.expiresAt, emailed: res.emailed })
      setInviteEmail('')
      load()
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not create the invite')
    } finally {
      setInviting(false)
    }
  }

  const copyLink = async () => {
    if (!newInvite) return
    try {
      await navigator.clipboard.writeText(newInvite.link)
      setCopied(true)
    } catch {
      await promptDialog({ title: 'Copy this invite link', body: 'Your browser blocked automatic copying. Select the link below and copy it.', defaultValue: newInvite.link, confirmLabel: 'Done' })
    }
  }

  const change = async (m: TeamMember, changes: { role?: UserRole; status?: 'active' | 'suspended' | 'revoked' }, confirmText?: string) => {
    if (confirmText && !await confirmDialog(confirmText)) return
    setBusyId(m.member_id)
    setError(null)
    try {
      await updateMember(m.member_id, changes)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this member')
    } finally {
      setBusyId(null)
    }
  }

  const resetTwoStep = async (m: TeamMember) => {
    if (!await confirmDialog(`Reset two-step sign-in for ${m.full_name}? Use this if they've lost their phone. They'll sign in with just their password and${m.role === 'owner' || m.role === 'manager' ? ' be asked to' : ' can'} set up a new authenticator app.`)) return
    setBusyId(m.member_id)
    setError(null)
    try {
      await resetMemberTwoStep(m.member_id)
      alertDialog(`Two-step sign-in reset for ${m.full_name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset two-step sign-in')
    } finally {
      setBusyId(null)
    }
  }

  const revoke = async (inv: OrganisationInvite) => {
    if (!await confirmDialog(`Cancel the invite for ${inv.email}? The link will stop working.`)) return
    setBusyId(inv.id)
    try {
      await revokeInvite(inv.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the invite')
    } finally {
      setBusyId(null)
    }
  }

  const canEdit = (m: TeamMember) =>
    canManage && m.user_id !== activeUser?.id && (isOwner || !SENIOR_ROLES.includes(m.role as InvitableRole))

  const mailto = newInvite
    ? `mailto:${encodeURIComponent(newInvite.email)}?subject=${encodeURIComponent(`Join ${organisation?.name ?? 'our pharmacy'} on PharmStation`)}&body=${encodeURIComponent(
      `Hi,\n\nYou've been invited to join ${organisation?.name ?? 'our pharmacy'} on PharmStation as ${ROLE_LABELS[newInvite.role]}.\n\nSet up your login here (use this email address, ${newInvite.email}):\n${newInvite.link}\n\nThe link works once and expires on ${formatDate(newInvite.expiresAt)}.\n`,
    )}`
    : ''

  const verification = organisation?.verification_status

  return (
    <div className="team-settings">
      {verification && verification !== 'verified' && (
        <div className={`ps-alert ${verification === 'rejected' ? 'ps-alert-error' : 'ps-alert-info'} team-verification`}>
          {verification === 'pending' ? (
            <span>
              <strong>Verification in progress.</strong> We&rsquo;re checking your GPhC premises registration. Until
              then you can use registers, logs and your team, but not network messaging or public listings. This
              usually takes one working day.
            </span>
          ) : (
            <span>
              <strong>We couldn&rsquo;t verify this pharmacy.</strong>{' '}
              {organisation?.verification_note ?? ''} Contact <a href="mailto:hello@pharmstation.co.uk">hello@pharmstation.co.uk</a>.
            </span>
          )}
        </div>
      )}

      {canManage && (
        <div className="ps-card team-card">
          <h2 className="team-card-title">Invite a member of staff</h2>
          <p className="team-card-help">
            Each person gets their own login, so every register entry and RP sign-in shows who did it. Invites
            are tied to one email address and expire after 7 days.
          </p>
          <form onSubmit={handleInvite} className="team-invite-form">
            <div className="form-group">
              <label htmlFor="invite-email">Email</label>
              <input id="invite-email" type="email" className="ps-input" value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@example.com" required />
            </div>
            <div className="form-group">
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" className="ps-input" value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InvitableRole)}>
                {invitableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <button type="submit" className="ps-btn ps-btn-primary team-invite-submit" disabled={inviting}>
              {inviting ? 'Creating…' : 'Create invite'}
            </button>
          </form>
          <p className="team-role-hint">{ROLE_HINTS[inviteRole]}</p>

          {inviteError && <div className="ps-alert ps-alert-error">{inviteError}</div>}

          {newInvite && (
            <div className="team-invite-result" role="status">
              {newInvite.emailed ? (
                <p>
                  We&rsquo;ve emailed an invite to <strong>{newInvite.email}</strong>. If it doesn&rsquo;t arrive, ask
                  them to check their spam folder, or send them this link yourself.
                </p>
              ) : (
                <p>
                  Invite ready for <strong>{newInvite.email}</strong>, but we couldn&rsquo;t email it. Send them this
                  link. It&rsquo;s shown once, so copy it now. If it&rsquo;s lost, just invite them again.
                </p>
              )}
              <div className="team-invite-link">
                <input className="ps-input" readOnly value={newInvite.link} aria-label="Invite link"
                  onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="ps-btn ps-btn-secondary" onClick={copyLink}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <a className="ps-btn ps-btn-ghost" href={mailto}>Email it</a>
              </div>
            </div>
          )}
        </div>
      )}

      {canManage && invites.length > 0 && (
        <div className="ps-card team-card">
          <h2 className="team-card-title">Waiting to join</h2>
          <ul className="team-list">
            {invites.map((inv) => (
              <li key={inv.id} className="team-row">
                <div className="team-row-main">
                  <strong>{inv.email}</strong>
                  <span className="team-row-meta">
                    {ROLE_LABELS[inv.role]} · invited {formatDate(inv.created_at)}
                    {inv.invited_by_name ? ` by ${inv.invited_by_name}` : ''} · expires {formatDate(inv.expires_at)}
                  </span>
                </div>
                <div className="team-row-actions">
                  <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === inv.id}
                    onClick={() => revoke(inv)}>
                    Cancel invite
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ps-card team-card">
        <h2 className="team-card-title">Team</h2>
        {error && <div className="ps-alert ps-alert-error">{error}</div>}
        {loading && <p className="team-card-help">Loading&hellip;</p>}
        {!loading && members.length === 0 && !error && <p className="team-card-help">No members yet.</p>}
        <ul className="team-list">
          {members.map((m) => {
            const editable = canEdit(m)
            const busy = busyId === m.member_id
            const roleOptions: UserRole[] = isOwner ? [...SENIOR_ROLES, ...STAFF_ROLES] : STAFF_ROLES
            return (
              <li key={m.member_id} className={`team-row ${m.status !== 'active' ? 'team-row-inactive' : ''}`}>
                <div className="team-row-main">
                  <strong>
                    {m.full_name}
                    {m.user_id === activeUser?.id && <span className="team-you"> (you)</span>}
                  </strong>
                  <span className="team-row-meta">
                    {m.email ? `${m.email} · ` : ''}
                    {m.gphc_number ? `GPhC ${m.gphc_number} · ` : ''}
                    joined {formatDate(m.created_at)}
                  </span>
                </div>
                <div className="team-row-actions">
                  {editable && m.role !== 'carehome_user' ? (
                    <select className="ps-input ps-input-sm team-role-select" value={m.role} disabled={busy}
                      aria-label={`Role for ${m.full_name}`}
                      onChange={(e) => change(m, { role: e.target.value as UserRole },
                        `Change ${m.full_name}'s role to ${ROLE_LABELS[e.target.value as UserRole]}? Their permissions change straight away.`)}>
                      {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  ) : (
                    <span className="team-role-label">{ROLE_LABELS[m.role] ?? m.role}</span>
                  )}
                  {statusBadge(m.status)}
                  {editable && m.status === 'active' && (
                    <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busy}
                      onClick={() => change(m, { status: 'suspended' },
                        `Suspend ${m.full_name}? They won't be able to sign in to ${organisation?.name ?? 'this pharmacy'} until you reactivate them. Their past entries stay on record.`)}>
                      Suspend
                    </button>
                  )}
                  {editable && m.status !== 'active' && (
                    <button type="button" className="ps-btn ps-btn-secondary ps-btn-sm" disabled={busy}
                      onClick={() => change(m, { status: 'active' })}>
                      Reactivate
                    </button>
                  )}
                  {editable && m.status === 'active' && (
                    <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busy}
                      title="Use when someone has lost the phone with their authenticator app"
                      onClick={() => resetTwoStep(m)}>
                      Reset two-step
                    </button>
                  )}
                  {editable && m.status !== 'revoked' && (
                    <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm team-remove" disabled={busy}
                      onClick={() => change(m, { status: 'revoked' },
                        `Remove ${m.full_name} from ${organisation?.name ?? 'this pharmacy'}? Their past register entries stay on record, attributed to them.`)}>
                      Remove
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {!canManage && (
          <p className="team-card-help">Ask an owner or manager to add or change staff.</p>
        )}
      </div>
    </div>
  )
}
