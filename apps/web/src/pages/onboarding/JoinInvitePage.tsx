import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import {
  getUserClient,
  getAuthRedirectType,
  previewInvite,
  acceptInvite,
  friendlyAuthError,
  passwordProblem,
} from '@pharmstation/supabase-client'
import { ROLE_LABELS, type InvitePreview, type UserRole } from '@pharmstation/types'

type Joined = { organisation_id: string; organisation_name: string; role: UserRole }

/**
 * /join/:token — a member of staff accepts an invite.
 * The invite is bound to one email address; the database checks that the
 * signed-in account has that (confirmed) email before adding the membership.
 */
export function JoinInvitePage() {
  const { token = '' } = useParams<{ token: string }>()
  const { userSession, organisation, refreshUserLayer, userLogout } = useAuthStore()
  const [invite, setInvite] = useState<InvitePreview | null | undefined>(undefined)
  const justConfirmed = getAuthRedirectType() === 'signup'
  const [mode, setMode] = useState<'new' | 'existing'>(justConfirmed ? 'existing' : 'new')
  const [fullName, setFullName] = useState('')
  const [gphcNumber, setGphcNumber] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const [joined, setJoined] = useState<Joined | null>(null)

  useEffect(() => {
    previewInvite(token).then(setInvite).catch(() => setInvite(null))
  }, [token])

  const signedInEmail = userSession?.user?.email?.toLowerCase() ?? null
  const emailMatches = !!invite && signedInEmail === invite.email

  const accept = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const result = await acceptInvite(token)
      await refreshUserLayer()
      setJoined(result)
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }, [token, refreshUserLayer])

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault()
    if (!invite) return
    setError(null)
    if (mode === 'new') {
      if (!fullName.trim()) return setError('Enter your full name')
      if (gphcNumber && !/^\d{7}$/.test(gphcNumber)) return setError('A GPhC registration number is 7 digits')
      const pwProblem = passwordProblem(password)
      if (pwProblem) return setError(`${pwProblem} in your password`)
    }
    setBusy(true)
    try {
      if (mode === 'existing') {
        const { error: signInError } = await getUserClient().auth.signInWithPassword({ email: invite.email, password })
        if (signInError) throw signInError
      } else {
        const { data, error: signUpError } = await getUserClient().auth.signUp({
          email: invite.email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/join/${token}`,
            data: {
              account_type: 'user',
              full_name: fullName.trim(),
              gphc_number: gphcNumber || null,
              default_role: invite.role,
            },
          },
        })
        if (signUpError) throw signUpError
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMode('existing')
          throw new Error('You already have a PharmStation account. Sign in with it below.')
        }
        if (!data.session) {
          setAwaitingConfirm(true)
          return
        }
      }
      setBusy(false)
      await accept()
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="auth-card onboarding-card">
      <div className="logo">
        Pharm<span>Station</span>
      </div>
      {children}
    </div>
  )

  if (invite === undefined) return shell(<p>Checking your invite&hellip;</p>)

  if (invite === null || invite.status !== 'pending') {
    const reason = invite?.status === 'accepted'
      ? 'This invite has already been used.'
      : invite?.status === 'expired'
        ? 'This invite has expired.'
        : 'This invite link isn’t valid. It may have been replaced by a newer one.'
    return shell(
      <>
        <h1>Invite not available</h1>
        <p className="subtitle">{reason} Ask your pharmacy manager to send you a new invite.</p>
        {invite?.status === 'accepted' && <Link to="/login/org" className="ps-btn ps-btn-primary onboarding-submit">Go to sign in</Link>}
      </>,
    )
  }

  const roleLabel = ROLE_LABELS[invite.role] ?? invite.role

  if (joined) {
    const onThisWorkstation = organisation?.id === joined.organisation_id
    return shell(
      <>
        <h1>You&rsquo;re in</h1>
        <p className="subtitle">
          You&rsquo;ve joined <strong>{joined.organisation_name}</strong> as {ROLE_LABELS[joined.role] ?? joined.role}.
        </p>
        {onThisWorkstation ? (
          <button type="button" className="ps-btn ps-btn-primary onboarding-submit" onClick={() => window.location.assign('/')}>
            Go to the dashboard
          </button>
        ) : (
          <>
            <p className="onboarding-help">
              At the pharmacy, choose <strong>Staff sign in</strong> on a PharmStation computer and use{' '}
              <strong>{invite.email}</strong> with the password you just set.
            </p>
            <Link to="/me" className="ps-btn ps-btn-ghost onboarding-submit">Open my account</Link>
          </>
        )}
      </>,
    )
  }

  if (awaitingConfirm) {
    return shell(
      <>
        <h1>Check your email</h1>
        <p className="subtitle">
          We&rsquo;ve sent a confirmation link to <strong>{invite.email}</strong>. Click it and you&rsquo;ll come
          back here to finish joining {invite.organisation_name}.
        </p>
        <button type="button" className="ps-btn ps-btn-ghost" onClick={() => { setAwaitingConfirm(false); setMode('existing') }}>
          I&rsquo;ve confirmed it, sign me in
        </button>
      </>,
    )
  }

  return shell(
    <>
      <h1>Join {invite.organisation_name}</h1>
      <p className="subtitle">
        {invite.invited_by_name ? <>{invite.invited_by_name} has invited you</> : <>You&rsquo;ve been invited</>} to join as{' '}
        <strong>{roleLabel}</strong>. This invite is for <strong>{invite.email}</strong> and expires on{' '}
        {new Date(invite.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.
      </p>

      {justConfirmed && !signedInEmail && !error && (
        <div className="ps-alert ps-alert-success onboarding-notice">Email confirmed. Sign in to finish joining.</div>
      )}
      {error && <div className="auth-error" role="alert">{error}</div>}

      {signedInEmail && emailMatches && (
        <button type="button" className="ps-btn ps-btn-primary onboarding-submit" disabled={busy} onClick={accept}>
          {busy ? 'Joining…' : `Accept and join as ${roleLabel}`}
        </button>
      )}

      {signedInEmail && !emailMatches && (
        <>
          <p className="onboarding-help">
            You&rsquo;re signed in as <strong>{signedInEmail}</strong>, but this invite is for{' '}
            <strong>{invite.email}</strong>.
          </p>
          <button type="button" className="ps-btn ps-btn-primary onboarding-submit" onClick={() => userLogout()}>
            Sign out and continue as {invite.email}
          </button>
        </>
      )}

      {!signedInEmail && (
        <form onSubmit={handleAuth} noValidate>
          <div className="onboarding-toggle" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'new'}
              className={`ps-btn ps-btn-sm ${mode === 'new' ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
              onClick={() => { setMode('new'); setError(null) }}>
              I&rsquo;m new to PharmStation
            </button>
            <button type="button" role="tab" aria-selected={mode === 'existing'}
              className={`ps-btn ps-btn-sm ${mode === 'existing' ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
              onClick={() => { setMode('existing'); setError(null) }}>
              I have an account
            </button>
          </div>

          <div className="form-group">
            <label htmlFor="join-email">Email</label>
            <input id="join-email" type="email" className="ps-input" value={invite.email} readOnly />
          </div>
          {mode === 'new' && (
            <>
              <div className="form-group">
                <label htmlFor="join-name">Full name</label>
                <input id="join-name" className="ps-input" autoComplete="name" value={fullName}
                  onChange={(e) => setFullName(e.target.value)} required autoFocus />
              </div>
              {(invite.role === 'pharmacist' || invite.role === 'locum' || invite.role === 'technician' || invite.role === 'owner' || invite.role === 'manager') && (
                <div className="form-group">
                  <label htmlFor="join-gphc">GPhC registration number <span className="onboarding-optional">(optional)</span></label>
                  <input id="join-gphc" className="ps-input" inputMode="numeric" maxLength={7} value={gphcNumber}
                    onChange={(e) => setGphcNumber(e.target.value.replace(/\D/g, ''))} />
                </div>
              )}
            </>
          )}
          <div className="form-group">
            <label htmlFor="join-password">{mode === 'new' ? 'Choose a password' : 'Password'}</label>
            <input id="join-password" type="password" className="ps-input"
              autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="ps-btn ps-btn-primary onboarding-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'new' ? 'Create account and join' : 'Sign in and join'}
          </button>
        </form>
      )}
    </>,
  )
}
