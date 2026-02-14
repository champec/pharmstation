import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import type { RegisterEntry, RegisterLedger } from '@pharmstation/types'

function toIsoDateLocal(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().split('T')[0]
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getLatestEffectiveForDate(entries: RegisterEntry[]) {
  const normals = entries.filter((entry) => entry.entry_type === 'normal')
  const corrections = entries.filter((entry) => entry.entry_type === 'correction')

  const latestCorrectionByTarget = new Map<string, RegisterEntry>()
  for (const correction of corrections) {
    if (!correction.corrects_entry_id) continue
    const current = latestCorrectionByTarget.get(correction.corrects_entry_id)
    if (!current || new Date(correction.entered_at) > new Date(current.entered_at)) {
      latestCorrectionByTarget.set(correction.corrects_entry_id, correction)
    }
  }

  return normals
    .map((normal) => latestCorrectionByTarget.get(normal.id) ?? normal)
    .sort((a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime())
}

const moduleCards = [
  {
    icon: '📑',
    title: 'Registers',
    description: 'CD Register, RP Log, and Patient Returns',
    to: '/registers',
  },
  {
    icon: '📌',
    title: 'Handover Notes',
    description: 'Staff handover board and task management',
    to: '/handover',
  },
  {
    icon: '📋',
    title: 'SOPs',
    description: 'Standard Operating Procedures library',
    to: '/sops',
  },
  {
    icon: '⚙',
    title: 'Settings',
    description: 'Organisation settings and user management',
    to: '/settings',
  },
]

export function DashboardPage() {
  const navigate = useNavigate()
  const { activeUser, organisation, membership } = useAuthStore()
  const [activeRp, setActiveRp] = useState<RegisterEntry | null>(null)
  const [rpLoading, setRpLoading] = useState(true)
  const [rpError, setRpError] = useState<string | null>(null)

  const loadActiveRp = useCallback(async () => {
    if (!organisation) return

    setRpLoading(true)
    setRpError(null)

    try {
      const today = toIsoDateLocal(new Date())
      const { data, error } = await getUserClient()
        .from('ps_register_entries')
        .select('*')
        .eq('organisation_id', organisation.id)
        .eq('register_type', 'RP')
        .eq('date_of_transaction', today)
        .order('entered_at', { ascending: true })

      if (error) {
        throw error
      }

      const effectiveEntries = getLatestEffectiveForDate((data as RegisterEntry[]) ?? [])
      const active = [...effectiveEntries]
        .reverse()
        .find((entry) => !!entry.rp_signed_in_at && !entry.rp_signed_out_at)

      setActiveRp(active ?? null)
    } catch (err) {
      setRpError(err instanceof Error ? err.message : 'Failed to load RP status')
      setActiveRp(null)
    } finally {
      setRpLoading(false)
    }
  }, [organisation])

  useEffect(() => {
    loadActiveRp()
  }, [loadActiveRp])

  const handleSignInAsRp = async () => {
    if (!organisation || !activeUser) return

    if (!activeUser.gphc_number) {
      setRpError('Your profile has no GPhC number. Add it before signing in as RP.')
      return
    }

    const confirmed = window.confirm(
      'By signing in as today\'s Responsible Pharmacist, you are making a legal declaration and accepting responsibility for all RP duties in this pharmacy. Continue?',
    )

    if (!confirmed) return

    try {
      const { data: existingLedger, error: lookupError } = await getUserClient()
        .from('ps_register_ledgers')
        .select('*')
        .eq('organisation_id', organisation.id)
        .eq('register_type', 'RP')
        .is('drug_id', null)
        .maybeSingle()

      if (lookupError) {
        throw lookupError
      }

      let ledger: RegisterLedger | null = (existingLedger as RegisterLedger | null) ?? null

      if (!ledger) {
        const { data: newLedger, error: createError } = await getUserClient()
          .from('ps_register_ledgers')
          .insert({
            organisation_id: organisation.id,
            register_type: 'RP',
            drug_name: 'Responsible Pharmacist Log',
          })
          .select('*')
          .single()

        if (createError) {
          throw createError
        }

        ledger = newLedger as RegisterLedger
      }

      const now = new Date()
      const { error: entryError } = await getUserClient().rpc('ps_make_register_entry', {
        p_ledger_id: ledger.id,
        p_register_type: 'RP',
        p_entry_type: 'normal',
        p_date_of_transaction: toIsoDateLocal(now),
        p_source: 'manual',
        p_expected_lock_version: ledger.lock_version,
        p_entered_by: activeUser.id,
        p_authorised_by: activeUser.full_name,
        p_pharmacist_name: activeUser.full_name,
        p_gphc_number: activeUser.gphc_number,
        p_rp_signed_in_at: now.toISOString(),
        p_rp_signed_out_at: null,
        p_notes: 'Signed in from dashboard prompt',
      })

      if (entryError) {
        throw entryError
      }

      await loadActiveRp()
    } catch (err) {
      setRpError(err instanceof Error ? err.message : 'Failed to sign in as RP')
    }
  }

  const canPromptRpSignIn = membership?.role === 'pharmacist' || membership?.role === 'locum'

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Welcome back, {activeUser?.full_name ?? 'User'} — {organisation?.name ?? ''}
        </p>
      </div>

      <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)', padding: 'var(--ps-space-md)' }}>
        {rpLoading ? (
          <p style={{ color: 'var(--ps-slate)' }}>Checking today’s RP status...</p>
        ) : activeRp ? (
          <div>
            <strong>✅ Acting RP in store:</strong> {activeRp.pharmacist_name || 'Unknown'}
            <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: '4px' }}>
              Signed in at {formatDateTime(activeRp.rp_signed_in_at)}
            </div>
          </div>
        ) : canPromptRpSignIn ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            <div>
              <strong>⚠️ No acting RP signed in for today.</strong>
              <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: '4px' }}>
                Do you want to sign in as today’s Responsible Pharmacist?
              </div>
            </div>
            <button type="button" className="ps-btn ps-btn-primary" onClick={handleSignInAsRp}>
              Sign in as RP
            </button>
          </div>
        ) : (
          <p style={{ color: 'var(--ps-slate)' }}>No acting RP signed in for today.</p>
        )}

        {rpError && (
          <div className="auth-error" style={{ marginTop: 'var(--ps-space-sm)' }}>
            {rpError}
          </div>
        )}
      </div>

      <div className="dashboard-grid">
        {moduleCards.map((card) => (
          <div
            key={card.to}
            className="dashboard-card"
            onClick={() => navigate(card.to)}
          >
            <div className="dashboard-card-icon">{card.icon}</div>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
