// ============================================
// MessageDetailModal — shared message detail view
// Used by MessagingHubPage (recent list) and MessageHistoryPage.
// Shows full delivery detail (like the SMS Works dashboard report)
// with actions: check status, retry (failed), reuse content.
// ============================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import type { NotifyMessage } from '@pharmstation/types'
import { Modal } from '../Modal'

export const STATUS_BADGES: Record<string, string> = {
  created: 'ps-badge',
  sending: 'ps-badge ps-badge-amber',
  sent: 'ps-badge ps-badge-amber',
  delivered: 'ps-badge ps-badge-green',
  failed: 'ps-badge ps-badge-red',
  'permanent-failure': 'ps-badge ps-badge-red',
  'temporary-failure': 'ps-badge ps-badge-amber',
  'technical-failure': 'ps-badge ps-badge-red',
}

/** Human labels — "sent" only means the provider accepted it; delivery is
 *  unconfirmed until the webhook reports, so we show it as pending. */
export const STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  sending: '⏳ Pending',
  sent: '⏳ Pending',
  delivered: '✓ Delivered',
  failed: 'Failed',
  'permanent-failure': 'Perm. failure',
  'temporary-failure': 'Temp. failure',
  'technical-failure': 'Tech. failure',
}

export const FAILED_STATUSES = ['failed', 'permanent-failure', 'temporary-failure', 'technical-failure']

const CHANNEL_ICON: Record<string, string> = { sms: '📱', email: '📧', letter: '✉️' }

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  message: NotifyMessage | null
  onClose: () => void
  /** Called after an action changed server state (check status / retry). */
  onChanged?: () => void
}

export function MessageDetailModal({ message, onClose, onChanged }: Props) {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { sendMessage } = useMessagingStore()

  const [checking, setChecking] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const close = () => {
    setNotice(null)
    setCopied(false)
    onClose()
  }

  const handleCheckStatus = async (m: NotifyMessage) => {
    if (!organisation?.id || !m.notify_message_id) return
    setChecking(true)
    setNotice(null)
    try {
      const { checkStatus } = useMessagingStore.getState()
      const r = await checkStatus(organisation.id, m.id)
      setNotice(`Status refreshed: ${STATUS_LABELS[r.status] ?? r.status}`)
      onChanged?.()
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : 'Status check failed')
    }
    setChecking(false)
  }

  const handleRetry = async (m: NotifyMessage) => {
    if (!organisation?.id || !m.body) return
    setRetrying(true)
    setNotice(null)
    try {
      const base = { org_id: organisation.id, body: m.body, patient_id: m.patient_id ?? undefined }
      if (m.channel === 'sms' && m.recipient_phone) {
        await sendMessage({ action: 'send_sms', phone_number: m.recipient_phone, ...base })
      } else if (m.channel === 'email' && m.recipient_email) {
        await sendMessage({ action: 'send_email', email_address: m.recipient_email, subject: m.subject ?? undefined, ...base })
      } else if (m.channel === 'letter' && m.recipient_address) {
        await sendMessage({ action: 'send_letter', address: m.recipient_address, ...base })
      } else {
        throw new Error('Original recipient details are missing — use "Reuse message" instead')
      }
      setNotice('✓ Message queued — it will appear at the top of the history')
      onChanged?.()
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : 'Retry failed')
    }
    setRetrying(false)
  }

  const handleReuse = (m: NotifyMessage) => {
    navigate(`/messaging/compose?channel=${m.channel}`, {
      state: { body: m.body ?? '', subject: m.subject ?? '' },
    })
  }

  const copyProviderId = (id: string) => {
    navigator.clipboard?.writeText(id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const m = message

  return (
    <Modal
      isOpen={!!m}
      onClose={close}
      title={m ? `${CHANNEL_ICON[m.channel] || ''} ${m.channel.toUpperCase()} Message` : ''}
      width="680px"
    >
      {m && (
        <div>
          {/* Status + provider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
            <span className={STATUS_BADGES[m.status] || 'ps-badge'} style={{ fontSize: '0.9rem' }}>
              {STATUS_LABELS[m.status] ?? m.status}
            </span>
            {m.provider && (
              <span style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                via {m.provider === 'nhs_notify' ? 'NHS Notify' : 'SMS Works'}
              </span>
            )}
          </div>

          {notice && (
            <div style={{
              padding: 'var(--ps-space-sm) var(--ps-space-md)', marginBottom: 'var(--ps-space-md)',
              background: 'var(--ps-ice-blue)', borderRadius: 'var(--ps-radius-md)', fontSize: '0.9rem',
            }}>
              {notice}
            </div>
          )}

          {/* Details grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', rowGap: 'var(--ps-space-sm)', columnGap: 'var(--ps-space-md)', fontSize: '0.9rem', marginBottom: 'var(--ps-space-md)' }}>
            <strong>Patient</strong>
            <span>{m.patient ? `${m.patient.first_name} ${m.patient.last_name}` : '—'}</span>

            <strong>To</strong>
            <span style={{ fontFamily: 'monospace' }}>
              {m.recipient_phone || m.recipient_email ||
                (m.recipient_address ? Object.values(m.recipient_address).join(', ') : '—')}
            </span>

            {m.sms_sender && (<>
              <strong>From (sender)</strong>
              <span>{m.sms_sender}</span>
            </>)}

            <strong>Created</strong>
            <span>{formatDate(m.created_at)}</span>

            {m.sent_at && (<>
              <strong>Submitted</strong>
              <span>{formatDate(m.sent_at)}</span>
            </>)}

            {m.delivered_at && (<>
              <strong>Delivered</strong>
              <span style={{ color: 'var(--ps-success)' }}>{formatDate(m.delivered_at)}</span>
            </>)}

            {m.failed_at && (<>
              <strong>Failed</strong>
              <span style={{ color: 'var(--ps-error)' }}>{formatDate(m.failed_at)}</span>
            </>)}

            {m.failure_reason && (<>
              <strong>Failure reason</strong>
              <span style={{ color: 'var(--ps-error)' }}>{m.failure_reason}</span>
            </>)}

            {(m.segments ?? null) !== null && (<>
              <strong>Segments</strong>
              <span>{m.segments} SMS segment{m.segments === 1 ? '' : 's'}{typeof m.credits === 'number' ? ` · ${m.credits} credit${m.credits === 1 ? '' : 's'}` : ''}</span>
            </>)}

            {m.feature && (<>
              <strong>Source</strong>
              <span>{m.feature}{m.reference ? ` (${m.reference})` : ''}</span>
            </>)}

            {m.notify_message_id && (<>
              <strong>Provider ID</strong>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
                {m.notify_message_id}
                <button className="ps-btn ps-btn-ghost" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => copyProviderId(m.notify_message_id!)}>
                  {copied ? '✓' : 'Copy'}
                </button>
              </span>
            </>)}
          </div>

          {/* Body */}
          {(m.subject || m.body) && (
            <div style={{
              padding: 'var(--ps-space-md)', background: 'var(--ps-off-white)',
              borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-md)',
              whiteSpace: 'pre-wrap', fontSize: '0.95rem',
            }}>
              {m.subject && <div style={{ fontWeight: 600, marginBottom: 'var(--ps-space-xs)' }}>{m.subject}</div>}
              {m.body}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
            {m.notify_message_id && (
              <button className="ps-btn ps-btn-secondary" disabled={checking} onClick={() => handleCheckStatus(m)}>
                {checking ? 'Checking…' : '🔄 Check status'}
              </button>
            )}
            {FAILED_STATUSES.includes(m.status) && m.body && (
              <button className="ps-btn ps-btn-primary" disabled={retrying} onClick={() => handleRetry(m)}>
                {retrying ? 'Re-sending…' : '↩️ Retry (same recipient)'}
              </button>
            )}
            {m.body && (
              <button className="ps-btn ps-btn-secondary" onClick={() => handleReuse(m)}>
                📝 Reuse message
              </button>
            )}
            <button className="ps-btn ps-btn-ghost" style={{ marginLeft: 'auto' }} onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
