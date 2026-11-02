import { useState, type FormEvent } from 'react'
import {
  getUserClient,
  startOwnerClaim,
  acceptInvite,
  friendlyAuthError,
} from '@pharmstation/supabase-client'

/**
 * Second half of pharmacy sign-up: link the owner's PERSONAL account to the
 * pharmacy that the workstation session has just created.
 *
 * The pharmacy login (shared by the shop) and the owner's own login are
 * separate accounts on purpose: staff sign in as themselves on top of the
 * pharmacy session, so every register entry is attributed to a person.
 *
 * Requires an active workstation (org) session.
 */
export function OwnerSetupForm({ pharmacyName }: { pharmacyName?: string }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [fullName, setFullName] = useState('')
  const [gphcNumber, setGphcNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)

  const finish = async (ownerEmail: string) => {
    const token = await startOwnerClaim(ownerEmail)
    await acceptInvite(token)
    // Reload so the auth store restores both sessions plus the new membership.
    window.location.assign('/')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const cleanEmail = email.trim().toLowerCase()

    if (mode === 'new') {
      if (!fullName.trim()) return setError('Enter your full name')
      if (gphcNumber && !/^\d{7}$/.test(gphcNumber.trim())) return setError('A GPhC registration number is 7 digits')
      if (password.length < 10) return setError('Use at least 10 characters for your password')
      if (password !== confirm) return setError('The passwords don’t match')
    }

    setBusy(true)
    try {
      if (mode === 'existing') {
        const { error: signInError } = await getUserClient().auth.signInWithPassword({ email: cleanEmail, password })
        if (signInError) throw signInError
        await finish(cleanEmail)
        return
      }

      const { data, error: signUpError } = await getUserClient().auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login/org`,
          data: {
            account_type: 'user',
            full_name: fullName.trim(),
            gphc_number: gphcNumber.trim() || null,
            default_role: 'owner',
          },
        },
      })
      if (signUpError) throw signUpError
      // Supabase hides "already registered" behind a user with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setMode('existing')
        throw new Error('That email already has a PharmStation account. Sign in with it below.')
      }
      if (!data.session) {
        setAwaitingConfirm(true)
        return
      }
      await finish(cleanEmail)
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  if (awaitingConfirm) {
    return (
      <div>
        <h2 className="onboarding-step-title">Check your email</h2>
        <p className="onboarding-help">
          We&rsquo;ve sent a confirmation link to <strong>{email.trim().toLowerCase()}</strong>. Click it, then
          sign in to the pharmacy again. We&rsquo;ll bring you back here to finish, and you&rsquo;ll choose
          &ldquo;I already have an account&rdquo;.
        </p>
        <button type="button" className="ps-btn ps-btn-ghost" onClick={() => { setAwaitingConfirm(false); setMode('existing') }}>
          I&rsquo;ve confirmed it, sign me in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2 className="onboarding-step-title">Your personal login</h2>
      <p className="onboarding-help">
        You&rsquo;ll be the owner of {pharmacyName ? <strong>{pharmacyName}</strong> : 'this pharmacy'}. Use your own
        email, not the pharmacy&rsquo;s. Each member of staff signs in as themselves, so every register entry
        shows who made it.
      </p>

      <div className="onboarding-toggle" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'new'}
          className={`ps-btn ps-btn-sm ${mode === 'new' ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
          onClick={() => { setMode('new'); setError(null) }}>
          Create my account
        </button>
        <button type="button" role="tab" aria-selected={mode === 'existing'}
          className={`ps-btn ps-btn-sm ${mode === 'existing' ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
          onClick={() => { setMode('existing'); setError(null) }}>
          I already have an account
        </button>
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      {mode === 'new' && (
        <>
          <div className="form-group">
            <label htmlFor="owner-name">Full name</label>
            <input id="owner-name" className="ps-input" autoComplete="name" value={fullName}
              onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="owner-gphc">GPhC registration number <span className="onboarding-optional">(if you&rsquo;re a pharmacist)</span></label>
            <input id="owner-gphc" className="ps-input" inputMode="numeric" maxLength={7} value={gphcNumber}
              onChange={(e) => setGphcNumber(e.target.value.replace(/\D/g, ''))} />
          </div>
        </>
      )}

      <div className="form-group">
        <label htmlFor="owner-email">Your email</label>
        <input id="owner-email" type="email" className="ps-input" autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="form-group">
        <label htmlFor="owner-password">Password</label>
        <input id="owner-password" type="password" className="ps-input"
          autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={password}
          onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {mode === 'new' && (
        <div className="form-group">
          <label htmlFor="owner-confirm">Confirm password</label>
          <input id="owner-confirm" type="password" className="ps-input" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} required />
        </div>
      )}

      <button type="submit" className="ps-btn ps-btn-primary onboarding-submit" disabled={busy}>
        {busy ? 'Setting up…' : 'Finish setup'}
      </button>
    </form>
  )
}
