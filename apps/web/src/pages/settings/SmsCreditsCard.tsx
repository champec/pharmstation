import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSubscriptionStore, SMS_PACKS, formatPence } from '@pharmstation/core'

/** Prepaid text message credits: balance and packs to buy. */
export function SmsCreditsCard({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { smsBalance, fetchSmsBalance, buySmsCredits } = useSubscriptionStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const result = searchParams.get('credits')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    fetchSmsBalance(orgId)
  }, [orgId, fetchSmsBalance])

  // Back from Stripe: credits land when the webhook arrives, usually in seconds.
  useEffect(() => {
    if (result !== 'success') return
    let cancelled = false
    const before = useSubscriptionStore.getState().smsBalance
    setNotice('Payment received. Adding your credits…')
    ;(async () => {
      for (let i = 0; i < 8 && !cancelled; i++) {
        const now = await fetchSmsBalance(orgId)
        if (now !== null && before !== null && now > before) break
        await new Promise((r) => setTimeout(r, 2000))
      }
      if (cancelled) return
      setNotice('Thanks! Your text credits have been added.')
      const next = new URLSearchParams(searchParams)
      next.delete('credits')
      setSearchParams(next, { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, result]) // eslint-disable-line react-hooks/exhaustive-deps

  const buy = async (packId: string) => {
    setBusy(packId)
    setError('')
    try {
      window.location.href = await buySmsCredits(orgId, packId)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  const low = smsBalance !== null && smsBalance < 50

  return (
    <div className="ps-card billing-sms">
      <div className="billing-sms-head">
        <div>
          <div className="billing-eyebrow">Text message credits</div>
          <h3>
            {smsBalance === null ? '…' : smsBalance.toLocaleString('en-GB')} credits
            {low && <span className="ps-badge ps-badge-amber">Running low</span>}
          </h3>
          <p>
            One credit sends one text of up to 160 characters; longer texts use more. Credits never expire.
          </p>
        </div>
      </div>

      {result === 'cancel' && <div className="billing-banner">Purchase cancelled. Nothing was charged.</div>}
      {notice && <div className="billing-banner billing-banner-ok">{notice}</div>}
      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div className="billing-sms-packs">
        {SMS_PACKS.map((p) => (
          <button
            key={p.id}
            className="ps-btn ps-btn-secondary billing-sms-pack"
            onClick={() => buy(p.id)}
            disabled={!canManage || busy !== null}
          >
            <strong>{p.credits.toLocaleString('en-GB')} texts</strong>
            <span>
              {busy === p.id ? 'Opening Stripe…' : `${formatPence(p.pence)} · ${(p.pence / p.credits).toFixed(1)}p each`}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
