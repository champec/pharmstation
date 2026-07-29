import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Patient, SmsInbound, SmsInboundDisposition } from '@pharmstation/types'

type InboxTab = 'inbox' | 'requests' | 'blocked'

const TAB_DISPOSITION: Record<InboxTab, SmsInboundDisposition> = {
  inbox: 'inbox',
  requests: 'quarantine',
  blocked: 'blocked',
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function displayPhone(normalized: string) {
  return normalized.startsWith('44') ? `+${normalized}` : normalized
}

interface Conversation {
  phoneNumber: string
  latest: SmsInbound
  unread: number
  count: number
}

export function SmsInboxPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { organisation, activeUser } = useAuthStore()
  const {
    inbound, smsThread, smsSenderControls, smsSettings, unreadInboundCount, error,
    fetchInbound, fetchSmsThread, fetchSmsSenderControls, fetchSmsSettings,
    markSmsConversationRead, sendSmsReply, setSmsSenderControl, linkSmsSenderToPatient,
    subscribeToInbound, unsubscribeFromInbound, clearError,
  } = useMessagingStore()

  const [tab, setTab] = useState<InboxTab>('inbox')
  const [selectedPhone, setSelectedPhone] = useState(searchParams.get('sender') ?? '')
  const [search, setSearch] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<Patient[]>([])

  const orgId = organisation?.id
  const load = useCallback(async () => {
    if (!orgId) return
    await Promise.all([
      fetchInbound(orgId, { disposition: TAB_DISPOSITION[tab], limit: 500 }),
      fetchSmsSenderControls(orgId),
      fetchSmsSettings(orgId),
    ])
  }, [orgId, tab, fetchInbound, fetchSmsSenderControls, fetchSmsSettings])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!orgId || tab !== 'inbox') {
      unsubscribeFromInbound()
      return
    }
    subscribeToInbound(orgId)
    return () => unsubscribeFromInbound()
  }, [orgId, tab, subscribeToInbound, unsubscribeFromInbound])

  const conversations = useMemo(() => {
    const grouped = new Map<string, Conversation>()
    for (const message of inbound) {
      const current = grouped.get(message.normalized_from_number)
      if (!current) {
        grouped.set(message.normalized_from_number, {
          phoneNumber: message.normalized_from_number,
          latest: message,
          unread: message.is_read ? 0 : 1,
          count: 1,
        })
      } else {
        current.count += 1
        if (!message.is_read) current.unread += 1
        if (message.received_at > current.latest.received_at) current.latest = message
      }
    }
    const query = search.trim().toLowerCase()
    return [...grouped.values()]
      .filter((item) => {
        if (!query) return true
        const patient = item.latest.patient
        return item.phoneNumber.includes(query) || item.latest.content.toLowerCase().includes(query) ||
          `${patient?.first_name ?? ''} ${patient?.last_name ?? ''}`.toLowerCase().includes(query)
      })
      .sort((a, b) => b.latest.received_at.localeCompare(a.latest.received_at))
  }, [inbound, search])

  const selected = conversations.find((item) => item.phoneNumber === selectedPhone) ?? null
  const selectedControl = smsSenderControls.find((item) => item.phone_number === selectedPhone)

  useEffect(() => {
    if (!selectedPhone || !orgId) return
    fetchSmsThread(orgId, selectedPhone)
    if (tab === 'inbox') markSmsConversationRead(orgId, selectedPhone)
  }, [selectedPhone, orgId, tab, fetchSmsThread, markSmsConversationRead])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (!orgId || patientSearch.trim().length < 2) {
        setPatientResults([])
        return
      }
      const query = patientSearch.trim()
      const { data } = await getUserClient().from('ps_patients').select('*')
        .eq('organisation_id', orgId)
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%,nhs_number.ilike.%${query}%`)
        .limit(8)
      setPatientResults((data ?? []) as Patient[])
    }, 250)
    return () => window.clearTimeout(timer)
  }, [orgId, patientSearch])

  function selectConversation(phoneNumber: string) {
    setSelectedPhone(phoneNumber)
    setSearchParams({ sender: phoneNumber })
    setNotice(null)
    setPatientSearch('')
    setPatientResults([])
  }

  async function handleReply() {
    if (!orgId || !selected || !reply.trim()) return
    setSending(true)
    setNotice(null)
    try {
      await sendSmsReply({
        orgId,
        phoneNumber: selected.phoneNumber,
        patientId: selected.latest.patient_id ?? undefined,
        body: reply.trim(),
      })
      setReply('')
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : 'Could not send the reply')
    } finally {
      setSending(false)
    }
  }

  async function changeSenderControl(status: 'approved' | 'blocked' | 'muted' | null) {
    if (!orgId || !selectedPhone) return
    const mutedUntil = status === 'muted' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null
    await setSmsSenderControl({
      orgId, phoneNumber: selectedPhone, status, mutedUntil,
      reason: status === 'blocked' ? 'Blocked by pharmacy staff' : undefined,
      userId: activeUser?.id,
    })
    setSelectedPhone('')
    setSearchParams({})
    await load()
  }

  async function linkPatient(patient: Patient) {
    if (!orgId || !selectedPhone) return
    await linkSmsSenderToPatient(orgId, selectedPhone, patient.id)
    await setSmsSenderControl({
      orgId, phoneNumber: selectedPhone, status: 'approved', userId: activeUser?.id,
    })
    setPatientSearch('')
    setPatientResults([])
    await load()
    setNotice(`Linked to ${patient.first_name} ${patient.last_name}`)
  }

  const patient = selected?.latest.patient
  const canReply = Boolean(smsSettings?.reply_number) && selectedControl?.status !== 'blocked'
  const segmentCount = reply.length === 0 ? 0 : reply.length <= 160 ? 1 : Math.ceil(reply.length / 153)

  return (
    <div>
      <div className="page-header sms-inbox-header">
        <div>
          <div className="breadcrumbs">
            <a href="/" onClick={(event) => { event.preventDefault(); navigate('/') }}>Dashboard</a>
            <span className="separator">/</span>
            <a href="/messaging" onClick={(event) => { event.preventDefault(); navigate('/messaging') }}>Messaging</a>
            <span className="separator">/</span>
            <span>Patient inbox</span>
          </div>
          <h1>Patient text messages</h1>
        </div>
        <div className="sms-inbox-number">
          <span>Reply number</span>
          <strong>{smsSettings?.reply_number ? displayPhone(smsSettings.reply_number) : 'Not assigned'}</strong>
        </div>
      </div>

      {error && <div className="auth-error"><span>{error}</span><button className="ps-btn ps-btn-ghost" onClick={clearError}>Dismiss</button></div>}

      <div className="sms-inbox-tabs" role="tablist" aria-label="Message folders">
        {(['inbox', 'requests', 'blocked'] as InboxTab[]).map((item) => (
          <button key={item} className={tab === item ? 'active' : ''} onClick={() => {
            setTab(item); setSelectedPhone(''); setSearchParams({})
          }}>
            {item === 'inbox' ? `Inbox${unreadInboundCount ? ` (${unreadInboundCount})` : ''}` : item === 'requests' ? 'Requests' : 'Blocked'}
          </button>
        ))}
      </div>

      <div className="sms-inbox-workspace">
        <aside className="sms-conversation-list">
          <div className="sms-conversation-search">
            <input className="ps-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages or patients" />
          </div>
          {conversations.length === 0 ? (
            <div className="sms-empty-list">No {tab === 'inbox' ? 'messages' : tab}.</div>
          ) : conversations.map((conversation) => {
            const rowPatient = conversation.latest.patient
            return (
              <button
                key={conversation.phoneNumber}
                className={`sms-conversation-row${selectedPhone === conversation.phoneNumber ? ' selected' : ''}`}
                onClick={() => selectConversation(conversation.phoneNumber)}
              >
                <span className="sms-conversation-avatar">{rowPatient?.first_name?.[0] ?? '?'}</span>
                <span className="sms-conversation-copy">
                  <span className="sms-conversation-name">
                    {rowPatient ? `${rowPatient.first_name} ${rowPatient.last_name}` : 'Unknown sender'}
                    {conversation.unread > 0 && <span className="sms-unread-dot" title={`${conversation.unread} unread`} />}
                  </span>
                  <span className="sms-conversation-preview">{conversation.latest.content}</span>
                  <span className="sms-conversation-meta">{displayPhone(conversation.phoneNumber)} · {formatTime(conversation.latest.received_at)}</span>
                </span>
              </button>
            )
          })}
        </aside>

        <main className="sms-thread-panel">
          {!selected ? (
            <div className="sms-thread-empty">Select a conversation to read and reply.</div>
          ) : (
            <>
              <header className="sms-thread-header">
                <div>
                  <h2>{patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown sender'}</h2>
                  <span>{displayPhone(selected.phoneNumber)}</span>
                </div>
                <div className="sms-thread-actions">
                  {tab === 'requests' && <button className="ps-btn ps-btn-secondary" onClick={() => changeSenderControl('approved')}>Approve</button>}
                  {selectedControl?.status === 'blocked'
                    ? <button className="ps-btn ps-btn-secondary" onClick={() => changeSenderControl(null)}>Unblock</button>
                    : <button className="ps-btn ps-btn-ghost" onClick={() => changeSenderControl('muted')}>Mute 24h</button>}
                  {selectedControl?.status !== 'blocked' && <button className="ps-btn ps-btn-danger" onClick={() => changeSenderControl('blocked')}>Block</button>}
                </div>
              </header>

              <div className="sms-thread-body">
                {patient ? (
                  <div className="sms-patient-strip">
                    <button onClick={() => navigate(`/patients/${patient.id}`)}>{patient.first_name} {patient.last_name}</button>
                    <span>DOB {patient.dob ? new Date(patient.dob).toLocaleDateString('en-GB') : 'not recorded'}</span>
                    <span>NHS {patient.nhs_number || 'not recorded'}</span>
                    <span>{patient.phone || 'No phone recorded'}</span>
                    <span>{patient.email || 'No email recorded'}</span>
                    <span>{[patient.address_line_1, patient.address_line_2, patient.city, patient.postcode].filter(Boolean).join(', ') || 'No address recorded'}</span>
                  </div>
                ) : (
                  <div className="sms-patient-linker">
                    <input className="ps-input" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} placeholder="Link this number to a patient" />
                    {patientResults.length > 0 && <div className="sms-patient-results">
                      {patientResults.map((result) => <button key={result.id} onClick={() => linkPatient(result)}>
                        <strong>{result.first_name} {result.last_name}</strong><span>{result.phone || 'No phone'} · {result.dob || 'DOB unknown'}</span>
                      </button>)}
                    </div>}
                  </div>
                )}

                <div className="sms-message-stream">
                  {smsThread.map((message) => (
                    <div key={`${message.direction}-${message.id}`} className={`sms-message ${message.direction}`}>
                      <div>{message.body}</div>
                      <span>{formatTime(message.timestamp)}{message.status ? ` · ${message.status}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>

              <footer className="sms-reply-box">
                {notice && <div className="sms-reply-notice">{notice}</div>}
                {!smsSettings?.reply_number && <div className="sms-reply-warning">Assign a reply number in Messaging settings before responding.</div>}
                <textarea
                  className="ps-input" value={reply} onChange={(event) => setReply(event.target.value)}
                  placeholder="Write a reply" rows={3} disabled={!canReply || sending}
                />
                <div>
                  <span>{reply.length} characters · {segmentCount} SMS {segmentCount === 1 ? 'segment' : 'segments'}</span>
                  <button className="ps-btn ps-btn-primary" onClick={handleReply} disabled={!canReply || !reply.trim() || sending}>
                    {sending ? 'Sending...' : 'Send reply'}
                  </button>
                </div>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  )
}